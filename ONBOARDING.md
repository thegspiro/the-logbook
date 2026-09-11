# Onboarding Module Guide

> **Canonical source.** A copy of this guide is published to the GitHub Wiki
> from [`wiki/Onboarding.md`](wiki/Onboarding.md). The two are not synced
> automatically — if you change this file, update the wiki page too.

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

The progress indicator contains 11 steps. Email configuration and file-storage
configuration are conditional sub-pages within their respective steps, so the
number of screens a user sees depends on the services they select.

Only the first two — Organization Setup and System Owner Creation — are
required; `complete_onboarding` enforces exactly those, and every other step
has a Skip. The order puts identity second so the rest of setup runs against a
real signed-in account, and leaves the steps that need credentials from
elsewhere (email, file storage, sign-in) until the end.

#### Step 1: Organization Setup

- Create your fire department or organization
- Set organization name, slug, and type (`fire_department`, `ems_only`, `fire_ems_combined`)
- Configure timezone, contact info, mailing/physical addresses
- Upload organization logo (optional)
- Set department identifiers (FDID, State ID, or Department ID)
- Say whether members carry numbers, with a prefix and a starting number. Asked
  here because the counter only numbers members created after it is on — the
  System Owner and IT team are created later in this same wizard.
- **Commits to database immediately**

#### Step 2: System Owner Creation

- Create the first administrator account
- Enforces strong password requirements (12+ characters with complexity rules)
- Membership Number is optional — all other fields are required
- Automatically assigns Super Admin access

#### Step 3: Module Selection

- Choose which modules to enable:
  - **Core** (always on): Member Management, Events & RSVP, Documents & Files, Custom Forms
  - **Operations**: Training & Certifications, Inventory, Medical Supplies, Shift Scheduling, Apparatus & Fleet, Facilities Management, Department Store
  - **Governance**: Elections & Voting, Meeting Minutes, Reports & Analytics
  - **Communication**: Email Notifications, Mobile App Access
  - **Advanced**: External Integrations
  - **Membership**: Prospective Members Pipeline
- Modules the wizard does not ask about — Communications, Finance, Grants &
  Fundraising, HR & Payroll, Incidents, Medical Screening, Public Information and
  the Testing Checklist — are turned on later under **Settings → Modules**

#### Step 4: Ranks & Positions

- Set the membership ladder — the stages a member progresses through, the years
  each takes, and what each one confers: voting in elections, holding office,
  any meeting-attendance threshold for voting, and training exemption. Turn off
  automatic advancement if your department promotes by vote or by application
- Edit the department's rank ladder: rename ranks to your own vocabulary,
  reorder them, remove ones you do not have, add your own, and set each rank's
  shift eligibility. Set your own rank as System Owner
- Configure operational positions with two-tier permissions (View Access / Manage Access)
- Use pre-configured position templates by category (Leadership, Officers, Administrative, etc.)
- A position left unselected is not created — except the System Owner's own and
  the baseline Member position, which are always kept

#### Step 5: Stations

- Confirm the headquarters created from the organization mailing address
- Add any additional stations (optional)

#### Step 6: Apparatus

- Add apparatus and minimum staffing requirements (optional)

#### Step 7: IT Team & Backup Access

- Configure IT team contacts and backup access information
- Each contact may be given an operational rank, applied when their account is
  created at completion

#### Step 8: Email Platform Choice

- Select email service: Gmail, Microsoft 365, Cloudflare Email, Self-Hosted (SMTP), or Skip
- If a service is selected, proceeds to email configuration

#### Step 9: File Storage Choice

- Select file storage: Local, Amazon S3, Google Drive, OneDrive / SharePoint, or Other

> **The choice is recorded but not yet acted on** (2026-09-10). Uploads write to
> the server's own filesystem whatever is selected here — no code outside the
> settings screen reads the stored credentials. A department that picks S3 or
> Drive so its files sit somewhere the server is not should treat that as still
> to do after setup, not done by it.

#### Step 10: Authentication Choice

- Select authentication method: Local passwords, Google, Microsoft, or Authentik

> **Do not choose Authentik yet** (2026-09-10). It is accepted and stored, but
> no Authentik sign-in flow exists — the login page offers Google and Microsoft
> only, so the SSO you selected is not there. Passwords still work, but the
> setting switches the organization off self-service password resets: a member
> who forgets theirs needs an administrator to reset it. Choose Local unless
> you are setting up Google or Microsoft.

#### Step 11: Navigation Choice

