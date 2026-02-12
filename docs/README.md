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
   - **Updated**: 2026-02-12 with security hardening, session management, error improvements

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

4. **[ERROR_MESSAGES_UPDATES_2026_02_07.md](./ERROR_MESSAGES_UPDATES_2026_02_07.md)**
   - Error message improvements (Feb 7, 2026)
   - Before/after comparisons
   - New error handler features
   - Developer guidelines

5. **[ERROR_MESSAGES_UPDATES_2026_02_12.md](./ERROR_MESSAGES_UPDATES_2026_02_12.md)**
   - Security hardening error messages (Feb 12, 2026)
   - Session timeout and password reset messages
   - Frontend error message standardization
   - Updated error message guidelines

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
   - Comprehensive election/voting system security review (rating: 7.1/10)
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

9. **[PUBLIC_API_DOCUMENTATION.md](./PUBLIC_API_DOCUMENTATION.md)**
   - Public API v1.1.0 with public form endpoints
   - Form retrieval and submission without authentication
   - Rate limiting, security notes, integration examples

10. **Documents Module**
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

12. **Scheduling Module**
    - Shift creation and management with position types
    - Week and month calendar views with real shift data
    - Attendance tracking per shift
    - API endpoints: 10 endpoints for shift CRUD, attendance, calendar views, summary
    - Permissions: `scheduling.view`, `scheduling.manage`

13. **Reports Module**
    - Report generation: member roster, training summary, event attendance
    - Data aggregation from members, training records, and events
    - Tabular report display with filtering
    - API endpoints: 2 endpoints (available reports list, generate report)
    - Permissions: `reports.view`, `reports.manage`

14. **Notifications Module**
    - Notification rule creation with trigger/category configuration
    - Rule toggle (enable/disable) with persistence
    - Notification log tracking with delivery status and read state
    - API endpoints: 8 endpoints for rule CRUD, toggle, logs, mark-read, summary
    - Permissions: `notifications.view`, `notifications.manage`

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

See [ERROR_MESSAGES_UPDATES_2026_02_12.md](./ERROR_MESSAGES_UPDATES_2026_02_12.md) for latest details.

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
| Reports / data export | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#reports-module) |
| Notification rules / alerts | [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#notifications-module) |
| Public API (forms, events) | [PUBLIC_API_DOCUMENTATION.md](./PUBLIC_API_DOCUMENTATION.md) |
| Election security | [ELECTION_SECURITY_AUDIT.md](../ELECTION_SECURITY_AUDIT.md) |
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
- ERROR_MESSAGES_UPDATES_2026_02_07.md - Latest changes

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

1. **Error Messages**: Follow standards in [ERROR_MESSAGES_UPDATES_2026_02_07.md](./ERROR_MESSAGES_UPDATES_2026_02_07.md#developer-guidelines)
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
| TROUBLESHOOTING.md | 1.3 | 2026-02-12 | Current |
| ERROR_MESSAGES_COMPLETE.md | 1.2 | 2026-02-12 | Current |
| ERROR_MESSAGES_LOGO_UPLOAD.md | 1.0 | 2026-02-07 | Current |
| ERROR_MESSAGES_UPDATES_2026_02_07.md | 1.0 | 2026-02-07 | Current |
| ERROR_MESSAGES_UPDATES_2026_02_12.md | 1.0 | 2026-02-12 | Current |
| SECURITY_IMAGE_UPLOADS.md | 1.0 | 2026-02-07 | Current |
| ENUM_CONVENTIONS.md | 1.0 | 2026-02-07 | Current |
| FORMS_MODULE.md | 1.0 | 2026-02-12 | Current |
| PUBLIC_API_DOCUMENTATION.md | 1.1 | 2026-02-12 | Current |
| ONBOARDING_REVIEW.md | 1.0 | 2026-02-07 | Current |
| ELECTION_SECURITY_AUDIT.md | 1.0 | 2026-02-10 | Current |
| ASYNC_SQLALCHEMY_REVIEW.md | 1.0 | 2026-02-10 | Current |
| ONBOARDING_FLOW.md | 1.2 | 2026-02-12 | Current |

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

See [ERROR_MESSAGES_UPDATES_2026_02_12.md](./ERROR_MESSAGES_UPDATES_2026_02_12.md) for error message details.

---

### 2026-02-12 - Forms Module & Public Forms

**What Changed**:
- Added complete Custom Forms module with form builder, field management, and submissions
- Added public-facing forms accessible via unique URL slugs without authentication
- Added cross-module integrations (Membership, Inventory)
- Added QR code generation for physical form distribution
- Added comprehensive form security (input sanitization, rate limiting, honeypot bot detection)
- Updated Public API Documentation to v1.1.0 with public form endpoints

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
- Created ERROR_MESSAGES_UPDATES_2026_02_07.md (change log)
- Created ENUM_CONVENTIONS.md (developer guide)
- Updated all error references

See [ERROR_MESSAGES_UPDATES_2026_02_07.md](./ERROR_MESSAGES_UPDATES_2026_02_07.md) for complete details.

---

## 📄 License

Documentation is part of The Logbook project.

---

**Maintained by**: Development Team
**Questions?**: See [Getting Help](#-getting-help) section
**Contributions**: Follow guidelines in individual documents
