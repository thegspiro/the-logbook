# Script 2: First-Time Setup & Onboarding Walkthrough

**Video Type:** Deep Dive
**Estimated Length:** 15–20 minutes
**Target Audience:** Department leadership, IT admins, whoever is setting up the system
**Prerequisites:** The Logbook is installed and running (see Script 1)
**Chapters:** 8 (each cuttable as a standalone clip)

---

## CHAPTER 1: Introduction (0:00 – 1:00)

### HOOK (0:00 – 0:20)

**[SCREEN: Browser open to The Logbook's Welcome page — the onboarding wizard
greeting screen with the logo and "Welcome to The Logbook" text.]**

> "Your Logbook is installed and running. Now let's turn it into *your*
> department's platform. The onboarding wizard walks you through everything step
> by step, and in this video, I'm going to walk you through the wizard — with
> tips on what to pick and why."

### WHAT WE'RE DOING (0:20 – 1:00)

**[CALLOUT: Numbered list of onboarding steps]**

> "Here's the onboarding flow: we'll set up your organization info, create the
> system owner account, choose your authentication method, configure which
> modules you need, set up positions and permissions, and configure email if you
> want notifications. By the end, you'll have a fully configured platform ready
> for your members to log in."

> "Let's start."

**[TRANSITION: Click "Get Started" on the Welcome page]**

---

## CHAPTER 2: Welcome & Organization Setup (1:00 – 4:00)

### WELCOME SCREEN (1:00 – 1:30)

**[SCREEN: The Welcome page of the onboarding wizard. Show the progress
indicator at the top showing all steps.]**

> "This is the Welcome page. You can see the progress indicator at the top —
> it shows every step in the onboarding process. The wizard auto-saves your
> progress, so if you need to step away or your browser closes, you'll pick up
> right where you left off."

**[CALLOUT: Arrow pointing to progress indicator bar]**

> "Notice the auto-save indicator — every time you move to the next step, your
> data is saved automatically."

**[SCREEN: Click "Get Started"]**

### ORGANIZATION SETUP (1:30 – 4:00)

**[SCREEN: The OrganizationSetup page loads with the form fields.]**

> "First up: tell The Logbook about your organization. This is where you enter
> your department's basic information."

**[SCREEN: Fill in fields one at a time, pausing to explain each]**

> "**Organization Name** — this is the name that appears throughout the platform.
> 'Anytown Volunteer Fire Department,' 'Metro City Fire Rescue,' whatever your
> official name is."

**[SCREEN: Type "Anytown Volunteer Fire Department" into the name field]**

> "**Department Type** — select the type that best fits. Fire Department,
> Ambulance Corps, Rescue Squad, Fire District, or a combined agency. This
> affects some default settings and terminology."

**[SCREEN: Click the dropdown and select "Volunteer Fire Department"]**

> "**Address and Contact Information** — enter your station's physical address
> and the department's main phone number and email. This appears on public-facing
> pages if you enable the public portal module later."

**[SCREEN: Fill in a sample address, phone, and email]**

> "**Timezone** — this is important. All dates and times in The Logbook are
> stored in UTC and displayed in whatever timezone you set here. If your
> department is in the Eastern time zone, select `America/New_York`. Central is
> `America/Chicago`. Make sure this is correct — members will see event times,
> shift schedules, and deadlines in this timezone."

**[SCREEN: Select a timezone from the dropdown]**

**[CALLOUT: "All times are stored as UTC, displayed in your local timezone"]**

> "**Department Logo** — you can upload your department's logo here. This appears
> on the login page, the dashboard header, member ID cards, and reports. PNG or
> SVG format works best. If you don't have one ready, you can always add it
> later in Organization Settings."

**[SCREEN: Click "Next" to proceed]**

**[TRANSITION: Page transition to next step]**

---

## CHAPTER 3: System Owner Account (4:00 – 6:30)

### CREATING THE ADMIN (4:00 – 5:30)

**[SCREEN: The AdminUserCreation (SystemOwnerCreation) page loads.]**

> "Now we create the System Owner account. This is the first user in the
> system — the person who has full administrative access to everything. In The
> Logbook's permission model, this maps to the 'IT Manager' position, which
> has the wildcard permission — meaning access to every feature, every setting,
> every module."

**[CALLOUT: "System Owner = IT Manager position = full access (wildcard *)"]**

> "A quick note on best practice: this account should belong to whoever is
> responsible for managing the technology in your department. It might be you,
> it might be the person who handles your website or IT. After setup, you'll
> create additional accounts for other officers — Chief, President, Secretary —
> but this first account is the keys to the kingdom."

**[SCREEN: Fill in the form fields]**

> "Enter the first name, last name, and email address. The email is used for
> login and for password recovery if you configure email later."

