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

The wizard is **eleven steps**. Only two are required — the organization and
the administrator account — and every other step can be skipped and set up
later from Settings.

**The order was rebuilt on 2026-09-11** to follow what a department can
actually answer. Identity comes **second**, so everything after it belongs to a
real signed-in account; what the department _uses_ (modules, ranks, stations,
apparatus) comes before the _external integrations_ (email, storage, sign-in),
which are the steps that send someone off to find credentials — and all of
those are skippable.

The order is declared once, in
`frontend/src/modules/onboarding/config/steps.ts`. It previously lived in three
places that each restated it — the progress indicator, the route table, and a
hardcoded next-step path in every page — and they drifted.

| #   | Step                  | Path                            | Required?              |
| --- | --------------------- | ------------------------------- | ---------------------- |
| —   | Setup Prerequisites   | `/onboarding/prepare`           | Not a step — see below |
| 1   | Organization Setup    | `/onboarding/start`             | **Required**           |
| 2   | Administrator Account | `/onboarding/system-owner`      | **Required**           |
| 3   | Modules               | `/onboarding/modules`           | Optional               |
| 4   | Ranks & Positions     | `/onboarding/positions`         | Optional               |
| 5   | Stations              | `/onboarding/stations`          | Optional               |
| 6   | Apparatus             | `/onboarding/apparatus`         | Optional               |
| 7   | IT & Backup Contacts  | `/onboarding/it-team`           | Optional               |
| 8   | Email                 | `/onboarding/email-platform`    | Optional               |
| 9   | File Storage          | `/onboarding/file-storage`      | Optional               |
| 10  | Sign-In Method        | `/onboarding/authentication`    | Optional               |
| 11  | Navigation Layout     | `/onboarding/navigation-choice` | Optional               |

**The provider-configuration screens are not steps of their own.**
`/onboarding/email-config` and `/onboarding/file-storage-config` configure the
provider the preceding step just chose. A department that picks SMTP has not
reached a twelfth step — it is still on Email. They previously counted
unevenly (email's config screen was a step, file storage's was not), which made
the same kind of decision cost a different amount of visible progress depending
on which one you were making.

#### Before you start: Setup Prerequisites (`/onboarding/prepare`)

Opens the flow and **collects nothing**. It lists what setup will ask for,
split into what is required and what is optional, so an operator knows before
starting that the wizard will want SMTP credentials, an OAuth client secret and
a storage key.

It exists because the health screen told an operator the database was up and
nothing told them what came next — so they started, met a step they could not
answer, and left to go and find it. **Walking away is what used to end the
install.**

Both lists are derived from the step list's own `optional` flags, so a step
that changes its flag changes this screen with it.

#### Step 1: Organization Setup

- Name, organization type, timezone and contact details
- Mailing and physical address, department identifiers (FDID / State ID / Dept ID)
- Whether members carry numbers, and where the sequence starts — asked here so
  the accounts this wizard creates are numbered too
- Logo (optional)
- Commits the organization, and creates the headquarters facility and location
  from the department address

> **Member numbering has to be asked first.** The counter only numbers members
> created _after_ it is switched on, and this wizard creates the administrator
> account in step 2 and the IT team in step 7. A department that set this on a
> members screen afterwards ended up with its first accounts holding no number
> and the roster import starting at the number they should have had — an
> off-by-a-few nobody notices until a badge is printed.

#### Step 2: Administrator Account

- Create the first administrator account: username, email, password (12+
  characters), name and membership number
- Optionally set this account's operational rank
- Sets the authentication cookies — the administrator is signed in from here on

> **This is why identity comes second.** Every step after it — modules,
> positions, the IT team — runs against a signed-in session.

#### Step 3: Modules

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
- Where enabling one module confers another, the screen says so — Inventory
  confers Medical Supplies _(2026-09-10)_

> **This step now comes before positions**, and that is what makes step 4's
> permission rows meaningful: they are filtered to the modules chosen here.

> Modules the wizard does not ask about — Communications, Finance, Grants &
> Fundraising, HR & Payroll, Incidents, Medical Screening, Public Information
> and the Testing Checklist — are turned on later under **Settings → Modules**.

#### Step 4: Ranks & Positions

**Your membership ladder** comes first — the stages a member progresses
through, and what each one lets them do:

- Rename the stages to your own (Probationary, Active, Senior, Life, or
  whatever your bylaws call them), set the years each requires, reorder them,
  add your own and remove any you do not have
