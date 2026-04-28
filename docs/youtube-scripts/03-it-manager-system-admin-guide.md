# Script 3: IT Manager / System Admin — Complete Platform Guide

**Video Type:** Role-Based Guide (Long-Form)
**Estimated Length:** 30–40 minutes
**Target Audience:** IT Managers, System Owners, technically responsible personnel
**Role:** IT Manager (wildcard `*` permission — full system access)
**Chapters:** 10 (each designed as a standalone clip)

---

## CHAPTER 1: Introduction — The IT Manager Role (0:00 – 2:00)

### HOOK (0:00 – 0:30)

**[SCREEN: Dashboard with the full sidebar expanded showing every module.
Quick cuts of: Settings page, Position Management, Member Admin, Integrations,
IP Security, Platform Analytics.]**

> "The IT Manager is the most powerful role in The Logbook. You have the wildcard
> permission — full access to everything. Every module, every setting, every
> member's data. That's a lot of responsibility, and in this video, I'm going to
> show you exactly how to wield it."

### WHAT WE'LL COVER (0:30 – 2:00)

> "This is the complete IT Manager guide. We'll cover:"

**[CALLOUT: Numbered chapter list appearing on screen]**

> "System settings and organization configuration. User management — adding
> members, bulk import, and account administration. Position and permission
> management. Security settings — two-factor authentication, IP restrictions,
> session policies. Module configuration and feature flags. Integrations with
> external services. Monitoring, analytics, and error tracking. Backup and
> maintenance routines. And common admin tasks you'll do regularly."

> "Even if you're not the 'IT person,' if you've been handed the System Owner
> account, this is your video. Let's dive in."

**[TRANSITION: Cut to dashboard]**

---

## CHAPTER 2: Organization Settings (2:00 – 5:00)

### ACCESSING SETTINGS (2:00 – 2:30)

**[SCREEN: Click "Settings" in the sidebar. The Settings page loads.]**

> "Let's start with the nerve center — Organization Settings. Click Settings in
> the sidebar. This is where you control everything about how the platform
> behaves."

### GENERAL SETTINGS (2:30 – 3:30)

**[SCREEN: Show the General settings tab/section.]**

> "**General settings** let you update everything you entered during onboarding —
> department name, address, contact info, timezone, and logo. You can also set
> the department's official website URL and social media links."

**[SCREEN: Show editing the organization name, then scrolling through fields]**

> "The timezone setting is especially important. If this is wrong, every event
> time, every shift schedule, every deadline will display incorrectly for your
> members. Make sure it matches your department's physical location."

**[CALLOUT: "Settings → General → Timezone — verify this is correct"]**

### MODULE TOGGLES (3:30 – 4:30)

> "From the settings page, you can also enable or disable modules after
> onboarding. Maybe your department just started using the platform and you want
> to introduce modules gradually — start with Members and Events, then add
> Training and Scheduling a month later."

**[SCREEN: Show module toggle switches]**

> "Disabling a module hides it from the sidebar and restricts access, but it
> doesn't delete any data. If you turn Scheduling off and back on three months
> later, all your previous schedules are still there."

**[CALLOUT: "Disabling a module hides it — data is preserved"]**

### BRANDING & APPEARANCE (4:30 – 5:00)

> "You can customize the platform's appearance — upload your department logo,
> set the primary color scheme to match your department's colors. The platform
> supports light mode, dark mode, system-matched, and a high-contrast mode for
> accessibility."

**[SCREEN: Show changing the theme, uploading a logo]**

> "Individual members can choose their own theme preference, but the
> organization-wide default is what new members see on first login."

**[TRANSITION: Smooth cut to user management]**

---

## CHAPTER 3: Member Management & Bulk Import (5:00 – 10:00)

### ADDING MEMBERS ONE AT A TIME (5:00 – 6:30)

**[SCREEN: Navigate to Members in the sidebar. Click "Add Member."]**

> "The first real task after setup is getting your roster into the system. There
> are two approaches — individual entry and bulk import."

> "For individual entry, click 'Add Member.' Fill in the basics: first name,
> last name, email address. Then assign their position — Firefighter, Captain,
> Secretary, whatever applies."

**[SCREEN: Fill in a sample member form. Show the position dropdown.]**

> "You can also fill in optional fields — phone number, emergency contact,
> membership type, station assignment. The more data you enter now, the less
> back-and-forth you'll have later."

**[SCREEN: Save the member. Show the success confirmation.]**

> "When you save, if email is configured, the system can automatically send
> an invitation email with login credentials."

### BULK IMPORT VIA CSV (6:30 – 8:30)

