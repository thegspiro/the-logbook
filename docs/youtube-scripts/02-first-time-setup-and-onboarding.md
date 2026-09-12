# Script 2: First-Time Setup & Onboarding Walkthrough

**Video Type:** Deep Dive
**Estimated Length:** 20–24 minutes
**Target Audience:** Department leadership, IT admins, whoever is setting up the system
**Prerequisites:** The Logbook is installed and running (see Script 1)
**Chapters:** 11 (each cuttable as a standalone clip)

> **PRODUCTION NOTE — 2026-09-11. This script was restructured, not edited.**
> The setup wizard was reordered on 2026-09-11 and the chapter order here now
> follows it. **Do not cut this from the previous take.** Five things in the
> old script are wrong rather than stale:
>
> 1. The old Chapter 2 told viewers that closing the browser ends the run and
>    that a refilled form is a dead session. **A lapsed setup is resumable
>    now** — that whole caution block was replaced.
> 2. Authentication was narrated at 6:30, third from the start. It is **step
>    10**, near the end, and has moved to Chapter 9.
> 3. The authentication beat listed **LDAP / Active Directory** and **SAML**.
>    **Neither is implemented.** Do not reuse that footage.
> 4. There were no chapters for **Stations** and **Apparatus** — steps 5 and 6.
> 5. The navigation beat said individual members can set their own layout.
>    **It is a department-wide setting.**
>
> Three beats are new: the **prerequisites screen**, **member numbering** in
> step 1, and the **rank and tier ladders** in step 4.

---

## CHAPTER 1: Introduction (0:00 – 1:15)

### HOOK (0:00 – 0:20)

**[SCREEN: Browser open to The Logbook's Welcome page — the onboarding wizard
greeting screen with the logo and "Welcome to The Logbook" text.]**

> "Your Logbook is installed and running. Now let's turn it into _your_
> department's platform. The onboarding wizard walks you through everything step
> by step, and in this video, I'm going to walk you through the wizard — with
> tips on what to pick and why."

### WHAT WE'RE DOING (0:20 – 1:15)

**[CALLOUT: Numbered list of the eleven onboarding steps]**

> "Here's the flow, and the order matters because it was designed around what a
> department can actually answer. First your organization. Then the
> administrator account — second, so that everything after it belongs to a real
> signed-in person. Then what your department _uses_: your modules, your ranks
> and positions, your stations, your apparatus. Then the things that send you
> off to find a credential — email, file storage, how people sign in — and
> every one of those can be skipped and done later. Last, your navigation
> layout."

**[CALLOUT: "11 steps · only 2 are required"]**

> "Only two steps are actually required: the organization, and the
> administrator account. Everything else is optional, the wizard tells you so
> up front, and you can come back to any of it from Settings."

**[TRANSITION: Click "Get Started" on the Welcome page]**

---

## CHAPTER 2: Before You Start & Organization Setup (1:15 – 5:00)

### WHAT SETUP WILL ASK FOR (1:15 – 2:15)

**[SCREEN: `/onboarding/prepare` — the Setup Prerequisites screen, showing both
lists: what setup requires and what it will ask for but can skip.]**

> "Before the wizard asks you anything, it tells you what it's going to ask
> for. This screen collects nothing — it's a packing list."

**[CALLOUT: Arrow to the two lists — "Required" and "Optional"]**

> "The reason it exists is worth saying out loud. The install checks used to
> tell you the database was up, and then nothing told you what was coming. So
> people started setup, hit a step wanting an SMTP password or an OAuth client
> secret, and left to go and find it. Walking away is what used to end the
> install."

> "That's no longer true — and this is the other thing to know before you
> start."

**[CALLOUT: "A lapsed setup is resumable (2026-09-11)"]**

> "Setup used to run in one tab, in one sitting. Thirty idle minutes and the
> run was over — the wizard would refuse to issue a new session once your
> organization existed, and there was no way back short of dropping the
> database. That's fixed. If you get called out on a job halfway through, you
> can come back and pick it up."

> "Two things to know about resuming. Before the administrator account exists,
> anyone who reaches the wizard can continue it — that's by design, there's
> nobody to authenticate as yet. **After** that account exists, only that
> person can resume. Your setup session stops being the thing that proves
> you're allowed to finish, which is what stops a half-built department being
> taken over by whoever finds it."