- Per stage: whether those members can vote in elections, whether they may hold
  elected office, whether they must meet a meeting-attendance threshold to vote
  (and what it is, over what period), and whether they are exempt from training
- Turn off automatic advancement if your department promotes by vote, by
  application, or on a date of its own choosing — it is on by default and a
  monthly job acts on it

> This is the one to check against your bylaws. It decides who is in the ballot
> electorate, and a department that leaves the shipped arrangement in place
> usually discovers it at its first election.

> The same editor is available after setup at **Members → Administration →
> Settings → Membership Tiers** _(2026-09-11)_.

**Your rank ladder** comes next. The department starts from the ranks its
agency type usually has and changes them to match what it actually uses:

- Rename a rank to your own vocabulary — an EMS service's Driver / Operator, a
  department whose Captain is a Company Officer
- Reorder the ladder, remove ranks you do not have, and add your own
  (Battalion Chief, Firefighter II)
- Set which shift seats each rank can fill — **including a seat your department
  invented** _(2026-09-11)_
- Set your own rank as System Owner

> A rank says where somebody sits and which seats they can fill; what they can
> **do** comes from their position. A rank you add yourself is marked **No
> default permissions** for that reason — those members need a position too.

> The ladder is also editable after setup at **Members → Administration →
> Settings → Operational Ranks**, which accepts `members.manage` _(2026-09-11)_.

**Then positions**, with a two-tier permission model (View Access / Manage
Access) per module:

- Ready-made templates, narrowed and renamed to suit the agency type — an
  EMS-only service has no Firefighter, and calls its Engineer a Driver /
  Operator. The Leadership, Officer, Support and Member groups cover corporate
  and administrative roles
- **Permission rows are shown only for the modules enabled in step 3**
  _(2026-09-11)_, and every checkbox grants a permission that exists
- Each position starts ticked to exactly what the backend seeds it with, so
  pressing Continue without editing anything changes no grants
- Unticking a seeded position **removes** it _(2026-09-10)_
- Leave a position unselected and it is not created. Your own System Owner
  position and the baseline Member position are always kept

#### Step 5: Stations

- Add the stations beyond headquarters — skippable, and many departments have one
- Creates a facility and location per station

#### Step 6: Apparatus

- Unit number, type, minimum staffing and riding positions
- Creates the lightweight apparatus records shift staffing needs

#### Step 7: IT Team & Backup Access

- Add IT team contact information, and optionally each contact's operational rank
- Configure backup access email and phone
- Set secondary admin email for emergencies
- IT contacts become user accounts at completion, each required to change its
  password on first sign-in

#### Step 8: Email

- Select email platform for notifications:
  - Gmail / Google Workspace
  - Microsoft 365 / Outlook
  - Self-hosted email server (SMTP)
  - Cloudflare Email Service (REST API — no SMTP server needed)
  - Other / Skip
- The following screen (`/onboarding/email-config`, not a step of its own)
  takes the platform's settings — SMTP host/port and an app password, or
  Cloudflare's Account ID and API Token
- Send a test message to verify the connection; credentials are encrypted
  server-side

#### Step 9: File Storage

- Choose a file storage solution:
  - Google Drive
  - OneDrive / SharePoint
  - Amazon S3
  - Local storage
  - Configure Later
- Enter the platform's credentials on the following screen
  (`/onboarding/file-storage-config`, not a step of its own). Skipping stores
  the choice without credentials rather than discarding the step

> **The choice is recorded but not yet acted on** (2026-09-10): uploads write to
> the server's own filesystem whatever is selected here — no code outside the
> settings screen reads the stored credentials. A department that picks S3 or
> Drive so its files sit somewhere the server is not should treat that as still
> to do after setup, not done by it.

#### Step 10: Sign-In Method

- Choose how users will authenticate:
  - **Google OAuth** - Sign in with Google accounts (recommended for Google Workspace users)
  - **Microsoft Azure AD** - Sign in with Microsoft accounts (recommended for Microsoft 365 users)
  - **Authentik SSO** - Self-hosted authentication platform (for complete control).
    **Not usable yet — see the warning below**
  - **Local Passwords** - Secure password-based authentication with Argon2id hashing (no external services required)

