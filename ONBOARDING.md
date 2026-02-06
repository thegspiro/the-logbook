# Onboarding Module Guide

The onboarding module handles first-time system setup and can be disabled once the platform is fully configured.

## Overview

The onboarding module provides:
- **Guided setup wizard** for first-time configuration
- **Security verification** to ensure proper configuration
- **Organization creation** with default roles
- **Admin user creation** with strong password requirements
- **Module selection** to enable only what you need
- **Post-onboarding checklist** for production readiness

## How It Works

### 1. Automatic Detection

The system automatically detects if onboarding is needed by checking:
- Whether any organizations exist in the database
- Whether an OnboardingStatus record exists and is marked complete

### 2. Startup Health Check

Before onboarding begins, the frontend performs a service health check that verifies:
- Backend API is reachable
- Database is connected and migrations are complete
- Redis cache is available (optional — degraded mode is supported)

The health check includes auto-retry with exponential backoff (up to 20 attempts) and shows real-time migration progress. If services take longer than expected, a "Skip Wait & Continue" option appears after 5 failed attempts.

### 3. Onboarding Steps

The onboarding process consists of 10 steps:

#### Step 1: Organization Setup
- Create your fire department or organization
- Set organization name, slug, and type (`fire_department`, `ems_only`, `fire_ems_combined`)
- Configure timezone, contact info, mailing/physical addresses
- Upload organization logo (optional)
- Set department identifiers (FDID, State ID, or Department ID)
- **Commits to database immediately**

#### Step 2: Navigation Choice
- Choose between Top Bar or Left Sidebar navigation layout

#### Step 3: Email Platform Choice
- Select email service: Gmail, Microsoft 365, Self-Hosted (SMTP), or Skip
- If a service is selected, proceeds to email configuration

#### Step 4: File Storage Choice
- Select file storage: Local, AWS S3, Azure Blob, or Google Cloud Storage

#### Step 5: Authentication Choice
- Select authentication method: Local, OAuth, SAML, or LDAP

#### Step 6: IT Team & Backup Access
- Configure IT team contacts and backup access information

#### Step 7: Role Setup
- Configure roles with two-tier permissions (View Access / Manage Access)
- Pre-configured role templates by category (Leadership, Officers, Administrative, etc.)

#### Step 8: Module Selection
- Choose which modules to enable:
  - **Essential**: Member Management, Events & RSVP, Documents & Files
  - **Recommended**: Training & Certifications, Equipment & Inventory, Scheduling, Elections, Compliance
  - **Optional**: Notifications, Mobile App, Forms & Surveys, Integrations

#### Step 9: Admin User Creation
- Create first administrator account
- Enforces strong password requirements (12+ characters with complexity rules)
- Badge Number is optional — all other fields are required
- Automatically assigns Super Admin role

#### Step 10: Complete
- Finalizes onboarding and redirects to dashboard
- Generate post-onboarding checklist

### 3. Post-Onboarding Checklist

After completing onboarding, a checklist is automatically created with critical tasks:

**Critical Priority:**
- ✅ Set up TLS/HTTPS certificates
- ✅ Configure automated backups
- ✅ Review HIPAA compliance checklist
- ✅ Configure firewall rules

**High Priority:**
- ✅ Configure email notifications
- ✅ Enable multi-factor authentication for admins
- ✅ Set up monitoring and alerting
- ✅ Train staff on security policies
- ✅ Test disaster recovery plan

**Medium Priority:**
- ✅ Review and customize user roles
- ✅ Configure additional modules
- ✅ Set up integrations (Microsoft 365, Google Workspace, LDAP)

## API Endpoints

### Check Onboarding Status

```bash
GET /api/v1/onboarding/status
```

**Response:**
```json
{
  "needs_onboarding": true,
  "is_completed": false,
  "current_step": 0,
  "total_steps": 7,
  "steps_completed": {},
  "organization_name": null
}
```

### Start Onboarding

```bash
POST /api/v1/onboarding/start
```

**Response:**
```json
{
  "message": "Onboarding started successfully",
  "current_step": 1,
  "steps": [...]
}
```

### Get System Information

```bash
GET /api/v1/onboarding/system-info
```

**Response:**
```json
{
  "app_name": "The Logbook",
  "version": "1.0.0",
  "environment": "development",
  "database": {
    "type": "MySQL",
    "host": "localhost",
    "port": 3306,
    "name": "intranet_db"
  },
  "security": {
    "password_min_length": 12,
    "mfa_available": true,
    "session_timeout_minutes": 480,
    "encryption": "AES-256",
    "password_hashing": "Argon2id"
  },
  "features": {
    "hipaa_compliant": true,
    "section_508_accessible": true,
    "tamper_proof_logging": true,
    "multi_factor_auth": true,
    "role_based_access": true
  }
}
```