- Choose between Top Bar or Left Sidebar navigation layout

#### Finishing up

- Finalizes onboarding and hands off to the Department Setup checklist at `/setup`
- The checklist derives each step from live entity counts rather than a stored list
- Module-specific steps appear only for the modules that were enabled — a
  department that turned on the Department Store is told it needs a catalog
  before anyone can order

### 3. Post-Onboarding Checklist

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

The request bodies, and a table naming the model behind each response, live in
[`docs/ONBOARDING_FLOW.md`](./docs/ONBOARDING_FLOW.md#backend-api-endpoints),
which is the reference this document defers to.

They were written out in full here as well until 2026-09-10, in a third copy
alongside this one and `wiki/Onboarding.md`. That file's header asks anyone
editing it to change this one first and mirror the result — but nothing
enforces it: `wiki/setup-wiki.sh` copies `wiki/*.md` verbatim and generates
only Troubleshooting and Error-Codes from `docs/`, so the two pages are
independently maintained and a hand-applied "mirror" is the only thing that
would carry a stale section from here to there. The copies had already drifted:
this one documented
`POST /onboarding/organization` with a five-field body, which that route stopped
accepting when it moved to the full `OrganizationSetupCreate` schema, so a
caller following it gets a 422.

The surface, so it is visible at a glance:

| Purpose                          | Endpoint                                                           |
| -------------------------------- | ------------------------------------------------------------------ |
| Is onboarding needed             | `GET /api/v1/onboarding/status`                                    |
| Begin a session                  | `POST /api/v1/onboarding/start`                                    |
| Host and version details         | `GET /api/v1/onboarding/system-info`                               |
| Security preconditions           | `GET /api/v1/onboarding/security-check`                            |
| Database reachability            | `GET /api/v1/onboarding/database-check`                            |
| Create the organization          | `POST /api/v1/onboarding/session/organization`                     |
| Read back a resumable session    | `GET /api/v1/onboarding/session/data`                              |
| Create the System Owner          | `POST /api/v1/onboarding/system-owner`                             |
| Enable modules                   | `POST /api/v1/onboarding/modules`                                  |
| Email configuration              | `POST /api/v1/onboarding/session/email`                            |
| Record that email was configured | `POST /api/v1/onboarding/notifications`                            |
| Finish onboarding                | `POST /api/v1/onboarding/complete`                                 |
| Reset — **destructive**          | `POST /api/v1/onboarding/reset`                                    |
| Post-setup checklist             | `GET /api/v1/organization/setup-checklist`                         |
| Acknowledge a checklist item     | `POST /api/v1/organization/setup-checklist/{item_key}/acknowledge` |

The last two rows about mail are not interchangeable. `/session/email` stores
the encrypted SMTP settings, which `/complete` then persists into the
organization. `/notifications` sets the `email_configured` flag and marks the
step done — it returns the `email_enabled` and `sms_enabled` booleans it was
given and discards everything else, so credentials sent there receive a success
response and configure nothing.

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
   - Don't allow all origins (\*) in production

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

### Frontend Component Structure

```
/                               → Welcome page (animated intro, "Get Started" button)
/onboarding                     → Service health check (auto-retries, then redirects)
/onboarding/prepare             → What setup will ask for (pre-flight, collects nothing)
/onboarding/start               → Step 1: Organization Setup      (required)
/onboarding/system-owner        → Step 2: System Owner Creation   (required)
/onboarding/modules             → Step 3: Module Selection
/onboarding/positions           → Step 4: Ranks & Positions
/onboarding/stations            → Step 5: Stations
/onboarding/apparatus           → Step 6: Apparatus
/onboarding/it-team             → Step 7: IT Team & Backup Access
/onboarding/email-platform      → Step 8: Email Platform Choice
/onboarding/email-config        → Step 8a: Email Configuration (if a service is selected)
/onboarding/file-storage        → Step 9: File Storage Choice
/onboarding/file-storage-config → Step 9a: File Storage Configuration (if a cloud service is selected)
/onboarding/authentication      → Step 10: Authentication Choice
/onboarding/navigation-choice   → Step 11: Navigation Choice — last step, so it
                                  calls POST /onboarding/complete
/onboarding/complete            → Summary, then → /setup (Department Setup checklist)

The order above is declared once, in
frontend/src/modules/onboarding/config/steps.ts. Pages ask it for their
neighbours rather than naming them, and OnboardingService.STEPS mirrors it
under a parity test.
```

### Data Persistence

Frontend onboarding state is stored in a Zustand store persisted to **localStorage** (key: `onboarding-storage`). Sensitive data (session IDs, CSRF tokens) is excluded from persistence.

The API client stores the session identifier separately, in **`sessionStorage`** under `onboarding_session_id` _(moved from `localStorage` on 2026-08-15)_. That identifier is a bearer credential — presented as the `X-Session-ID` header, it authorizes the setup mutations that create the organization, its stations and apparatus, the IT team, and the first System Owner — so it must not survive a browser restart or be readable from unrelated tabs. Its CSRF companion, `onboarding_csrf_token`, lives in **`sessionStorage`** too and is sent as the `X-CSRF-Token` header — not as a cookie. The backend sets no cookie of that name; the client reads one only to migrate a value an older build left, then deletes it. Identifiers left in `localStorage` by an older client are deleted on load.

**The two stores have different lifetimes, and that is visible to installers.** The wizard's typed answers (`onboarding-storage`) outlive the tab; the session identifier does not. Reopening `/onboarding` after closing the browser therefore repaints the answers already entered while the server session is gone — the failure surfaces at the next mutating step as `401` / `ONBD_SESSION_INVALID`, not at the repaint. **Onboarding should be completed in one tab, in one sitting**; the recovery from an expired run is to restart the wizard, not to re-type into a dead session. A second tab does not inherit the wizard either (a _duplicated_ tab does, because Chrome and Firefox copy `sessionStorage` into duplicates — browser behavior, not a supported resume path).

Server-side, the session row carries a **30-minute sliding expiry** (`SESSION_EXPIRY_HOURS = 0.5`), pushed forward on each authenticated activity.

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

### Access Control

1. **No Authentication Required** - Onboarding endpoints don't require authentication since no users exist yet
2. **GeoIP Bypass** - Onboarding endpoints are exempt from GeoIP country blocking, since first-time setup must be accessible before any configuration exists
3. **One-Time Use** - Once completed, can't be rerun without database changes
4. **Reset Protection** - The reset endpoint is blocked after onboarding completes; it only works while onboarding is still in progress
5. **CSRF Protection** - All session-modifying endpoints require a valid `X-CSRF-Token` header

### Data Protection

6. **Sensitive Data Encryption** - Email passwords, API keys, and file storage credentials entered during onboarding are encrypted (AES-256 via Fernet) before being stored in the session database. Only platform names are stored in plain text.
7. **No Passwords in Logs** - Temporary passwords are never written to application logs. Only the request for a welcome email is logged.
8. **Sanitized Error Responses** - API error responses never expose internal exception details, database structure, or stack traces. Full error details are logged internally only.
9. **Password Requirements** - Enforced at both API and client level (12+ chars, complexity, common password check)

### Monitoring & Hardening

10. **Audit Logging** - All onboarding actions are logged with IP, user agent, and timestamps
11. **IP Tracking** - Setup IP address is recorded for each session
12. **Email Test Timeout** - SMTP connection tests have a 30-second timeout to prevent indefinite hangs if a mail server is unreachable
13. **Uniform Auth Failure Messages** - Authentication logs do not reveal whether a username exists or a password was wrong, preventing username enumeration
14. **Health Endpoint Sanitized** - The `/health` endpoint reports service status without exposing raw error messages or infrastructure details
15. **Environment File Protection** - `.env` files are excluded from version control via `.gitignore` to prevent accidental secret commits

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

- At least 12 characters, and no more than `PASSWORD_MAX_LENGTH` (128 unless
  your deployment overrides it)
- One uppercase letter
- One lowercase letter
- One number
- One special character

Those five are not the whole rule, and the three below are what usually rejects
a password that appears to satisfy the list. It must also contain:

- no three sequential characters (`123`, `abc`, …) and no character repeated
  three times in a row
- no keyboard pattern — `qwerty`, `asdfgh`, `zxcvbn`, `qazwsx`, `qweasd`,
  `!@#$%^`, `1qaz2wsx`, `1234qwer`, `asdf1234`
- nothing on the common-password list, which includes fire-service words
  (`firefighter`, `station`, `medic`, `ambulance`) as well as the usual ones

The response lists every rule the password broke, not just the first — with two
exceptions: a password over `PASSWORD_MAX_LENGTH` is rejected on length alone,
and the breached-password check runs only once every rule above passes, so a
password
that is both weak and breached reports the weakness first. Full contract: [`docs/ONBOARDING_FLOW.md`](./docs/ONBOARDING_FLOW.md#create-admin-user).

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