> "And if you see 'Onboarding has already been completed' — that's a different
> message entirely. It means a department already exists on this install. Sign
> in rather than setting up again."

> "So: have your department's address, your station list, your apparatus list
> and the first administrator's details in front of you. Give yourself an
> uninterrupted half hour if you can. But it's no longer a disaster if you
> can't."

**[SCREEN: Click "Start setup"]**

### ORGANIZATION SETUP (2:15 – 5:00)

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

> "**Member numbers.** This one is easy to skim past and it's the reason this
> question sits in step one rather than on a members screen later."

**[SCREEN: The member numbering controls — the on/off switch, the prefix field,
and the starting number.]**

> "If your department gives members a number, switch this on here and say where
> the sequence starts. The counter only numbers members created **after** it's
> switched on — and this wizard is about to create your administrator account
> in step two and your IT team in step seven."

**[CALLOUT: "Set this now — the counter only numbers accounts created after it
is on"]**

> "Departments that answered this afterwards ended up with their first few
> accounts holding no number at all, and then the roster import starting at the
> number those accounts should have had. Nobody notices until somebody prints a
> badge."

**[SCREEN: Click "Next" to proceed]**

**[TRANSITION: Page transition to next step]**

---

---

## CHAPTER 3: Administrator Account (5:00 – 7:30)

> **EDITOR NOTE (2026-09-11):** this is **step 2** of eleven. The wizard puts
> identity second on purpose — every step after it runs against a signed-in
> session. The narration below is unchanged from the previous take, which
> already had it in this position.

### CREATING THE ADMIN (5:00 – 6:30)

**[SCREEN: The AdminUserCreation (SystemOwnerCreation) page loads.]**

> "Now we create the System Owner account. This is the first user in the
> system — the person who has full administrative access to everything. In The
> Logbook's permission model, this maps to the 'IT Manager' position, which
> has the wildcard permission — meaning access to every feature, every setting,
> every module."

*_[CALLOUT: "System Owner = IT Manager position = full access (wildcard *)"]*_

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

### TWO-FACTOR AUTHENTICATION (6:30 – 7:30)

> "After creating the account, you'll be prompted to set up two-factor
> authentication. I _strongly_ recommend enabling this, especially for the
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

---

## CHAPTER 4: Module Selection (7:30 – 11:00)

> **EDITOR NOTE (2026-09-11): this chapter moved.** Modules are now **step 3**,
> ahead of positions — which is what makes the permission rows in the next
> chapter meaningful, because they are filtered to the modules chosen here.

### THE MODULE OVERVIEW (7:30 – 8:30)

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

### CHOOSING YOUR MODULES (8:30 – 10:00)

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

### WHAT ENABLING A MODULE DOES (10:00 – 11:00)

**[SCREEN: Stay on the module overview. Show the enabled cards with their green
Enabled state.]**

> "Enabling is the whole step — there's no per-module questionnaire to sit
> through. Turning a module on makes it appear in the navigation for everyone
> whose position can see it, and that's it."

> "Who can _manage_ each module is the step you already did — positions. And
> every module's own settings, the detail like event types or training
> requirement categories, live inside that module once you're in the app.
> They're all changeable later, so nothing here is a decision you're stuck
> with."

**[SCREEN: Briefly show Settings → Modules]**

> "And if you skip something now, this same list is under Settings → Modules.
> A department that decides in March it wants the store can turn it on in
> March."

**[TRANSITION: Progress to next section]**

---

---

## CHAPTER 5: Ranks, Tiers & Positions (11:00 – 15:30)

### YOUR MEMBERSHIP LADDER (11:00 – 12:15)

**[SCREEN: Step 4 opens on the membership tier ladder — the stages, with the
per-stage controls beside each.]**

> "Step four is three things, and the first one is new to setup. This is your
> **membership ladder** — the stages a member moves through, and what each one
> lets them do."

**[SCREEN: Rename a stage; reorder two; add one]**

> "Rename them to whatever your bylaws call them — Probationary, Active,
> Senior, Life. Set the years each one requires. Reorder them, add your own,
> remove any you don't have."

**[SCREEN: Expand one stage to show its controls]**

> "Per stage you decide: can these members vote in elections, can they hold
> elected office, do they have to meet a meeting-attendance threshold before
> they can vote — and what that threshold is, over what period — and are they
> exempt from training."

**[CALLOUT: "⚠️ Check this against your bylaws — it decides your ballot
electorate"]**

> "This is the one to check against your bylaws, and I'd stop the video and go
> and get them. It decides who's in the electorate for every election you ever
> run. Departments that leave the shipped arrangement alone usually find that
> out at their first election, which is a bad time to find it out."

**[SCREEN: The automatic advancement switch]**

> "One more: automatic advancement is **on** by default, and a monthly job acts
> on it. If your department promotes by vote, by application, or on a date of
> its own choosing, turn it off here."

> "The same editor lives at Members, Administration, Settings, Membership Tiers
> after setup — so this isn't your only chance."

### YOUR RANK LADDER (12:15 – 13:15)

**[SCREEN: The rank ladder editor, pre-filled with the ranks the chosen agency
type usually has.]**

> "Next, your **rank ladder**. The Logbook starts you from the ranks your kind
> of agency usually has, and you change them to match what you actually use."

**[SCREEN: Rename a rank; reorder; remove one; add one]**

> "Rename a rank to your own vocabulary — an EMS service calling it Driver or
> Operator, a department whose Captain is really a Company Officer. Reorder the
> ladder. Remove ranks you don't have. Add your own — Battalion Chief,
> Firefighter Two."

**[SCREEN: The seat assignment control on one rank]**

> "And set which shift seats each rank can fill — including a seat your
> department invented, which is new."

**[CALLOUT: "A rank = where you sit and which seats you can fill. A position =
what you can do."]**

> "Keep these two apart in your head. A rank says where somebody sits and which
> seats they can fill. What they can actually **do** in the software comes from
> their position. That's why a rank you add yourself is marked **No default
> permissions** — those members still need a position."

> "This one also has a home after setup: Members, Administration, Settings,
> Operational Ranks."

### UNDERSTANDING POSITIONS (13:15 – 14:15)

**[SCREEN: The RoleSetup (PositionSetup) page loads showing a list of default
positions with permission toggles.]**

> "Now we set up positions and their permissions. This is The Logbook's access
> control system, and it's built specifically for fire department hierarchies."

> "There are two concepts to understand."

**[CALLOUT: Two-column layout]**

> "**Positions** are organizational or operational roles that carry permissions —
> Fire Chief, Captain, President, Secretary, Training Officer, IT Manager. A
> member can hold multiple positions."

> "**Membership standing** is a classification, and it is **two facts, not
> one**: a member's **class** — operational, administrative or social — and
> their **status** on the membership ladder — prospective, probationary,
> regular, life, retired. Neither carries permissions. They're labels for
> categorization."

**[CALLOUT: "Positions = permissions. Class + status = classification only."]**

> "Two, not one, because they're independent. A **probationary treasurer** is
> an ordinary thing for a department to have, and until the end of August there
> was nowhere to write it down — the two facts shared a field, so recording one
> erased the other."

**[PRODUCTION NOTE — 2026-08-31. Rewritten for the class/status split. The
previous take listed "Active, Retired, Honorary, Administrative" as one flat
set of membership types; those values mixed a class (administrative) with
statuses (retired) and a value that is now the social class (honorary). Do not
restore the flat list. **Honorary maps to the social class** — that is not a new
judgement, it is what the system already did with honorary members when
deciding shift access.]**

### DEFAULT POSITIONS (14:15 – 15:00)

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
> Officer, and Membership Coordinator. Each has permissions scoped to their
> area."

### CUSTOMIZING PERMISSIONS (15:00 – 15:30)

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

**[SCREEN: The permission rows, showing only the modules enabled in step 3]**

> "One thing you'll notice here that you wouldn't have seen before step three
> moved ahead of this one: **you only get permission rows for the modules you
> turned on.** If you didn't enable Grants and Fundraising, there's no row for
> it. It's a much shorter, much more honest screen than it used to be."

**[CALLOUT: "Permission rows are filtered to the modules you enabled"]**

> "Two smaller things worth knowing. Every position starts ticked to exactly
> what the system seeds it with — so if you press Continue without touching
> anything, **nothing changes**. And if you untick a position you don't want,
> it isn't created."

---

## CHAPTER 6: Stations & Apparatus (15:30 – 17:30)

> **EDITOR NOTE (2026-09-11): this chapter is new.** Steps 5 and 6 have always
> existed in the wizard and were never covered in this script — the previous
> take only mentioned having the lists to hand.

### STATIONS (15:30 – 16:30)

**[SCREEN: The Stations step. The headquarters entry is already there, created
from the address given in step 1.]**

> "Step five is your stations. Notice that headquarters is already here — the
> wizard created it from the address you gave in step one, along with its
> facility and location records."

**[SCREEN: Add a second station]**

> "So this step is for the stations **beyond** headquarters. Plenty of
> departments have exactly one and can skip straight through. If you run two or
> three, add them here — each one becomes a facility and a location, which is
> what lets you assign apparatus to a station, run shifts out of it, and track
> inventory by where it physically is."

**[CALLOUT: "One station? Skip it — headquarters is already created."]**

### APPARATUS (16:30 – 17:30)

**[SCREEN: The Apparatus step, adding a unit.]**

> "Step six: your apparatus. Unit number, type, minimum staffing, and the
> riding positions."

**[SCREEN: Fill in a unit — Engine 1, minimum staffing, riding positions]**

> "These are deliberately lightweight records — enough for shift staffing to
> know that Engine One needs four people and what seats those four sit in. The
> full fleet detail, maintenance history, inspections, all of that lives in the
> Apparatus module afterwards. You're not doing fleet management here, you're
> telling the scheduler what exists."

**[CALLOUT: "Minimum staffing + riding positions = what the scheduler needs"]**

> "If you enabled Shift Scheduling back in step three, this is the step that
> makes it useful on day one. If you didn't, skip it — you can add apparatus
> any time."

**[SCREEN: Click "Next"]**

---

## CHAPTER 7: IT Team & Backup Access (17:30 – 18:30)

> **EDITOR NOTE (2026-09-11): this chapter moved.** It is **step 7**, not step
> 4 as the previous take had it. The narration is otherwise unchanged.

### IT TEAM & BACKUP ACCESS (17:30 – 18:30)

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

---

## CHAPTER 8: Email & File Storage (18:30 – 20:30)

### EMAIL PLATFORM CHOICE (18:30 – 19:45)

**[SCREEN: The EmailPlatformChoice page loads.]**

> "Email configuration is optional but recommended. If you enable email, The
> Logbook can send automated notifications — event reminders, training expiration
> warnings, shift schedule updates, and password reset links."

**[SCREEN: Show the email platform options]**

**[EDITOR NOTE (2026-09-03): REWRITTEN. The previous take said Gmail and
Microsoft 365 "integrate via OAuth or app passwords". There was no working OAuth
path for either — the Client ID / Client Secret fields were decorative, no token
was ever obtained, and the fields have now been removed. Worse, **both platforms
could not send at all** until this window: the form stored credentials under
keys the sender never read. Do not re-use the old footage; the fields it shows
no longer exist.]**

> "You have several options. **Gmail** and **Microsoft 365** send over ordinary
> SMTP with an **app password** — the host, port and encryption are filled in
> for you, so all you supply is the From address and the app password.
> **Self-Hosted SMTP** is the most universal — any provider with SMTP
> credentials. And if your domain is on **Cloudflare**, **Cloudflare Email
> Service** sends via REST API, so you don't need an SMTP server at all;
> Cloudflare handles SPF, DKIM and DMARC automatically."

> "For most departments, Gmail or Microsoft 365 with an app password is the
> easiest path. Cloudflare is a good option if you're already managing your DNS
> there and want a simple setup."

**[SCREEN: Microsoft 365 selected, showing App registration (OAuth) beside App
Password]**

> "Microsoft 365 has one extra choice, and it's worth taking. Exchange Online is
> retiring Basic authentication for SMTP — an app password **is** Basic auth —
> so there's now an **App registration** option that uses a proper Entra ID
> app. If you're setting up Microsoft 365 fresh, start there."

**[SCREEN: Test Connection button and a successful result]**

> "Whichever you pick, finish with **Test Connection**. It signs in to the
> provider without saving, so you find out here rather than the first time the
> system tries to send somebody a password reset."

**[SCREEN: Select SMTP and show the configuration fields]**

> "For SMTP, enter your server, port, username, and password. For Gmail,
> that's `smtp.gmail.com` on port 587. You'll need to create an app-specific
> password if you're using Gmail with two-factor authentication."

**[SCREEN: Select Cloudflare and show the configuration fields]**

> "For Cloudflare, you just need your Account ID — it's on your Cloudflare
> dashboard sidebar — and an API token with email sending permission. No
> server addresses or ports to worry about."

> "If you're not ready to configure email yet, skip this step. The platform
> works perfectly without it — you just won't get automated notifications."

**[SCREEN: Click through or skip]**

### FILE STORAGE (19:45 – 20:30)

**[SCREEN: The FileStorageChoice page]**

> "Next is file storage — where uploaded documents, photos, and attachments are
> stored. The default is local storage, which saves files directly on your
> server. This works great for most deployments."

> "If you're running in the cloud or want offsite storage, you can choose S3-
> compatible storage — that works with Amazon S3, MinIO, or any S3-compatible
> provider."

**[SCREEN: Select local storage or appropriate option]**

**[EDITOR NOTE (2026-09-10): the file-storage choice is recorded but not yet
acted on.** Uploads write to the server's own filesystem whatever is selected
here — nothing outside the settings screen reads the stored credentials. **Do
not narrate this step as though picking S3 or Drive moves the files.** If you
keep a line about it at all, say the choice is saved and the move is still to
do.]**

> "One caveat, and it's an important one. Right now this choice is **recorded**
> rather than acted on — files go to the server's own disk whichever option you
> pick. If you're choosing S3 or Drive specifically so your files sit somewhere
> your server isn't, treat that as still on your list after setup, not done by
> it."

**[SCREEN: Click "Next"]**

---

## CHAPTER 9: Sign-In Method (20:30 – 21:45)

> **EDITOR NOTE (2026-09-11): this chapter moved and was rewritten.** It was
> narrated at 6:30 in the previous take; it is **step 10**. More importantly,
> the old take listed **LDAP / Active Directory** and **SAML** as supported
> options. **Neither is implemented** — LDAP has a config flag that gates
> nothing and there is no SAML path at all. **Do not reuse that footage.**

### SIGN-IN CHOICE (20:30 – 21:45)

**[SCREEN: The AuthenticationChoice page, showing the four options.]**

> "Step ten: how your members sign in. There are four options on this screen
> and I want to be straight with you about what each one actually does today."

**[SCREEN: Highlight each option in turn]**

> "**Local Passwords.** Members get an email address and a password, hashed
> with Argon2id. No external service, nothing to configure. This is what most
> volunteer departments should pick, and it's what I'm picking here."

> "**Sign in with Google.** If your department is on Google Workspace, members
> use their Google account. **Sign in with Microsoft** does the same for
> Microsoft 365, through Entra ID — single tenant."

**[CALLOUT: "Google and Microsoft are link-existing-only — they never create
accounts"]**

> "One thing about both of those that surprises people: they are
> **link-existing-only**. The verified email coming back from Google or
> Microsoft has to match an active member you already created. Signing in with
> Google does not create an account. That's deliberate — it means somebody with
> a Google address can't let themselves into your department."

> "**Authentik.** Don't pick this one yet."

**[CALLOUT: "⚠️ Authentik: selectable, not yet usable"]**

> "It's on the screen, and it is genuinely coming, but there's no sign-in flow
> behind it today — the login page only offers Google and Microsoft. Passwords
> will still work if you pick it, but selecting it **switches your department
> off self-service password resets**, so a member who forgets theirs needs an
> administrator to do it for them. Pick Local unless you're setting up Google
> or Microsoft."

> "And you can add methods later from Settings without disrupting any existing
> account."

**[SCREEN: Select "Local Passwords" and click Next]**

---

## CHAPTER 10: Navigation Layout (21:45 – 22:30)

> **EDITOR NOTE (2026-09-11): rewritten.** The previous take said "individual
> users can customize their own navigation preference later, so this just sets
> the default". **That is wrong in both halves.** It is a department-wide
> setting, and there is no per-member override.

### NAVIGATION LAYOUT (21:45 – 22:30)

**[SCREEN: The NavigationChoice page — top bar versus left sidebar.]**

> "Last step. Navigation across the top, or down the left side. Pick whichever
> your people will find easier."

**[CALLOUT: "This applies to the whole department — there is no per-member
override"]**

> "This one is worth being clear about, because it used to work differently and
> not in a good way. **This is a department-wide setting.** Whatever you pick
> here is what every member sees."

> "Until September eleventh, the answer only ever reached the browser that gave
> it — it was saved in local storage, and the copy that went to the server was
> read by nothing. So the officer running setup saw their choice, and everybody
> else in the department got the default, and there was no screen anywhere to
> change it. That's fixed."

**[EDITOR NOTE: if this script is being re-cut for an audience with existing
installations, add one line here — on upgrade, every department without a
stored layout gets the **left sidebar**, including officers whose browser was
showing the top bar. It is changed at Settings → General → Profile →
Navigation Layout.]**

> "And you can change it afterwards — Settings, General, Profile,
> Navigation Layout. It applies to everyone from their next page load."

**[SCREEN: Select a layout and proceed]**

**[TRANSITION: Completion transition]**

---

## CHAPTER 11: Completing Onboarding & Next Steps (22:30 – 24:30)

### ONBOARDING COMPLETE (22:30 – 23:00)

**[SCREEN: The onboarding completion page with a success message and summary
of what was configured.]**

> "And that's it — onboarding is complete! Let's see what we've set up."

**[SCREEN: Show the summary: organization name, modules enabled, positions
configured, etc.]**

> "The Logbook is now configured for your department. Let's click through to the
> dashboard and see what it looks like."

### FIRST LOOK AT THE DASHBOARD (23:00 – 23:30)

**[SCREEN: Click "Go to Dashboard." The main dashboard loads with the sidebar
navigation showing all enabled modules.]**

> "Welcome to your dashboard. You can see the sidebar on the left with all the
> modules you enabled. The main area shows your dashboard widgets — upcoming
> events, recent activity, quick stats."

**[SCREEN: Hover over sidebar items, show the navigation structure]**

> "Right now everything is empty — no members, no events, no training records.
> Let's talk about the first things you should do after onboarding."

### RECOMMENDED FIRST STEPS (23:30 – 24:30)

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

---

## Clip Extraction Guide

| Clip                    | Timecode    | Standalone Title                                       |
| ----------------------- | ----------- | ------------------------------------------------------ |
| Before You Start Setup  | 1:15–2:15   | "What The Logbook's Setup Wizard Will Ask You For"     |
| Organization Setup      | 2:15–5:00   | "Setting Up Your Organization in The Logbook"          |
| Module Selection        | 7:30–11:00  | "Which Modules Should Your Department Enable?"         |
| Your Membership Ladder  | 11:00–12:15 | "Membership Tiers: The Setting That Decides Who Votes" |
| Your Rank Ladder        | 12:15–13:15 | "Building Your Department's Rank Ladder"               |
| Understanding Positions | 13:15–15:30 | "Fire Department Positions & Permissions Explained"    |
| Stations & Apparatus    | 15:30–17:30 | "Adding Your Stations and Apparatus During Setup"      |
| Sign-In Method          | 20:30–21:45 | "How Should Your Members Sign In?"                     |
| First Steps After Setup | 23:30–24:30 | "5 Things to Do After Setting Up The Logbook"          |

> **EDITOR — re-time before publishing (2026-09-11).** Every timecode above and
> in the chapter headings is a **target, not a measurement**. This script was
> restructured for the reordered wizard and gained three chapters' worth of new
> material (prerequisites, the two ladders, stations and apparatus), so the
> running time moved from roughly 19 minutes to roughly 24. Set the real
> chapter markers and clip timecodes from the recorded take — narration pacing
> determines them.
>
> **Do not cut any of this from the previous take.** The five corrections in
> the production note at the top of this script are behavioural, not cosmetic:
> footage of the old chapter order, the "one tab, one sitting" caution, the
> LDAP/SAML authentication options, or the per-member navigation claim will all
> teach something that is not true.
>
> **"Before You Start Setup" is the highest-value short in this script** and
> now stands alone better than it did, because the prerequisites screen gives
> it something to show rather than only something to warn about.