### Verify Security Configuration

```bash
GET /api/v1/onboarding/security-check
```

**Response:**
```json
{
  "passed": false,
  "issues": [
    {
      "field": "SECRET_KEY",
      "severity": "critical",
      "message": "SECRET_KEY is using default value",
      "fix": "Run: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
    }
  ],
  "warnings": [],
  "total_issues": 1,
  "total_warnings": 0
}
```

### Check Database Connection

```bash
GET /api/v1/onboarding/database-check
```

**Response:**
```json
{
  "connected": true,
  "database": "intranet_db",
  "host": "mysql",
  "port": 3306,
  "server_time": "2026-01-17 15:30:45",
  "organizations_count": 0
}
```

### Create Organization

```bash
POST /api/v1/onboarding/organization
Content-Type: application/json

{
  "name": "Springfield Fire Department",
  "slug": "springfield-fd",
  "organization_type": "fire_department",
  "description": "Volunteer fire department serving Springfield",
  "timezone": "America/New_York"
}
```

**Response:**
```json
{
  "id": "uuid-here",
  "name": "Springfield Fire Department",
  "slug": "springfield-fd",
  "type": "fire_department",
  "description": "Volunteer fire department serving Springfield",
  "active": true
}
```

**Automatic Actions:**
- Creates 6 default roles: Super Admin, Admin, Chief, Officer, Member, Probationary
- Each role has appropriate permissions pre-configured
- Organization settings initialized

### Create Admin User

```bash
POST /api/v1/onboarding/admin-user
Content-Type: application/json

{
  "username": "admin",
  "email": "admin@springfieldfd.org",
  "password": "SecureP@ssw0rd123!",
  "password_confirm": "SecureP@ssw0rd123!",
  "first_name": "John",
  "last_name": "Doe",
  "badge_number": "001"
}
```

**Password Requirements:**
- Minimum 12 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Not a common password
- Passwords must match

**Response:**
```json
{
  "id": "uuid-here",
  "username": "admin",
  "email": "admin@springfieldfd.org",
  "first_name": "John",
  "last_name": "Doe",
  "badge_number": "001",
  "status": "active"
}
```

**Automatic Actions:**
- Password hashed with Argon2id
- User assigned Super Admin role
- Audit log entry created
- Email verification email sent (if configured)

### Configure Modules

```bash
POST /api/v1/onboarding/modules
Content-Type: application/json

{
  "enabled_modules": [
    "training",
    "compliance",
    "scheduling",
    "inventory",
    "incidents"
  ]
}
```

**Response:**
```json
{
  "message": "Modules configured successfully",
  "modules": {
    "training": true,
    "compliance": true,
    "scheduling": true,
    "inventory": true,
    "meetings": false,
    "elections": false,
    "fundraising": false,
    "incidents": true,
    "equipment": false,
    "vehicles": false,
    "budget": false
  }
}
```

### Configure Notifications (Optional)

```bash
POST /api/v1/onboarding/notifications
Content-Type: application/json

{
  "email_enabled": true,
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_user": "notifications@springfieldfd.org",
  "smtp_from_email": "noreply@springfieldfd.org",
  "sms_enabled": false
}
```

**Response:**
```json
{
  "message": "Notifications configured successfully",
  "email_enabled": true,
  "sms_enabled": false
}
```

### Complete Onboarding

```bash
POST /api/v1/onboarding/complete
Content-Type: application/json

{
  "notes": "Initial setup completed for Springfield Fire Department"
}
```

**Response:**
```json
{
  "message": "Onboarding completed successfully!",
  "organization": "Springfield Fire Department",
  "admin_user": "admin",
  "completed_at": "2026-01-17T15:45:30Z",
  "next_steps": "Review the post-onboarding checklist for additional configuration"
}
```

**Automatic Actions:**
- Onboarding marked as complete
- Post-onboarding checklist created (10 items)
- Audit log entry created
- System now allows normal operation

### Get Post-Onboarding Checklist

```bash
GET /api/v1/onboarding/checklist
```