**[SCREEN: Type "Alex" / "Rivera" / "alex.rivera@anytown-vfd.org"]**

> "**Set a strong password.** The system enforces minimum complexity — at least
> twelve characters, with a mix of uppercase, lowercase, numbers, and symbols.
> This is a HIPAA-compliant application, so the password requirements are
> intentionally strict."

**[SCREEN: Type a password. Show the strength indicator updating.]**

**[CALLOUT: "Use a password manager — you'll create this password once"]**

### TWO-FACTOR AUTHENTICATION (5:30 – 6:30)

> "After creating the account, you'll be prompted to set up two-factor
> authentication. I *strongly* recommend enabling this, especially for the
> System Owner account."

**[SCREEN: Show the 2FA setup screen with QR code if it appears during
onboarding, or note that it can be enabled after first login.]**

> "The Logbook supports TOTP-based two-factor authentication — that's the same
> standard used by Google Authenticator, Authy, 1Password, and most
> authenticator apps. Scan the QR code with your app, enter the six-digit code
> to verify, and you're set."

> "If you skip this now, you can always enable it later from User Settings.
> But for any account with admin access, I'd set it up right away."

**[SCREEN: Click "Next" to proceed]**

**[TRANSITION: Smooth page transition]**

---

## CHAPTER 4: Authentication & Security Settings (6:30 – 8:30)

### AUTHENTICATION CHOICE (6:30 – 7:30)

**[SCREEN: The AuthenticationChoice page loads showing authentication method
options.]**

> "Next, choose how your members will log in. The Logbook supports several
> authentication methods."

**[SCREEN: Show each option with a brief highlight]**

> "**Email and Password** — the simplest option. Members get an email address
> and password. This is what most volunteer departments will use."

> "**LDAP / Active Directory** — if your department already uses Active
> Directory (maybe through your municipality), members can log in with their
> existing network credentials. This requires some server configuration."

> "**OAuth / Single Sign-On** — supports Microsoft Azure AD and Google OAuth.
> If your department uses Microsoft 365 or Google Workspace, members can use
> their existing Microsoft or Google account to log in."

> "**SAML** — for organizations with enterprise identity providers."

