# The Logbook - Troubleshooting Guide

## Overview

This comprehensive troubleshooting guide helps you resolve common issues when using The Logbook application, with special focus on the onboarding process.

**Last Updated**: 2026-02-13 (includes meeting minutes module, documents module, prospective members, elections, inactivity timeout system, and pipeline troubleshooting)

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Onboarding Issues](#onboarding-issues)
3. [Email & SMTP Configuration](#email--smtp-configuration)
4. [User Account Issues](#user-account-issues)
5. [Network & Connection Problems](#network--connection-problems)
6. [Image Upload Issues](#image-upload-issues)
7. [Database & Migration Issues](#database--migration-issues)
8. [Prospective Members Module Issues](#prospective-members-module-issues)
9. [Elections Module Issues](#elections-module-issues)
10. [Meeting Minutes Module Issues](#meeting-minutes-module-issues)
11. [Documents Module Issues](#documents-module-issues)
12. [Error Message Reference](#error-message-reference)
13. [Getting Help](#getting-help)

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
1. Onboarding session timed out (30 minutes of inactivity)
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
docker exec the-logbook-db-1 mysql -uroot -plogbook_password \
  -e "SELECT table_schema, SUM(data_length + index_length) / 1024 / 1024 AS 'Size (MB)' FROM information_schema.tables GROUP BY table_schema;"

# Optimize tables
docker exec the-logbook-db-1 mysql -uroot -plogbook_password logbook \
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
docker exec the-logbook-db-1 mysql -uroot -plogbook_password logbook \
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
docker exec the-logbook-db-1 mysql -uroot -plogbook_password -e "SELECT VERSION();"

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
docker exec the-logbook-db-1 mysql -uroot -plogbook_password \
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

Expected: 7 system folders (SOPs, Policies, Forms & Templates, Reports, Training Materials, Meeting Minutes, General Documents)

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

## Version History

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

### Database Initialization Takes 25-30 Minutes (First Startup)

**Symptoms:**
- Backend shows "Connecting to database..." for extended period
- Multiple retry attempts logged
- Eventually connects successfully
- Migrations take significant time

**This is NORMAL behavior** on first startup:

1. **MySQL Container Initialization** (~6 minutes)
   - MySQL needs time to initialize database
   - Creates system tables and sets up permissions
   - First-time setup is slower than subsequent restarts

2. **Backend Connection Retries** (up to 20 attempts)
   - Backend retries every 2-15 seconds with exponential backoff
   - Logged as: `Database connection attempt X/20...`
   - Usually connects within first few attempts once MySQL is ready

3. **Database Migrations** (~23 minutes for 38 migrations)
   - Creates comprehensive database schema for fire department intranet
   - Includes tables for users, organizations, training, events, elections, inventory, and audit logs
   - Logged as: `Running 38 database migrations...`
   - **Protected by 30-minute timeout** to prevent infinite hangs

**Total Expected Time:**
- **First startup**: 25-30 minutes (~6 min MySQL + ~23 min migrations)
- **Subsequent restarts**: 10-30 seconds (MySQL already initialized)

**What the Frontend Shows:**
- "Database Connection: Establishing connection to MySQL database (may retry while database initializes)"
- "Database Setup: Preparing your intranet with membership, training, events, elections, inventory, and audit capabilities"
- Migration progress bar showing X/38 migrations complete
- Educational tips rotating every 15 seconds while waiting

**When to Worry:**
- If connection attempts exceed 20 retries
- If migrations fail with errors (not warnings)
- **If the process takes more than 35 minutes** (migration timeout will trigger at 30 minutes)
- If migrations time out (indicates deadlock, infinite loop, or network issue)

**Troubleshooting:**
```bash
# Check MySQL logs
docker logs intranet-mysql

# Check if MySQL is ready
docker exec intranet-mysql mysqladmin ping -h localhost

# Check backend logs for specific errors
docker logs intranet-backend | grep ERROR
```

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

#### 🔴 Migration Timeout Protection

**Status**: ✅ **ADDED** in commit `eed280e`

**Issue:**
- Database migrations had NO timeout
- Could hang indefinitely on deadlocks, infinite loops, or network issues
- Highest-risk hang point in startup process

**Protection Added:**
- 30-minute timeout on migrations (normal time: ~23 minutes)
- Fail-fast with clear error messages
- Prevents silent hangs

**Implementation:**
```python
with timeout_context(1800, "Database migrations"):
    command.upgrade(alembic_cfg, "head")
```

**Error Handling:**
- TimeoutError raised with descriptive message
- Startup phase set to "error"
- Application startup blocked (fail-fast principle)
- Clear troubleshooting guidance in logs

---

#### 🟢 Accurate Startup Time Estimates

**Status**: ✅ **UPDATED** in commit `5b8e63f`

**Changes:**
- Frontend now shows accurate 25-30 minute estimate (was 1-3 minutes)
- Reflects actual observed times: ~6 min MySQL + ~23 min migrations
- Updated in multiple locations:
  - OnboardingCheck initialization page
  - "What's Happening?" help section
  - Expected Timeline breakdown

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