**Response:**
```json
[
  {
    "id": "uuid-here",
    "title": "Set up TLS/HTTPS certificates",
    "description": "Enable HTTPS for secure communication",
    "category": "security",
    "priority": "critical",
    "is_completed": false,
    "completed_at": null,
    "documentation_link": "https://docs.the-logbook.org/security/tls",
    "estimated_time_minutes": 60
  },
  ...
]
```

### Mark Checklist Item Complete

```bash
PATCH /api/v1/onboarding/checklist/{item_id}/complete
```

**Response:**
```json
{
  "message": "Checklist item marked as complete",
  "item_id": "uuid-here",
  "title": "Set up TLS/HTTPS certificates"
}
```

## Security Verification Requirements

The onboarding security check detects insecure defaults using substring matching. Any value containing `"INSECURE_DEFAULT"` is flagged as critical. This matches the validation logic in `config.py`.

### Critical Issues (Must Fix)

1. **SECRET_KEY**
   - Cannot contain `INSECURE_DEFAULT` (the factory default is `INSECURE_DEFAULT_KEY_CHANGE_IN_PRODUCTION`)
   - Must be at least 32 characters
   - Generate with: `python -c "import secrets; print(secrets.token_urlsafe(64))"`

2. **ENCRYPTION_KEY**
   - Cannot contain `INSECURE_DEFAULT` (the factory default is `INSECURE_DEFAULT_KEY_CHANGE_ME`)
   - Should be a 64-character hex string (32 bytes)
   - Generate with: `python -c "import secrets; print(secrets.token_hex(32))"`

3. **ENCRYPTION_SALT**
   - Must be set (unique per installation)
   - Used for secure key derivation
   - Generate with: `python -c "import secrets; print(secrets.token_hex(16))"`

4. **DB_PASSWORD**
   - Cannot be `change_me_in_production`
   - Should be strong, unique password

### Warnings (Should Fix)

1. **DEBUG Mode in Production**
   - Set `DEBUG=false` in production

2. **Password Policy**
   - Recommended minimum 12 characters

3. **CORS Configuration**
   - Don't allow all origins (*) in production

## Disabling Onboarding

Once onboarding is complete, the module automatically disables itself:

1. **Database Check**: System checks for completed OnboardingStatus
2. **Legacy Detection**: If organizations exist but no OnboardingStatus, auto-marks as complete
3. **API Protection**: Onboarding endpoints return 400 error if already completed

To manually re-enable (NOT RECOMMENDED in production):
```sql
-- Delete onboarding status (will require re-onboarding)
DELETE FROM onboarding_status;
```

## Frontend Integration

The onboarding module is designed to be integrated with a frontend wizard:

### Recommended Flow

1. **Check Status on App Load**
   ```javascript
   const response = await fetch('/api/v1/onboarding/status');
   const status = await response.json();

   if (status.needs_onboarding) {
     // Redirect to onboarding wizard
     router.push('/onboarding');
   }
   ```

2. **Display Progress**
   - Show current step out of total steps
   - Display completed steps with checkmarks
   - Enable/disable navigation based on requirements

3. **Handle Errors**
   - Display validation errors clearly
   - Provide actionable fix instructions
   - Don't allow proceeding if critical issues exist

4. **Post-Completion**
   - Show success message
   - Display checklist with priorities
   - Allow marking items as complete
   - Link to relevant documentation

### Frontend Component Structure

```
/                              → Welcome page (animated intro, "Get Started" button)
/onboarding                    → Service health check (auto-retries, then redirects)
/onboarding/start              → Step 1: Organization Setup (comprehensive form)
/onboarding/navigation-choice  → Step 2: Top Bar vs Left Sidebar
/onboarding/email-platform     → Step 3: Email Platform Choice
/onboarding/email-config       → Step 3a: Email Configuration (if service selected)
/onboarding/file-storage       → Step 4: File Storage Choice
/onboarding/file-storage-config → Step 4a: File Storage Config (placeholder)
/onboarding/authentication     → Step 5: Authentication Choice
/onboarding/it-team            → Step 6: IT Team & Backup Access
/onboarding/roles              → Step 7: Role Setup (two-tier permissions)
/onboarding/modules            → Step 8: Module Selection
/onboarding/modules/:id/config → Step 8a: Per-Module Configuration
/onboarding/admin-user         → Step 9: Admin User Creation
→ On completion, redirects to /dashboard
```

### Data Persistence

Frontend onboarding state is stored in a Zustand store persisted to **localStorage** (key: `onboarding-storage`). Sensitive data (session IDs, CSRF tokens) is excluded from persistence. The API client stores the session ID separately in localStorage under `onboarding_session_id`.