**[SCREEN: Navigate to Members → Import Members]**

> "For departments with more than a handful of members, the CSV import is the
> way to go. Click 'Import Members' to open the bulk import tool."

**[SCREEN: Show the import page with the template download option.]**

> "First, download the CSV template. This gives you the exact column headers the
> system expects."

**[SCREEN: Click to download the template. Open it in a spreadsheet
application briefly to show the columns.]**

> "The template has columns for first name, last name, email, phone, position,
> membership type, station, and more. Fill this in with your department roster.
> A few tips:"

**[CALLOUT: Tips list]**

> "**Emails must be unique** — every member needs a different email address."

> "**Position names must match** — use the exact position names from the system.
> 'Firefighter,' not 'FF' or 'fire fighter.'"

> "**Empty optional fields are fine** — just leave them blank, don't put 'N/A.'"

**[SCREEN: Show uploading the completed CSV file]**

> "Upload your CSV and the system will validate it. You'll see a preview showing
> what will be imported, along with any warnings about invalid data."

**[SCREEN: Show the preview/validation screen with some rows highlighted]**

> "Green means good, yellow means a warning — like a duplicate email or
> unrecognized position name. Red means an error that needs fixing. Fix the
> issues in your spreadsheet, re-upload, and go."

**[SCREEN: Click "Import" and show the progress bar / completion message]**

### MANAGING MEMBER ACCOUNTS (8:30 – 10:00)

**[SCREEN: Navigate to the Members Admin Hub (MembersAdminHub)]**

> "Once members are imported, the Admin Hub is your command center. From here
> you can see every member, filter by position or membership type, and perform
> bulk actions."

**[SCREEN: Show the admin hub with filters, search, and member list]**

> "Click on any member to see their full profile — personal info, position
> assignments, training records, attendance history, equipment assignments."

**[SCREEN: Click into a member profile. Show the detail tabs.]**

> "As IT Manager, you can also reset passwords, force 2FA enrollment, disable
> accounts, and view audit history. The audit history shows every change made to
> a member's record — who changed it, when, and what was modified."

**[SCREEN: Show the audit history tab for a member (MemberAuditHistoryPage)]**

**[CALLOUT: "Audit trail is HIPAA-compliant — every change is logged"]**

**[TRANSITION: Move to positions]**

---

## CHAPTER 4: Position & Permission Management (10:00 – 14:00)

### THE PERMISSION MODEL (10:00 – 11:00)

**[SCREEN: Navigate to Settings → Position Management (RoleManagementPage)]**

> "The Logbook uses a dot-notation permission system. Permissions look like
> 'events.manage,' 'training.view,' 'settings.edit.' Positions are bundles of
> these permissions."

**[CALLOUT: Permission examples: "events.view", "events.create", "events.manage"]**

> "There's a hierarchy: 'view' lets you see data. 'Create' lets you make new
> records. 'Edit' lets you modify existing ones. 'Manage' usually includes all
> of those plus delete and configuration access. And the wildcard `*` — which
> only the IT Manager has — grants everything."

### MODIFYING POSITIONS (11:00 – 12:30)

**[SCREEN: Show the list of positions. Click to edit the "Captain" position.]**

> "Let's say your Captains need to manage training records, not just view them.
> Click on the Captain position and find the Training permissions section."

**[SCREEN: Show the permission toggles. Toggle 'training.manage' on for Captain.]**

> "Toggle 'training.manage' on. Now every member with the Captain position can
> create training sessions, record completions, and manage requirements."

> "Changes take effect immediately — any Captain currently logged in will gain
> the new permission on their next page load."

**[CALLOUT: "Permission changes are immediate — no restart needed"]**

### CREATING CUSTOM POSITIONS (12:30 – 13:30)

**[SCREEN: Click "Create Position" button]**

> "Need a custom position? Click 'Create Position.' Give it a name, a
> description, and set its priority level — this determines where it falls in
> the hierarchy."

**[SCREEN: Create a "Social Media Coordinator" position with settings.manage
and events.view permissions]**

> "For example, let's create a 'Social Media Coordinator' position. They need to
> view events so they can post about them, and maybe manage the public portal
> settings. Toggle on the permissions they need, save, and you're done."

### ASSIGNING MULTIPLE POSITIONS (13:30 – 14:00)

> "Remember, members can hold multiple positions. Your Captain might also be the
> Training Officer. The Safety Officer might also be a Lieutenant. Permissions
> from all positions are combined — if Captain gives 'training.view' and Training
> Officer gives 'training.manage,' that member gets 'training.manage.'"

**[CALLOUT: "Multiple positions → permissions are combined (union)"]**

