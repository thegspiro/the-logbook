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
   - **Updated**: 2026-02-07 with latest error handling

2. **[ERROR_MESSAGES_COMPLETE.md](./ERROR_MESSAGES_COMPLETE.md)**
   - Complete catalog of all 61 error messages in the application
   - Quality ratings and improvement status for each error
   - Troubleshooting steps for every error
   - Implementation roadmap

3. **[ERROR_MESSAGES_LOGO_UPLOAD.md](./ERROR_MESSAGES_LOGO_UPLOAD.md)**
   - Detailed guide for logo upload errors
   - Security validation explanations
   - File size, type, and dimension requirements
   - Testing procedures

4. **[ERROR_MESSAGES_UPDATES_2026_02_07.md](./ERROR_MESSAGES_UPDATES_2026_02_07.md)**
   - Latest error message improvements (Feb 7, 2026)
   - Before/after comparisons
   - New error handler features
   - Developer guidelines

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

---

### 🛠️ Development & Operations

7. **[ONBOARDING_REVIEW.md](../ONBOARDING_REVIEW.md)**
   - Analysis of startup delays and optimization recommendations
   - Docker Compose configuration improvements
   - Database connection retry strategy
   - Migration performance optimization

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

## 📊 Error Message Quality (As of 2026-02-07)

Current Status:
```
✅ Good: 40 errors (66%)
⚠️  Needs Improvement: 14 errors (23%)
❌ Poor: 7 errors (11%)

Total: 61 errors documented
```

Recent Improvements:
- ✅ Email/username duplicate errors - Now specific with suggestions
- ✅ Network error standardization - Comprehensive error handler
- ✅ SMTP errors - User-friendly instead of technical
- ✅ Soft-delete filtering - Prevents false duplicates

See [ERROR_MESSAGES_UPDATES_2026_02_07.md](./ERROR_MESSAGES_UPDATES_2026_02_07.md) for details.

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
| TROUBLESHOOTING.md | 1.1 | 2026-02-07 | Current |
| ERROR_MESSAGES_COMPLETE.md | 1.0 | 2026-02-07 | Current |
| ERROR_MESSAGES_LOGO_UPLOAD.md | 1.0 | 2026-02-07 | Current |
| ERROR_MESSAGES_UPDATES_2026_02_07.md | 1.0 | 2026-02-07 | Current |
| SECURITY_IMAGE_UPLOADS.md | 1.0 | 2026-02-07 | Current |
| ENUM_CONVENTIONS.md | 1.0 | 2026-02-07 | Current |
| ONBOARDING_REVIEW.md | 1.0 | 2026-02-07 | Current |

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