## Database Schema

### onboarding_status Table

Stores overall onboarding progress:
- `id` - UUID primary key
- `is_completed` - Boolean completion flag
- `completed_at` - Timestamp when completed
- `steps_completed` - JSON of step completion status
- `current_step` - Integer current step number
- `organization_name` - Name of created organization
- `organization_type` - Type of organization
- `admin_email` - Admin email address
- `admin_username` - Admin username
- `security_keys_verified` - Boolean security check passed
- `database_verified` - Boolean database check passed
- `email_configured` - Boolean email configured
- `enabled_modules` - JSON array of enabled modules
- `timezone` - Organization timezone
- `setup_started_at` - When setup was initiated
- `setup_ip_address` - IP that started setup
- `setup_user_agent` - Browser/client info
- `setup_notes` - Optional setup notes

### onboarding_checklist Table

Stores post-onboarding tasks:
- `id` - UUID primary key
- `title` - Task title
- `description` - Task description
- `category` - Category (security, configuration, deployment)
- `priority` - Priority (critical, high, medium, low)
- `is_completed` - Completion status
- `completed_at` - When completed
- `completed_by` - User ID who completed
- `documentation_link` - Link to docs
- `estimated_time_minutes` - Time estimate
- `sort_order` - Display order

## Security Considerations

1. **No Authentication Required** - Onboarding endpoints don't require authentication since no users exist yet
2. **GeoIP Bypass** - Onboarding endpoints are exempt from GeoIP country blocking, since first-time setup must be accessible before any configuration exists
3. **One-Time Use** - Once completed, can't be rerun without database changes
4. **Reset Protection** - The reset endpoint is blocked after onboarding completes; it only works while onboarding is still in progress
5. **Sensitive Data Encryption** - Email passwords, API keys, and file storage credentials entered during onboarding are encrypted (AES-256) before being stored in the session database
6. **Email Test Timeout** - SMTP connection tests have a 30-second timeout to prevent indefinite hangs if a mail server is unreachable
7. **Audit Logging** - All onboarding actions are logged
8. **IP Tracking** - Setup IP address is recorded
9. **Password Requirements** - Enforced at API level and client level

## Troubleshooting

### "Onboarding has already been completed" Error

**Cause**: OnboardingStatus exists and is marked complete

**Solution**: This is expected behavior. System is already set up.

### Security Check Not Passing

**Cause**: Using insecure default values in .env file. The security check flags any `SECRET_KEY` or `ENCRYPTION_KEY` containing the substring `INSECURE_DEFAULT`, and any `DB_PASSWORD` equal to `change_me_in_production`.

**Solution**:
1. Generate new SECRET_KEY: `python -c "import secrets; print(secrets.token_urlsafe(64))"`
2. Generate new ENCRYPTION_KEY: `python -c "import secrets; print(secrets.token_hex(32))"`
3. Generate new ENCRYPTION_SALT: `python -c "import secrets; print(secrets.token_hex(16))"`
4. Update .env file with all generated keys
5. Restart backend: `docker-compose restart backend`

### "Organization must be created first" Error

**Cause**: Trying to create admin user before organization

**Solution**: Complete Step 3 (Organization) before Step 4 (Admin User)

### Password Validation Failed

**Cause**: Password doesn't meet requirements

**Solution**: Ensure password has:
- At least 12 characters
- One uppercase letter
- One lowercase letter
- One number
- One special character

### Database Connection Failed

**Cause**: Database not running or connection settings wrong

**Solution**:
1. Check Docker: `docker-compose ps`
2. Verify MySQL is healthy: `docker-compose logs mysql`
3. Check .env database settings
4. Restart services: `docker-compose restart`

## Best Practices

1. **Complete All Steps**: Don't skip critical steps
2. **Use Strong Passwords**: Generate random passwords for production
3. **Enable MFA**: Set up 2FA for admin accounts immediately after onboarding
4. **Review Checklist**: Complete all critical and high-priority items before going live
5. **Document Setup**: Add notes during onboarding for future reference
6. **Test Backups**: Verify backup and restore before adding production data
7. **Security Audit**: Review SECURITY.md after onboarding
8. **Staff Training**: Train all users before full deployment

## Support

For issues with onboarding:
- Check logs: `docker-compose logs backend`
- Review SECURITY.md for requirements
- Check .env.example for configuration reference
- Open an issue on GitHub

---

**Ready to get started?** Access the onboarding wizard at: `/api/v1/onboarding/status`