**[CALLOUT: "Most volunteer departments → Email & Password. Career departments
with IT infrastructure → LDAP or OAuth."]**

> "For this walkthrough, I'll go with Email and Password. You can add additional
> authentication methods later from the Settings page without disrupting
> existing accounts."

**[SCREEN: Select "Email and Password" and click Next]**

### IT TEAM & BACKUP ACCESS (7:30 – 8:30)

**[SCREEN: The ITTeamBackupAccess page loads.]**

> "This step lets you configure backup access — who gets emergency access if the
> System Owner is unavailable. In a fire department context, think of this as
> your succession plan for platform access."

> "You can add additional email addresses that will receive a backup access code
> during setup. These aren't full admin accounts — they're an emergency recovery
> mechanism."

**[SCREEN: Optionally add a backup email or skip]**

> "If your department has a shared leadership email or a Deputy Chief who should
> have recovery access, add their email here. Otherwise, you can skip this and
> handle it through the normal role assignment process later."

**[SCREEN: Click "Next"]**

**[TRANSITION: Page transition]**

---

## CHAPTER 5: Module Selection (8:30 – 12:00)

### THE MODULE OVERVIEW (8:30 – 9:30)

**[SCREEN: The ModuleOverview page loads — a grid/list of all available modules
with toggle switches, organized by category.]**

> "This is one of the most important steps — choosing which modules to enable.
> The Logbook is fully modular. You only turn on what your department actually
> needs. No clutter, no unused features taking up space in the navigation."

> "Modules are organized into categories."

**[SCREEN: Scroll through the modules slowly, showing each category]**

**[CALLOUT: Category labels appearing as you scroll]**

> "**Core modules** are the essentials — Member Management, Events & RSVP,
> Documents & Files, and Custom Forms. These are enabled by default because
> almost every department needs them."

> "**Operations modules** cover Training & Certifications, Equipment &
> Inventory, Scheduling & Shifts, Apparatus & Fleet, and Facilities Management.
> These are recommended — turn on the ones that match your operations."

> "**Governance modules** include Elections & Voting, Meeting Minutes, and
> Reports & Analytics. If your department elects officers, takes meeting minutes,
> or needs reporting, enable these."

> "**Communication modules** cover Email Notifications and Mobile App Access."

> "**Advanced modules** include External Integrations and the Prospective
> Members Pipeline."

### CHOOSING YOUR MODULES (9:30 – 11:00)

> "Let me give you some practical guidance on what to enable based on department
> type."

**[CALLOUT: Three department profiles side by side]**

> "**Small volunteer department** — 15 to 40 members. Enable the four core
> modules, plus Training, Events, and maybe Elections. Keep it simple. You can
> always add more later."

> "**Mid-size department** — 40 to 100 members. Add Scheduling, Inventory, and
> Apparatus tracking. At this size, coordinating shifts and equipment manually
> gets painful."

> "**Large department or multi-station** — 100+ members. Enable everything.
> You'll want Facilities Management for tracking multiple stations, full
> analytics for reporting, and the Prospective Members pipeline if you're
> actively recruiting."

**[SCREEN: Toggle on a selection of modules for a mid-size department demo:
Members, Events, Documents, Forms, Training, Inventory, Scheduling, Apparatus,
Elections, Minutes]**

> "For this demo, I'm going to enable a typical mid-size department setup. I'm
> leaving off Facilities Management and some of the advanced modules — we can
> always turn them on later."

### MODULE CONFIGURATION (11:00 – 12:00)

**[SCREEN: After selecting modules, the ModuleConfigTemplate page loads for
each enabled module in sequence.]**

> "After selecting your modules, you'll walk through a quick configuration page
> for each one. These are the module-specific settings — things like default
> event types, training requirement categories, inventory classification
> schemes."

> "Don't overthink these. They're all changeable later from the Settings page.
> The defaults are sensible for most departments, so if you're not sure, just
> go with the defaults and customize once you've used the system for a few
> weeks."

**[SCREEN: Show one or two module config screens briefly, then click through
the rest]**

> "I'll click through these quickly — we'll cover the detail of each module in
> the role-specific videos later in this series."

**[TRANSITION: Progress to next section]**

---

## CHAPTER 6: Position & Permission Setup (12:00 – 15:00)

### UNDERSTANDING POSITIONS (12:00 – 13:00)

**[SCREEN: The RoleSetup (PositionSetup) page loads showing a list of default
positions with permission toggles.]**

> "Now we set up positions and their permissions. This is The Logbook's access
> control system, and it's built specifically for fire department hierarchies."

> "There are two concepts to understand."

**[CALLOUT: Two-column layout]**

> "**Positions** are organizational or operational roles that carry permissions —
> Fire Chief, Captain, President, Secretary, Training Officer, IT Manager. A
> member can hold multiple positions."

> "**Membership Types** are classifications like Active, Retired, Honorary,
> Administrative. Membership types do *not* carry permissions — they're just
> labels for categorization."

**[CALLOUT: "Positions = permissions. Membership Types = classification only."]**

### DEFAULT POSITIONS (13:00 – 14:00)

> "The Logbook ships with default positions for common fire department roles.
> Let me walk through the operational and administrative positions."

**[SCREEN: Scroll through the positions list, highlighting each category]**

> "**Operational Ranks:** Fire Chief, Deputy Chief, Assistant Chief, Captain,
> Lieutenant, Engineer/Driver Operator, and Firefighter. Each has permissions
> appropriate to their rank — the Chief has near-full access, a Firefighter has
> view access to most things."

> "**Administrative Positions:** IT Manager — that's the System Owner with full
> access. President, Vice President, Secretary, Treasurer. These carry
> administrative permissions for things like member management, elections, and
> meeting minutes."

> "**Specialist Positions:** Training Officer, Safety Officer, Quartermaster,
> Scheduling Officer, Apparatus Officer, Facilities Manager, Communications
> Officer, and Membership Committee Chair. Each has permissions scoped to their
> area."

### CUSTOMIZING PERMISSIONS (14:00 – 15:00)

> "You can customize which positions get 'view' versus 'manage' access for each
> module. 'View' means they can see the data but not change it. 'Manage' means
> full create, edit, and delete access."

**[SCREEN: Show expanding a module's permission row and toggling a position
from view to manage or vice versa.]**

> "For example, maybe you want your Lieutenants to manage training records in
> addition to just viewing them. Toggle their Training permission from 'view' to
> 'manage.'"

**[SCREEN: Toggle a permission, showing the change]**

> "The defaults are based on common fire department structures, so they're a
> great starting point. The beauty of this system is that you can adjust
> permissions at any time from the Settings page — you're not locked into
> anything you set during onboarding."

**[CALLOUT: "All permissions can be changed later in Settings → Position
Management"]**

> "You can also create entirely custom positions. If your department has a role
> like 'Social Media Coordinator' or 'Chaplain' that doesn't exist in the
> defaults, add it and assign the appropriate permissions."

**[SCREEN: Click "Next"]**

**[TRANSITION: Move to next section]**

---

## CHAPTER 7: Email & Navigation Configuration (15:00 – 17:00)

### EMAIL PLATFORM CHOICE (15:00 – 16:00)

**[SCREEN: The EmailPlatformChoice page loads.]**

> "Email configuration is optional but recommended. If you enable email, The
> Logbook can send automated notifications — event reminders, training expiration
> warnings, shift schedule updates, and password reset links."

**[SCREEN: Show the email platform options]**

> "You have several options. **SMTP** is the most universal — you can use any
> email provider. Gmail, Outlook, your department's email host — anything with
> SMTP credentials. **Mailgun**, **SendGrid**, and **Amazon SES** are dedicated
> email services that handle high volumes more reliably."

> "For most departments, SMTP with your existing email provider works perfectly
> fine. You only need a dedicated service if you're sending hundreds of emails
> per day."

**[SCREEN: Select SMTP and show the configuration fields]**

> "Enter your SMTP server, port, username, and password. For Gmail, that's
> `smtp.gmail.com` on port 587. You'll need to create an app-specific password
> if you're using Gmail with two-factor authentication."

> "If you're not ready to configure email yet, skip this step. The platform
> works perfectly without it — you just won't get automated notifications."

**[SCREEN: Click through or skip]**

### FILE STORAGE (16:00 – 16:30)

**[SCREEN: The FileStorageChoice page]**

> "Next is file storage — where uploaded documents, photos, and attachments are
> stored. The default is local storage, which saves files directly on your
> server. This works great for most deployments."

> "If you're running in the cloud or want offsite storage, you can choose S3-
> compatible storage — that works with Amazon S3, MinIO, or any S3-compatible
> provider."

**[SCREEN: Select local storage or appropriate option]**

### NAVIGATION STYLE (16:30 – 17:00)

**[SCREEN: The NavigationChoice page]**

> "Finally, choose your navigation style. This controls how the sidebar and main
> navigation appear. The options are designed for different screen sizes and
> preferences — try each one and pick what feels best."

> "Remember, individual users can customize their own navigation preference
> later, so this just sets the default."

**[SCREEN: Select a navigation option and proceed]**

**[TRANSITION: Completion transition]**

---

## CHAPTER 8: Completing Onboarding & Next Steps (17:00 – 19:00)

### ONBOARDING COMPLETE (17:00 – 17:30)

**[SCREEN: The onboarding completion page with a success message and summary
of what was configured.]**

> "And that's it — onboarding is complete! Let's see what we've set up."

**[SCREEN: Show the summary: organization name, modules enabled, positions
configured, etc.]**

> "The Logbook is now configured for your department. Let's click through to the
> dashboard and see what it looks like."

### FIRST LOOK AT THE DASHBOARD (17:30 – 18:00)

**[SCREEN: Click "Go to Dashboard." The main dashboard loads with the sidebar
navigation showing all enabled modules.]**

> "Welcome to your dashboard. You can see the sidebar on the left with all the
> modules you enabled. The main area shows your dashboard widgets — upcoming
> events, recent activity, quick stats."

**[SCREEN: Hover over sidebar items, show the navigation structure]**

> "Right now everything is empty — no members, no events, no training records.
> Let's talk about the first things you should do after onboarding."

### RECOMMENDED FIRST STEPS (18:00 – 19:00)

**[CALLOUT: Numbered list of first steps, appearing one at a time]**

> "**Step one: Add your members.** Go to the Members module and add your
> department roster. You can add members one at a time or use the CSV import for
> bulk upload. Each member needs at least a name, email, and position."

> "**Step two: Assign positions.** Make sure your Chief, officers, and key
> personnel are assigned their correct positions. This controls what they can see
> and do in the platform."

> "**Step three: Create your first event.** Whether it's the next drill night,
> business meeting, or training session, creating an event lets your members
> start RSVPing and checking in."

> "**Step four: Invite your members.** Once accounts are created, send out the
> login credentials. If email is configured, The Logbook can send invitation
> emails automatically."

> "**Step five: Explore.** Click through the modules. The interface is designed
> to be intuitive, and every module has consistent patterns — lists, detail
> views, forms."

**[SCREEN: Quickly click into Members, then Events, then Training to show the
empty but ready state of each]**

> "In the rest of this series, we have detailed guides for every role —
> IT Manager, Fire Chief, Training Officer, Secretary, and the everyday member.
> Each video shows exactly what that role can do and how to do it."

**[CALLOUT: Playlist card showing the role-based video series]**

> "Start with the one that matches your role, and you'll be up and running in no
> time. Thanks for watching, and welcome to The Logbook."

**[SCREEN: End card with subscribe button, next video link, and playlist
link.]**

---

## Clip Extraction Guide

| Clip | Timecode | Standalone Title |
|------|----------|-----------------|
| Organization Setup | 1:30–4:00 | "Setting Up Your Organization in The Logbook" |
| Understanding Positions | 12:00–15:00 | "Fire Department Positions & Permissions Explained" |
| Module Selection | 8:30–12:00 | "Which Modules Should Your Department Enable?" |
| First Steps After Setup | 18:00–19:00 | "5 Things to Do After Setting Up The Logbook" |
