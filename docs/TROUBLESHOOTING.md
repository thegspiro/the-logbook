# The Logbook - Troubleshooting Guide

## Overview

This comprehensive troubleshooting guide helps you resolve common issues when using The Logbook application, with special focus on the onboarding process.

**Last Updated**: 2026-02-16 (includes database startup reliability improvements, hierarchical document folders, role sync fixes, dark theme unification, form enhancements; plus system-wide theme support, member-focused dashboard redesign, election dark theme fixes, election timezone fixes, footer positioning fix, duplicate index crash fix, codebase quality fixes, shift module enhancements, facilities module, meeting quorum, peer eval sign-offs, cert expiration alerts, competency matrix, training calendar/booking, bulk voter overrides, proxy voting, events module, TypeScript fixes, meeting minutes module, documents module, prospective members, elections, inactivity timeout system, and pipeline troubleshooting)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Onboarding Issues](#onboarding-issues)
3. [Email & SMTP Configuration](#email--smtp-configuration)
4. [User Account Issues](#user-account-issues)
5. [Network & Connection Problems](#network--connection-problems)
6. [Image Upload Issues](#image-upload-issues)
7. [Database & Migration Issues](#database--migration-issues)
8. [Startup Sequence Issues](#startup-sequence-issues)
9. [Prospective Members Module Issues](#prospective-members-module-issues)
10. [Elections Module Issues](#elections-module-issues)
11. [Meeting Minutes Module Issues](#meeting-minutes-module-issues)
12. [Documents Module Issues](#documents-module-issues)
13. [Events Module Issues](#events-module-issues)
14. [Facilities Module](#facilities-module)
15. [Theme & Display Issues](#theme--display-issues)
16. [Dashboard Issues](#dashboard-issues)
17. [TypeScript Build Issues](#typescript-build-issues)
18. [Error Message Reference](#error-message-reference)
19. [Error Handling Patterns](#error-handling-patterns)
20. [Getting Help](#getting-help)

---

## Getting Started

### Quick Diagnostics

If you encounter an error, follow these steps:

1. **Read the error message carefully** - As of 2026-02-07, all error messages include:
   - What went wrong
   - Why it happened
   - What to do next

2. **Check this guide** - Use Ctrl+F to search for keywords from the error

3. **Try the suggested fix** - Error messages now include specific actions

4. **Check your network** - Many issues are connectivity-related

5. **Clear browser cache** - Sometimes helps with persistent issues

---

## Onboarding Issues

### Organization Creation Failures

#### Error: "Organization type enum mismatch"

**Message**: `'fire_ems_combined' is not among the defined enum values`

**Cause**: Database enum values don't match application expectations (case mismatch)

**Fix**:
```bash
# Run the enum fix migration
cd backend
alembic upgrade head

# Restart the application
docker-compose restart backend
```

**Prevention**: This has been fixed. If you encounter it again, check that migrations are up to date.

---

### Username/Email Already Exists

#### Error: Username is already taken

**Message**: `"Username 'admin' is already taken. Try a different username like 'admin2' or 'admin_fcvfd'."`

**Causes**:
1. Someone else in your organization has this username
2. You previously created an account with this username

**Solutions**:

**Option 1: Use suggested variation**
```
Original: admin
Try: admin2, admin_fcvfd, admin_chief, john_admin
```

**Option 2: Check existing accounts**
1. Contact your organization administrator
2. Ask if username is from a deleted account
3. Administrator can verify in database

**Option 3: Use different username**
```
✅ Good usernames:
- firstname.lastname (john.smith)
- username + role (john_captain)
- username + badge (john_1234)
- firstname + org (john_fcvfd)
```

**Important**: As of 2026-02-07, the system now properly handles soft-deleted users. If a user was deleted, their username can be reused.

---

#### Error: Email is already registered

**Message**: `"Email 'user@example.com' is already registered. Use a different email address or contact your administrator if this is your account."`

**Causes**:
1. Email already in use by active account
2. You forgot you have an account
3. Trying to reuse email from deleted account

**Solutions**:

**If this IS your email:**
1. Try password reset (if login page available)
2. Contact administrator to verify account status
3. Check if account was soft-deleted (can now be reused)

**If you need to use different email:**
```
✅ Options:
- Work email: john@department.org
- Plus addressing: john+logbook@gmail.com
- Alternative: john.smith.fd@gmail.com
```

**Administrator Actions**:
```bash
# Check if email is from deleted user
SELECT username, email, deleted_at
FROM users
WHERE email = 'user@example.com';

# If deleted_at is NOT NULL, the email can be reused
# New user creation will now work
```

---

### Logo Upload Issues

See detailed guide: [`ERROR_MESSAGES_LOGO_UPLOAD.md`](./ERROR_MESSAGES_LOGO_UPLOAD.md)

#### Quick Reference:

| Issue | Limit | Solution |
|-------|-------|----------|
| File too large | 5MB max | Compress or resize image |
| Wrong format | PNG/JPEG only | Convert from SVG/GIF/WebP |
| Dimensions too large | 4096x4096 max | Resize image |
| Dimensions too small | 16x16 min | Use larger image |

**Common Tools**:
- Online: tinypng.com, compressor.io
- Desktop: GIMP, Paint.NET, Preview (Mac)
- Command line: `convert logo.png -resize 2048x2048 logo_small.png`

---

## Email & SMTP Configuration

### SMTP Authentication Failed

#### Error: Username and password not accepted

**Message**: `"SMTP authentication failed. Verify your username and password are correct. For Gmail or Outlook, you may need an app-specific password."`

**Causes**:
1. Wrong username or password
2. Need app-specific password (Gmail/Outlook)
3. Two-factor authentication enabled
4. Account locked or suspended

**Solutions by Provider**:

#### **Gmail**
1. **Enable 2FA** (required for app passwords)
   - Go to: myaccount.google.com/security
   - Enable 2-Step Verification

2. **Create App Password**
   - Go to: myaccount.google.com/apppasswords
   - Select "Mail" and "Other"
   - Name it "The Logbook"
   - Copy the 16-character password
   - Use this password instead of your regular password

3. **SMTP Settings**:
   ```
   Server: smtp.gmail.com
   Port: 587
   Encryption: STARTTLS
   Username: your-email@gmail.com
   Password: [16-char app password]
   ```

#### **Microsoft 365 / Outlook**
1. **Enable 2FA** (if required)
   - Go to: account.microsoft.com/security
   - Security basics → Advanced security options
   - Turn on two-step verification

2. **Create App Password**
   - Same security page
   - App passwords → Create new
   - Use generated password

3. **SMTP Settings**:
   ```
   Server: smtp.office365.com
   Port: 587
   Encryption: STARTTLS
   Username: your-email@outlook.com
   Password: [app password]
   ```

#### **Custom/Self-hosted**
```
Check with your email provider for:
- Correct SMTP server address
- Supported ports (usually 587 or 465)
- Whether TLS/SSL is required
- Authentication method (usually username/password)
```

---

### Connection Refused / Cannot Connect

#### Error: Cannot connect to mail server

**Message**: `"Cannot connect to mail server at smtp.gmail.com:587. Verify the server address and port are correct."`

**Diagnostic Steps**:

**1. Test connectivity**
```bash
# Test if port is reachable
telnet smtp.gmail.com 587

# Or using netcat
nc -zv smtp.gmail.com 587

# Expected: Connection succeeded
```

**2. Check firewall**
```bash
# Check if SMTP ports are blocked
sudo iptables -L -n | grep -E "587|465|25"

# Common ports:
# 587 - STARTTLS (most common)
# 465 - SSL/TLS
# 25 - Unencrypted (often blocked)
```

**3. Verify DNS**
```bash
# Ensure hostname resolves
nslookup smtp.gmail.com

# Should return IP addresses
```

**Common Fixes**:

**Corporate/Firewall Block**:
- Contact IT department
- Request outbound SMTP access
- Ports needed: 587 (primary), 465 (backup)

**Docker Network Issues**:
```bash
# Check container can reach internet
docker exec the-logbook-backend-1 ping -c 3 8.8.8.8

# Check DNS resolution
docker exec the-logbook-backend-1 nslookup smtp.gmail.com
```

**Wrong Port**:
| Port | Encryption | When to Use |
|------|-----------|-------------|
| 587 | STARTTLS | **Recommended** - Modern standard |
| 465 | SSL/TLS | Alternative if 587 blocked |
| 25 | None | **Avoid** - Often blocked, insecure |

---

### SSL/TLS Errors

#### Error: SSL version or cipher mismatch

**Message**: `"SSL/TLS version mismatch. Try changing the encryption method: Use STARTTLS for port 587, or SSL/TLS for port 465."`

**Cause**: Port and encryption method don't match

**Solution**: Match port to encryption

| If using Port | Use Encryption | Setting |
|---------------|----------------|---------|
| 587 | STARTTLS | `use_tls: true`, `use_ssl: false` |
| 465 | SSL/TLS | `use_ssl: true`, `use_tls: false` |

**Configuration Examples**:

**Correct (Port 587 + STARTTLS)**:
```yaml
smtp_host: smtp.gmail.com
smtp_port: 587
use_tls: true
use_ssl: false
```

**Correct (Port 465 + SSL)**:
```yaml
smtp_host: smtp.gmail.com
smtp_port: 465
use_ssl: true
use_tls: false
```

**Wrong (mismatched)**:
```yaml
# ❌ This will fail
smtp_port: 587
use_ssl: true  # Wrong! Port 587 needs TLS, not SSL
```

---

## User Account Issues

### Password Requirements Not Met

#### Error: Password does not meet security requirements

**Message**: `"Password requirements not met (3 issues): Must be at least 12 characters; Must contain uppercase letter; Must contain special character"`

**Requirements**:
- ✅ Minimum 12 characters
- ✅ At least 1 uppercase letter (A-Z)
- ✅ At least 1 lowercase letter (a-z)
- ✅ At least 1 number (0-9)
- ✅ At least 1 special character (!@#$%^&*)

**Good Password Examples**:
```
✅ FireDept2024!
✅ MySecurePass123!
✅ Logbook$2026#Main
✅ Welcome@Department1
```

**Bad Password Examples**:
```
❌ password123        - No uppercase, no special char
❌ PASSWORD!          - No lowercase, no number
❌ Short1!            - Too short (only 7 chars)
❌ SimplePassword     - No number, no special char
```

---

### Admin User Creation Fails with 500 Error (Step 10)

#### Error: 500 Internal Server Error during admin account creation

**Status**: ✅ **FIXED** in latest version (commit `314a721`)

**Symptoms:**
- Complete onboarding steps 1-9 successfully
- Step 10 "Create Admin Account" returns 500 error
- Backend logs show: `INFO | User registered: [username]`
- But endpoint returns 500 error to frontend
- Trying again shows: "Username already exists"

**What Happened:**
1. User WAS successfully created in database ✅
2. But endpoint failed after creation ❌
3. Frontend stayed on form (thought it failed)
4. User tried again → "already exists" error

**Root Cause:**
- Bug in code: Tuple unpacking error in `onboarding.py`
- `register_user()` returns `(user, error)` tuple
- Code treated it as single user object
- Caused AttributeError when accessing user properties

**Solution:**
✅ **Update to latest version** - This bug is fixed.

```bash
# Update and restart with fresh database
docker compose down -v
git pull origin main
docker compose up --build
```

**If You're Stuck on This Error:**

**Option 1: Delete the user and try again**
```bash
# Connect to MySQL
docker compose exec mysql mysql -u root -p[YOUR_ROOT_PASSWORD]

# Delete the stuck user
USE the_logbook;
DELETE FROM users WHERE username = '[your-username]';
EXIT;

# Refresh browser and try Step 10 again
```

**Option 2: Fresh start (recommended)**
```bash
# Complete reset
docker compose down -v
docker compose up --build

# Complete onboarding again from Step 1
```

**Prevention:**
- This bug is fixed in commit `314a721`
- Update to latest version before starting onboarding
- No workaround needed - the fix works correctly

**Password Generators**:
- Browser built-in (Chrome, Firefox, Safari all offer this)
- Password managers (1Password, Bitwarden, LastPass)
- Command line: `openssl rand -base64 12`

---

### Session Expired

#### Error: Session expired or invalid

**Message**: `"Session expired. Please log in again."`

**Causes**:
1. Onboarding session timed out (30 minutes of inactivity, as of 2026-02-12)
2. Browser was closed
3. Cookies were cleared
4. Server was restarted

**Solutions**:

**During Onboarding**:
```
1. Click "Reset Progress" if available
2. Or return to /onboarding/start
3. Data is saved server-side, so you may be able to resume
```

**After Onboarding (logged in)**:
```
1. Navigate to login page
2. Enter your credentials
3. No data lost - just need to re-authenticate
```

**Prevention**:
- Keep browser tab open during onboarding
- Complete each step promptly
- Save work frequently (most steps auto-save)

---

## Network & Connection Problems

### General Connection Issues

As of **2026-02-07**, The Logbook includes comprehensive network error handling.

#### Error: Cannot connect to server

**Message**: `"Cannot connect to server. Please check your internet connection and try again."`

**Diagnostic Steps**:

**1. Check internet connection**
```bash
# Test basic connectivity
ping google.com

# Test backend server (if on same network)
ping localhost

# Check if backend is running
curl http://localhost:3001/health
```

**2. Verify backend is running**
```bash
# Check Docker containers
docker ps

# Should see:
# - the-logbook-backend-1 (running)
# - the-logbook-frontend-1 (running)
# - the-logbook-db-1 (running)

# Check backend logs
docker logs the-logbook-backend-1 --tail 50
```

**3. Check frontend can reach backend**
```bash
# From frontend container
docker exec the-logbook-frontend-1 curl http://backend:3001/health

# Expected: {"status": "healthy"}
```

**Common Fixes**:

**Backend Not Running**:
```bash
docker-compose up -d
# or
docker-compose restart backend
```

**Port Conflicts**:
```bash
# Check if port 3001 is in use
lsof -i :3001

# If another process is using it:
# Option 1: Stop the other process
# Option 2: Change port in docker-compose.yml
```

**CORS Errors**:
```bash
# Update .env file
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Restart backend
docker-compose restart backend
```

---

#### Error: Request timed out

**Message**: `"Request timed out. The server is taking too long to respond. Please try again."`

**Causes**:
1. Server is overloaded
2. Database query is slow
3. Network is slow
4. Migration is running

**Diagnostic**:
```bash
# Check server load
docker stats the-logbook-backend-1

# Check backend logs for slow queries
docker logs the-logbook-backend-1 | grep "slow"

# Check if migration is running
docker logs the-logbook-backend-1 | grep "migration"
```

**Solutions**:

**During Migrations**:
- Wait for migrations to complete (check logs)
- Usually takes 30-120 seconds
- Don't interrupt - data corruption risk

**Server Overloaded**:
```bash
# Increase resources in docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 2G
```

**Database Slow**:
```bash
# Check database size
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "SELECT table_schema, SUM(data_length + index_length) / 1024 / 1024 AS 'Size (MB)' FROM information_schema.tables GROUP BY table_schema;"

# Optimize tables
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" logbook \
  -e "OPTIMIZE TABLE users, organizations, audit_logs;"
```

---

#### Error: Server temporarily unavailable

**Message**: `"Server is temporarily unavailable. Please try again in a few moments."`

**Causes**:
- Server is restarting
- Database is restarting
- Maintenance in progress
- Container crashed

**Check Status**:
```bash
# Check all containers
docker-compose ps

# Expected output (all "Up"):
# the-logbook-backend-1    running
# the-logbook-frontend-1   running
# the-logbook-db-1         running

# If any are missing, restart
docker-compose up -d
```

**Recovery**:
```bash
# Full restart
docker-compose down
docker-compose up -d

# Check health
curl http://localhost:3001/health
```

---

## Image Upload Issues

See detailed guide: [`ERROR_MESSAGES_LOGO_UPLOAD.md`](./ERROR_MESSAGES_LOGO_UPLOAD.md)

### Security Validations

The Logbook performs comprehensive security checks on uploaded images:

**File Type Validation**:
- ✅ Allowed: PNG, JPEG
- ❌ Blocked: SVG (XSS risk), GIF, WebP, TIFF, BMP

**Magic Byte Verification**:
- Checks actual file content, not just extension
- Prevents malware disguised as images
- Example: `malware.exe` renamed to `logo.png` → **Rejected**

**Metadata Stripping**:
- Removes EXIF data (GPS coordinates, camera info)
- Protects privacy
- Prevents metadata-based attacks

**Size Limits**:
- File size: 5MB maximum
- Dimensions: 16x16 to 4096x4096 pixels
- Prevents decompression bombs

**Decompression Bomb Detection**:
- Catches images that decompress to massive size
- Example: 1KB PNG → 100GB decompressed → **Rejected**

---

## Database & Migration Issues

### Enum Case Mismatch

**Status**: ✅ **FIXED** as of 2026-02-07

#### Symptoms
```
Error: 'fire_ems_combined' is not among the defined enum values
Enum name: organizationtype
Possible values: FIRE_DEPART.., EMS_ONLY, FIRE_EMS_CO..
```

#### Cause
Database had UPPERCASE enum values but application sends lowercase.

#### Fix
```bash
cd backend
alembic upgrade head  # Runs migration 20260207_0500
```

#### Verification
```bash
# Check enum values in database
python scripts/verify_database_enums.py

# Expected output:
# ✅ OrganizationType: Database matches model
# ✅ IdentifierType: Database matches model
```

#### Prevention
**Automatic Checks** (implemented 2026-02-07):
1. **Startup validation** - Warns if enum mismatch detected
2. **Automated tests** - `pytest tests/test_enum_consistency.py`
3. **Verification script** - `python scripts/verify_database_enums.py`

See: [`ENUM_CONVENTIONS.md`](./ENUM_CONVENTIONS.md)

---

### Duplicate Index Name on Startup

**Status**: ✅ **FIXED** as of 2026-02-15

#### Symptoms
```
sqlalchemy.exc.OperationalError: (pymysql.err.OperationalError) (1061, "Duplicate key name 'ix_locations_organization_id'")
[SQL: CREATE INDEX ix_locations_organization_id ON locations (organization_id)]
```
or:
```
sqlalchemy.exc.OperationalError: (pymysql.err.OperationalError) (1061, "Duplicate key name 'ix_voting_tokens_token'")
```

Application crashes during startup with `Application startup failed. Exiting.`

#### Cause
SQLAlchemy model columns had **both** `index=True` on the column definition **and** an explicit `Index()` with the same name in `__table_args__`. When SQLAlchemy generates the `index=True` index, it auto-names it `ix_<tablename>_<columnname>`. If `__table_args__` also declares an `Index("ix_<tablename>_<columnname>", ...)`, MySQL rejects the duplicate name.

This happens on every fresh database initialization — it is not caused by leftover tables.

**Affected models** (now fixed):
- `location.py` — `organization_id` (crash: same index name)
- `election.py` — `VotingToken.token` (crash: same index name)
- `apparatus.py`, `facilities.py`, `inventory.py`, `ip_security.py`, `public_portal.py` — had redundant indexes with different names (no crash, but wasteful)

#### Fix
This has been fixed in the codebase. Pull the latest changes:
```bash
git pull origin main
docker compose down
docker volume rm the-logbook_mysql_data  # Clean slate recommended
docker compose up -d
```

#### Prevention
When defining indexes on SQLAlchemy models, use **one** method, not both:

```python
# ✅ CORRECT: Use explicit Index in __table_args__ (preferred for clarity)
organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False)

__table_args__ = (
    Index("ix_locations_organization_id", "organization_id"),
)

# ✅ CORRECT: Use index=True on the column (simpler for single-column indexes)
organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)

# ❌ WRONG: Both together — creates duplicate index
organization_id = Column(String(36), ForeignKey("organizations.id"), nullable=False, index=True)

__table_args__ = (
    Index("ix_locations_organization_id", "organization_id"),  # Duplicate!
)
```

---

### Migration Failures

#### Error: Migration failed to apply

**Common Causes**:

**1. Duplicate Column**:
```
Error: Column 'organization_type' already exists
```

**Fix**: Migration was already applied
```bash
# Check migration status
alembic current

# Check history
alembic history
```

**2. Missing Dependency**:
```
Error: Cannot find revision 'abc123'
```

**Fix**: Run migrations in order
```bash
alembic upgrade head
```

**3. Data Constraint Violation**:
```
Error: Data truncation or constraint violation
```

**Fix**: Check existing data
```bash
# Find problematic data
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" logbook \
  -e "SELECT * FROM organizations WHERE organization_type NOT IN ('fire_department', 'ems_only', 'fire_ems_combined');"
```

---

## Error Message Reference

### Error Message Format (As of 2026-02-07)

All error messages now follow this format:
```
[What failed]: [Specific reason]. [Action to fix].
```

**Examples**:

✅ **Good** (new format):
```
"Username 'admin' is already taken. Try a different username like 'admin2'."
"Cannot connect to server. Please check your internet connection and try again."
"Image too large: 7.50MB (max 5MB). Reduce image size and try again."
```

❌ **Old** (being phased out):
```
"Username already exists"
"Failed to fetch"
"Invalid image"
```

---

### Error Categories

#### 1. Validation Errors (400, 422)
**Pattern**: Shows what's invalid and requirements
```
"Email 'invalid-email' is not valid. Must be in format: user@domain.com"
"Password too short. Must be at least 12 characters."
```

#### 2. Duplicate/Conflict Errors (409)
**Pattern**: Shows conflicting value and suggests alternative
```
"Username 'admin' is already taken. Try 'admin2' or 'admin_fcvfd'."
"Organization name already exists. Try adding location (e.g., 'FCVFD West')."
```

#### 3. Authentication Errors (401, 403)
**Pattern**: Clear action needed
```
"Session expired. Please log in again."
"Access denied. You don't have permission to perform this action."
```

#### 4. Network Errors
**Pattern**: Explains connectivity issue and next steps
```
"Cannot connect to server. Check your internet connection and try again."
"Request timed out. The server is responding slowly. Please try again."
```

#### 5. Server Errors (500+)
**Pattern**: Acknowledges error and suggests action
```
"Server error occurred. Please try again later or contact support."
"Database connection error. Please try again in a moment."
```

---

### Technical Error Translation

The system now automatically translates technical errors:

| Technical Error | User-Friendly Message |
|----------------|----------------------|
| `Failed to fetch` | Cannot connect to server. Check your internet connection. |
| `TypeError: Cannot read property` | An unexpected error occurred. Please try again. |
| `(pymysql.err.OperationalError)` | Database connection error. Please try again in a moment. |
| `ECONNREFUSED` | Cannot connect to server at [address]. Verify the server is running. |
| `ETIMEDOUT` | Request timed out. The server is taking too long to respond. |
| `SSL: WRONG_VERSION_NUMBER` | SSL/TLS version mismatch. Try changing encryption method. |

---

## Security & Session Management

**Last Updated**: 2026-02-12

### Session Inactivity Timeout

The application automatically logs users out after **30 minutes of inactivity** (no mouse, keyboard, scroll, or touch events).

#### Symptom: "You have been logged out due to inactivity"

**Cause**: No user activity detected for 30 minutes.

**Solutions**:
1. Log in again at the login page
2. Keep the browser tab active during long workflows
3. No data is lost -- unsaved form changes will need to be re-entered

---

### Onboarding Session Expiry

Onboarding sessions now expire after **30 minutes of inactivity** (previously 2 hours).

#### Symptom: "Your onboarding session has expired due to inactivity"

**Cause**: Took too long between onboarding steps.

**Solutions**:
1. Refresh the page to start a new session
2. Previously saved progress (organization, email config) is retained
3. Complete each step promptly to avoid timeout

---

### Password Reset Links

Password reset links expire after **30 minutes**.

#### Symptom: "This password reset link has expired"

**Cause**: Reset link was not used within 30 minutes of being sent.

**Solutions**:
1. Request a new reset link from the login page
2. Check email promptly after requesting reset
3. If emails are delayed, contact your administrator

#### Symptom: "This password reset link is invalid or has already been used"

**Cause**: Link was already used, or URL was corrupted.

**Solutions**:
1. Each reset link can only be used once
2. Request a new link from the login page
3. Copy the full URL from the email (don't modify it)

---

### Account Lockout

After **5 failed login attempts**, accounts are temporarily locked for **30 minutes**.

#### Symptom: "Account is temporarily locked"

**Cause**: Too many incorrect password attempts.

**Solutions**:
1. Wait for the lockout period to expire (message shows remaining time)
2. Use "Forgot Password" to reset your password
3. Contact your administrator if you're locked out repeatedly

---

### Security Configuration (Administrators)

#### Production Environment Requirements

The following must be configured in production:

| Setting | Requirement | Error if Missing |
|---------|------------|------------------|
| `ENCRYPTION_SALT` | Unique random value | Application will not start |
| `SECRET_KEY` | Unique, 32+ characters | Startup warning/failure |
| `ENCRYPTION_KEY` | Unique random value | Startup warning/failure |

**Generate secure values**:
```bash
# Generate ENCRYPTION_SALT
python -c "import secrets; print(secrets.token_hex(16))"

# Generate SECRET_KEY
python -c "import secrets; print(secrets.token_hex(32))"

# Generate ENCRYPTION_KEY
python -c "import secrets; print(secrets.token_hex(32))"
```

#### Bulk Import Limits

External training bulk imports are limited to **500 records** per request to prevent abuse.

#### Form Submission Sanitization

All form submissions are automatically sanitized with DOMPurify to strip HTML/script injection. If form data appears truncated, ensure inputs don't contain HTML tags.

#### Password Requirements

Login passwords must be at least **8 characters** (schema validation). New passwords during registration or reset must meet the full strength requirements (12+ characters, mixed case, numbers, special characters).

---

## Documents Module

### Overview

The Documents module provides file storage with folder hierarchy, document upload/download, and status management (draft, active, archived).

**API Endpoints**: `/api/v1/documents/`
**Permissions**: `documents.view` (read), `documents.manage` (create/edit/delete)

### Common Issues

#### Error: Unable to load documents

**Message**: `"Unable to load documents. Please check your connection and try again."`

**Causes**:
1. Network connectivity issue
2. Backend service not running
3. Database migration not applied (missing `documents` or `document_folders` tables)

**Solutions**:
```bash
# Verify the documents tables exist
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" logbook \
  -e "SHOW TABLES LIKE 'document%';"

# Expected: documents, document_folders

# If tables are missing, run migrations
docker exec the-logbook-backend-1 alembic upgrade head
```

---

#### Error: Unable to upload document

**Message**: `"Unable to upload the document. Please check your input and try again."`

**Causes**:
1. File too large (check server upload limits)
2. Missing required fields (name)
3. Invalid folder_id reference

**Solutions**:
- Verify the file is not too large for your server configuration
- Ensure the target folder exists before uploading
- Check that the document name is provided

---

#### Error: Unable to create folder

**Message**: `"Unable to create the folder. Please check your input and try again."`

**Causes**:
1. Duplicate folder name in the same parent
2. Invalid parent_folder_id
3. Missing `documents.manage` permission

**Solutions**:
- Use a unique folder name within the parent directory
- Verify your user role has `documents.manage` permission
- Check that the parent folder exists

---

## Meetings & Minutes Module

### Overview

The Meetings module manages meeting records with attendees, action items, and approval workflows. Meeting types include regular, special, emergency, committee, and board meetings.

**API Endpoints**: `/api/v1/meetings/`
**Permissions**: `meetings.view` (read), `meetings.manage` (create/edit/delete/approve)

### Common Issues

#### Error: Unable to load meetings

**Message**: `"Unable to load meetings. Please check your connection and try again."`

**Causes**:
1. Network connectivity issue
2. Missing `meetings` table (migration not applied)

**Solutions**:
```bash
# Verify the meetings tables exist
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" logbook \
  -e "SHOW TABLES LIKE 'meeting%';"

# Expected: meetings, meeting_attendees, meeting_action_items
```

---

#### Error: Unable to create meeting

**Message**: `"Unable to create the meeting. Please check your input and try again."`

**Causes**:
1. Missing required fields (title, meeting_type, meeting_date)
2. Invalid meeting_type value
3. Missing `meetings.manage` permission

**Solutions**:
- Ensure title, meeting type, and date are all provided
- Valid meeting types: `regular`, `special`, `emergency`, `committee`, `board`
- Check that your user role has `meetings.manage` permission

---

#### Meeting Approval Workflow

Meetings follow a status workflow: **draft** -> **approved** -> **archived**

- Only users with `meetings.manage` permission can approve meetings
- Approved meetings cannot be edited (only archived)
- Action items can be managed independently of meeting status

---

## Scheduling Module

### Overview

The Scheduling module provides full shift management including shift creation, templates, recurring patterns, duty roster assignments, swap requests, time-off tracking, call recording, and reporting.

**API Endpoints**: `/api/v1/scheduling/`
**Permissions**: `scheduling.view` (read), `scheduling.manage` (create/edit/delete), `scheduling.assign` (assign members), `scheduling.swap` (swap requests), `scheduling.report` (reports/analytics)

### Common Issues

#### Error: Unable to load shifts

**Message**: `"Unable to load shifts. Please check your connection and try again."`

**Causes**:
1. Network connectivity issue
2. Backend service not running
3. Shifts table not created (migration not applied)

**Solutions**:
```bash
# Check backend health
curl http://localhost:3001/health

# Run migrations if needed
docker exec the-logbook-backend-1 alembic upgrade head
```

---

#### Error: Unable to create shift

**Message**: `"Unable to create the shift. Please check your input and try again."`

**Causes**:
1. Missing required fields (shift_date, start_time)
2. End time before start time
3. Missing `scheduling.manage` permission

**Solutions**:
- Verify all required fields are filled in
- Ensure end time is after start time
- Check user has `scheduling.manage` permission

---

#### Calendar View Shows No Data

**Symptoms**: Calendar shows empty week/month despite shifts existing

**Causes**:
1. Date range filter doesn't match existing shifts
2. Shifts exist for different dates

**Solutions**:
- Navigate to the correct week using the calendar navigation
- Check that shifts have been created for the current week
- Verify shift dates are correct in the database

---

#### Shift Template: Not Appearing in Template List

**Symptoms**: Created a template but it doesn't show up when listing templates

**Causes**:
1. Template marked as inactive (`is_active = false`)
2. The `active_only` query parameter defaults to `true`

**Solutions**:
- Check the template's `is_active` status
- To see all templates including inactive: `GET /api/v1/scheduling/templates?active_only=false`
- Update the template: `PATCH /api/v1/scheduling/templates/{id}` with `{"is_active": true}`

---

#### Shift Pattern: Auto-Generation Not Creating Shifts

**Symptoms**: `POST /api/v1/scheduling/patterns/{id}/generate` returns 0 shifts

**Causes**:
1. Start date is after end date
2. Pattern has no template linked (`template_id` is null)
3. For WEEKLY patterns: `schedule_config.weekdays` doesn't include any days in the range
4. For PLATOON patterns: `days_on` and `days_off` not configured
5. Pattern is inactive

**Solutions**:
- Verify the pattern has a valid `template_id`
- For weekly patterns, ensure `schedule_config` includes `{"weekdays": [0, 1, 2, 3, 4]}` (Mon-Fri)
- For platoon patterns, set `rotation_days`, `days_on`, and `days_off`
- Check that the date range in the generation request covers at least one matching day

---

#### Shift Assignment: Member Can't Confirm

**Symptoms**: Member gets an error when trying to confirm their shift assignment

**Causes**:
1. The logged-in user doesn't match the assignment's `user_id`
2. Assignment has already been confirmed or declined

**Solutions**:
- Members can only confirm their own assignments
- Check the current `assignment_status` — only `assigned` status can be confirmed

---

#### Shift Swap: Request Denied Unexpectedly

**Symptoms**: Swap request was denied even though both members agreed

**Causes**:
1. An officer must review and approve swap requests — member-to-member agreement is not sufficient
2. The reviewer may have added notes explaining the denial

**Solutions**:
- Check `reviewer_notes` on the swap request for the reason
- Ensure the request was reviewed by someone with `scheduling.manage` permission
- Submit a new request if the original was denied in error

---

#### Time-Off: Request Not Showing in Availability

**Symptoms**: Submitted a time-off request but `GET /availability` doesn't show it

**Causes**:
1. Time-off request is still `pending` — only `approved` requests appear in availability
2. Date range doesn't overlap with the time-off dates

**Solutions**:
- Have an officer approve the time-off request: `POST /api/v1/scheduling/time-off/{id}/review`
- Verify the availability query date range overlaps with the time-off dates

---

#### Shift Calls: Not Linked to Correct Shift

**Symptoms**: Call records appear under the wrong shift

**Causes**:
1. Wrong `shift_id` provided when creating the call

**Solutions**:
- Verify the shift ID before creating a call: `GET /api/v1/scheduling/shifts` to list shifts by date
- Update the call if needed: `PATCH /api/v1/scheduling/calls/{id}`

---

#### Reports: Member Hours Showing Zero

**Symptoms**: Member hours report shows 0 hours for members who worked shifts

**Causes**:
1. Members have attendance records but no `checked_out_at` time (duration not calculated)
2. Date range doesn't cover the shift dates

**Solutions**:
- Ensure attendance records have both `checked_in_at` and `checked_out_at` — duration is auto-calculated from these
- Expand the date range in the report query

---

#### Scheduling: Permission Denied for Assignment

**Symptoms**: User gets 403 when trying to assign members to shifts

**Causes**:
1. User has `scheduling.manage` but not `scheduling.assign`
2. The `scheduling.assign` permission is separate from general manage

**Solutions**:
- Grant the user the `scheduling.assign` permission
- Officers, chiefs, and the Scheduling Officer role have this by default

---

## Facilities Module

### Overview

The Facilities module manages buildings, stations, and properties including maintenance scheduling, utility tracking, key/access management, room inventory, emergency contacts, capital projects, insurance policies, occupant assignments, and compliance checklists.

**API Endpoints**: `/api/v1/facilities/`
**Permissions**: `facilities.view` (read), `facilities.create`, `facilities.edit`, `facilities.delete`, `facilities.maintenance` (log maintenance), `facilities.manage` (full access)

### Common Issues

#### Error: Unable to load facilities

**Message**: `"Unable to load facilities. Please check your connection and try again."`

**Causes**:
1. Network connectivity issue
2. Migration not applied (facilities tables don't exist)
3. Facilities module not enabled during onboarding

**Solutions**:
```bash
# Run migrations
docker exec the-logbook-backend-1 alembic upgrade head

# Verify the facilities tables exist
docker exec the-logbook-db-1 mysql -u root -p the_logbook -e "SHOW TABLES LIKE 'facilit%';"
```

---

#### Facility Types/Statuses Empty

**Symptoms**: No facility types or statuses available when creating a facility

**Causes**:
1. Seed migration `20260214_2000` not applied
2. Organization-specific types not yet created (system defaults have `organization_id = NULL`)

**Solutions**:
```bash
# Run seed migration
docker exec the-logbook-backend-1 alembic upgrade head
```
- System defaults (10 types, 6 statuses, 20 maintenance types) are seeded automatically
- Organizations can create additional custom types

---

#### Maintenance Scheduling: No Default Types

**Symptoms**: No maintenance types available when logging maintenance

**Causes**:
1. Seed migration not applied

**Solutions**:
- Run `alembic upgrade head` — migration `20260214_2000` seeds 20 default maintenance types (HVAC, generator, fire alarm, sprinkler, elevator, bay door, etc.) with recommended scheduling intervals

---

#### Utility Readings: Can't Add Meter Reading

**Symptoms**: Error when adding a utility reading

**Causes**:
1. No utility account exists for the facility
2. Missing `facilities.maintenance` permission

**Solutions**:
- First create a utility account: `POST /api/v1/facilities/{id}/utility-accounts`
- Then add readings: `POST /api/v1/facilities/{id}/utility-accounts/{account_id}/readings`
- Ensure user has `facilities.maintenance` permission

---

#### Key/Access: Member Not Found for Assignment

**Symptoms**: Can't assign an access key to a member

**Causes**:
1. The `assigned_to` field expects a valid user ID
2. The user must be in the same organization

**Solutions**:
- Verify the user ID: `GET /api/v1/users` to list organization members
- Use the correct `user_id` in the `assigned_to` field

---

#### Compliance Checklist: Items Not Saving

**Symptoms**: Compliance checklist items aren't persisting

**Causes**:
1. Must create the checklist first, then add items to it
2. Missing `facilities.edit` permission

**Solutions**:
- Create checklist: `POST /api/v1/facilities/{id}/compliance-checklists`
- Then add items: `POST /api/v1/facilities/{id}/compliance-checklists/{checklist_id}/items`

---

#### Facilities Manager Role: Missing Permissions

**Symptoms**: Facilities Manager can view but can't edit or log maintenance

**Causes**:
1. The Facilities Manager role intentionally excludes `facilities.delete` and `facilities.manage`
2. It includes: `facilities.view`, `facilities.create`, `facilities.edit`, `facilities.maintenance`

**Solutions**:
- This is by design — the role is for day-to-day management, not full admin
- For full access, assign the Chief, President, or Assistant Chief role
- Or create a custom role with all 6 facilities permissions

---

## Reports Module

### Overview

The Reports module generates data reports including member roster, training summary, and event attendance reports using aggregated data from across the application.

**API Endpoints**: `/api/v1/reports/`
**Permissions**: `reports.view` (view report types), `reports.manage` (generate reports)

### Common Issues

#### Error: Unable to generate report

**Message**: `"Unable to generate report. Please check your connection and try again."`

**Causes**:
1. Network connectivity issue
2. No data available for the requested report type
3. Missing `reports.manage` permission

**Solutions**:
- Verify your connection to the server
- Ensure data exists for the report (e.g., members exist for member roster report)
- Check that your user role has `reports.manage` permission

---

#### Report Returns Empty Results

**Symptoms**: Report generates successfully but shows no data

**Causes**:
1. No records match the report criteria
2. Date range filters exclude all data
3. Data hasn't been entered yet

**Solutions**:
- For **member_roster**: Verify active members exist in the Members module
- For **training_summary**: Verify training records have been created
- For **event_attendance**: Verify events with attendees exist

---

#### Available Report Types

| Report Type | Description | Data Source |
|-------------|-------------|-------------|
| `member_roster` | List of all active members with roles | Users table |
| `training_summary` | Training completion and certification status | Training records |
| `event_attendance` | Event participation rates | Events and attendees |
| `training_progress` | Pipeline enrollment progress and requirement completion | Program enrollments |
| `annual_training` | Comprehensive annual training and shift breakdown | Training records + shift reports |

#### Date Range Not Applied to Report

**Symptoms**: Report generates but ignores the selected date range

**Causes**:
1. Report type does not support date ranges (e.g., member_roster, training_progress)
2. Date format is incorrect

**Solutions**:
- Only reports marked with `usesDateRange: true` use the date range picker (training_summary, event_attendance, annual_training)
- Verify dates are in `YYYY-MM-DD` format
- Check that start date is before end date

---

## Inventory Module & Property Return Reports

### Overview

The Inventory module manages equipment, assignments, checkout/check-in, and maintenance tracking. When a member is dropped (voluntarily or involuntarily), a property-return report is automatically generated listing all assigned items.

**API Endpoints**: `/api/v1/inventory/`, `/api/v1/users/{user_id}/status`

### Common Issues

#### Property Return Report: No Items Listed

**Symptoms**: Member was dropped but the property return report shows an empty item table

**Causes**:
1. Items were not assigned through the inventory system (only verbal assignments)
2. Items were previously unassigned or checked in but the drop was processed later
3. Items are assigned to a different user ID

**Solutions**:
- Verify the member has active assignments in Inventory → Items → filter by assigned user
- Check that items were assigned using the `POST /inventory/items/{id}/assign` endpoint, not just manually tracked
- Review the member's assignment history via `GET /inventory/users/{user_id}/assignments`

#### Property Return Report: Dollar Values Show $0.00

**Symptoms**: Items are listed but all values show $0.00

**Causes**:
1. Neither `purchase_price` nor `current_value` was entered when the item was created
2. Items were created without purchase information

**Solutions**:
- Update items with their purchase price or current value before dropping the member
- Use `PATCH /inventory/items/{item_id}` to set `purchase_price` or `current_value`
- The report uses `current_value` first, then falls back to `purchase_price`

#### Property Return Email Not Sent

**Symptoms**: Member was dropped but no email was received

**Causes**:
1. `send_property_return_email` was set to `false` in the status change request
2. Member has no email address on file
3. SMTP is not configured or email is disabled
4. Email was sent but caught by spam filter

**Solutions**:
- Verify the status change request included `"send_property_return_email": true`
- Check the member's email address in their profile
- Review SMTP configuration in organization settings or global config
- Check the email service logs for delivery errors
- The report is always saved to Documents regardless of email delivery

#### Member Status Change: Invalid Status Error

**Symptoms**: `400 Bad Request` when trying to change a member's status

**Causes**:
1. The status value is misspelled or not a valid UserStatus
2. The member is already in the requested status

**Solutions**:
- Valid statuses: `active`, `inactive`, `suspended`, `probationary`, `retired`, `dropped_voluntary`, `dropped_involuntary`
- Check the member's current status first — you cannot change to the same status

#### Property Return Report: Preview vs. Actual Drop

**Tip**: Use `GET /api/v1/users/{user_id}/property-return-report` to preview the report without changing the member's status. This is useful for reviewing assigned items and values before performing the actual drop.

**For full configuration documentation, see [DROP_NOTIFICATIONS.md](./DROP_NOTIFICATIONS.md).**

#### Membership Tier: Member Not Auto-Advancing

**Symptoms**: A member has enough years of service but is still at a lower tier

**Causes**:
1. `auto_advance` is disabled in the membership tier settings
2. The member's `hire_date` is not set on their profile
3. The `advance-membership-tiers` endpoint hasn't been called
4. The member is not in `active` or `probationary` status

**Solutions**:
- Call `POST /api/v1/users/advance-membership-tiers` to trigger a batch scan
- Check `Organization Settings > membership_tiers > auto_advance` is `true`
- Ensure the member's profile has a `hire_date` value
- Manually promote: `PATCH /api/v1/users/{user_id}/membership-type` with the target tier

#### Voting: Granting a Member an Override to Vote

**Scenario**: A member is blocked from voting (due to tier or attendance) but leadership wants to allow them to vote anyway

**Solution**:
1. An officer with `elections.manage` permission calls `POST /api/v1/elections/{election_id}/voter-overrides` with the member's `user_id` and a `reason`
2. The override is recorded with the granting officer's name, timestamp, and reason
3. The member can now vote in that election — tier and attendance checks are skipped
4. To revoke before they vote: `DELETE /api/v1/elections/{election_id}/voter-overrides/{user_id}`
5. View all overrides: `GET /api/v1/elections/{election_id}/voter-overrides`

**Note**: Overrides do NOT bypass the election's `eligible_voters` whitelist, position-specific role requirements, or double-vote prevention.

#### Meeting: Secretary Attendance Dashboard

**Scenario**: The secretary needs an overview of all members' meeting attendance, voting eligibility, and waiver status.

**Endpoint**: `GET /api/v1/meetings/attendance/dashboard`

**Parameters**:
- `period_months`: Look-back period (default 12)
- `meeting_type`: Filter by type (e.g. `business` for business meetings only)

**Returns per member**: `attendance_pct`, `meetings_attended`, `meetings_waived`, `meetings_absent`, `membership_tier`, `voting_eligible`, `voting_blocked_reason`

**Summary block**: Average attendance, voting eligible count, members blocked by attendance.

#### Meeting: Granting an Attendance Waiver

**Scenario**: A member can't make a meeting and the secretary/president/chief wants to excuse them so their attendance percentage isn't penalized, but they also cannot vote in that meeting.

**Steps**:
1. Call `POST /api/v1/meetings/{meeting_id}/attendance-waiver` with `user_id` and `reason`
2. The member is marked as excused with a waiver
3. This meeting is excluded from the member's attendance percentage calculation
4. The member cannot vote in elections associated with this meeting
5. View all waivers: `GET /api/v1/meetings/{meeting_id}/attendance-waivers`

**Note**: Waivers are logged as `meeting_attendance_waiver_granted` audit events with `warning` severity.

#### Training: Auto-Enrollment on Member Conversion

**Scenario**: A prospective member has been approved and converted to a full member — they should be automatically enrolled in the probationary training program.

**How It Works**:
1. When `transfer_to_membership()` is called (from the prospective member pipeline), the system looks for the org's default probationary program
2. First checks `organization.settings.training.auto_enroll_program_id` for an explicitly configured program
3. Falls back to any active training program with "probationary" in the name
4. Creates an active `ProgramEnrollment` automatically

**Manual Enrollment**: The training officer can enroll anyone into any program via `POST /api/v1/training/enrollments?user_id={id}&program_id={id}`.

**Not working?** Check that:
- A training program exists with "probationary" in the name (or set `auto_enroll_program_id` in org settings)
- The program is `active = true`

#### Training: Incident-Based Requirements (Calls, Shifts, Hours)

**Scenario**: A department requires driver candidates to respond to 15 calls (10 transports), complete 5 shifts, with specific call type tracking.

**Configuration** (set on `TrainingRequirement`):
- `requirement_type`: `"calls"`, `"shifts"`, or `"hours"`
- `required_calls`: Total number of calls required (e.g. 15)
- `required_call_types`: Specific types to count (e.g. `["transport", "cardiac", "trauma"]`)
- `required_shifts`: Number of shifts required (e.g. 5)
- `required_hours`: Total hours (e.g. 40)

**Tracking**: Shift completion reports (`POST /api/v1/training/shift-reports`) auto-update requirement progress:
- SHIFTS: +1 per shift report
- CALLS: Counts matching call types from the report's `call_types` array
- HOURS: Adds `hours_on_shift` from the report

**Call type totals**: View `progress_notes.call_type_totals` on the requirement progress record for a breakdown by type.

#### Scheduled Tasks: Setting Up the Cron

**Scenario**: The system needs daily cert alerts, weekly struggling member checks, and monthly tier advancement.

**Recommended crontab**:
```
# Daily at 6:00 AM — cert expiration alerts
0 6 * * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=cert_expiration_alerts

# Weekly Monday 7:00 AM — struggling member detection
0 7 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=struggling_member_check

# Weekly Monday 7:30 AM — enrollment deadline warnings
30 7 * * 1 curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=enrollment_deadline_warnings

# Monthly 1st at 8:00 AM — membership tier auto-advance
0 8 1 * * curl -s -X POST http://localhost:8000/api/v1/scheduled/run-task?task=membership_tier_advance
```

**Manual trigger**: Any task can be run on-demand via the same endpoint.

**View tasks**: `GET /api/v1/scheduled/tasks` lists all tasks with their schedules.

#### Membership: Editing Tier Requirements

**Scenario**: The training officer or secretary needs to change the meeting attendance percentage required for voting eligibility, or adjust tier benefits.

**Steps**:
1. View current config: `GET /api/v1/users/membership-tiers/config`
2. Update config: `PUT /api/v1/users/membership-tiers/config` with the full tier list
3. Each tier has `benefits` with: `voting_eligible`, `voting_requires_meeting_attendance`, `voting_min_attendance_pct`, `voting_attendance_period_months`, `training_exempt`, `training_exempt_types`, `can_hold_office`

**Example**: To require 60% attendance over 6 months for active members to vote:
```json
{
  "benefits": {
    "voting_requires_meeting_attendance": true,
    "voting_min_attendance_pct": 60.0,
    "voting_attendance_period_months": 6
  }
}
```

#### Voting: Setting Up Proxy Voting

**Scenario**: A member cannot attend the meeting but the department allows proxy voting — another member should be able to vote on their behalf.

**Prerequisites**: Proxy voting must be enabled for the organization. Set `organization.settings.proxy_voting.enabled = true` via org settings. This is a department-level decision and is disabled by default.

**Steps**:
1. An officer with `elections.manage` permission calls `POST /api/v1/elections/{election_id}/proxy-authorizations` with:
   - `delegating_user_id`: the absent member
   - `proxy_user_id`: the member who will vote on their behalf
   - `proxy_type`: `"single_election"` (one-time) or `"regular"` (standing proxy)
   - `reason`: why the proxy is being authorized
2. The authorization is recorded with both member names, the authorizing officer, and a timestamp
3. When ballot emails are sent, the proxy holder is automatically CC'd on the absent member's ballot notification
4. The proxy casts the vote via `POST /api/v1/elections/{election_id}/proxy-vote` with their `proxy_authorization_id`
5. The system checks the *delegating* member's eligibility and applies double-vote prevention against them
6. The hash trail shows: `is_proxy_vote=true`, who physically voted (`proxy_voter_id`), and on whose behalf (`proxy_delegating_user_id`)
7. To revoke before voting: `DELETE /api/v1/elections/{election_id}/proxy-authorizations/{id}`
8. View all authorizations: `GET /api/v1/elections/{election_id}/proxy-authorizations`

**Note**: A proxy authorization cannot be revoked after the proxy has cast the vote. The vote itself must be soft-deleted first. Proxy voting does NOT bypass the election's `eligible_voters` whitelist, position-specific role requirements, or double-vote prevention.

#### Voting: Bulk Voter Overrides

**Scenario**: The Secretary needs to grant voting overrides to multiple members at once (e.g., for a special election where several excused members were approved by board vote).

**Steps**:
1. Call `POST /api/v1/elections/{election_id}/voter-overrides/bulk` with:
   - `user_ids`: list of member UUIDs to override
   - `reason`: explanation for the bulk override (10–500 characters)
2. Each member is individually logged with `warning` severity in the audit trail
3. A summary audit event captures the full batch with all user IDs and the officer who granted them
4. Members who already have an override are skipped (no duplicates)

**Note**: Bulk overrides follow the same scope rules as individual overrides — they bypass tier/attendance checks only, NOT eligible_voters lists, role requirements, or double-vote prevention.

#### Meeting: Configuring Quorum

**Scenario**: The department wants quorum enforcement for meetings — the system should show whether enough members are present.

**Organization-Level Configuration**:
Set `organization.settings.quorum_config`:
```json
{
  "enabled": true,
  "type": "percentage",
  "threshold": 50.0
}
```
- `type`: `"percentage"` (of active members) or `"count"` (absolute number required)
- `threshold`: the value (e.g., 50.0 for 50% or 10 for 10 members)

**Per-Meeting Override**:
Use `PATCH /api/v1/minutes/{minutes_id}/quorum-config` to set `quorum_type` and `quorum_threshold` on a specific meeting, overriding the org default.

**Checking Quorum**:
- `GET /api/v1/minutes/{minutes_id}/quorum` returns `quorum_met`, `present_count`, `required_count`, and a description
- Quorum recalculates automatically when attendees are marked present or removed

**Common Issue**: Quorum says 0 present — ensure attendees have `present: true` in the meeting's attendee list.

#### Meeting: Quorum Not Updating After Check-In

**Symptoms**: Members are checking in but quorum still shows 0 present.

**Causes**:
1. Attendees are added to the meeting but not marked as `present: true`
2. The org quorum config has `enabled: false`

**Solutions**:
- Verify the meeting's `attendees` JSON array — each entry should have `"present": true`
- Check `Organization Settings > quorum_config > enabled` is `true`
- If using per-meeting override, verify both `quorum_type` and `quorum_threshold` are set on the meeting

#### Training: Configuring Peer Skill Evaluation Sign-Offs

**Scenario**: The training officer wants to control who can sign off on skill evaluations — for example, only the shift leader can evaluate Attendant in Charge (AIC) skills, while only a driver trainer can evaluate driver trainees.

**Configuration** (set by training officer or chief on each SkillEvaluation record):

**Role-based** (`allowed_evaluators` JSON):
```json
{"type": "roles", "roles": ["shift_leader", "driver_trainer"]}
```
Only users with one of these roles can sign off on this skill.

**User-specific**:
```json
{"type": "specific_users", "user_ids": ["uuid1", "uuid2"]}
```
Only explicitly named users can evaluate.

**Default** (set to `null`): Any user with `training.manage` permission can sign off.

**Checking Permission**:
- `POST /api/v1/training/skill-evaluations/{skill_id}/check-evaluator` — returns whether the current user is authorized

#### Training: Certification Expiration Alert Pipeline

**Scenario**: Members with expiring certifications should receive tiered reminders, and training/compliance officers should be CC'd on escalating notifications when members are non-responsive.

**Alert Tiers**:
| Days Before Expiry | Alert Level | CC Recipients |
|---|---|---|
| 90 days | First notice | Member only |
| 60 days | Second notice | Member only |
| 30 days | Urgent | Member + Training officers |
| 7 days | Final warning | Member + Training + Compliance officers |
| Expired | Escalation | Member + Training + Compliance + Chief |

**Triggering Alerts**:
- `POST /api/v1/training/certifications/process-alerts` — designed to be called by a daily cron job
- Each tier is tracked per-record (`alert_90_sent_at`, etc.) — idempotent, won't re-send

**Common Issue**: No alerts being sent — verify that training records have an `expiration_date` set and that the email service is configured.

#### Training: Using the Competency Matrix Dashboard

**Scenario**: Training officers need an at-a-glance view of department readiness — who is current, who is expiring soon, and where the gaps are.

**Endpoint**: `GET /api/v1/training/competency-matrix`

**Returns**: A matrix of members vs. requirements with status for each cell:
- **current** (green): Active and not expiring soon
- **expiring_soon** (yellow): Expires within 90 days
- **expired** (red): Past expiration date
- **not_started** (gray): No record on file

**Filtering**:
- `requirement_ids`: comma-separated list to focus on specific requirements
- `user_ids`: comma-separated list to focus on specific members

**Summary Block** includes `readiness_percentage` — the percentage of all member/requirement cells that are `current` or `expiring_soon`.

#### Training: Calendar Integration & Double-Booking Prevention

**Scenario**: Training sessions should appear on the organization calendar and prevent double-booking at the same location.

**Creating a Training Session with Location**:
- Include `location_id` in the `POST /api/v1/training-sessions` request
- The system checks for overlapping events at that location before creating the training event
- If a conflict exists, the request returns `400` with the conflicting event name(s)

**Calendar View**:
- `GET /api/v1/training-sessions/calendar` — returns all training sessions with their linked Event data (dates, times, locations)
- Supports `start_after`, `start_before`, and `training_type` filters

**Hall Coordinator Separation**:
- Hall coordinators who manage facility bookings can use `GET /api/v1/events?exclude_event_types=training` to see only non-training events
- Double-booking prevention still applies across ALL event types — training sessions booked at a location will block other events from booking the same slot

#### Voting: Member Blocked Due to Meeting Attendance

**Symptoms**: An active member gets "attendance below minimum" when trying to vote

**Causes**:
1. The member's tier has `voting_requires_meeting_attendance: true` with a minimum percentage
2. The member hasn't attended enough meetings in the look-back period
3. Meeting attendance was not recorded (member was present but not marked)

**Solutions**:
- Check the member's tier in `Organization Settings > membership_tiers > tiers` — look at `benefits.voting_min_attendance_pct`
- Verify meeting attendance records: ensure the member is marked `present: true` in meeting attendee records
- Adjust the look-back period (`voting_attendance_period_months`) or lower the minimum if the policy was set too aggressively
- Alternatively, promote the member to a tier without attendance requirements

#### Training: Life Member Still Showing Pending Requirements

**Symptoms**: A life member is flagged for incomplete training requirements

**Causes**:
1. The member's `membership_type` hasn't been updated to the exempt tier
2. The tier's `training_exempt` setting is not enabled
3. Auto-advancement hasn't been triggered

**Solutions**:
- Verify the member's tier: check `membership_type` on their profile
- Check `Organization Settings > membership_tiers > tiers` — the life tier should have `benefits.training_exempt: true`
- Run `POST /api/v1/users/advance-membership-tiers` or manually update via `PATCH /api/v1/users/{user_id}/membership-type`

#### Drop Notification: CC Recipients Not Receiving Email

**Symptoms**: Leadership or quartermaster didn't receive a copy of the drop notification

**Causes**:
1. The CC roles are not configured in organization settings
2. The user with that role has no email address
3. Email sending is disabled for the organization

**Solutions**:
- Check `Organization Settings > member_drop_notifications > cc_roles` — default is `["admin", "quartermaster", "chief"]`
- Add specific emails to `cc_emails` list for users who should always receive copies
- Verify email service is enabled: `Organization Settings > email_service > enabled`

#### Drop Notification: Personal Email Not Included

**Symptoms**: The drop notification was only sent to the department email, not the member's personal email

**Causes**:
1. The member has no `personal_email` on file
2. The `include_personal_email` setting is disabled

**Solutions**:
- Ensure the member's profile has a `personal_email` value set
- Check `Organization Settings > member_drop_notifications > include_personal_email` is `true`

#### Drop Notification: Customizing the Email Template

**Tip**: The drop notification uses the `MEMBER_DROPPED` email template. Edit it at **Settings > Email Templates** to customize the subject, body, and styling. Available template variables: `{{member_name}}`, `{{organization_name}}`, `{{drop_type_display}}`, `{{reason}}`, `{{effective_date}}`, `{{return_deadline}}`, `{{item_count}}`, `{{total_value}}`, `{{performed_by_name}}`, `{{performed_by_title}}`.

#### Property Return Reminders: 30-Day or 90-Day Not Sending

**Symptoms**: A member was dropped more than 30 days ago but no reminder was sent

**Causes**:
1. The process endpoint hasn't been called (reminders require a trigger)
2. The member has no outstanding items (all were returned)
3. The reminder was already sent previously (duplicate prevention)
4. The member was dropped before `status_changed_at` was tracked (legacy drops)

**Solutions**:
- Call `POST /api/v1/users/property-return-reminders/process` manually or set up a daily scheduler
- Check the overdue list: `GET /api/v1/users/property-return-reminders/overdue`
- Verify the member still has active assignments/checkouts in the inventory system
- For legacy drops: update the member's `status_changed_at` to their actual drop date

#### Property Return Reminders: Overdue List Shows Returned Items

**Symptoms**: Items appear on the overdue list but the member already returned them

**Causes**:
1. Items were physically returned but not checked in / unassigned in the system
2. Officer forgot to process the return in the inventory module

**Solutions**:
- Unassign items: `POST /api/v1/inventory/items/{item_id}/unassign`
- Check in items: `POST /api/v1/inventory/checkout/{checkout_id}/checkin`
- Once all items are returned in the system, the member will no longer appear on the overdue list and no further reminders will be sent
- Once all items are returned, the member is automatically archived (see below)

#### Member Not Auto-Archived After Returning All Items

**Symptoms**: A dropped member returned all items but is still in `dropped_voluntary` or `dropped_involuntary` status

**Causes**:
1. Items were returned physically but not processed through the system (unassign / check-in)
2. There is still an active `ItemAssignment` or unreturned `CheckOutRecord` for the member
3. The member was not in a dropped status when items were returned

**Solutions**:
- Verify all items are unassigned: check `GET /api/v1/inventory/users/{user_id}/assignments?active_only=true`
- Verify all checkouts are returned: check active checkouts for the user
- Manually archive the member: `POST /api/v1/users/{user_id}/archive`

#### Prospect Creation or Transfer Blocked by Archived Member Match

**Symptoms**: Creating a prospect or transferring to membership returns 409 Conflict

**Causes**:
1. The prospect's email matches an archived (or active) member in the system

**Solutions**:
- If the person is a returning member: use `POST /api/v1/users/{user_id}/reactivate` to restore their archived profile
- If it's a genuinely different person who happens to share the email: update the archived member's email first, then retry
- Use `POST /api/v1/membership-pipeline/prospects/check-existing?email=...` to preview matches before creating

#### Cannot Reactivate Member

**Symptoms**: Reactivation endpoint returns an error

**Causes**:
1. Member is not in `archived` status (only archived members can be reactivated)
2. Member was soft-deleted (`deleted_at` is set)

**Solutions**:
- Verify the member's current status — only `archived` members can be reactivated
- If the member is still in a dropped status, archive them first, then reactivate
- If the member was soft-deleted, this requires direct database intervention

---

## Training Module

### Overview

The Training module manages courses, requirements, programs (pipelines), shift completion reports, self-reported training, and member visibility settings. Training data is accessible to individual members via their "My Training" page with configurable visibility settings per department.

**API Endpoints**: `/api/v1/training/`, `/api/v1/training/programs/`, `/api/v1/training/shift-reports/`, `/api/v1/training/submissions/`, `/api/v1/training/module-config/`

### Common Issues

#### Self-Reported Training: Submission Not Appearing for Review

**Symptoms**: Member submits training but officer doesn't see it in Review Submissions

**Causes**:
1. Submission is still in "draft" status
2. Officer doesn't have `training.manage` permission
3. Different organization context

**Solutions**:
- Confirm the member clicked "Submit" (not just "Save Draft")
- Verify the officer has `training.manage` permission assigned
- Ensure both the member and officer are in the same organization
- Refresh the Review Submissions page

#### Self-Reported Training: Auto-Approve Not Working

**Symptoms**: Submissions under the configured hour threshold are not auto-approved

**Causes**:
1. `auto_approve_under_hours` is set to null (disabled)
2. The submitted hours exceed the threshold
3. `require_approval` is set to true and overrides auto-approve

**Solutions**:
- Navigate to Review Submissions → Settings and verify auto-approve is configured
- Check the hour threshold value
- Ensure the submission's hours are strictly below the threshold

#### Shift Report: Pipeline Progress Not Updating

**Symptoms**: Filing a shift report doesn't update the trainee's requirement progress

**Causes**:
1. No enrollment_id was linked to the shift report
2. The trainee has no active enrollments
3. The enrollment's requirements don't include SHIFTS, CALLS, or HOURS types

**Solutions**:
- When creating a shift report, select the trainee's program enrollment from the dropdown
- Verify the trainee has an active program enrollment
- Check that the program's requirements include shift-based, call-based, or hour-based requirement types
- Look at the enrollment's requirement progress to confirm the types match

#### Shift Report: Trainee Can't See Report

**Symptoms**: Trainee doesn't see shift reports on their My Training page

**Causes**:
1. The `show_shift_reports` visibility setting is turned off
2. The report was filed for a different trainee

**Solutions**:
- Officers: Go to My Training → Member Visibility Settings and enable "Shift Reports"
- Verify the correct trainee was selected when filing the report

#### My Training Page: Missing Data Sections

**Symptoms**: Member's training page is missing sections (e.g., no shift stats, no certifications)

**Causes**:
1. Visibility settings have been turned off for those sections
2. No data exists for those sections yet

**Solutions**:
- Officers: Navigate to My Training → Member Visibility Settings to check which sections are enabled
- Data sections only appear when there is data to show — an empty certification list won't show the Certifications section
- Check that training records, shift reports, or enrollments exist for the member

#### Member Visibility Settings: Changes Not Taking Effect

**Symptoms**: After toggling visibility settings, members still see/don't see certain data

**Causes**:
1. Settings weren't saved (the Save button was not clicked)
2. Browser cache showing stale data

**Solutions**:
- Ensure the "Save Changes" button is clicked after toggling settings
- Ask the member to refresh their browser
- Verify the settings took effect by checking GET `/api/v1/training/module-config/visibility`

#### Training Reports: Annual Report Shows No Data

**Symptoms**: Annual Training Report generates but all values are zero

**Causes**:
1. Date range doesn't match any training records or shift reports
2. No completed training records exist in the period
3. Members don't have training records linked to the organization

**Solutions**:
- Check the reporting period — default is current year (Jan 1 - Dec 31)
- Try "Last Year" if training was recorded in the prior year
- Verify training records exist with `completed_date` within the selected range
- For shift data, verify shift completion reports exist with `shift_date` in range

---

## Notifications Module

### Overview

The Notifications module manages notification rules (triggers and categories), delivery logging, and read tracking. Rules can be toggled on/off and notification logs track delivery status.

**API Endpoints**: `/api/v1/notifications/`
**Permissions**: `notifications.view` (read), `notifications.manage` (create/edit/delete rules)

### Common Issues

#### Error: Unable to load notification rules

**Message**: `"Unable to load notification rules. Please check your connection and try again."`

**Causes**:
1. Network connectivity issue
2. Missing `notification_rules` or `notification_logs` tables

**Solutions**:
```bash
# Verify the notification tables exist
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" logbook \
  -e "SHOW TABLES LIKE 'notification%';"

# Expected: notification_rules, notification_logs
```

---

#### Error: Unable to create notification rule

**Message**: `"Unable to create the notification rule. Please check your input and try again."`

**Causes**:
1. Missing required fields (name, trigger_type, category)
2. Invalid trigger_type or category value
3. Missing `notifications.manage` permission

**Valid Configuration Values**:

| Field | Valid Values |
|-------|-------------|
| `trigger_type` | `event_created`, `training_due`, `shift_assigned`, `document_uploaded`, `meeting_scheduled`, `election_opened`, `form_submitted`, `custom` |
| `category` | `events`, `training`, `scheduling`, `documents`, `meetings`, `elections`, `forms`, `system` |
| `channel` | `in_app`, `email`, `sms`, `push` |

---

#### Notification Rule Toggle Not Persisting

**Symptoms**: Toggling a rule on/off reverts after page refresh

**Causes**:
1. API call to toggle endpoint failing silently
2. Network issue preventing the update

**Solutions**:
- Check browser console for API errors (F12 -> Console)
- Verify the rule ID is valid
- Confirm `notifications.manage` permission is assigned

---

## Error Handling Patterns

### Frontend Error Handling

As of 2026-02-15, all frontend `catch` blocks use type-safe error handling:

```typescript
// Correct pattern — use catch (err: unknown)
try {
  const data = await apiCall();
} catch (err: unknown) {
  const appError = toAppError(err);
  // For HTTP errors, use the API message; for generic errors, use a fallback
  setError(appError.status ? appError.message : 'Operation failed');
}
```

**Do NOT use:**
```typescript
// WRONG — 'any' bypasses type safety
catch (err: any) { ... }
```

**Key utilities** (`frontend/src/utils/errorHandling.ts`):
- `toAppError(err)` — Converts any error to a structured `AppError` with `message`, `status`, `code`, and `details`
- `getErrorMessage(err, fallback)` — Shorthand that returns just the message string
- `isAppError(err)` — Type guard for checking if an object is an `AppError`

**Check order in `toAppError()`:**
1. Axios/HTTP errors (objects with `.response`) — extracts `.response.data.detail` and `.response.status`
2. Standard `Error` instances — uses `.message`
3. Plain `AppError` objects — returns as-is
4. Strings — wraps in `{ message: string }`
5. Unknown — returns generic message

### Backend Error Handling

Backend services should raise `HTTPException` directly rather than returning error tuples:

```python
# Correct — raise on error
async def get_item(item_id: str, db: AsyncSession):
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item

# WRONG — don't return (result, error) tuples
async def get_item(item_id, db):
    item = await db.get(Item, item_id)
    if not item:
        return None, "Item not found"  # Don't do this
    return item, None
```

### Common Error Handling Issues

#### Problem: Error message shows "Network error" instead of a user-friendly fallback

**Cause**: The error is a plain `Error` object (not an HTTP error with `.response`), so `toAppError()` extracts the raw `.message` property.

**Solution**: Use `toAppError()` and check for `appError.status` to decide between the API message and a fallback:
```typescript
const appError = toAppError(err);
setError(appError.status ? appError.message : 'A friendly fallback message');
```

#### Problem: Test mock errors not being parsed correctly

**Cause**: `createMockApiError()` must return an error object (not a Promise). The error needs a `.response` property for `toAppError()` to extract the detail message.

**Solution**: Use the test utility correctly:
```typescript
// Correct — returns error object for use with mockRejectedValue
vi.mocked(api.someMethod).mockRejectedValue(
  createMockApiError('Error message', 400)
);
```

---

## Getting Help

### Self-Service Resources

1. **This Troubleshooting Guide** - Comprehensive solutions
2. **Error Message Documentation** - [`ERROR_MESSAGES_COMPLETE.md`](./ERROR_MESSAGES_COMPLETE.md)
3. **Enum Conventions** - [`ENUM_CONVENTIONS.md`](./ENUM_CONVENTIONS.md)
4. **Security Documentation** - [`SECURITY_IMAGE_UPLOADS.md`](../SECURITY_IMAGE_UPLOADS.md)

### Diagnostic Information to Gather

When reporting an issue, include:

**1. Error Details**:
```
- Exact error message (copy/paste or screenshot)
- When did it occur? (during which step)
- Can you reproduce it? (steps to reproduce)
```

**2. Environment**:
```bash
# Browser
- Name and version (Chrome 120, Firefox 121, etc.)

# Backend version
docker exec the-logbook-backend-1 python -c "from app.core.config import settings; print(settings.VERSION)"

# Database status
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SELECT VERSION();"

# Container status
docker-compose ps
```

**3. Recent Logs**:
```bash
# Backend logs (last 100 lines)
docker logs the-logbook-backend-1 --tail 100 > backend_logs.txt

# Frontend logs (browser console)
# Press F12, go to Console tab, screenshot errors
```

**4. Network Information**:
```bash
# Test connectivity
curl http://localhost:3001/health

# Check CORS
curl -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -X OPTIONS \
  http://localhost:3001/api/v1/onboarding/session/start
```

---

### Contact Support

**For Administrators**:
1. Check logs first (see Diagnostic Information above)
2. Review this troubleshooting guide
3. Check GitHub Issues: https://github.com/anthropics/claude-code/issues
4. File new issue with diagnostic information

**For Users**:
1. Contact your organization administrator
2. Provide error message and steps to reproduce
3. Include screenshots if helpful

---

## Appendix: Common Scenarios

### Scenario 1: Cannot Complete Onboarding

**Symptoms**: Stuck on one step, can't progress

**Diagnostics**:
```bash
# Check session status
curl http://localhost:3001/api/v1/onboarding/session/status

# Check backend logs for errors
docker logs the-logbook-backend-1 --tail 50 | grep ERROR
```

**Solutions**:
1. Try refreshing the page (F5)
2. Check browser console for errors (F12)
3. Clear browser cache and cookies
4. Use "Reset Progress" button if available
5. Restart onboarding from /onboarding/start

---

### Scenario 2: Email Not Sending

**Symptoms**: Test email fails, no error in inbox

**Checklist**:
- [ ] SMTP credentials correct?
- [ ] Using app password (Gmail/Outlook)?
- [ ] Port matches encryption (587=TLS, 465=SSL)?
- [ ] Server address correct?
- [ ] Firewall allowing outbound SMTP?
- [ ] Email in spam folder?

**Test Manually**:
```bash
# Install swaks (SMTP test tool)
sudo apt-get install swaks

# Test SMTP connection
swaks --to test@example.com \
  --from your-email@gmail.com \
  --server smtp.gmail.com:587 \
  --tls \
  --auth LOGIN \
  --auth-user your-email@gmail.com \
  --auth-password your-app-password
```

---

### Scenario 3: Slow Performance

**Symptoms**: Pages load slowly, requests timeout

**Diagnostics**:
```bash
# Check resource usage
docker stats

# Check database size
docker exec the-logbook-db-1 mysql -uroot -p"$MYSQL_ROOT_PASSWORD" \
  -e "SELECT table_name, ROUND(((data_length + index_length) / 1024 / 1024), 2) AS 'Size (MB)' FROM information_schema.tables WHERE table_schema = 'logbook' ORDER BY (data_length + index_length) DESC LIMIT 10;"

# Check slow queries
docker logs the-logbook-backend-1 | grep "slow"
```

**Solutions**:
1. Increase container resources
2. Optimize database (see Database Slow section)
3. Clear audit logs if very large
4. Check network latency

---

## Prospective Members Module Issues

### Inactivity Timeout Not Triggering

**Symptoms**: Applicants stay active despite no activity beyond the configured timeout period.

**Causes**:
1. Inactivity timeout not configured for the pipeline
2. Timeout preset set to "never"
3. Per-stage override extending the timeout beyond expected
4. Backend cron/scheduled job not running

**Solutions**:

**Check pipeline inactivity configuration:**
1. Navigate to Prospective Members → Pipeline Settings
2. Scroll to "Inactivity Timeout Configuration"
3. Verify a timeout preset is selected (not "never")
4. If using custom, verify the custom days value is set

**Check per-stage overrides:**
- Open each stage's configuration (pencil icon in Pipeline Builder)
- Look for "Custom timeout for this stage" checkbox
- A stage with a very long override can keep applicants active longer than the pipeline default

**Check backend logs:**
```bash
docker logs intranet-backend 2>&1 | grep -i "inactivity\|timeout\|deactivat"
```

---

### Applicants Incorrectly Marked Inactive

**Symptoms**: Active applicants with recent activity being marked inactive prematurely.

**Causes**:
1. `last_activity_at` not being updated on certain actions
2. Per-stage timeout too short
3. Warning threshold set too high

**Solutions**:

**Verify activity timestamps:**
1. Open the applicant's detail drawer
2. Check "Last Activity" in the metadata section
3. If the timestamp is outdated despite recent actions, check backend logs for errors

**Adjust warning threshold:**
1. Pipeline Settings → Inactivity Timeout Configuration
2. Warning threshold slider controls when amber warnings appear (default: 80%)
3. Consider increasing the threshold if false positives are common

---

### Cannot Reactivate an Applicant

**Symptoms**: Reactivate button doesn't work or returns an error.

**Causes**:
1. User doesn't have `prospective_members.manage` permission
2. Applicant has been purged (permanently deleted)
3. Backend API endpoint returning error

**Solutions**:

**Check permissions:**
```sql
SELECT rp.permission FROM role_permissions rp
  JOIN user_roles ur ON ur.role_id = rp.role_id
  WHERE ur.user_id = 'YOUR_USER_ID' AND rp.permission LIKE 'prospective_members%';
```

**Check if applicant still exists:**
- Purged applicants are permanently deleted and cannot be reactivated
- The individual would need to resubmit an interest form to start a new application

**Check backend logs:**
```bash
docker logs intranet-backend 2>&1 | grep -i "reactivat"
```

---

### Pipeline Statistics Not Updating

**Symptoms**: Stats bar shows stale numbers or counts don't match visible applicants.

**Causes**:
1. Browser cache serving stale data
2. Stats API endpoint returning cached results
3. Inactive applicants being inadvertently included

**Solutions**:

**Refresh data:**
1. Click the browser refresh button or press F5
2. The stats bar fetches fresh data on each page load

**Understand stats annotations:**
- Statistics include **active applicants only**
- Inactive, rejected, and withdrawn applicants are **excluded** from conversion rate and averages
- The "Approaching Timeout" count shows applicants in warning state
- The "Inactive" count shows deactivated applicants

---

### Purge Operation Safety

**Important**: Purging applicants is a **permanent, irreversible** operation.

**Before purging:**
1. Review the list of inactive applicants carefully
2. Consider reactivating any that may have legitimate reasons for inactivity
3. Note that purged applicant data cannot be recovered
4. The purge confirmation modal will show the count and warn about permanent deletion

**Data privacy note:**
- Purging helps comply with data minimization principles
- Old applicant records contain private information (name, email, phone, documents)
- Regular purging reduces the impact of potential security incidents

---

### Withdraw Action Not Appearing

**Symptoms**: The "Withdraw" button is missing from the applicant detail drawer or table action menu.

**Causes**:
1. Applicant is not in `active` or `on_hold` status
2. User does not have `prospective_members.manage` permission

**Solutions**:
- Withdraw is only available for applicants with `active` or `on_hold` status
- Rejected, converted, and inactive applicants cannot be withdrawn
- Check that the user's role includes `prospective_members.manage`

---

### Withdrawn Applicant Tab Empty

**Symptoms**: The "Withdrawn" tab shows no applicants even though withdrawals were performed.

**Solutions**:
1. Check that the correct pipeline is selected in the pipeline filter
2. Refresh the page — the withdrawn tab fetches data when first selected
3. Use the search field on the withdrawn tab to locate specific applicants

---

### Election Package Not Auto-Created

**Symptoms**: Applicant advances to an `election_vote` stage but no election package appears in the detail drawer.

**Causes**:
1. The pipeline is not loaded in the store (no `currentPipeline`)
2. The advance API did not return the updated applicant data
3. The package creation API call failed silently

**Solutions**:

**Verify the pipeline is loaded:**
- The election package auto-creation depends on `currentPipeline` being set in the store
- If navigating directly to an applicant, ensure the pipeline loads first

**Check backend logs:**
```bash
docker logs intranet-backend 2>&1 | grep -i "election-package\|election_package"
```

**Manual creation:**
- If auto-creation failed, the package can be created manually via the API
- The detail drawer will show "No election package has been created yet" with instructions

---

### Election Package Stuck in Draft

**Symptoms**: The coordinator edited the election package but cannot submit it for ballot.

**Causes**:
1. The "Mark Ready for Ballot" button may be disabled due to a pending save
2. API error when updating package status

**Solutions**:

**Save first, then submit:**
1. Click "Save Draft" to persist coordinator notes and supporting statement
2. Then click "Mark Ready for Ballot" to change status to `ready`

**Check for errors:**
- Look for error toasts or the store's `error` field
- Check backend logs for validation failures on the election package endpoint

---

### Election Package Not Visible in Elections Module

**Symptoms**: Package is marked as "ready" but the secretary cannot see it in the Elections module.

**Solutions**:
- The Elections module queries the `GET /api/v1/prospective-members/election-packages?status=ready` endpoint
- Verify the package status is actually `ready` (not still `draft`)
- Ensure the pipeline_id filter (if any) matches the correct pipeline

---

## Elections Module Issues

### Election Cannot Be Closed

**Symptoms**: Clicking "Close Election" returns an error or does nothing.

**Possible Causes & Solutions**:

1. **Election is not OPEN**: Only OPEN elections can be closed. If the election is still in DRAFT status, you must open it first via the "Open Election" button.

2. **Election not found**: Verify the election exists and belongs to your organization.

---

### Double-Voting Error

**Symptoms**: User receives "Database integrity check: You have already voted" error.

**Explanation**: This is the database-level protection working correctly. The 4 partial unique indexes on the votes table prevent duplicate votes even if a race condition occurs.

**For anonymous elections**: The system tracks votes by `voter_hash` (HMAC-SHA256 of user_id + election_id + per-election salt). Even though `voter_id` is NULL, duplicate detection works via the hash.

**For non-anonymous elections**: Duplicate detection uses `voter_id` directly.

---

### Results Not Showing After Election Closes

**Symptoms**: Election status is "closed" but results show "Results not available yet".

**Possible Causes & Solutions**:

1. **Time-based check**: Results require BOTH `status == CLOSED` AND `current_time > end_date`. If the election was closed early (before `end_date`), results won't show until the original end time passes.

2. **Timezone issue**: All time comparisons use UTC. Ensure your election dates were set in UTC or adjusted accordingly.

3. **Override option**: A manager can toggle `results_visible_immediately` on a CLOSED election to show results before the end_date passes.

---

### Cannot Update Election While Open

**Symptoms**: Attempting to update election fields returns "Cannot update X for open election".

**Explanation**: When an election is OPEN, only `end_date` can be modified (to extend voting time). This restriction prevents changing voting rules, eligibility, or other configuration during active voting.

To make broader changes, use the "Rollback Election" feature to return to DRAFT status, then make changes and re-open.

---

### Invalid Voting Method Error

**Symptoms**: Creating or updating an election returns "Invalid voting method" error.

**Valid Values**:
- `voting_method`: `simple_majority`, `ranked_choice`, `approval`, `supermajority`
- `victory_condition`: `most_votes`, `majority`, `supermajority`, `threshold`
- `runoff_type`: `top_two`, `eliminate_lowest`

---

### Candidate Position Rejected

**Symptoms**: Adding a candidate returns "Position 'X' is not defined for this election".

**Explanation**: If the election defines specific positions, candidates must be assigned to one of those positions. Check the election's positions list and ensure the candidate's position matches exactly.

---

### Results Visibility Toggle Missing for Open Elections

**Symptoms**: The "Show Results to Voters" / "Hide Results from Voters" button is not visible when the election is OPEN.

**Explanation**: This is intentional. Revealing live results during active voting enables strategic voting and undermines election integrity. The toggle is only available for DRAFT and CLOSED elections.

---

## Meeting Minutes Module Issues

### Minutes Sections Not Loading

**Symptoms**: Minutes detail page shows no sections or shows stale data.

**Causes**:
1. Template had no sections defined when minutes were created
2. Sections JSON is empty or malformed in the database
3. Frontend not parsing `sections` array from API response

**Solutions**:

**Check if sections exist in the database:**
```sql
SELECT id, title, JSON_LENGTH(sections) AS section_count
FROM meeting_minutes
WHERE id = 'YOUR_MINUTES_ID';
```

**If sections are empty, regenerate from template:**
1. Note the meeting type of the minutes
2. Delete and recreate the minutes using the correct template
3. Or manually add sections via the "Add Section" button in the detail page

---

### Cannot Edit Approved Minutes

**Symptoms**: All fields are read-only on an approved minutes record.

**Explanation**: This is intentional. Once minutes are approved, they are locked to preserve the official record. The status must be changed back to `draft` or `review` to allow editing.

**If changes are needed:**
1. A user with `meetings.manage` permission can update the status back to `review`
2. Make the required changes
3. Re-approve the minutes

---

### Publish Button Not Appearing

**Symptoms**: Minutes are approved but no "Publish to Documents" button is visible.

**Possible Causes & Solutions**:

1. **Minutes not in `approved` status**: Only approved minutes can be published. Check the status badge at the top of the detail page.

2. **Already published**: If the minutes have already been published, the button changes to "Re-publish" and a "View in Documents" link appears.

3. **Missing permission**: User must have `meetings.manage` permission to publish.

---

### Template Not Auto-Selected

**Symptoms**: Creating new minutes doesn't auto-select a template for the chosen meeting type.

**Possible Causes & Solutions**:

1. **No default template for that meeting type**: Check that a template with `is_default = true` exists for the selected meeting type.

2. **Templates not loaded**: Refresh the page and try again. The template list is fetched when the create modal opens.

**Create a default template:**
- Navigate to Minutes page
- Templates are auto-created on first access for each meeting type
- If missing, check backend logs for template creation errors

---

### Section Reordering Not Saving

**Symptoms**: Reordering sections with up/down arrows reverts after page refresh.

**Solution**: After reordering sections, click the "Save" button. Reordering changes are held in local state until explicitly saved.

---

### Published Minutes Missing Formatting

**Symptoms**: Published document in Documents module shows plain text without formatting.

**Possible Causes**:
1. HTML content was not generated properly during publish
2. Section content contained unescaped special characters

**Check the published document:**
```sql
SELECT id, title, content_html IS NOT NULL AS has_html
FROM documents
WHERE source_type = 'generated'
  AND source_id = 'YOUR_MINUTES_ID';
```

If `has_html` is 0, try re-publishing the minutes.

---

## Documents Module Issues

### System Folders Not Appearing

**Symptoms**: Documents page shows no folders on first load.

**Explanation**: System folders are auto-created on first access. If they don't appear:

1. **Refresh the page** — The first API call triggers folder initialization
2. **Check backend logs:**
```bash
docker logs the-logbook-backend-1 | grep "initialize_system_folders"
```
3. **Check database:**
```sql
SELECT name, is_system FROM document_folders
WHERE organization_id = 'YOUR_ORG_ID'
ORDER BY sort_order;
```

Expected: 10 system folders (SOPs, Policies, Forms & Templates, Reports, Training Materials, Meeting Minutes, General Documents, Member Files, Apparatus Files, Facility Files)

---

### My Personal Folder Not Appearing

**Symptoms**: Member cannot find their personal document folder.

**Explanation**: Per-member folders are created lazily under the "Member Files" system folder on first access.

**Solutions**:
1. **Use the My Folder endpoint**: Navigate to Documents and look for "Member Files" > your name
2. **Check via API**: `GET /api/v1/documents/my-folder` returns your personal folder (creates it if it doesn't exist)
3. **Check permissions**: Members need `documents.view` permission to access their folder

---

### Apparatus/Facility/Event Folders Not Appearing

**Symptoms**: No document folders appear for a specific apparatus, facility, or event.

**Explanation**: Hierarchical folders are created lazily on first access, not when the parent entity is created.

**Solutions**:
1. **Access the folders endpoint**:
   - Apparatus: `GET /api/v1/apparatus/{id}/folders` — creates Photos, Registration & Insurance, Maintenance Records, Inspection & Compliance, Manuals & References sub-folders
   - Facilities: `GET /api/v1/facilities/{id}/folders` — creates Photos, Blueprints & Permits, Maintenance Records, Inspection Reports, Insurance & Leases, Capital Projects sub-folders
   - Events: `GET /api/v1/events/{id}/folder` — creates the event folder
2. **Refresh the page** after first access to see newly created folders
3. **Check the parent system folder exists**: Member Files, Apparatus Files, and Facility Files should appear as system folders in the Documents page

---

### Folder Access Denied

**Symptoms**: User gets 403 error when trying to access a document folder.

**Explanation**: Folders now have visibility controls: `organization` (everyone), `leadership` (officers+), or `owner` (folder owner only).

**Solutions**:
1. **Check folder visibility**: Member personal folders are `owner` visibility — only the member and admins can access them
2. **Check your role**: Leadership-restricted folders require an officer-level role
3. **Admins**: Users with `documents.manage` permission can access all folders regardless of visibility

---

### Cannot Delete a Folder

**Symptoms**: Delete button returns "Folder not found or is a system folder" error.

**Explanation**: System folders (the 7 default folders) cannot be deleted. Only custom folders created by users can be deleted.

**How to identify system folders**: System folders have `is_system = true` and display a lock icon in the UI.

---

### Document Viewer Shows Raw HTML

**Symptoms**: Opening a generated document shows HTML tags instead of rendered content.

**Possible Causes**:
1. Browser security settings blocking inline HTML rendering
2. Content Security Policy preventing `dangerouslySetInnerHTML`

**Solutions**:
- Check browser console for CSP warnings
- Ensure the document's `content_html` field contains valid HTML
- Try a different browser to rule out extension interference

---

### Document Count Doesn't Match

**Symptoms**: Folder badge shows a different count than the actual documents listed.

**Explanation**: The document count badge is fetched separately from the document list. This can be a brief timing issue.

**Solution**: Refresh the page. Both counts are re-fetched on navigation.

---

## Events Module Issues

### Event Creation Fails

**Symptoms**: Creating an event returns an error or the form doesn't submit.

**Possible Causes & Solutions**:

1. **Missing required fields**: Ensure title, event type, start date, and end date are all provided.

2. **End date before start date**: Event end time must be after the start time.

3. **Location double-booking**: If booking prevention is enabled, the selected location may already be reserved for the chosen time slot. Choose a different location or time.

4. **Missing `events.manage` permission**: Check that your user role includes `events.manage` permission.

---

### Event Duplication Not Working

**Symptoms**: "Duplicate Event" button on the detail page returns an error or nothing happens.

**Possible Causes & Solutions**:

1. **Missing permission**: User needs `events.manage` permission to duplicate events.

2. **API error**: Check the browser console (F12) for specific error messages from the `POST /events/{id}/duplicate` endpoint.

3. **Network issue**: Verify backend connectivity.

---

### Event Attachments Upload Fails

**Symptoms**: Uploading an attachment to an event returns an error.

**Possible Causes & Solutions**:

1. **File too large**: Check server upload size limits in your configuration.

2. **Invalid file type**: Verify the file type is allowed by your server configuration.

3. **Event not found**: Ensure the event ID is valid and belongs to your organization.

4. **Missing permission**: User needs `events.manage` permission to upload attachments.

---

### Recurring Event Not Generating Occurrences

**Symptoms**: A recurring event was created but individual occurrences don't appear in the calendar.

**Possible Causes & Solutions**:

1. **Recurrence pattern misconfigured**: Check that the recurrence interval, frequency (daily/weekly/monthly/yearly), and end conditions are set correctly.

2. **End date already passed**: If the recurrence end date is in the past, no future occurrences will be generated.

3. **Backend processing**: Recurrence expansion may happen on-demand when loading the calendar view. Refresh the page.

---

### Event Edit Page Shows Blank Form

**Symptoms**: Navigating to the edit page shows an empty form instead of pre-populated event data.

**Possible Causes & Solutions**:

1. **Event not found**: The event ID in the URL may be invalid. Check the URL path.

2. **Permission issue**: User may not have `events.manage` permission to edit events.

3. **Network issue**: The API call to fetch event details may have failed. Check browser console.

---

### RSVP Not Working

**Symptoms**: Members cannot RSVP to events or RSVP count is wrong.

**Possible Causes & Solutions**:

1. **RSVP deadline passed**: Check if the event has an RSVP deadline that has expired.

2. **RSVP limit reached**: The event may have reached its maximum RSVP capacity. Admins can use RSVP override to bypass limits.

3. **Missing `events.view` permission**: Users need at least view permission to RSVP.

---

## Theme & Display Issues

### Theme Not Switching

**Symptom**: Clicking the theme toggle button doesn't change the app's appearance.

**Possible Causes & Solutions**:

1. **Browser localStorage blocked**: Some privacy settings block localStorage. Check browser console for storage errors.
2. **CSS not loading**: Verify that `src/styles/index.css` is imported and contains the `:root` and `.dark` CSS variable blocks.
3. **ThemeProvider missing**: Ensure `<ThemeProvider>` wraps the app in `App.tsx`. Without it, the `useTheme` hook will throw an error.

### Components Still Using Hardcoded Colors

**Symptom**: Some components don't change appearance when switching themes.

**Explanation**: The theme system uses CSS custom properties for the main layout (background gradient, navigation, inputs). Individual components that still use hardcoded Tailwind classes (e.g., `bg-white/10`, `text-white`) will only look correct in dark mode. To make a component theme-aware, replace hardcoded colors with the `theme-*` Tailwind utilities:

| Dark-only class | Theme-aware class |
|---|---|
| `bg-white/10` | `bg-theme-surface` |
| `border-white/20` | `border-theme-surface-border` |
| `text-white` | `text-theme-text-primary` |
| `text-slate-300` | `text-theme-text-secondary` |
| `bg-slate-900/50` | `bg-theme-input-bg` |
| `border-slate-600` | `border-theme-input-border` |

### Election Components Display Issues

**Symptom**: Election-related UI (ballot builder, voting, results, attendance) appears invisible or has white text on white backgrounds.

**Fix Applied**: As of 2026-02-15, all election sub-components (CandidateManagement, BallotBuilder, ElectionBallot, ElectionResults, MeetingAttendance) have been converted to use the dark theme color scheme. If you still see display issues, hard-refresh (Ctrl+Shift+R) to clear cached CSS.

### Election Dates Show Wrong Times

**Symptom**: Election start/end dates appear offset by your timezone difference from UTC.

**Fix Applied**: As of 2026-02-15, the frontend uses local datetime formatting instead of `.toISOString()` for `datetime-local` inputs, and the backend uses `datetime.now()` instead of `datetime.utcnow()` for comparisons. If you created elections before this fix, the stored dates may still be in UTC and appear offset.

---

## Dashboard Issues

### Dashboard Shows Admin Content Instead of Member Content

**Symptom**: Dashboard shows "Getting Started", "Setup Status", or other admin-oriented content.

**Fix Applied**: As of 2026-02-15, the dashboard has been redesigned to show member-focused content:
- **Hours summary**: Training, standby, and administrative hours for the current month
- **Notifications**: Recent department notifications with read/unread status
- **Upcoming shifts**: Your scheduled shifts for the next 30 days
- **Training progress**: Active training program enrollments

### Notifications Not Loading on Dashboard

**Symptom**: The notifications widget shows "No notifications" even when you have notifications.

**Possible Causes**:
1. **Permissions**: The `/notifications/logs` endpoint requires `notifications.view` permission. Ensure the user's role includes this permission.
2. **No notification rules configured**: Notifications are generated by rules. If no rules are active, no notifications will be created. Go to Settings → Notifications to configure rules.

### Shift Hours Showing Zero

**Symptom**: All hour counts show 0 on the dashboard.

**Possible Causes**:
1. **No shifts logged this month**: Hours are calculated from shift attendance records for the current month.
2. **Scheduling permissions**: The `/scheduling/summary` endpoint requires `scheduling.view` permission.
3. **Detailed hour breakdown**: Training and administrative hours require shift completion reports to be filed. The standby hours come from the scheduling summary.

---

## TypeScript Build Issues

### All Build Errors (Fixed 2026-02-14)

**Status**: Fixed in commit `e97be90`

All TypeScript compilation errors across the frontend codebase have been resolved. If you encounter build errors after pulling the latest changes:

```bash
# Pull latest and rebuild
git pull origin main
cd frontend && npm install
npm run typecheck

# If errors persist, clean and rebuild
rm -rf node_modules
npm install
npm run typecheck
```

---

### 'as any' Type Assertions (Removed 2026-02-14)

**Status**: Fixed in commit `ef938f7`

All 17 `as any` type assertions have been replaced with proper typing. Files affected:

| File | What Changed |
|------|-------------|
| `modules/apparatus/services/api.ts` | Added proper response types |
| `pages/AddMember.tsx` | Used correct form data types |
| `pages/EventDetailPage.tsx` | Added event-specific types |
| `pages/EventQRCodePage.test.tsx` | Fixed mock types |
| `pages/MinutesDetailPage.tsx` | Added minutes types |
| `test/setup.ts` | Proper mock typing |
| `utils/errorHandling.ts` | Added `unknown` error type handling |

If you find new `as any` assertions, replace them with proper types following the patterns in these files.

---

### Broken JSX After Merge (Fixed 2026-02-14)

**Status**: Fixed in commit `1ac8d46`

**Symptoms**: `DocumentsPage` or `MinutesPage` show blank content or React errors after pulling merged code.

**Cause**: Git merge created duplicate JSX blocks within the same component.

**Solution**: Already fixed. Pull latest changes.

---

## Version History

**v1.8** - 2026-02-14
- Expanded Scheduling module section with 10 new troubleshooting entries (templates, patterns, assignments, swaps, time-off, calls, reports, permissions)
- Added Facilities module troubleshooting section (7 new entries covering facility creation, types/statuses, maintenance, utilities, keys, compliance, permissions)
- Updated permissions reference for new scheduling permissions (assign, swap, report)

**v1.7** - 2026-02-14
- Added events module troubleshooting section (6 new entries)
- Added TypeScript build issues section (3 entries covering build errors, type assertions, broken JSX)
- Covers: event creation, duplication, attachments, recurring events, RSVP, editing

**v1.6** - 2026-02-13
- Added meeting minutes module troubleshooting section (6 new entries)
- Added documents module troubleshooting section (4 new entries)
- Covers: sections, templates, publishing, folders, document viewer

**v1.5** - 2026-02-12
- Added elections module troubleshooting section (7 new entries)
- Covers: closing, double-voting, results visibility, update restrictions, validation errors

**v1.4** - 2026-02-12
- Added withdraw/archive troubleshooting sections
- Added election package troubleshooting sections
- Added cross-module election package visibility guidance

**v1.3** - 2026-02-12
- Added Documents module troubleshooting (folder creation, file upload, loading errors)
- Added Meetings & Minutes module troubleshooting (meeting creation, approval workflow, action items)
- Added Scheduling module troubleshooting (shift creation, calendar views, attendance)
- Added Reports module troubleshooting (report generation, empty results, available report types)
- Added Notifications module troubleshooting (rule creation, toggle persistence, valid configuration values)
- Added Prospective Members module troubleshooting section
- Added inactivity timeout troubleshooting
- Added applicant reactivation troubleshooting
- Added pipeline statistics explanation
- Added purge operation safety guidance

**v1.2** - 2026-02-08
- ✅ Added backend configuration issues section
- ✅ Added database migration best practices
- ✅ Added startup sequence troubleshooting
- ✅ Documented three critical backend fixes:
  - Settings configuration reference fix
  - Duplicate migration error fix
  - Organization creation error fix

**v1.1** - 2026-02-07
- ✅ Added comprehensive network error handling section
- ✅ Added email/username duplicate troubleshooting with soft-delete clarification
- ✅ Added error message translation reference
- ✅ Updated all error examples to new format
- ✅ Added diagnostic commands and scripts

**v1.0** - 2026-02-07
- Initial comprehensive troubleshooting guide
- Covers all major error categories
- Includes onboarding-specific guidance

---

**Document Maintainer**: Development Team
**For Updates**: Submit PR or create GitHub issue
**Related Docs**: ERROR_MESSAGES_COMPLETE.md, ENUM_CONVENTIONS.md, SECURITY_IMAGE_UPLOADS.md

---

## Backend Configuration Issues (Added 2026-02-08)

### Error: "'Settings' object has no attribute 'MYSQL_DATABASE'"

**Symptoms:**
```
WARNI [app.utils.startup_validators] Could not validate enum consistency: 'Settings' object has no attribute 'MYSQL_DATABASE'
```

**Cause:**
- The startup validator was trying to access `settings.MYSQL_DATABASE` 
- The correct attribute name in the config is `settings.DB_NAME`

**Solution:**
✅ **FIXED in latest version** (commit: bc58d8d)

If you see this error in an older version:
1. Update to the latest code: `git pull`
2. Rebuild Docker containers: `docker-compose down && docker-compose up --build -d`

**Technical Details:**
- File: `backend/app/utils/startup_validators.py`
- Changed lines 64 and 199 from `settings.MYSQL_DATABASE` to `settings.DB_NAME`

---

### Error: "Table 'skill_evaluations' already exists"

**Symptoms:**
```
ERROR [alembic.env] Migration failed: (pymysql.err.OperationalError) (1050, "Table 'skill_evaluations' already exists")
```

**Cause:**
- Migration `20260206_0301` was trying to create tables that already existed from migration `20260122_0015`
- Duplicate table creation in migration chain

**Solution:**
✅ **FIXED in latest version** (commit: bc58d8d)

The migration now checks if tables exist before creating them:
```python
# Check if tables exist to avoid errors
conn = op.get_bind()
inspector = inspect(conn)
existing_tables = inspector.get_table_names()

# Only create tables if they don't exist
for table_name, create_func in tables_to_create.items():
    if table_name not in existing_tables:
        create_func()
```

If you encounter this on a fresh install:
1. Update to latest code: `git pull`
2. Clear old database (if safe to do so): `docker-compose down -v`
3. Rebuild: `docker-compose up --build -d`

For existing installations, the migration will skip creating tables that already exist.

---

### Error: "'OrganizationSetupCreate' object has no attribute 'description'"

**Symptoms:**
```
ERROR | app.api.v1.onboarding:save_session_organization:1381 - Error creating organization during onboarding: 'OrganizationSetupCreate' object has no attribute 'description'
```

**Cause:**
- The onboarding endpoint was trying to access `data.description`
- The `OrganizationSetupCreate` Pydantic schema doesn't have a `description` field
- Frontend doesn't collect organization description

**Solution:**
✅ **FIXED in latest version** (commit: da23ccd)

If you see this in an older version:
1. Update to latest code: `git pull`
2. Restart backend: `docker-compose restart backend`

**Technical Details:**
- File: `backend/app/api/v1/onboarding.py` line 1322
- Changed `description=data.description` to `description=None`

---

## Database Migration Best Practices

### Checking Migration Status

To see which migrations have been applied:
```bash
# Inside Docker container
docker exec -it intranet-backend alembic current

# Or on host
cd backend
alembic current
```

### Viewing Migration History
```bash
docker exec -it intranet-backend alembic history
```

### Common Migration Issues

#### Migrations Out of Sync
If migrations seem out of sync:
```bash
# Check current revision
docker exec -it intranet-backend alembic current

# Stamp to specific revision (if you know the correct one)
docker exec -it intranet-backend alembic stamp head
```

#### Rolling Back Migrations
⚠️ **WARNING: Can cause data loss**
```bash
# Downgrade one revision
docker exec -it intranet-backend alembic downgrade -1

# Downgrade to specific revision
docker exec -it intranet-backend alembic downgrade <revision_id>
```

---

## Startup Sequence Issues

### Database Initialization (First Startup)

**Symptoms:**
- Backend shows "Connecting to database..." for extended period
- Multiple retry attempts logged
- Eventually connects successfully

**This is NORMAL behavior** on first startup:

1. **MySQL Container Initialization** (~6 minutes)
   - MySQL needs time to initialize its data directory
   - Creates system tables and sets up permissions
   - First-time setup is slower than subsequent restarts
   - Health check uses TCP (`-h 127.0.0.1 --port=3306`) to avoid false-positive from MySQL's temporary init server

2. **Backend Connection Retries** (up to 40 attempts)
   - Backend retries every 2-15 seconds with exponential backoff
   - Logged as: `Database connection attempt X/40...`
   - 40 retries (~10 min) covers MySQL's ~6 min first-time init

3. **Fast-Path Database Initialization** (seconds, not minutes)
   - Fresh databases use `create_all()` instead of running 45+ Alembic migrations sequentially
   - Creates all 127+ tables in a single pass
   - Progress logged every 25 tables for visibility
   - **Protected by 20-minute timeout** to prevent hangs
   - Self-healing: retries on failure, repairs missing tables, ensures `FK_CHECKS` is always re-enabled

**Total Expected Time:**
- **First startup**: ~7-10 minutes (mostly MySQL init; table creation takes seconds)
- **Subsequent restarts**: 10-30 seconds (MySQL already initialized)
- **Resource-constrained environments** (e.g., Unraid NAS): May take longer; optimized with single-connection DDL, batched operations, and `NullPool`

**What the Frontend Shows:**
- "Database Connection: Establishing connection to MySQL database (may retry while database initializes)"
- "Database Setup: Preparing your intranet with membership, training, events, elections, inventory, and audit capabilities"
- Educational tips rotating every 15 seconds while waiting

**When to Worry:**
- If connection attempts exceed 40 retries
- If initialization fails with errors (not warnings)
- **If the process takes more than 20 minutes** (init timeout will trigger)
- If you see `FK_CHECKS` warnings (self-healing should handle this, but check logs)

**Troubleshooting:**
```bash
# Check MySQL logs
docker logs intranet-mysql

# Check if MySQL is ready (use TCP, not Unix socket)
docker exec intranet-mysql mysqladmin ping -h 127.0.0.1 --port=3306

# Check backend logs for specific errors
docker logs intranet-backend | grep ERROR

# Check if fast-path init completed
docker logs intranet-backend | grep "fast_path"

# Check table count (should be 127+)
docker logs intranet-backend | grep "validate_schema"
```

### Fast-Path Init Crashes on Leftover Tables

**Symptoms:**
- Backend crashes with `Duplicate key name` error during startup
- Happens after a previous startup was interrupted or failed

**Cause:** Leftover tables from a partial previous boot conflict with `create_all()`.

**Resolution:** This is now self-healing. The fast-path init dynamically discovers and drops ALL tables (except `alembic_version`) before running `create_all()`. If you still see this issue:
```bash
# Force clean restart
docker-compose down -v
docker-compose up --build
```

### Startup Fails Silently (No Tables Created)

**Symptoms:**
- Backend appears to start successfully
- API calls fail with "table does not exist" errors
- No error messages in logs about initialization failure

**Cause:** Previously, `_fast_path_init()` was wrapped in a try/except that swallowed all exceptions.

**Resolution:** This has been fixed. The fast-path init now:
1. Runs outside the forgiving try/except
2. Validates schema after fast-path completes
3. Crashes the app if validation fails (fail-fast)
4. Logs clear error messages

If you see schema validation failures, check that all model files are imported in `models/__init__.py`.

---

## Recent Fixes Summary

### Critical Fixes (2026-02-09)

#### 🔴 CRITICAL: Admin User Creation 500 Error (Step 10 Onboarding)

**Status**: ✅ **FIXED** in commit `314a721`

**Symptoms:**
- User completes onboarding steps 1-9 successfully
- Step 10 (admin user creation) returns 500 Internal Server Error
- Backend logs show "User registered: [username]" but endpoint fails
- User tries again and gets "username already exists" error

**Root Cause:**
- `auth_service.register_user()` returns a tuple `(user, error_message)`
- Onboarding service was treating it as a single `User` object
- Caused AttributeError when trying to access `user.roles` on a tuple

**Fix Applied:**
```python
# Before (WRONG):
user = await auth_service.register_user(...)

# After (CORRECT):
user, error = await auth_service.register_user(...)
if error or not user:
    raise ValueError(error or "Failed to create admin user")
```

**Impact**: Users can now complete Step 10 and finish onboarding successfully.

---

#### 🟡 User Status Field Type Safety

**Status**: ✅ **FIXED** in commit `afe28f2`

**Issue:**
- User status was set as string `"active"` instead of enum `UserStatus.ACTIVE`
- Could cause AttributeError when accessing `.value` on status field

**Fix Applied:**
```python
# Before:
user = User(..., status="active", ...)

# After:
from app.models.user import UserStatus
user = User(..., status=UserStatus.ACTIVE, ...)
```

---

#### 🔴 Migration & Init Timeout Protection

**Status**: ✅ **ADDED** (commit `eed280e`), ✅ **IMPROVED** (fast-path init, commit `5841063`)

**Current Protection:**
- Fast-path `create_all()` has a 20-minute timeout (normal time: seconds)
- Self-healing retry after 2 seconds on failure
- Schema validation after init, with automatic repair via `create_all(checkfirst=True)`
- `FK_CHECKS` always re-enabled in `finally` block
- Fail-fast with clear error messages if validation fails

**Error Handling:**
- TimeoutError raised with descriptive message
- Startup phase set to "error"
- Application startup blocked (fail-fast principle)
- Clear troubleshooting guidance in logs

---

#### 🟢 Fast-Path Database Initialization

**Status**: ✅ **IMPLEMENTED** — replaces the old 23-minute migration approach

**Changes:**
- Fresh databases now use `create_all()` instead of running 45+ Alembic migrations sequentially
- First-boot time reduced from ~25-30 minutes to ~7-10 minutes (mostly MySQL init; table creation takes seconds)
- Resource-constrained environments (Unraid NAS) supported with optimized DDL and batched operations
- Progress logged every 25 tables during creation

---

### Previous Fixes (2026-02-08)

1. ✅ Fixed settings configuration reference (`MYSQL_DATABASE` → `DB_NAME`)
2. ✅ Fixed duplicate migration error (conditional table creation)
3. ✅ Fixed organization creation error (removed non-existent `description` field)

---

### When to Update

**If you see any of these errors, update immediately:**
```bash
cd /path/to/the-logbook
git pull origin main
docker-compose down -v  # -v removes volumes for fresh start
docker-compose up --build
```

**⚠️ Note:** The `-v` flag removes database volumes. Since these fixes relate to onboarding (before data entry), no data will be lost.

### Verifying the Fixes
After updating, check logs for clean startup:
```bash
# Should see no MYSQL_DATABASE errors
docker logs intranet-backend | grep MYSQL_DATABASE

# Should see no "Table already exists" errors  
docker logs intranet-backend | grep "already exists"

# Should see successful onboarding
docker logs intranet-backend | grep "Organization created"
```

---
