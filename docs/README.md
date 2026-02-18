# The Logbook - Documentation

Welcome to The Logbook documentation! This directory contains comprehensive guides, references, and troubleshooting resources.

---

## 📚 Documentation Index

### 🚨 Troubleshooting & Errors

**Start here if you're experiencing issues:**

1. **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** ⭐ **START HERE**
   - Comprehensive troubleshooting guide for common issues
   - Step-by-step solutions for onboarding, SMTP, network, and database issues
   - Diagnostic commands and verification scripts
   - **Updated**: 2026-02-16 with database startup reliability improvements, hierarchical document folders, role sync fixes, dark theme unification, form enhancements, plus theme support, dashboard redesign, election fixes

2. **[ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md)**
   - Complete catalog of all 94+ error messages in the application
   - Quality ratings and improvement status for each error
   - Troubleshooting steps for every error
   - Implementation roadmap

3. **[ERROR_MESSAGES_LOGO_UPLOAD.md](./ERROR_MESSAGES_LOGO_UPLOAD.md)**
   - Detailed guide for logo upload errors
   - Security validation explanations
   - File size, type, and dimension requirements
   - Testing procedures

---

### 🔒 Security Documentation

5. **[SECURITY_IMAGE_UPLOADS.md](../SECURITY_IMAGE_UPLOADS.md)**
   - Comprehensive image upload security measures
   - Attack vectors addressed (XSS, file spoofing, DoS, privacy leaks)
   - Validation layers (frontend, magic bytes, metadata stripping)
   - Security workflow and compliance information

6. **[ENUM_CONVENTIONS.md](./ENUM_CONVENTIONS.md)**
   - Enum naming and case conventions (always lowercase)
   - Step-by-step guide for adding new enums
   - Migration patterns for fixing enum values
   - Automated validation and testing procedures
   - Prevents critical enum case mismatch bugs

7. **[ELECTION_SECURITY_AUDIT.md](../ELECTION_SECURITY_AUDIT.md)**
   - Comprehensive election/voting system security review (rating: 9.0/10)
   - Double-voting vulnerability analysis and database constraint fixes
   - Anonymous voting implementation review (HMAC-SHA256)
   - Election results timing enforcement

---

### 📋 Module Documentation

8. **[FORMS_MODULE.md](./FORMS_MODULE.md)**
   - Complete Forms module documentation
   - Public-facing forms with QR code generation
   - Cross-module integrations (Membership, Inventory)
   - Security: input sanitization, rate limiting, honeypot bot detection
   - API endpoint reference (20+ endpoints)
   - Database models, migrations, and permissions

9. **[PROSPECTIVE_MEMBERS_MODULE.md](./PROSPECTIVE_MEMBERS_MODULE.md)**
   - Prospective Members Pipeline module documentation
   - Configurable pipeline stages (form submission, document upload, election/vote, manual approval)
   - Inactivity timeout system with per-stage overrides
   - Applicant lifecycle (active, on_hold, withdrawn, converted, rejected, inactive)
   - Conversion flow, reactivation, and auto-purge for data privacy
   - Kanban board and table view modes
   - Zustand store architecture and frontend components

10. **[MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md)**
    - Meeting Minutes and Documents module documentation
    - 8 meeting types with tailored default section templates
    - Template system with configurable sections, header/footer
    - Dynamic sections: reorder, add, remove with draft/review/approved lifecycle
    - Publish approved minutes to Documents module as styled HTML
    - 7 system document folders with custom folder support
    - API endpoint reference and security considerations

10. **[PUBLIC_API_DOCUMENTATION.md](./PUBLIC_API_DOCUMENTATION.md)**
    - Public API v1.1.0 with public form endpoints
    - Form retrieval and submission without authentication
    - Rate limiting, security notes, integration examples

10. **[TRAINING_PROGRAMS.md](./TRAINING_PROGRAMS.md)** (Updated 2026-02-14)
    - Complete Training module documentation
    - Pipeline programs, requirements, phases, enrollments, progress tracking
    - Self-reported training with configurable approval workflow
    - Shift completion reports with auto-pipeline progress updates
    - Member Training page with configurable visibility (14 toggle settings)
    - Training reports: training progress, annual training, date range picker
    - External training integration (Vector Solutions, Target Solutions, Lexipol)
    - Registry support (NFPA, NREMT, Pro Board)
    - API reference and database schema for all training tables

11. **[DROP_NOTIFICATIONS.md](./DROP_NOTIFICATIONS.md)** (New 2026-02-14)
    - Configurable drop/separation notification messages
    - Organization-level settings: CC roles, static CC emails, personal email toggle
    - Default MEMBER_DROPPED email template with 10 template variables
    - CC/BCC support in EmailService for all outbound emails
    - Personal email field on user profiles for post-separation contact
    - Template editing via Settings > Email Templates
    - API reference for organization settings and email template endpoints

