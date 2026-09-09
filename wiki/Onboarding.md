# Onboarding Module Guide

> **Published copy — not the canonical source.** The maintained original is
> [`ONBOARDING.md`](https://github.com/thegspiro/the-logbook/blob/main/ONBOARDING.md)
> in the repository root, and this page may lag behind it. Make content changes
> there first, then mirror them here.

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

> **Login blocked until configured (2026-06-25):** Visiting `/login` directly on
> an unconfigured install no longer shows the sign-in form. The login page checks
> `GET /api/v1/onboarding/status` on load and, when `needs_onboarding` is true,
> redirects to `/onboarding` (a brief spinner shows during the check). There are
> no accounts to sign into before setup, so users are routed into the wizard
> instead. If the status check can't be reached, the login page still renders.

### 2. Onboarding Steps

The wizard is twelve steps. Only two are required — the organization and the
System Owner — and every other step can be skipped and set up later from
Settings.

The System Owner is created at step 9, not at the end: the IT team, position
and module steps all run against a signed-in session.

#### Step 1: Organization Setup

- Name, organization type, timezone and contact details
- Mailing and physical address, department identifiers (FDID / State ID / Dept ID)
- Logo (optional)
- Commits the organization, and creates the headquarters facility and location
  from the department address

#### Step 2: Stations

- Add the stations beyond headquarters — skippable, and many departments have one
- Creates a facility and location per station

#### Step 3: Apparatus

- Unit number, type, minimum staffing and riding positions
- Creates the lightweight apparatus records shift staffing needs

#### Step 4: Navigation Layout

- Choose a top bar or a left sidebar

#### Step 5: Email Platform

- Select email platform for notifications:
  - Gmail / Google Workspace
  - Microsoft 365 / Outlook
  - Self-hosted email server (SMTP)
  - Cloudflare Email Service (REST API — no SMTP server needed)
  - Other / Skip

#### Step 6: Email Configuration

- Configure platform-specific settings (OAuth credentials, SMTP host/port, or
  Cloudflare Account ID and API Token)
- Send a test message to verify the connection; credentials are encrypted
  server-side

#### Step 7: File Storage

- Choose a file storage solution:
  - Google Drive
  - OneDrive / SharePoint
  - Amazon S3
  - Local storage
  - Configure Later
- Enter the platform's credentials on the following screen. Skipping stores the
  choice without credentials rather than discarding the step

#### Step 8: Authentication Platform

- Choose how users will authenticate:
  - **Google OAuth** - Sign in with Google accounts (recommended for Google Workspace users)
  - **Microsoft Azure AD** - Sign in with Microsoft accounts (recommended for Microsoft 365 users)
  - **Authentik SSO** - Self-hosted authentication platform (for complete control)
  - **Local Passwords** - Secure password-based authentication with Argon2id hashing (no external services required)

> **OAuth sign-in (2026-05-29):** "Sign in with Google" and "Sign in with
> Microsoft" (Azure AD, single-tenant) are now fully implemented. They are
> **link-existing-only** — the verified IdP email must match an active local
> user; OAuth never auto-creates accounts. Configure via the `GOOGLE_*` /
> `AZURE_AD_*` environment variables and optionally restrict by email domain.
> See [Authentication > OAuth](Security-Authentication#oauth).

#### Step 9: System Owner

- Create the first administrator account: username, email, password (12+
  characters), name and membership number
- Sets the authentication cookies — the administrator is signed in from here on

#### Step 10: IT Team & Backup Access

- Add IT team contact information, and optionally each contact's operational rank
- Configure backup access email and phone
- Set secondary admin email for emergencies
- IT contacts become user accounts at completion, each required to change its
  password on first sign-in

#### Step 11: Ranks & Positions

**Your rank ladder** comes first. The department starts from the ranks its
agency type usually has and changes them to match what it actually uses:

- Rename a rank to your own vocabulary — an EMS service's Driver / Operator, a
  department whose Captain is a Company Officer
- Reorder the ladder, remove ranks you do not have, and add your own
  (Battalion Chief, Firefighter II)
- Set which shift seats each rank can fill
- Set your own rank as System Owner

> A rank says where somebody sits and which seats they can fill; what they can
> **do** comes from their position. A rank you add yourself is marked **No
> default permissions** for that reason — those members need a position too.

**Then positions**, with a two-tier permission model (View Access / Manage
Access) per module:

- Ready-made templates, narrowed and renamed to suit the agency type — an
  EMS-only service has no Firefighter, and calls its Engineer a Driver /
  Operator. The Leadership, Officer, Support and Member groups cover corporate
  and administrative roles
- Each position starts ticked to exactly what the backend seeds it with, so
  pressing Continue without editing anything changes no grants
- Leave a position unselected and it is not created. Your own System Owner
  position and the baseline Member position are always kept

#### Step 12: Module Selection

- Choose which modules to enable:
  - **Core:** Member Management, Events & RSVP, Documents & Files, Custom Forms
    (always on)
  - **Operations:** Training & Certifications, Inventory, Medical Supplies,
    Shift Scheduling, Apparatus & Fleet, Facilities Management, Department Store
  - **Governance:** Elections & Voting, Meeting Minutes, Reports & Analytics
  - **Communication:** Email Notifications, Mobile App Access
  - **Advanced:** External Integrations
  - **Membership:** Prospective Members Pipeline
- A module shows a clear **Enabled** state once turned on — the button turns
  green with a checkmark and the card is highlighted — so it is obvious at a
  glance which are active _(2026-06-25)_
- Continuing here finalizes setup and hands off to the Department Setup
  checklist at `/setup`

> Modules the wizard does not ask about — Communications, Finance, Grants &
> Fundraising, HR & Payroll, Incidents, Medical Screening, Public Information
> and the Testing Checklist — are turned on later under **Settings → Modules**.

### 3. Reset Progress

A "Reset Progress" button is available on every onboarding page (top right corner). This allows you to:

1. Clear all onboarding database records
2. Delete saved configuration
3. Start fresh from the beginning

**Warning:** This action cannot be undone and will delete all onboarding progress including any organizations or users created during the process.

### 4. Post-Onboarding Checklist

After completing onboarding, a checklist is automatically created with critical tasks:

**Critical Priority:**

- ✅ Set up TLS/HTTPS certificates
- ✅ Configure automated backups
- ✅ Review security checklist (HIPAA-aligned)
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
- ✅ Set up integrations (Microsoft 365, Google Workspace)

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
  "total_steps": 10,
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
    "encryption": "AES-256-GCM",
    "password_hashing": "Argon2id"
  },
  "features": {
    "hipaa_security_features": true,
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
POST /api/v1/onboarding/system-owner
Content-Type: application/json

{
  "username": "admin",
  "email": "admin@springfieldfd.org",
  "password": "SecureP@ssw0rd123!",
  "password_confirm": "SecureP@ssw0rd123!",
  "first_name": "John",
  "last_name": "Doe",
  "membership_number": "001"
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
  "membership_number": "001",
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
- Default seed data created for the organization
- Audit log entry created
- System now allows normal operation

### Department Setup Checklist

Remaining setup work lives on the department setup checklist, not in the
onboarding module. It derives completion from live data — member counts,
apparatus counts, whether anyone has actually signed in — rather than a static
list seeded at completion, so it stays accurate as the department works
through it.

```bash
GET /api/v1/organization/setup-checklist
```

**Response:**

```json
{
  "items": [
    {
      "key": "members",
      "title": "Add Department Members",
      "description": "Import or manually add your department roster.",
      "path": "/members/admin",
      "category": "essential",
      "is_complete": false,
      "count": 1,
      "required": true,
      "kind": "auto"
    }
  ],
  "completed_count": 0,
  "total_count": 10,
  "enabled_modules": ["members", "events", "documents"]
}
```

Items are either `kind: "auto"` (completion derived from entity counts) or
`kind: "review"` (no measurable signal — the admin confirms they looked).

### Acknowledge a Review Item

Only `review` items can be acknowledged; `auto` items are completed by doing
the work.

```bash
POST /api/v1/organization/setup-checklist/{item_key}/acknowledge?acknowledged=true
```

**Response:**

```json
{
  "item_key": "org_settings",
  "acknowledged": true
}
```

## Security Verification Requirements

### Critical Issues (Must Fix)

1. **SECRET_KEY**
   - Cannot be default value
   - Must be at least 32 characters
   - Generate with: `python -c "import secrets; print(secrets.token_urlsafe(64))"`

2. **ENCRYPTION_KEY**
   - Cannot be default value
   - Must be 64-character hex string (32 bytes)
   - Generate with: `python -c "import secrets; print(secrets.token_hex(32))"`

3. **ENCRYPTION_SALT**
   - Must be set (unique per installation)
   - Used for secure key derivation
   - Generate with: `python -c "import secrets; print(secrets.token_hex(16))"`

4. **DB_PASSWORD**
   - Cannot be "change_me_in_production"
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
   const response = await fetch("/api/v1/onboarding/status");
   const status = await response.json();

   if (status.needs_onboarding) {
     // Redirect to onboarding wizard
     router.push("/onboarding");
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

### Sample Frontend Component Structure

```
/onboarding
  /welcome
  /security-check
  /organization
  /admin-user
  /modules
  /notifications
  /review
/onboarding-complete
/checklist
```

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
2. **One-Time Use** - Once completed, can't be rerun without database changes
3. **Audit Logging** - All onboarding actions are logged
4. **IP Tracking** - Setup IP address is recorded
5. **Password Requirements** - Enforced at API level and client level

## Troubleshooting

### "Onboarding has already been completed" Error

**Cause**: OnboardingStatus exists and is marked complete

**Solution**: This is expected behavior. System is already set up.

### Security Check Not Passing

**Cause**: Using default values in .env file

**Solution**:

1. Generate new SECRET_KEY: `python -c "import secrets; print(secrets.token_urlsafe(64))"`
2. Generate new ENCRYPTION_KEY: `python -c "import secrets; print(secrets.token_hex(32))"`
3. Update .env file with generated keys
4. Restart backend: `docker-compose restart backend`

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