**[TRANSITION: Security section]**

---

## CHAPTER 5: Security Configuration (14:00 – 18:00)

### TWO-FACTOR AUTHENTICATION (14:00 – 15:30)

**[SCREEN: Navigate to Settings → Security settings area]**

> "Security is critical — especially in a HIPAA-compliant platform that may
> store protected health information. Let's go through the security settings."

> "**Two-Factor Authentication.** You can require 2FA for all members, for
> specific positions, or leave it optional. My recommendation: require it for
> all administrative positions at minimum — IT Manager, Chiefs, President,
> Secretary, Training Officer."

**[SCREEN: Show the 2FA policy settings]**

**[CALLOUT: "Best practice: require 2FA for all admin-level positions"]**

> "Members use any TOTP-compatible authenticator app. The setup flow is simple —
> scan a QR code, enter the verification code, done."

### IP SECURITY (15:30 – 16:30)

**[SCREEN: Navigate to IP Security module (IPSecurityPage)]**

> "The IP Security module lets you restrict access by IP address. This is useful
> if you want to limit admin access to your station's network, or if you need to
> block specific IP ranges."

**[SCREEN: Show the IP security dashboard with allowlist/blocklist]**

> "You can create allowlists — only these IPs can access the system. Or
> blocklists — these IPs are denied. You can also set up geofencing rules if
> you want to restrict access to specific geographic regions."

**[CALLOUT: "Use IP allowlisting for admin access from station networks only"]**

### SESSION & PASSWORD POLICIES (16:30 – 17:30)

> "Under security settings, you can configure session timeouts — how long before
> an inactive user is automatically logged out. For HIPAA compliance, the
> recommended timeout is 15 to 30 minutes."

**[SCREEN: Show session timeout settings]**

> "Password policies are also configurable — minimum length, complexity
> requirements, maximum age before forced rotation. The defaults are HIPAA-
> compliant, but you can make them stricter."

### AUDIT LOGS (17:30 – 18:00)

> "Every security-relevant action is logged in the audit trail — logins,
> failed login attempts, permission changes, data access, account modifications.
> As IT Manager, you can review these logs at any time."

**[SCREEN: Show the audit log view with filter options]**

> "This is your paper trail for compliance. If anyone asks 'who accessed this
> record' or 'when was this permission changed,' the audit log has the answer."

**[TRANSITION: Module deep dive]**

---

## CHAPTER 6: Module Configuration Deep Dive (18:00 – 22:00)

### EVENTS SETTINGS (18:00 – 19:00)

**[SCREEN: Navigate to Events → Settings (EventsSettingsTab)]**

> "Each module has its own settings page. Let's walk through the most important
> ones, starting with Events."

> "In Events settings, you can configure event types — business meetings,
> training drills, social events, fundraisers. You can set default RSVP
> deadlines, enable or disable QR code check-in, and control whether event
> request approval is required."

**[SCREEN: Show event type configuration, QR check-in toggle]**