11. **Documents Module**
    - Document storage with folder hierarchy (create, browse, upload, delete)
    - File metadata tracking (size, MIME type, upload date)
    - Document status workflow (draft, active, archived)
    - API endpoints: 8 endpoints for folder CRUD, document CRUD, summary
    - Permissions: `documents.view`, `documents.manage`

11. **Meetings & Minutes Module**
    - Meeting creation with type classification (regular, special, emergency, committee, board)
    - Attendee tracking and action item management
    - Meeting approval workflow (draft, approved, archived)
    - API endpoints: 12 endpoints for meeting CRUD, attendees, action items, summary
    - Permissions: `meetings.view`, `meetings.manage`

12. **Scheduling Module** (Enhanced 2026-02-14)
    - Shift creation, templates, and recurring patterns (daily/weekly/platoon/custom)
    - Auto-generation of shifts from patterns with pre-assigned members
    - Duty roster: assign members to shifts with position and confirm/decline workflow
    - Shift swap requests with officer approval workflow
    - Time-off requests with approval and member availability checking
    - Shift call recording with incident details and responding members
    - Week and month calendar views with real shift data
    - Attendance tracking per shift with check-in/check-out
    - Reports: member hours, shift coverage, call volume analysis
    - Personal views: my-shifts, my-assignments
    - API endpoints: 49 endpoints for shifts, templates, patterns, assignments, swaps, time-off, calls, reports
    - Permissions: `scheduling.view`, `scheduling.manage`, `scheduling.assign`, `scheduling.swap`, `scheduling.report`
    - Roles: Scheduling Officer with full scheduling access

13. **Facilities Module** (New 2026-02-14)
    - Building and property management with types, statuses, addresses, GPS, and photos
    - Maintenance scheduling with 20 default maintenance types and recommended frequencies
    - Facility inspections with pass/fail tracking and follow-up
    - Utility tracking: accounts and meter readings for electric, gas, water, sewer, internet, phone, trash
    - Key & access management: keys, fobs, cards, codes with member assignment
    - Room/space inventory with type, capacity, and equipment tracking
    - Emergency contacts & shutoff locations by category
    - Capital improvement projects with budget, timeline, and contractor tracking
    - Insurance policies: building, liability, flood, earthquake, equipment with coverage and renewal tracking
    - Occupant/unit assignments for multi-use facilities
    - ADA/compliance checklists with individual items and due dates
    - Seed data: 10 facility types, 6 statuses, 20 maintenance types
    - API endpoints: full CRUD for 14 entity types under `/api/v1/facilities/`
    - Permissions: `facilities.view`, `facilities.create`, `facilities.edit`, `facilities.delete`, `facilities.maintenance`, `facilities.manage`
    - Roles: Facilities Manager for day-to-day building management

14. **Reports Module** (Updated 2026-02-14)
    - Report generation: member roster, training summary, event attendance, training progress, annual training
    - Data aggregation from members, training records, events, shift reports, and pipeline enrollments
    - Customizable reporting period with date range picker (This Year, Last Year, Last 90 Days, Custom)
    - Tabular report display with filtering
    - API endpoints: 2 endpoints (available reports list, generate report)
    - Permissions: `reports.view`, `reports.manage`

14. **Notifications Module**
    - Notification rule creation with trigger/category configuration
    - Rule toggle (enable/disable) with persistence
    - Notification log tracking with delivery status and read state
    - API endpoints: 8 endpoints for rule CRUD, toggle, logs, mark-read, summary
    - Permissions: `notifications.view`, `notifications.manage`

15. **Events Module** (Enhanced 2026-02-14)
    - Event creation with dedicated `EventCreatePage` and reusable `EventForm` component
    - Event edit/delete with `EventEditPage`, cancel notifications
    - Event duplication from detail page
    - Recurring events with daily/weekly/monthly/yearly patterns
    - Event templates for reusable configurations
    - Attachment upload, download, and delete
    - Location booking prevention (double-booking protection across all event types including training)
    - `exclude_event_types` filter for hall coordinators to hide training events from their view
    - RSVP overrides for admin flexibility
    - Organization timezone support in date formatting
    - QR code check-in, self-check-in pages, analytics
    - Comprehensive test coverage (5 test files, 1,865+ lines)
    - API endpoints: events CRUD, RSVP, attachments, templates, recurrence, duplication
    - Permissions: `events.view`, `events.manage`

---

### 🛠️ Development & Operations

10. **[ONBOARDING_REVIEW.md](../ONBOARDING_REVIEW.md)**
    - Analysis of startup delays and optimization recommendations
    - Docker Compose configuration improvements
    - Database connection retry strategy
    - Migration performance optimization