> **OAuth sign-in (2026-05-29):** "Sign in with Google" and "Sign in with
> Microsoft" (Azure AD, single-tenant) are now fully implemented. They are
> **link-existing-only** — the verified IdP email must match an active local
> user; OAuth never auto-creates accounts. Configure via the `GOOGLE_*` /
> `AZURE_AD_*` environment variables and optionally restrict by email domain.
> See [Authentication > OAuth](Security-Authentication#oauth).

> **Do not choose Authentik yet (2026-09-10):** unlike the two above, it has no
> sign-in flow — there is no Authentik authorization or callback route, and the
> login page renders Google and Microsoft only, so the SSO you selected is not
> there. Passwords still work, but selecting it switches the organization off
> self-service password resets: a member who forgets theirs needs an
> administrator to reset it. Choose Local unless you are setting up Google or
> Microsoft.

#### Step 11: Navigation Layout

- Choose a top bar or a left sidebar

> **This is a department-wide setting, not a personal one** _(2026-09-11)_. The
> answer is stored on the organization and applies to every member. It used to
> be written to the browser's local storage, so only the officer who ran setup
> ever saw their own choice.
>
> It can be changed afterwards at **Settings → General → Profile →
> Navigation Layout**. An installation upgraded from before 2026-09-11 has no
> stored value and gets the `left` default — see
> [UPGRADING.md](https://github.com/thegspiro/the-logbook/blob/main/docs/UPGRADING.md#changes-you-will-notice-after-an-upgrade).

- Continuing here finalizes setup and hands off to the Department Setup
  checklist at `/setup`

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

The request bodies, and a table naming the model behind each response, live in
[`docs/ONBOARDING_FLOW.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/ONBOARDING_FLOW.md#backend-api-endpoints),
which is the reference this page defers to. That is an absolute link on purpose:
`wiki/setup-wiki.sh` publishes `wiki/*.md` and generates two pages from `docs/`,
so `docs/ONBOARDING_FLOW.md` is not in the published wiki and a relative
`../docs/...` would resolve to nothing from the rendered page.

They were written out in full here as well until 2026-09-10, and the two copies
had drifted: this page documented `POST /onboarding/organization` with a
five-field body, which that route stopped accepting when it moved to the full
`OrganizationSetupCreate` schema. A caller following it now gets a 422. Nothing
kept the two copies in step, and nothing would have.

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

The last two rows about mail are not interchangeable. `/session/email` is what
stores the encrypted SMTP settings, which `/complete` then persists into the
organization. `/notifications` sets the `email_configured` flag on the
onboarding status and marks the step done — it returns the `email_enabled` and
`sms_enabled` booleans it was given and discards everything else in the body, so
a caller that sends SMTP or Twilio credentials there receives a success response
and has configured nothing.

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

### The onboarding routes

The real route table, as registered in
`frontend/src/modules/onboarding/routes.tsx`. Step routes are in wizard order;
the rest are entry points, provider-configuration screens, or aliases kept so
older links keep working.

```
/onboarding                          entry — decides whether setup is needed
/onboarding/prepare                  Setup Prerequisites (not a step)

/onboarding/start                    step 1   Organization Setup
/onboarding/system-owner             step 2   Administrator Account
/onboarding/modules                  step 3   Modules
/onboarding/positions                step 4   Ranks & Positions
/onboarding/stations                 step 5   Stations
/onboarding/apparatus                step 6   Apparatus
/onboarding/it-team                  step 7   IT & Backup Contacts
/onboarding/email-platform           step 8   Email
/onboarding/file-storage             step 9   File Storage
/onboarding/authentication           step 10  Sign-In Method
/onboarding/navigation-choice        step 11  Navigation Layout

/onboarding/email-config             configures the platform step 8 chose
/onboarding/file-storage-config      configures the platform step 9 chose
/onboarding/complete                 Setup Complete
/onboarding/security-check           security preconditions

/onboarding/department          -->  /onboarding/start
/onboarding/admin-user          -->  /onboarding/system-owner
/onboarding/roles               -->  /onboarding/positions
/onboarding/modules/:id/config  -->  /onboarding/modules
/onboarding/module-selection         renders the Modules screen
```

> `/onboarding/modules/:moduleId/config` **stopped being a step on 2026-09-10**
> and now redirects. The screen it rendered reported success and saved nothing.

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
that is both weak and breached reports the weakness first. Full contract: [`docs/ONBOARDING_FLOW.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/ONBOARDING_FLOW.md#create-admin-user).

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