**[CALLOUT: "QR Check-In generates a unique QR code for each event for
contactless attendance tracking"]**

### TRAINING SETTINGS (19:00 – 20:00)

**[SCREEN: Navigate to Training → Admin (TrainingAdminPage)]**

> "Training settings control certification categories, expiration warning
> thresholds, and required training programs. You can set how far in advance
> members are warned about expiring certifications — 30 days, 60 days, 90 days."

**[SCREEN: Show training admin with certification categories and warning
thresholds]**

> "Training programs are pre-defined sets of requirements. For example, you
> might create an 'Annual Firefighter I Recertification' program with specific
> courses and skills testing."

**[SCREEN: Show the training programs configuration]**

### SCHEDULING SETTINGS (20:00 – 21:00)

**[SCREEN: Navigate to Scheduling → Shift Templates (ShiftTemplatesPage)]**

> "Scheduling settings let you define shift templates — recurring schedule
> patterns your department uses. Define the shift duration, minimum staffing
> levels, and which positions are required per shift."

**[SCREEN: Show creating or editing a shift template]**

> "You can also configure shift swap rules — whether swaps need officer approval,
> how far in advance members can request swaps, and blackout dates when swaps
> aren't allowed."

### ELECTIONS SETTINGS (21:00 – 22:00)

**[SCREEN: Navigate to Elections → Settings (ElectionsSettingsPage)]**

> "Elections settings define your voting rules. The Logbook supports multiple
> voting methods — simple majority, ranked choice, and more. You can set
> eligibility rules like minimum tenure, active membership status, and good
> standing requirements."

**[SCREEN: Show election configuration options]**

> "You can also control ballot secrecy, whether results are auto-published or
> require officer certification, and the voting window duration."

**[TRANSITION: Integrations]**

---

## CHAPTER 7: External Integrations (22:00 – 25:00)

### INTEGRATIONS DASHBOARD (22:00 – 23:00)

**[SCREEN: Navigate to Integrations (IntegrationsPage)]**

> "The Integrations module connects The Logbook with external services.
> Currently supported integrations include Google Calendar sync, email service
> providers, SMS via Twilio, and monitoring via Sentry."

**[SCREEN: Show the integrations dashboard with available/connected services]**

### EMAIL CONFIGURATION (23:00 – 24:00)

> "If you didn't set up email during onboarding, this is where you do it. Go
> to **Administration > Organization Settings**, click the **Email** tab, and
> select your platform."

**[SCREEN: Show email settings with platform buttons — Gmail, Microsoft 365, Self-Hosted SMTP, Cloudflare, Other]**

> "You can choose Gmail, Microsoft 365, Self-Hosted SMTP, or Cloudflare Email
> Service. For SMTP-based platforms, enter your server, port, and credentials.
> For Cloudflare, enter your Account ID and API Token — Cloudflare handles
> all the DNS authentication automatically."

**[SCREEN: Show Cloudflare configuration fields with Account ID and API Token]**

> "Once configured, use the **Test Connection** button to verify everything
> works. For SMTP, this tests the server connection and authentication. For
> Cloudflare, it validates your API token against Cloudflare's servers."

**[SCREEN: Show sending a test email and the success confirmation]**

> "With email enabled, the platform can send: event reminders, training
> expiration warnings, shift schedule notifications, password reset links,
> election announcements, and custom notifications."

> "One thing to note: Cloudflare Email Service doesn't support file
> attachments. If your department sends compliance reports or other files
> by email, use one of the SMTP-based platforms instead."

### CALENDAR SYNC (24:00 – 24:30)

> "The calendar sync integration lets members export their events and shifts
> to their personal Google Calendar, Apple Calendar, or Outlook. This is a
> one-way sync — events from The Logbook appear in their external calendar."

### MONITORING WITH SENTRY (24:30 – 25:00)

> "If you want error monitoring and performance tracking, enable the Sentry
> integration. This sends frontend and backend errors to Sentry for analysis.
> It's optional but useful for large deployments."

**[SCREEN: Show Sentry configuration fields]**

**[CALLOUT: "Sentry is optional — useful for diagnosing issues in production"]**

**[TRANSITION: Monitoring section]**

---

## CHAPTER 8: Platform Analytics & Monitoring (25:00 – 28:00)

### PLATFORM ANALYTICS (25:00 – 26:00)

**[SCREEN: Navigate to Admin → Platform Analytics (PlatformAnalyticsPage)]**

> "The Platform Analytics page gives you a bird's-eye view of system usage —
> active users, login frequency, most-used modules, storage usage."

**[SCREEN: Show the analytics dashboard with charts and metrics]**

> "This is where you see if the platform is actually being adopted. If you
> notice that the Training module has low usage, maybe it needs more promotion
> or training. If Events has high engagement, you know that module is delivering
> value."

### ERROR MONITORING (26:00 – 27:00)

**[SCREEN: Navigate to Admin → Error Monitoring (ErrorMonitoringPage)]**

> "The Error Monitoring page shows any client-side or server-side errors. Each
> error includes the type, the affected component, the timestamp, and any
> available stack trace."

**[SCREEN: Show the error list, click into one to show details]**

> "This is your first stop when a member reports something isn't working. Check
> the error log, see what happened, and either fix it or report it to the
> community."

### DEPARTMENT SETUP & CONFIGURATION (27:00 – 28:00)

**[SCREEN: Navigate to Admin → Department Setup (DepartmentSetupPage)]**

> "The Department Setup page gives you a configuration checklist — what's been
> set up, what's missing, and what could be improved. Think of it as a health
> check for your Logbook instance."

**[SCREEN: Show the checklist with green/yellow/red status indicators]**

> "Green means configured and healthy. Yellow means configured but could be
> improved. Red means missing or not configured. Walk through any yellows and
> reds and address them."

**[TRANSITION: Maintenance section]**

---

## CHAPTER 9: Maintenance & Operations (28:00 – 33:00)

### REGULAR MAINTENANCE TASKS (28:00 – 29:30)

> "Let's talk about what you should be doing regularly as the IT Manager."

**[CALLOUT: Weekly / Monthly / Quarterly checklist]**

> "**Weekly:** Check the error monitoring page for any new issues. Review
> failed login attempts in the audit log. Verify backups are running
> successfully."

> "**Monthly:** Review platform analytics — are all members logging in? Are
> there modules with zero usage that should be disabled or promoted? Check for
> any pending application updates."

> "**Quarterly:** Review and rotate the encryption keys if your security policy
> requires it. Audit the position/permission assignments — has anyone left the
> department who still has an active account? Are there any position changes
> that haven't been reflected?"

### UPDATING THE LOGBOOK (29:30 – 31:00)

> "When a new version of The Logbook is released, updating is straightforward
> with Docker."

**[SCREEN: Show terminal commands]**

```bash
cd the-logbook
git pull origin main
docker compose down
docker compose up -d --build
```

> "Pull the latest code, stop the services, rebuild and restart. The backend
> will automatically run any new database migrations on startup."

**[CALLOUT: "Always back up your database before updating"]**

> "Before any update, I recommend backing up your database."

```bash
docker compose exec mysql mysqldump -u root -p intranet_db > backup_$(date +%Y%m%d).sql
```

> "This creates a timestamped SQL dump. If anything goes wrong with the update,
> you can restore from this backup."

### BACKUP STRATEGY (31:00 – 33:00)

> "Speaking of backups, let's talk strategy. You need to back up two things:
> the database and the uploaded files."

**[CALLOUT: Two-box layout: "Database" and "File Storage"]**

> "**Database:** The MySQL database contains all your members, events, training
> records, meeting minutes — everything. Use `mysqldump` on a schedule or
> configure automated backups."

> "**File Storage:** Uploaded documents, member photos, logos, and attachments
> are stored in the uploads volume. Back this up alongside the database."

> "For automated backups, you can set the `BACKUP_ENABLED` environment variable
> and configure the backup schedule, retention period, and storage location in
> your `.env` file."

**[SCREEN: Show the backup-related environment variables]**

> "The minimum viable backup strategy: a daily database dump to an external
> drive or cloud storage, with at least 30 days of retention. For HIPAA
> compliance, ensure backups are encrypted and access-controlled."

**[CALLOUT: "HIPAA: Backups must be encrypted and access-controlled"]**

**[TRANSITION: Common tasks]**

---

## CHAPTER 10: Common Admin Tasks Quick Reference (33:00 – 36:00)

### QUICK REFERENCE (33:00 – 36:00)

> "Let me wrap up with a quick-reference of the most common tasks you'll perform
> as IT Manager."

**[SCREEN: Show each task as a quick demonstration — 15-20 seconds each]**

> "**Resetting a member's password:** Members page → click member → Account →
> Reset Password."

**[SCREEN: Quick demo of the flow]**

> "**Disabling an account:** When someone leaves the department. Members page →
> click member → Account → Disable Account. This preserves their historical data
> but prevents login."

**[SCREEN: Quick demo]**

> "**Adding a new position:** Settings → Position Management → Create Position.
> Name it, set permissions, save."

**[SCREEN: Quick demo]**

> "**Viewing who has access to what:** Settings → Position Management. Click any
> position to see its permissions. Click any member to see their combined
> permissions from all positions."

> "**Checking system health:** Navigate to the admin dashboard. Green = healthy.
> Or from the command line: `curl http://localhost:3001/health`."

> "**Generating reports:** Reports module → choose report type → set date range
> → export as PDF or CSV."

**[SCREEN: Quick demo of report generation]**

> "That's the complete IT Manager guide. You now know how to manage members,
> configure permissions, secure the platform, set up integrations, and maintain
> the system. If you have questions or run into issues, the GitHub community is
> active and helpful."

> "In the next video, we look at The Logbook from the Fire Chief's perspective —
> the operational and leadership view."

**[SCREEN: End card with subscribe, next video link, and playlist link]**

---

## Clip Extraction Guide

| Clip | Timecode | Standalone Title |
|------|----------|-----------------|
| Adding a New Member | 5:00–6:30 | "How to Add a Member to The Logbook" |
| Bulk CSV Import | 6:30–8:30 | "Importing Your Roster via CSV" |
| Customizing Permissions | 10:00–14:00 | "Position & Permission Management Explained" |
| Setting Up 2FA | 14:00–15:30 | "Enabling Two-Factor Authentication" |
| IP Security Setup | 15:30–16:30 | "Restricting Access with IP Security" |
| Email Configuration | 23:00–24:00 | "Setting Up Email Notifications" |
| Updating The Logbook | 29:30–31:00 | "How to Update The Logbook (Docker)" |
| Backup Strategy | 31:00–33:00 | "Backing Up Your Logbook Data" |
| Admin Quick Reference | 33:00–36:00 | "IT Manager Quick Reference Guide" |