11. **[ASYNC_SQLALCHEMY_REVIEW.md](../ASYNC_SQLALCHEMY_REVIEW.md)**
    - Full codebase audit of 32 flush() calls for greenlet errors
    - 87.5% safe, 4 low-risk patterns identified, 0 critical issues
    - Recommendations for async SQLAlchemy best practices

---

## 🎯 Quick Start Guide

### For End Users

**Having trouble with onboarding?**
1. Go to [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
2. Use Ctrl+F to search for your error message
3. Follow the step-by-step solution

**Common Issues**:
- Username/email already exists → [User Account Issues](./TROUBLESHOOTING.md#user-account-issues)
- SMTP not working → [Email & SMTP Configuration](./TROUBLESHOOTING.md#email--smtp-configuration)
- Logo won't upload → [Image Upload Issues](./TROUBLESHOOTING.md#image-upload-issues)
- Can't connect to server → [Network & Connection Problems](./TROUBLESHOOTING.md#network--connection-problems)

---

### For Administrators

**Diagnosing issues:**
```bash
# Check all containers running
docker-compose ps

# Check backend logs
docker logs the-logbook-backend-1 --tail 100

# Verify database enums
python backend/scripts/verify_database_enums.py

# Run migrations
cd backend && alembic upgrade head
```

**Key Resources**:
- [Database & Migration Issues](./TROUBLESHOOTING.md#database--migration-issues)
- [Enum Verification](./ENUM_CONVENTIONS.md)
- [Security Validations](../SECURITY_IMAGE_UPLOADS.md)

---

### For Developers

**Adding new features:**
1. **Enums**: Follow [ENUM_CONVENTIONS.md](./ENUM_CONVENTIONS.md)
2. **Error Messages**: Use [errorHandler.ts](../frontend/src/modules/onboarding/utils/errorHandler.ts)
3. **Image Uploads**: Review [SECURITY_IMAGE_UPLOADS.md](../SECURITY_IMAGE_UPLOADS.md)
4. **Migrations**: Check [Database Issues](./TROUBLESHOOTING.md#database--migration-issues)

**Testing:**
```bash
# Test enum consistency
pytest backend/tests/test_enum_consistency.py -v

# Verify database enums
python backend/scripts/verify_database_enums.py

# Check error messages
# See ERROR_MESSAGES_COMPLETE.md for complete catalog
```

---

## 📊 Error Message Quality (As of 2026-02-12)

Current Status:
```
✅ Good: 73+ errors (78%)
⚠️  Needs Improvement: 15 errors (16%)
❌ Poor: 6 errors (6%)

Total: 94+ errors documented
```

Recent Improvements (2026-02-12):
- ✅ Session timeout & inactivity messages - Show time limits and data retention
- ✅ Password reset messages - Include expiry duration and clear next steps
- ✅ Logout errors - Provide workaround actions
- ✅ Onboarding errors - Guide users to correct step
- ✅ Frontend errors standardized - "Unable to [action]. Please [fix]." pattern
- ✅ 25+ messages improved across 15+ files

Previous Improvements (2026-02-07):
- ✅ Email/username duplicate errors - Specific with suggestions
- ✅ Network error standardization - Comprehensive error handler
- ✅ SMTP errors - User-friendly instead of technical

See [ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md) for the full error message catalog.

---

## 🔍 Finding Information

### By Topic

| Topic | Document |
|-------|----------|
| Can't complete onboarding | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#onboarding-issues) |
| Email/SMTP not working | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#email--smtp-configuration) |
| Logo upload fails | [ERROR_MESSAGES_LOGO_UPLOAD.md](./ERROR_MESSAGES_LOGO_UPLOAD.md) |
| Database errors | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#database--migration-issues) |
| Network/connection issues | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#network--connection-problems) |
| Enum case mismatch | [ENUM_CONVENTIONS.md](./ENUM_CONVENTIONS.md) |
| Custom forms / public forms | [FORMS_MODULE.md](./FORMS_MODULE.md) |
| Documents / file management | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#documents-module) |
| Meeting minutes / action items | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#meetings--minutes-module) |
| Shift scheduling / calendar | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#scheduling-module) |
| Shift templates / patterns | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#shift-template-not-appearing-in-template-list) |
| Shift assignments / duty roster | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#shift-assignment-member-cant-confirm) |
| Shift swap requests | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#shift-swap-request-denied-unexpectedly) |
| Time-off / availability | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#time-off-request-not-showing-in-availability) |
| Facilities / building management | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#facilities-module) |
| Facility maintenance | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#maintenance-scheduling-no-default-types) |
| Facility compliance / ADA | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#compliance-checklist-items-not-saving) |
| Reports / data export | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#reports-module) |
| Notification rules / alerts | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#notifications-module) |
| Membership tiers / life member | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#membership-tier-member-not-auto-advancing) |
| Voter override (secretary) | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#voting-granting-a-member-an-override-to-vote) |
| Proxy voting setup | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#voting-setting-up-proxy-voting) |
| Secretary attendance dashboard | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#meeting-secretary-attendance-dashboard) |
| Meeting attendance waivers | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#meeting-granting-an-attendance-waiver) |
| Auto-enrollment on conversion | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-auto-enrollment-on-member-conversion) |
| Incident-based requirements | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-incident-based-requirements-calls-shifts-hours) |
| Scheduled tasks / cron setup | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#scheduled-tasks-setting-up-the-cron) |
| Membership tier config editor | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#membership-editing-tier-requirements) |
| Bulk voter overrides | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#voting-bulk-voter-overrides) |
| Meeting quorum config | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#meeting-configuring-quorum) |
| Peer skill eval sign-offs | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-configuring-peer-skill-evaluation-sign-offs) |
| Cert expiration alerts | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-certification-expiration-alert-pipeline) |
| Competency matrix dashboard | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-using-the-competency-matrix-dashboard) |
| Training calendar / booking | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-calendar-integration--double-booking-prevention) |
| Voting attendance requirements | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#voting-member-blocked-due-to-meeting-attendance) |
| Training exemptions by tier | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#training-life-member-still-showing-pending-requirements) |
| Drop notifications / CC config | [DROP_NOTIFICATIONS.md](./DROP_NOTIFICATIONS.md) |
| Email templates / customization | [DROP_NOTIFICATIONS.md](./DROP_NOTIFICATIONS.md#email-template-management) |
| Personal email / post-separation | [DROP_NOTIFICATIONS.md](./DROP_NOTIFICATIONS.md#personal-email) |
| Prospective members pipeline | [PROSPECTIVE_MEMBERS_MODULE.md](./PROSPECTIVE_MEMBERS_MODULE.md) |
| Inactivity timeouts / purging | [PROSPECTIVE_MEMBERS_MODULE.md](./PROSPECTIVE_MEMBERS_MODULE.md#inactivity-timeout-system) |
| Meeting minutes / templates | [MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md) |
| Document management / folders | [MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md#documents-module) |
| Public API (forms, events) | [PUBLIC_API_DOCUMENTATION.md](./PUBLIC_API_DOCUMENTATION.md) |
| Election security | [ELECTION_SECURITY_AUDIT.md](../ELECTION_SECURITY_AUDIT.md) |
| Events / recurring events / RSVP | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#events-module-issues) |
| TypeScript build errors | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#typescript-build-issues) |
| TypeScript safeguards / `as any` | [TYPESCRIPT_SAFEGUARDS.md](./TYPESCRIPT_SAFEGUARDS.md) |
| Async SQLAlchemy issues | [ASYNC_SQLALCHEMY_REVIEW.md](../ASYNC_SQLALCHEMY_REVIEW.md) |
| Security questions | [SECURITY_IMAGE_UPLOADS.md](../SECURITY_IMAGE_UPLOADS.md) |

### By Error Message

1. Search [ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md)
2. Use Ctrl+F with keywords from your error
3. Each error includes:
   - Current message
   - Quality rating
   - Troubleshooting steps
   - Related files

### By File Type

**Guides** (Step-by-step):
- TROUBLESHOOTING.md - User-facing troubleshooting
- ENUM_CONVENTIONS.md - Developer conventions

**References** (Complete catalogs):
- ERROR_MESSAGES_COMPLETE.md - All errors
- ERROR_MESSAGES_LOGO_UPLOAD.md - Logo errors

**Technical** (Architecture & security):
- SECURITY_IMAGE_UPLOADS.md - Security implementation
- ONBOARDING_REVIEW.md - Performance optimization

---

## 🎓 Learning Resources

### New to The Logbook?

1. **Installation**: See main README.md in project root
2. **First Time Setup**: Follow onboarding at `/onboarding/start`
3. **Common Issues**: Bookmark [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

### Contributing?

1. **Error Messages**: Follow standards in [ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md)
2. **Enums**: Follow [ENUM_CONVENTIONS.md](./ENUM_CONVENTIONS.md)
3. **Security**: Review [SECURITY_IMAGE_UPLOADS.md](../SECURITY_IMAGE_UPLOADS.md)
4. **Testing**: Run enum tests and database verification

### Debugging?

**Step 1**: Check logs
```bash
docker logs the-logbook-backend-1 --tail 50
docker logs the-logbook-frontend-1 --tail 50
docker logs the-logbook-db-1 --tail 50
```

**Step 2**: Search documentation
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for solutions
- [ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md) for error details

**Step 3**: Verify environment
```bash
# Check enum consistency
python backend/scripts/verify_database_enums.py

# Check migrations
cd backend && alembic current

# Check containers
docker-compose ps
```

---

## 📝 Document Versions

| Document | Version | Last Updated | Status |
|----------|---------|--------------|--------|
| TROUBLESHOOTING.md | 1.9 | 2026-02-16 | Current |
| ERROR_MESSAGES_COMPLETE.md | 1.0 | 2026-02-07 | Current |
| ERROR_MESSAGES_LOGO_UPLOAD.md | 1.0 | 2026-02-07 | Current |
| SECURITY_IMAGE_UPLOADS.md | 1.0 | 2026-02-07 | Current |
| ENUM_CONVENTIONS.md | 1.0 | 2026-02-07 | Current |
| FORMS_MODULE.md | 1.0 | 2026-02-12 | Current |
| PUBLIC_API_DOCUMENTATION.md | 1.1 | 2026-02-12 | Current |
| ONBOARDING_REVIEW.md | 1.0 | 2026-02-07 | Current |
| ELECTION_SECURITY_AUDIT.md | 2.0 | 2026-02-12 | Current |
| ASYNC_SQLALCHEMY_REVIEW.md | 1.0 | 2026-02-10 | Current |
| PROSPECTIVE_MEMBERS_MODULE.md | 1.0 | 2026-02-12 | Current |
| MEETING_MINUTES_MODULE.md | 1.0 | 2026-02-13 | Current |
| ONBOARDING_FLOW.md | 1.2 | 2026-02-12 | Current |
| DROP_NOTIFICATIONS.md | 1.0 | 2026-02-14 | Current |
| TYPESCRIPT_SAFEGUARDS.md | 1.1 | 2026-02-14 | Current |

---

## 🆘 Getting Help

**Self-Service** (Try first):
1. Search [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for your issue
2. Check [ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md) for error details
3. Review logs and run diagnostics

**Administrator**:
1. Gather diagnostic information (see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#diagnostic-information-to-gather))
2. Check backend/frontend/database logs
3. Run verification scripts

**Developer**:
1. Check related documentation for feature area
2. Run automated tests
3. Review code references in error documentation

**Support**:
- GitHub Issues: https://github.com/anthropics/claude-code/issues
- Include: Error message, logs, steps to reproduce
- Reference: Relevant documentation section

---

## 🔄 Recent Updates

### 2026-02-16 - Documentation Update: Changelog, Troubleshooting & Startup Reliability

**What Changed**:
- **CHANGELOG.md updated**: Added 20 previously undocumented commits covering database startup reliability (12 commits), hierarchical document folders (3 commits), testing & quality (2 commits), dark theme unification, role sync fixes, and form/security enhancements
- **TROUBLESHOOTING.md v1.9**: Rewrote "Startup Sequence Issues" section to reflect fast-path init (seconds, not 25-30 minutes); added new sections for hierarchical folder troubleshooting (personal folders, apparatus/facility/event folders, folder access control); updated table of contents
- **docs/README.md**: Updated version table and recent updates

**Key Documentation Corrections**:
- First-boot time: Corrected from "25-30 minutes" to "~7-10 minutes" (fast-path `create_all()` replaced sequential Alembic migrations)
- Connection retries: Updated from 20 to 40 to match current codebase
- System folders: Updated from 7 to 10 (added Member Files, Apparatus Files, Facility Files)
- Added troubleshooting for: fast-path leftover table crashes, silent init failures, folder access denied, missing personal/apparatus/facility folders

---

### 2026-02-14 - Shift Module Enhancement & Facilities Module

**What Changed**:
- **Shift Module Enhanced**: Added shift templates, recurring patterns (daily/weekly/platoon/custom), duty roster assignments, shift swap requests, time-off tracking, shift call recording, and reporting/analytics
- **5 New Shift Tables**: `shift_templates`, `shift_patterns`, `shift_assignments`, `shift_swap_requests`, `shift_time_off`
- **3 New Scheduling Permissions**: `scheduling.assign`, `scheduling.swap`, `scheduling.report`
- **Scheduling Officer Role**: New system role for dedicated scheduling coordinators
- **Facilities Module**: Complete building/property management with maintenance, utilities, keys, rooms, emergency contacts, capital projects, insurance, occupants, compliance checklists
- **Facilities Extended**: 11 additional tables for utility tracking, access keys, rooms, emergency contacts, shutoff locations, capital projects, insurance policies, occupants, compliance
- **Seed Data**: 10 facility types, 6 statuses, 20 maintenance types seeded automatically
- **Facilities Manager Role**: System role for day-to-day building management
- **Apparatus Hardened**: Tenant isolation, pagination, soft-delete, historic repair entries

**Updated Documentation**:
- Updated [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) v1.8 — Scheduling module expanded (10 new entries), Facilities module added (7 entries)
- Updated [CHANGELOG.md](../CHANGELOG.md) — Full feature changelog for shift enhancement, facilities, and apparatus hardening

---

### 2026-02-14 - Attendance Dashboard, Auto-Enrollment, Incident Tracking, Cron & Tier Editor

**What Changed**:
- **Secretary Attendance Dashboard**: `GET /api/v1/meetings/attendance/dashboard` shows per-member meeting attendance %, waiver counts, voting eligibility, and tier info
- **Meeting Attendance Waivers**: Secretary/president/chief can excuse members from meetings — attendance % not penalized, but member can't vote in that meeting
- **Auto-Enrollment on Conversion**: Prospective members automatically enrolled in probationary training program when converted; training officer can enroll anyone via `POST /api/v1/training/enrollments`
- **Incident-Based Tracking**: Shift completion reports now match call types against `required_call_types` on requirements; tracks per-type running totals in `progress_notes`
- **Scheduled Tasks/Cron**: `GET/POST /api/v1/scheduled/tasks` for listing and triggering cron tasks (daily cert alerts, weekly struggling member checks, monthly tier advance)
- **Struggling Member Detection**: Flags members behind pace, approaching deadlines, or with stalled requirements; sends training officer notifications
- **Membership Tier Config Editor**: `GET/PUT /api/v1/users/membership-tiers/config` for editing tier benefits (attendance %, voting, training exemptions)
- **Migration**: `20260214_1300` adds waiver fields to meeting_attendees

**Updated Documentation**:
- Updated [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Dashboard, waivers, auto-enrollment, incident tracking, cron, tier config
- Updated [CHANGELOG.md](../CHANGELOG.md) — Full feature changelog

---

### 2026-02-14 - Training Module Enhancements (Calendar, Competency Matrix, Alerts, Peer Eval)

**What Changed**:
- **Training Calendar Integration**: Training sessions now appear on the organization calendar via linked Events; new `GET /api/v1/training-sessions/calendar` endpoint returns sessions with dates, times, locations
- **Double-Booking Prevention**: Training sessions with a `location_id` are checked against all other events — prevents scheduling conflicts across training and non-training events
- **Hall Coordinator Filtering**: `GET /api/v1/events?exclude_event_types=training` lets hall coordinators hide training events from their view while booking prevention remains organization-wide
- **Competency Matrix Dashboard**: `GET /api/v1/training/competency-matrix` generates a member vs. requirement heat map (current/expiring_soon/expired/not_started) with readiness percentage
- **Certification Expiration Alerts**: Tiered pipeline (90/60/30/7 days + expired escalation) with CC to training officer, compliance officer, and chief on escalating notifications
- **Peer Skill Evaluation Sign-Offs**: Training officer can configure who signs off on each skill — role-based (`shift_leader`, `driver_trainer`) or user-specific — with permission check endpoint
- **Meeting Quorum Enforcement**: Org-configurable quorum (count or percentage) with per-meeting override; auto-recalculates when attendees check in
- **Bulk Voter Overrides**: `POST /api/v1/elections/{election_id}/voter-overrides/bulk` — secretary can grant overrides to multiple members with enhanced audit logging
- **Migration**: `20260214_1200` adds quorum columns, allowed_evaluators, and cert alert tracking columns

**Updated Documentation**:
- Updated [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Quorum, peer eval, cert alerts, competency matrix, calendar/booking, bulk override troubleshooting
- Updated [CHANGELOG.md](../CHANGELOG.md) — Full feature changelog for all 7 features

---

### 2026-02-14 - Proxy Voting for Elections

**What Changed**:
- **Organization Opt-In**: Proxy voting is a department choice — enable via `settings.proxy_voting.enabled`; disabled by default
- **Proxy Authorization**: Secretary can designate one member to vote on behalf of another with `single_election` or `regular` proxy type
- **Proxy Vote Casting**: Proxy casts a vote; eligibility and double-vote prevention apply to the *delegating* (absent) member
- **Hash Trail**: Each proxy vote records who physically voted (`proxy_voter_id`) and on whose behalf (`proxy_delegating_user_id`) — full forensic traceability
- **Ballot Email CC**: When ballot emails are sent, the proxy holder is automatically CC'd on the delegating member's notification
- **Forensics**: Election forensics report includes `proxy_voting` section with all authorizations and proxy votes
- **Migration**: `20260214_1100` adds `proxy_authorizations` column and vote proxy fields

---

### 2026-02-14 - Secretary Voter Override for Elections

**What Changed**:
- **Voter Override Endpoint**: Secretary/elections manager can grant a member voting rights for a specific election, bypassing tier and attendance restrictions
- **Audit Trail**: Each override records the reason, granting officer, and timestamp; logged with `warning` severity
- **Override Management**: List all overrides, revoke an override before the member votes
- **Scope**: Overrides skip tier/attendance checks only — NOT eligible_voters lists, role requirements, or double-vote prevention
- **Migration**: `20260214_1000` adds `voter_overrides` column to elections table

---

### 2026-02-14 - Membership Tiers, Voting Attendance Rules & Training Exemptions

**What Changed**:
- **Membership Tier System**: Organizations can define ordered tiers (Probationary, Active, Senior, Life) with years-of-service thresholds and per-tier benefits
- **Tier Benefits**: Training exemptions (full or by type), voting eligibility rules, meeting attendance requirements for voting, office-holding eligibility
- **Manual + Auto Advancement**: Leadership can change a member's tier directly, or trigger batch auto-advancement based on years of service
- **Voting Attendance Gating**: Election system enforces minimum meeting attendance percentage per tier before allowing votes
- **Training Exemptions**: Members at exempt tiers (e.g. Life Members) have all training requirements treated as met
- **Migration**: `20260214_0900` adds `membership_type` and `membership_type_changed_at` to users table

**Updated Documentation**:
- Updated [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — Tier advancement, voting attendance, training exemption troubleshooting
- Updated [CHANGELOG.md](../CHANGELOG.md) — Full feature changelog

---

### 2026-02-14 - Configurable Drop Notifications & Email Template Settings

**What Changed**:
- **Configurable Drop Notifications**: Drop/separation notification messages are now fully configurable per organization
- **CC Recipient Settings**: Organization settings control which roles (admin, quartermaster, chief by default) and static email addresses are CC'd on every drop notification
- **Personal Email Field**: Members can now have a `personal_email` for post-separation contact; configurable whether it receives the drop notification
- **Default MEMBER_DROPPED Template**: Auto-created for each org with 10 template variables; fully editable via Settings > Email Templates
- **CC/BCC Support**: `EmailService.send_email()` now supports `cc_emails` and `bcc_emails` parameters for all outbound emails
- **Migration**: `20260214_0800` adds `personal_email` column to users table

**New Documentation**:
- Created [DROP_NOTIFICATIONS.md](./DROP_NOTIFICATIONS.md) — Complete configuration guide, template variables, API reference
- Updated [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — CC recipients, personal email, and template customization troubleshooting
- Updated [CHANGELOG.md](../CHANGELOG.md) — Full feature changelog

---

### 2026-02-14 - Events Module, TypeScript Quality & Backend Fixes

**What Changed**:
- **Events Module Enhanced**: Recurring events, event templates, event duplication, attachment upload/download/delete, booking prevention, RSVP overrides, cancel notifications, organization timezone support
- **Dedicated Event Pages**: New `EventCreatePage`, `EventEditPage` with `EventForm` component (extracted from monolithic `EventsPage`)
- **TypeScript Build Fixed**: All TypeScript compilation errors resolved across the entire frontend codebase
- **17 `as any` Assertions Removed**: All unsafe type assertions replaced with proper typing across 7 files
- **Backend Quality**: Fixed broken dependency injection, duplicate models, missing permissions across 29 backend files; fixed mutable default arguments across 9 models
- **Startup Fixes**: Fixed infinite polling loop in onboarding, type safety issues in hooks, API client signatures
- **Events Module Bugs**: Fixed critical runtime crashes, simplified event endpoints, fixed location model relationships
- **Comprehensive Event Tests**: 5 test files with 1,865+ lines covering all event components
- **JSX Merge Fixes**: Repaired broken JSX in `DocumentsPage` and `MinutesPage` from merge conflicts

**Updated Documentation**:
- Updated TROUBLESHOOTING.md v1.7 with events module and TypeScript build sections
- Updated TYPESCRIPT_SAFEGUARDS.md v1.1 with `as any` removal and mutable defaults fix
- Updated CHANGELOG.md with full details of all changes

---

### 2026-02-12 - Five New Modules: Documents, Minutes, Scheduling, Reports, Notifications

**What Changed**:
- Built complete backend stack for 5 new modules (models, schemas, services, endpoints, migration)
- Connected all 5 frontend pages to real database APIs (replacing placeholder/static data)
- **Documents**: Folder hierarchy, file upload/download, document status management
- **Meetings/Minutes**: Meeting CRUD with attendees, action items, approval workflow
- **Scheduling**: Shift management, week/month calendar views, attendance tracking
- **Reports**: Member roster, training summary, event attendance report generation
- **Notifications**: Rule-based notification configuration, delivery logging, read tracking
- Database migration creates 7 new tables: document_folders, documents, meetings, meeting_attendees, meeting_action_items, notification_rules, notification_logs
- Updated TROUBLESHOOTING.md with module-specific troubleshooting sections
- Updated ERROR_MESSAGES_COMPLETE.md with 20+ new error messages for new modules

**Rollout Status** (36 of 40 pages production-ready):
- Ready: Dashboard, Auth, Members, Events, Elections, Training, Forms, Inventory, Settings, Documents, Minutes, Scheduling, Reports, Notifications
- Deferred: Integrations (needs OAuth), Analytics Dashboard (localStorage), Error Monitoring (localStorage), Create Training Session (partial)

---

### 2026-02-12 - Security Hardening & Error Message Review

**What Changed**:
- Added 30-minute frontend session inactivity auto-logout
- Added DOMPurify sanitization for all form submissions
- Added 500-item limit on bulk external training imports
- Increased login password minimum from 1 to 8 characters
- Reduced onboarding session expiry from 2 hours to 30 minutes
- Blocked encryption salt fallback in production (hard failure)
- Added POST `/validate-reset-token` endpoint (replaced GET to prevent token in logs)
- Added bulk role replacement audit logging
- Added wildcard permission check to admin access endpoint
- Improved 25+ error messages across backend and frontend for clarity
- Updated TROUBLESHOOTING.md with security & session management section
- Updated ERROR_MESSAGES_COMPLETE.md with 14 new error entries

---

### 2026-02-12 - Forms Module & Public Forms
### 2026-02-12 - Prospective Members Module, Inactivity System & Forms

**What Changed**:
- Added Prospective Members Pipeline module with configurable stages, kanban/table views, and conversion flow
- Added inactivity timeout system with per-stage overrides, two-phase warnings, reactivation, and auto-purge
- Added prospective members module to onboarding as optional; Secretary and Membership Coordinator given manage permissions
- Added complete Custom Forms module with form builder, field management, and submissions
- Added public-facing forms accessible via unique URL slugs without authentication
- Added cross-module integrations (Membership, Inventory)
- Added QR code generation for physical form distribution
- Added comprehensive form security (input sanitization, rate limiting, honeypot bot detection)
- Updated Public API Documentation to v1.1.0 with public form endpoints

**New Documentation**:
- Created [PROSPECTIVE_MEMBERS_MODULE.md](./PROSPECTIVE_MEMBERS_MODULE.md) - Complete prospective members documentation
- Updated [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) - Added prospective members troubleshooting section

---

### 2026-02-11 - Module UIs, Auth Fixes & Navigation

**What Changed**:
- Built 8 fully-featured module pages (Events, Inventory, Training, Documents, Scheduling, Reports, Minutes, Elections)
- Added persistent side navigation and top navigation with configurable layout
- Added dashboard stats API endpoint and training progress widget
- Fixed critical auth redirect loop, login flow (account lockout, token refresh, session creation)
- Added organization branding to login page
- Added 8 new system roles (Officers, Quartermaster, Training Officer, and more)
- Unified role initialization to single source of truth
- Fixed onboarding state persistence (role permissions, module configs, orphaned role IDs)
- Docker graceful shutdown (exec form CMD, stop_grace_period, init: true)
- Optimized first-boot startup from ~20 minutes to seconds with fast-path database initialization

---

### 2026-02-10 - Election Security, UX Improvements & Testing

**What Changed**:
- Fixed critical double-voting vulnerability with database-level unique constraints
- Enforced election closing time before revealing results
- Added password reset flow, user settings page, live dashboard stats
- Added logout confirmation modal, breadcrumb progress indicator, contextual help system
- Improved onboarding UX (module features visible, simplified org setup, focus traps)
- Added membership type field with prospective member warning
- Fixed SQLAlchemy async issues (greenlet errors in org creation and admin user creation)
- Added comprehensive onboarding test suite with MySQL database

**New Documentation**:
- Created [FORMS_MODULE.md](./FORMS_MODULE.md) - Complete forms documentation
- Updated [PUBLIC_API_DOCUMENTATION.md](./PUBLIC_API_DOCUMENTATION.md) - Added public form endpoints
- Updated [SECURITY.md](../SECURITY.md) - Added public form security section

---

### 2026-02-07 - Major Error Handling Update

**What Changed**:
- ✅ Comprehensive network error standardization
- ✅ Email/username duplicate errors now specific and actionable
- ✅ Soft-delete user filtering prevents false duplicates
- ✅ Created comprehensive TROUBLESHOOTING.md guide
- ✅ Error message quality improved from 49% → 66%

**New Features**:
- `frontend/src/modules/onboarding/utils/errorHandler.ts` - Standardized error handling
- `backend/scripts/verify_database_enums.py` - Enum verification
- `backend/tests/test_enum_consistency.py` - Automated enum tests

**Documentation**:
- Created TROUBLESHOOTING.md (comprehensive guide)
- Created ENUM_CONVENTIONS.md (developer guide)
- Updated all error references

---

## 📄 License

Documentation is part of The Logbook project.

---

**Maintained by**: Development Team
**Questions?**: See [Getting Help](#-getting-help) section
**Contributions**: Follow guidelines in individual documents
