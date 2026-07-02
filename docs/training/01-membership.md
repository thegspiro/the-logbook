# Membership Management

The Membership module is the foundation of The Logbook. It manages your department's roster, member profiles, prospective member pipelines, membership tiers, and the full member lifecycle from application through retirement.

---

## Table of Contents

1. [Member Directory](#member-directory)
2. [Member Profiles](#member-profiles)
3. [Adding Members](#adding-members)
4. [Importing Members from CSV](#importing-members-from-csv)
5. [Member Admin Edit](#member-admin-edit)
6. [Member Audit History](#member-audit-history)
7. [Deleting Members](#deleting-members)
8. [Prospective Members Pipeline](#prospective-members-pipeline)
9. [Member Status Management](#member-status-management)
10. [Leave of Absence](#leave-of-absence)
11. [Waiver Management](#waiver-management)
12. [Rank Validation](#rank-validation)
13. [Membership Tiers](#membership-tiers)
14. [Member Lifecycle Management](#member-lifecycle-management)
15. [Troubleshooting](#troubleshooting)

---

## Member Directory

Navigate to **Members** in the sidebar to view your department roster.

The directory shows all active members with their name, rank, status, and contact information. You can:

- **Search** by name using the search bar
- **Filter** by status (Active, Inactive, On Leave, Retired)
- **Click** any member to view their full profile

> **Screenshot placeholder:**
> _[Screenshot of the Members page showing the member list table with columns for name, rank, status, and contact info. Show the search bar at the top and the status filter dropdown]_

**Member Statuses:**

| Status | Description |
|--------|-------------|
| **Active** | Currently serving member |
| **Inactive** | Temporarily not participating |
| **Suspended** | Account suspended by administration |
| **Probationary** | New member in probationary period |
| **Retired** | Retired from active service |
| **Dropped (Voluntary)** | Member who voluntarily left |
| **Dropped (Involuntary)** | Member removed from the department |
| **Archived** | Fully processed departed member |

### Printing Member Badges

Select members in the directory (the row checkboxes), then click **Print Badges** on the selection bar to open the shared label print page for those members. Choose a label size — any sticker/thermal printer (Dymo, Rollo, or a custom size) — and download a PDF or print. The badge barcode encodes the member's **membership number**. The chosen printer is remembered for your role, separately from the inventory/apparatus printers.

> **Screenshot needed:**
> _[Screenshot of the Members directory with several rows checked and the "Print Badges" button highlighted on the selection bar, plus the label print page previewing a member badge with name and a membership-number barcode]_

---

## Member Profiles

Click on any member in the directory to view their profile. The profile page includes:

**Left Column:**
- **Basic Information** - Name, rank, membership number, hire date, station
- **Profile Photo** - Member photo with upload/change capability
- **Compliance Summary** - Green/yellow/red indicator showing training compliance status, requirements met/total, hours this year, active certifications, and expiring certifications
- **Training Records** - Recent training completions and course history
- **Assigned Inventory** - Equipment currently assigned to the member

**Right Column:**
- **Contact Information** - Email, phone, mobile, address (editable by the member or officers)
- **Emergency Contacts** - Emergency contact list
- **Roles & Permissions** - Assigned positions and their permissions
- **Quick Stats** - Training count, total hours, assigned equipment count
- **Leave of Absence** - Any active leave periods (shown if applicable)

> **Screenshot placeholder:**
> _[Screenshot of a member profile page showing the two-column layout. Left side shows profile photo, compliance summary card (green/yellow/red indicator), basic info card, and training records table. Right side shows contact info, emergency contacts, and roles sections]_

### Profile Photo Upload

Members and officers can upload a profile photo:

1. Click the **photo area** on the member's profile (or the camera icon).
2. Select an image file (JPEG, PNG, or WebP).
3. Preview and crop the image.
4. Click **Upload** to save.

> **Screenshot placeholder:**
> _[Screenshot of the photo upload modal showing the image preview with crop controls and Upload/Cancel buttons]_

### Member Self-Edit

Members can edit their own limited profile fields directly from their profile page:

- Phone number, mobile number
- Personal email address
- Home address
- Emergency contacts
- Notification preferences

Click the **Edit** button (pencil icon) on the relevant section to make changes. Officers with `members.manage` permission can edit all fields for any member.

> **Hint:** Members can edit their own contact information and notification preferences. Officers with the `members.manage` permission can edit any member's profile using the full Admin Edit page.

---

## Adding Members

**Required Permission:** `members.manage`

Navigate to **Administration > Members > Member Management**, then click the **Add Member** tab.

1. Fill in the required fields:
   - **First Name** and **Last Name**
   - **Email** (must be unique within the department)
   - **Username** (auto-generated or custom)
2. Optionally set:
   - Rank, station, membership number
   - Hire date
   - Assigned roles/positions
3. Check **Send Welcome Email** to automatically email the new member their login credentials.
4. Click **Create Member**.

> **Screenshot placeholder:**
> _[Screenshot of the Add Member form showing the personal information fields, role assignment section, and the "Send Welcome Email" checkbox at the bottom]_

> **Hint:** The system generates a temporary password for the new member. If you uncheck "Send Welcome Email," you will need to share the credentials manually. The member will be prompted to change their password on first login.

**Edge Cases:**
- If the email address is already in use, you will see an error. Each member must have a unique email within the department.
- Badge numbers and membership numbers must also be unique if provided.

---

## Importing Members from CSV

**Required Permission:** `members.manage`

For bulk onboarding, you can import members from a CSV file:

1. Navigate to **Administration > Members > Import Members**.
2. Download the **CSV template** to see the required column format.
3. Fill in the spreadsheet with your member data.
4. Upload the completed CSV file.
5. Review the **preview** to verify the data looks correct.
6. Confirm the import.

> **Screenshot placeholder:**
> _[Screenshot of the Import Members page showing the file upload area, the download template link, and a preview table of parsed CSV data with validation indicators (green checkmarks for valid rows, red X for errors)]_

**CSV Columns:**
- `first_name`, `last_name` (required)
- `email` (required, must be unique)
- `username`, `phone`, `mobile`
- `rank`, `station`, `membership_number`
- `hire_date` (format: YYYY-MM-DD)

> **Troubleshooting:** If rows fail validation, the preview will highlight the issues. Common problems include duplicate emails, missing required fields, or incorrectly formatted dates.

---

## Member Admin Edit

**Required Permission:** `members.manage`

Navigate to **Members > Admin**, click on a member, then click **Edit** to open the full Admin Edit page at `/members/admin/edit/:userId`.

The Admin Edit page provides complete control over all member fields:

- **Personal Information** - First name, last name, email, username, phone, mobile, address
- **Department Information** - Rank (dropdown from configured operational ranks), station (dropdown from configured stations), membership number, hire date
- **Status Management** - Change member status (Active, Inactive, Suspended, Probationary, etc.) with reason
- **Role Assignment** - Assign or remove positions/roles and their associated permissions
- **Emergency Contacts** - Add, edit, or remove emergency contact entries

> **Screenshot placeholder:**
> _[Screenshot of the Admin Member Edit page showing the form sections: personal info fields at top, department info with rank/station dropdowns, status management section, and role assignment checkboxes]_

> **Hint:** Rank and station fields use dropdowns populated from the organization's configured values, ensuring consistency across all member records.

---

## Member Audit History

**Required Permission:** `members.manage`

Navigate to **Members > Admin**, click on a member, then click **History** to view the full audit trail at `/members/admin/history/:userId`.

The audit history page shows a chronological list of all changes made to a member's record, including:

- **What changed** - Which field was modified (e.g., rank, status, station)
- **Old value → New value** - The before and after values
- **Who made the change** - The user who performed the edit
- **When** - Timestamp of the change

> **Screenshot placeholder:**
> _[Screenshot of the Member Audit History page showing a timeline of changes with entries like "Rank changed from 'Firefighter' to 'Lieutenant' by John Smith on 2026-02-15 14:30"]_

> **Note:** Audit entries are only created for changes made after the audit history feature was deployed. Earlier changes will not appear in the history.

---

## Deleting Members

**Required Permission:** `members.manage`

To permanently delete a member:

1. Navigate to the member's profile or the Admin Edit page.
2. Click the **Delete Member** button (typically at the bottom of the page).
3. A confirmation dialog will appear with clear warnings about the irreversible nature of the action.
4. Type the member's name or confirm to proceed.
5. Click **Delete** to permanently remove the member.

> **Screenshot placeholder:**
> _[Screenshot of the Delete Member confirmation modal showing the warning text "This action cannot be undone. All data associated with this member will be permanently deleted." and the confirmation input field]_

**What gets deleted:**
- Member profile and all personal information
- Training records and certifications
- Inventory assignments (items are unassigned, not deleted)
- Event attendance records
- Shift assignments

> **Important:** Deletion is permanent and cannot be undone. Consider changing the member's status to **Archived** instead if you may need their records in the future. Archived members can be reactivated from the Member Lifecycle page.

---

## Prospective Members Pipeline

**Required Permission:** `members.manage`

The pipeline manages people who are interested in joining but are not yet full members. Navigate to **Administration > Members > Prospective** to access the pipeline.

### Pipeline Views

The pipeline offers two views:

- **Kanban Board** - Drag-and-drop cards through stages
- **Table View** - Traditional list with sorting and filtering

> **Screenshot placeholder:**
> _[Screenshot of the Kanban board view showing pipeline stages as columns (e.g., "Application Received", "Interview Scheduled", "Background Check", "Vote Required", "Approved") with prospect cards in each column]_

### Working with Prospects

1. **Add a Prospect** - Click **Add Prospect** and fill in their basic information (name, email, phone, interest reason, and **desired membership type** — regular or administrative).
2. **Complete Steps** - Each pipeline stage has steps (action items, checkboxes, notes). Mark steps as completed as the prospect progresses.
3. **Advance** - Move the prospect to the next stage when all required steps are complete. If the next stage is an automated email stage, the configured email is sent automatically.
4. **Move Back** - If a prospect needs to return to a previous stage (e.g., missing documents discovered after advancing), click **Move Back** in the prospect's detail drawer. The previous stage's progress is reset to allow re-completion.
5. **Upload Documents** - Attach application documents, ID copies, or other requirements to the prospect's record. Uploaded files are now stored on the prospect's record and can be downloaded later. Each file may be up to **50 MB**; allowed types are PDF, Word (DOC/DOCX), JPEG, PNG, and GIF.

> **[SCREENSHOT NEEDED]:** _The prospect detail drawer's documents area showing an uploaded file in the list with its download link._

6. **Transfer to Member** - When the prospect is approved, click **Transfer to Membership** to convert them to a full member account. The membership type is pre-filled from the prospect's desired type.

> **Screenshot needed:**
> _[Screenshot of the Applicant Detail Drawer showing the "Move Back" button alongside the "Advance" button, with a prospect in the middle of a multi-stage pipeline]_

### Desired Membership Type

Prospective members can indicate their preferred membership type when applying:

| Type | Description |
|------|-------------|
| **Regular** | Standard active membership (starts as probationary) |
| **Administrative** | Non-operational administrative role |

- The desired type is captured on the **Membership Interest Form** template (if used as the intake form)
- Coordinators can change the desired type inline at any pipeline stage by clicking the type badge
- During conversion to full member, the system pre-fills "Regular" or "Administrative" based on the prospect's selection
- Regular members start with probationary status; administrative members start with active status

> **Screenshot needed:**
> _[Screenshot of the Prospective Members pipeline showing a prospect card with the "Regular" membership type badge visible. Also show the inline dropdown that appears when clicking the badge to change it to "Administrative"]_

> **Edge case:** If a prospect's desired membership type is changed from "Regular" to "Administrative" after they have already passed an election/vote stage, the system does not retroactively invalidate the vote. The coordinator should verify that the voting requirements for administrative members were met.

> **Screenshot placeholder:**
> _[Screenshot of a prospect detail drawer showing the prospect's info at the top, the current pipeline stage, step checklist with some items completed, and the "Transfer to Membership" button]_

### Printing Applicant Badges

Select applicants in the pipeline (the checkboxes), then click **Print Badges** on the selection bar — useful for sign-in/check-in at a recruitment or outreach event. It opens the shared label print page; pick a label size and download a PDF or print. The badge barcode encodes the applicant's **status token** (the same scannable code used for public application-status checks), so a scanned badge ties back to that applicant. The outreach team's printer choice is remembered for their role, separately from other modules.

> **Screenshot needed:**
> _[Screenshot of the Prospective Members pipeline with several applicants selected and the "Print Badges" button highlighted on the bulk-action bar, plus the label print page previewing an applicant badge]_

### Pipeline Stage Types

The pipeline supports seven stage types, each tailored to a specific step in the membership process:

| Stage Type | Purpose | What Happens |
|------------|---------|--------------|
| **Form Submission** | Collect information from the applicant | Links to a form from the Forms module. Can auto-advance when the form is submitted |
| **Document Upload** | Collect required documents | Applicant uploads documents (ID, certifications, etc.). Can auto-advance when all documents are uploaded |
| **Election/Vote** | Membership vote | Auto-creates an election package for the Elections module when a prospect reaches this stage |
| **Manual Approval** | Coordinator sign-off | Coordinator manually marks this stage as complete |
| **Automated Email** | Send a notification email | Automatically sends a configurable email when the prospect reaches this stage. Configure subject, welcome message, FAQ link, meeting details, and custom sections |
| **Form Dropdown** | Link an existing form | Select a form from the Forms module via dropdown for data collection |
| **Meeting** | Schedule interview/orientation | Links to upcoming events. Includes a "President Interview" quick preset |

> **Screenshot needed:**
> _[Screenshot of the Stage Configuration Modal showing the stage type selector with all seven options, and the configuration panel for an automated email stage showing the email subject, welcome message toggle, and custom sections]_

### Auto-Advance

Form submission and document upload stages can be configured to **auto-advance** the prospect when the condition is met:

1. Open the stage configuration (pencil icon in Pipeline Builder)
2. Check **"Auto-advance when form is submitted"** or **"Auto-advance when documents are uploaded"**
3. Save the pipeline

When enabled, the prospect automatically moves to the next stage without coordinator intervention.

> **Edge case:** Auto-advance does not trigger conversion at the final stage. A coordinator must always manually convert a prospect to a full member.

### Automated Email Stages

When a prospect advances to an automated email stage, the system sends the configured email immediately. Configure the email in the stage settings:

- **Subject line** — customize per stage
- **Welcome message** — optional introduction section
- **FAQ link** — link to your department's FAQ page
- **Next meeting details** — date, time, and location of the next relevant meeting
- **Custom sections** — add titled content blocks (e.g., "What to Bring", "Parking Information")
- **Status tracker** — link to the application status page

> **Screenshot needed:**
> _[Screenshot of the email configuration panel in the Stage Config Modal, showing the subject field, welcome message toggle with text area, and a custom section with title and content fields]_

> **Edge case:** If your department has not configured SMTP email settings (in Settings > Email or during onboarding), automated emails will be skipped silently. Check **Settings > Email** to verify your SMTP configuration.

### Pipeline Configuration

Navigate to **Administration > Members > Pipeline Settings** to:

- Create and customize pipelines
- Add, remove, or reorder stages (seven stage types available)
- Configure auto-advance, email templates, form links, and event linking per stage
- Set a default pipeline for new prospects
- Enable auto-transfer on final step approval

> **Hint:** You can create multiple pipelines for different scenarios (e.g., "Standard Application", "Lateral Transfer", "Junior Firefighter").

---

## Member Status Management

**Required Permission:** `members.manage`

Officers can change a member's status from their profile page or the Members Admin area.

### Changing a Member's Status

1. Navigate to the member's profile.
2. Click the **status badge** or use the status change action.
3. Select the new status.
4. Provide a **reason** for the change.
5. For drops, optionally:
   - Send a property return notification email
   - Set a return deadline
   - Include custom instructions

> **Screenshot placeholder:**
> _[Screenshot of the status change dialog showing the status dropdown (with options like Active, Inactive, Suspended, Dropped), the reason text field, and the property return options for drop statuses]_

### Property Return Process

When a member is dropped, the system automatically:

1. Generates a **property return report** listing all assigned equipment
2. Sends a reminder email (if configured)
3. Tracks outstanding items
4. Auto-archives the member once all property is returned

> **Hint:** Check the **Overdue Returns** tab on the Member Lifecycle page to see members with outstanding equipment.

---

## Leave of Absence

**Required Permission:** `members.manage`

When a member takes a leave of absence, their time away should be recorded so that rolling-period training and shift requirements are adjusted. Months during a leave are excluded from the denominator when calculating compliance.

### Managing Leaves

Navigate to **Administration > Members > Member Management**, then open the **Member Lifecycle Management** page and select the **Leave of Absence** tab.

1. Click **Add Leave of Absence**.
2. Select the **member** from the dropdown.
3. Choose the **leave type**: Leave of Absence, Medical, Military, Personal, Administrative, or Other.
4. Set the **start date** and **end date**.
5. Optionally provide a **reason**.
6. Click **Create Leave**.

> **Screenshot placeholder:**
> _[Screenshot of the Add Leave of Absence modal showing the member dropdown selector, leave type dropdown, start/end date pickers, and the reason text area]_

### How Leave Affects Requirements

For rolling-period requirements (e.g., "12 hours of training over 12 months"):

- If a member has a 3-month leave, the system adjusts the requirement to 9 hours (12 x 9/12)
- Only **full calendar months** fully covered by the leave are excluded
- Partial months still count (so the member gets credit for time they were active)

### Viewing Leaves

- The **Leave of Absence** tab shows all active (and optionally inactive) leaves across the department
- Individual member profiles show active leaves in the right sidebar
- Toggle **Show inactive leaves** to see historical records

> **Hint:** Deactivating a leave does not delete it -- it becomes inactive and remains in the history. You can toggle "Show inactive leaves" to review past records.

### LOA and Training Waiver Auto-Linking

When a Leave of Absence is created, the system **automatically creates a linked training waiver** with matching dates. This means:

- You do **not** need to separately create a training waiver after creating an LOA
- If the LOA dates are updated, the linked training waiver dates sync automatically
- If the LOA is deactivated, the linked training waiver is also deactivated
- To opt out of auto-linking for a specific leave, set `exempt_from_training_waiver` on the leave (available via the "Meetings & Shifts Only" option in the Waiver Management page)

> For detailed technical documentation on how waivers adjust training compliance, see [Training Waivers & Leaves of Absence](../../backend/app/docs/TRAINING_WAIVERS.md).

---

## Waiver Management

**Required Permission:** `members.manage`

Navigate to **Members > Admin > Waivers** to access the unified Waiver Management page. This page consolidates all waiver types into a single interface.

### Tabs

| Tab | Purpose |
|-----|---------|
| **Active Waivers** | View all currently active waivers across the department |
| **Create Waiver** | Create a new waiver for a member |
| **All Waivers** | View full history including expired and deactivated waivers |

### Creating a Waiver

1. Click the **Create Waiver** tab.
2. Select the **member** from the dropdown.
3. Choose the **Applies To** scope:
   - **All (LOA + Training Waiver)** — Creates a Leave of Absence and automatically links a training waiver. This is the most common choice.
   - **Training Only** — Creates a standalone training waiver without affecting meeting attendance or scheduling.
   - **Meetings & Shifts Only** — Creates a Leave of Absence with training waiver opt-out. Training requirements are not adjusted.
4. Select the **leave type** and set the **date range**.
5. Optionally provide a **reason**.
6. Click **Create Waiver**.

> **Screenshot placeholder:**
> _[Screenshot of the Create Waiver form showing the member dropdown, "Applies To" radio buttons (All, Training Only, Meetings & Shifts Only), leave type selector, date range pickers, and reason text area]_

### Training Waivers Officer View

Training officers can also view training-specific waivers from **Training Admin > Dashboard > Training Waivers** tab. This view includes:

- Summary cards showing Active, Future, Expired, and Total waiver counts
- Filterable table with status badges (Active, Future, Expired, Deactivated)
- Source tracking showing whether each waiver was auto-created from an LOA or manually created
- Links back to the full Waiver Management page

---

## Rank Validation

**Required Permission:** `members.manage`

The rank validation feature helps identify members whose rank does not match any of the organization's configured operational ranks.

### How It Works

The system compares each active member's rank against the organization's configured list of operational ranks. Members whose rank does not match (case-sensitive) are flagged for review.

### Viewing Rank Mismatches

Rank validation results are visible in the **Members Admin Hub**. Members with unrecognized ranks are surfaced with their current rank and the list of valid ranks to choose from.

### Resolving Mismatches

1. Navigate to the flagged member's profile or Admin Edit page.
2. Use the **rank dropdown** to select the correct operational rank.
3. Save the changes.

> **Hint:** If a member's rank is legitimate but not in the system, add it to the organization's operational ranks in **Settings** before correcting individual member records.

---

## Membership Tiers

**Required Permission:** `members.manage`

Membership tiers classify members by their years of service and grant benefits like voting eligibility, office-holding rights, and training exemptions.

### Configuring Tiers

Navigate to the **Member Lifecycle Management** page and select the **Tier Configuration** tab.

1. Click **Add Tier** to create a new tier.
2. Set the **tier name** (e.g., "Senior Member", "Life Member").
3. Set the **years required** for automatic advancement.
4. Configure **benefits**:
   - Voting eligible
   - Can hold office
   - Training exempt
   - Requires meeting attendance for voting

> **Screenshot placeholder:**
> _[Screenshot of the Tier Configuration tab showing two configured tiers (e.g., "Active Member" at 0 years, "Senior Member" at 10 years) with their benefits checkboxes, and the "Add Tier" button at the bottom]_

### Auto-Advancement

Enable **Auto-advance members based on years of service** to automatically promote members when their hire date qualifies them. You can also manually trigger advancement by clicking **Advance Eligible Now**.

---

## Member Lifecycle Management

The **Member Lifecycle Management** page (found under Members Admin) consolidates all lifecycle operations into one view with four tabs:

| Tab | Purpose |
|-----|---------|
| **Archived Members** | View and reactivate members who have been archived |
| **Overdue Returns** | Track members with outstanding property to return |
| **Leave of Absence** | Manage leave periods for active members |
| **Tier Configuration** | Configure membership tiers and auto-advancement |

> **Screenshot placeholder:**
> _[Screenshot of the Member Lifecycle Management page showing the four tab buttons at the top and the Archived Members tab active, displaying a table of archived members with reactivate buttons]_

---

## EVOC Certification on Member Profiles (2026-03-24)

Members can now have an EVOC (Emergency Vehicle Operations Course) certification level tracked on their profile:

| Level | Description |
|-------|-------------|
| Basic | Standard vehicle operation |
| Intermediate | Emergency vehicle operation with lights and sirens |
| Advanced | Specialized apparatus operation (aerials, heavy rescue) |

The EVOC level is set by administrators via the member admin edit page and is used by the Scheduling module to validate driver/operator position assignments against apparatus requirements.

> **Screenshot needed:**
> _[Screenshot of the member admin edit page showing the EVOC Level dropdown (Basic/Intermediate/Advanced) in the certifications section alongside other certification fields]_

> **Edge case:** Members without an EVOC level set can still be assigned to driver/operator positions, but a warning badge appears on the assignment.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Email already in use" when adding a member | Each member must have a unique email. Check if the email belongs to an existing or archived member. |
| Member cannot log in after creation | Ensure the welcome email was sent, or manually share the temporary password. Check that the member's status is Active. |
| CSV import rows failing | Review the error details in the preview. Common issues: duplicate emails, missing required fields, date format (use YYYY-MM-DD). |
| Prospect not showing in pipeline | Check the pipeline filter. Prospects may be in a different pipeline or have a status of Withdrawn/Transferred. |
| Auto-advance not triggering | Verify that "Auto-advance when form is submitted" (or documents uploaded) is checked in the stage configuration. The setting defaults to off. |
| Automated email not sent | Check that SMTP is configured in Settings > Email. Verify the prospect has a valid email address. Check the scheduled email logs for errors. |
| "Move Back" button not visible | The prospect must be on a stage beyond the first. The "Move Back" action is only available for active prospects not at the first stage. |
| Email showing UTC times | Ensure the organization's timezone is configured in Settings > Organization. Scheduled emails display times in the organization's timezone. *(fixed 2026-03-14)* |
| Days-in-stage always shows 0 | Fixed 2026-03-15 — days-in-stage is now computed server-side from the prospect's `updated_at` timestamp. Pull latest and restart. |
| Pipeline email sections in wrong order | As of 2026-03-15, use drag-and-drop to reorder email sections in the pipeline email configuration. The order persists in the `section_order` array. |
| Pipeline email preview not available | Added 2026-03-15 — preview rendered email content before sending from the pipeline email configuration panel. |
| Pipeline overview report not showing | Added 2026-03-15 — enable the pipeline overview report in Reports. Configure stage grouping in Pipeline Settings > Report Stage Groups. |
| SMTP connection error on email send | Verify SMTP settings: Gmail/Office 365 use STARTTLS on port 587 (`EMAIL_USE_SSL=false`); self-hosted servers may use SSL on port 465 (`EMAIL_USE_SSL=true`). *(fixed 2026-03-13)* |
| Member still showing as active after being dropped | The status change may not have been saved. Verify from the member's profile. |
| Property return report not generating | The member must have inventory items assigned. If none are assigned, no report is generated. |
| Membership tier not advancing | Verify the member has a **hire_date** set and that auto-advance is enabled. The member must have an Active status. |
| LOA created but training not adjusted | Check that the LOA does not have `exempt_from_training_waiver` set. The auto-linked training waiver should appear in the Training Waivers tab. If missing, create a standalone waiver from the Waiver Management page. |
| Rank shows as unrecognized in validation | The member's rank must exactly match a configured operational rank (case-sensitive). Edit the member's rank or add the rank to the organization's configuration. |
| Audit history is empty | Audit entries are only tracked for changes made after the feature was deployed. Earlier changes will not appear. |
| Cannot find Admin Edit page | Navigate to Members > Admin, click a member, then click **Edit**. The page is at `/members/admin/edit/:userId`. |
| Photo upload fails | Check the file type (JPEG, PNG, WebP only) and file size. Ensure the backend has sufficient disk space for uploads. |
| Compliance card shows wrong status | Refresh the page. Red = expired certs or <50% requirements met; Yellow = expiring certs or incomplete requirements; Green = fully compliant. |

---

## Department Email Generation, Username Safety & Default Roles (2026-03-24)

### Department Email Generation

When a prospect is elected to full membership (transferred from the prospective pipeline), the system can now **automatically generate a department email address** (e.g., `john.smith@firedept.org`).

**Configuration** (Settings > Organization > Department Email):

| Setting | Description |
|---------|-------------|
| **Enabled** | Toggle department email generation on/off |
| **Domain** | Your department's email domain (e.g., `firedept.org`) |
| **Format** | Choose from 4 patterns (see below) |

**Email Format Patterns:**

| Format | Example |
|--------|---------|
| `first.last` | john.smith@firedept.org |
| `flast` (first initial + last) | jsmith@firedept.org |
| `firstlast` | johnsmith@firedept.org |
| `last.first` | smith.john@firedept.org |

> **Screenshot needed:**
> _[Screenshot of the Organization Settings page showing the "Department Email" section with an enabled toggle, domain field showing "firedept.org", and a format dropdown set to "first.last"]_

The prospect's **personal email** is preserved in the `personal_email` field on their user profile, so you always have a way to contact them outside the department system.

> **Edge case:** If the generated email already exists (e.g., two members named John Smith), the system automatically appends a numeric suffix: `john.smith2@firedept.org`, `john.smith3@firedept.org`, etc.

> **Edge case:** If department email generation is disabled in settings, the prospect's personal email becomes their primary account email.

### Username Collision Handling

When members are created (via admin, self-registration, or prospect transfer), the system now generates unique usernames automatically:

- First attempt: `jsmith` (first initial + last name)
- If taken: `jsmith1`, `jsmith2`, etc.

This prevents registration failures when multiple members share similar names.

> **Edge case:** Manually provided usernames are also validated for uniqueness. If you enter a username that already exists, you'll receive an error asking you to choose a different one.

### Default Member Role

All new members — whether created by an admin, self-registered, or transferred from the prospective pipeline — now receive the **"member" role** automatically. This ensures every member has baseline permissions from day one without requiring manual role assignment.

### Password Security on Creation

All member creation paths now set `password_changed_at` to the creation time, ensuring HIPAA password age checks work correctly from day one. Self-registered users additionally have `must_change_password=True`, forcing a password change on first login.

### Membership ID Auto-Generation

Membership IDs are now auto-generated when a member is created or transferred. Additional safety features:

- When a member is archived (soft-deleted), their membership number is preserved in `previous_membership_number`
- When a member is reactivated, their previous membership number is automatically restored
- The active membership number column is NULLed on archive so the number can be reassigned if needed

> **Screenshot needed:**
> _[Screenshot of a member profile showing the auto-generated Membership ID field (e.g., "2026-0042") in the member details section, with the field marked as read-only]_

> **Edge case:** If a member is archived and then a new member is assigned their old number, reactivating the archived member will generate a new number instead of conflicting.

### Troubleshooting Additions (2026-03-24)

| Issue | Solution |
|-------|----------|
| Department email shows collision error | System auto-resolves by appending numeric suffix. If issue persists, check for deleted users with the same email. |
| Username "already exists" on admin create | Choose a different username or let the system auto-generate one. |
| New member has no permissions | All members now get the "member" role automatically. If still no access, verify the role exists in Settings > Roles. |
| Member reactivated but old membership number not restored | Number is restored only if no other active member has been assigned that number since archival. |

---

## Realistic Example: New Member Onboarding (End-to-End)

This walkthrough follows a single applicant — **Alex Rivera** — from first contact through the end of their third month at **Oakville Fire Department (OFD)**. It touches six modules (Membership, Elections, Inventory, Medical, Training, Scheduling) and highlights the cross-module data flows that make The Logbook more than a collection of independent tools.

**Personas:**

| Person | Role |
|--------|------|
| **Alex Rivera** | New applicant, later Probationary Firefighter |
| **Lt. Morrison** | Membership Coordinator |
| **Capt. Davis** | Training Officer |
| **Lt. Walsh** | Quartermaster (Inventory) |
| **Secretary Sarah Kim** | Election administrator |
| **Capt. Alvarez** | Health & Safety Officer |

---

### Part 1: Application (January 5)

Alex discovers OFD's recruitment page and submits an interest form through the **public portal**.

1. Lt. Morrison opens **Administration > Members > Prospective** and clicks **Add Prospect**. She enters Alex's name, email, phone, and sets the desired membership type to **Regular**.
2. The prospect card appears in the Kanban board at **Stage 1: Interest Form** (a Form Submission stage linked to the Membership Interest Form in the Forms module).
3. Because Stage 1 is configured as an **Automated Email** follow-up, the system sends Alex a welcome email containing a status tracker link and instructions for completing the interest form.
4. Alex clicks the link, fills out the interest form online, and submits it.
5. The stage has **auto-advance** enabled, so Alex's card automatically moves to **Stage 2: Application Review**.

**Edge case — duplicate detection:** When Lt. Morrison creates the prospect, the system detects an archived member with the last name "Rivera" but a different email address. A duplicate warning banner appears on the prospect drawer. Lt. Morrison reviews the archived record, confirms this is a different person, and dismisses the warning. The prospect proceeds normally.

> **[SCREENSHOT NEEDED]:** _The Prospective Members Kanban board showing Alex Rivera's card in Stage 2: Application Review, with the duplicate warning banner visible at the top of the prospect detail drawer._

---

### Part 2: Background Check & Interview (January 10 -- February 15)

1. Lt. Morrison advances Alex to **Stage 3: Background Check** (a Document Upload stage).
2. The background check takes three weeks. On January 31, the results are uploaded as a PDF document to Alex's prospect record (up to 50 MB, PDF/DOC/DOCX/JPEG/PNG/GIF).
3. With the document uploaded and auto-advance enabled, Alex moves to **Stage 4: Interview** (a Meeting stage linked to the February interview event).

**Interview panel — three officers evaluate Alex:**

| Interviewer | Recommendation | Notes |
|-------------|---------------|-------|
| Capt. Davis | Recommend | "Strong mechanical aptitude, team-oriented" |
| Lt. Hernandez | Recommend | "Excellent communication skills" |
| FF Brooks | Recommend with reservations | "Limited weekday availability — works full-time until May" |

Each interviewer records their recommendation in the prospect's pipeline steps. FF Brooks's reservation is captured as a note on the step but does not block advancement — the pipeline requires a majority "Recommend" to proceed, not unanimity.

4. Lt. Morrison reviews all three recommendations and advances Alex to **Stage 5: Membership Vote**.

**Edge case — reservation handling:** FF Brooks's "Recommend with reservations" is stored in the prospect's history. If a future coordinator reviews Alex's file, the reservation and its context are visible in the audit trail. Reservations do not create a separate approval gate; they are informational.

---

### Part 3: Membership Vote (March Business Meeting)

When Alex reaches the **Election/Vote** stage, the system automatically creates an **election package** in the Elections module. The package includes:

- Alex's name, photo, and desired membership type
- A snapshot of pipeline progress (all stages completed, interviewer recommendations)
- Uploaded documents (background check results, interest form responses)

1. Secretary Sarah Kim opens **Elections** and sees the auto-created package with status **Pending**.
2. She adds Alex to the **March Business Meeting** election ballot.
3. At the meeting, 38 members are present. The vote proceeds:
   - **Yes:** 35
   - **No:** 3
   - **Result:** Approved (simple majority required)
4. Secretary Kim records the results. The election package status changes to **Elected**.
5. Alex's prospect card in the pipeline automatically reflects the election result.

**Edge case — failed vote:** If the vote had been 15-23 (Not Elected), the election package status would change to **Not Elected**. Alex would remain in the pipeline at the Election/Vote stage with the option to re-apply after a configurable waiting period (default: 6 months). Lt. Morrison would see a "Re-application eligible" date on the prospect card.

> **[SCREENSHOT NEEDED]:** _The Elections module showing Alex Rivera's election package with status "Elected", vote tally (35-3), and the linked prospect record._

---

### Part 4: Member Conversion & Gear Assignment (March 16)

#### Conversion to Full Member

1. Lt. Morrison clicks **Transfer to Membership** on Alex's prospect card.
2. The system creates a new user account:
   - **Rank:** Probationary Firefighter
   - **Station:** Station 1
   - **Status:** Probationary
   - **Membership number:** OFD-2026-047 (auto-generated)
   - **Department email:** alex.rivera@oakvillefd.org (auto-generated from the `first.last` pattern)
   - **Personal email:** preserved from the prospect record
   - **Role:** "member" (assigned automatically)
3. A welcome email is sent to Alex's personal email with login credentials and a prompt to change the password on first login.

#### Gear Assignment via Impact Planner

4. Lt. Walsh opens the **Inventory** module and navigates to the **Impact Planner**.
5. He runs an analysis filtered to **Station 1 probationary members needing PPE**.
6. Alex appears in the results as **"Needs item"** for five categories:
   - Turnout coat
   - Turnout pants
   - Helmet
   - Gloves
   - Boots
7. Alex's sizes are not on file. Lt. Walsh clicks **"Request Sizes"** next to Alex's name. The system sends Alex a notification asking them to enter size preferences.
8. Alex logs in for the first time, changes their password, and navigates to **My Equipment > Size Preferences**. Alex enters:
   - Coat: L Regular
   - Pants: 34x32
   - Helmet: 7 1/4
   - Gloves: XL
   - Boots: 11 Wide
9. Lt. Walsh returns to the Impact Planner, sees Alex's sizes are now on file, and clicks **Issue PPE Kit**. The system matches available inventory to Alex's size preferences and creates assignment records.

**Edge case — stock shortage:** XL gloves are out of stock. The system issues a partial kit (coat, pants, helmet, boots) and flags gloves as **"Pending — Out of Stock"**. An automatic reorder request is created in the Inventory module, and Lt. Walsh receives a notification. Alex's equipment profile shows 4 of 5 items assigned with the gloves line item showing a yellow "Backordered" badge.

> **[SCREENSHOT NEEDED]:** _The Impact Planner results showing Alex Rivera with "Needs item" status for five PPE categories, with the "Request Sizes" button visible and size preference fields partially filled._

---

### Part 5: Medical Screening (March 20)

Capt. Alvarez opens the **Medical Screening** module and creates screening records for Alex:

| Screening | Status | Scheduled Date |
|-----------|--------|---------------|
| Annual Physical Exam | Scheduled | March 25 |
| Pre-Employment Drug Screen | Scheduled | March 22 |

**March 22 — Drug Screen:**
- Alex completes the drug screen at the designated facility.
- Capt. Alvarez updates the record: Status changes from **Scheduled** to **Passed**.

**March 25 — Physical Exam:**
- Alex completes the annual physical.
- Capt. Alvarez updates the record: Status changes to **Passed**, Expiration set to **March 25, 2027**.

**Alex's compliance summary** now shows:
- Requirements met: **2 / 2**
- Overall status: **Fully Compliant** (green badge)
- Next expiration: March 25, 2027 (Annual Physical)

**Edge case — failed drug screen:** If the drug screen result had been **Failed**, the screening record would display a red "Failed" badge. Alex's membership would be automatically flagged for HR review. The compliance summary would show **1 / 2 requirements met** with a red "Non-Compliant" status. HR would receive a notification to initiate the department's substance abuse policy procedures.

---

### Part 6: Training Enrollment (March 25)

Capt. Davis opens the **Training** module and enrolls Alex in the **Probationary Firefighter Program** — a Sequential program with four phases:

**Phase 1: Orientation (4 requirements)**
- Department history presentation
- SOPs review and acknowledgment
- Facility tour (all stations)
- Radio procedures and protocol

**Phase 2: Basic Skills (6 requirements)**
- Hose operations (3 observed evolutions)
- Ladder operations (3 observed evolutions)
- SCBA donning and use
- Forcible entry techniques
- Search and rescue procedures
- Ventilation operations

**Phase 3: EMS (3 requirements)**
- CPR/AED certification
- First Responder certification
- Patient assessment competency

**Phase 4: Live Fire (2 requirements)**
- 40 hours supervised fireground operations
- Officer sign-off on fireground competency

Alex completes all four Phase 1 orientation requirements during the first week (March 25--31). Capt. Davis marks each requirement as complete in the training program tracker. Phase 1 status changes to **Complete**, and Phase 2 unlocks (sequential programs require phase completion in order).

**Edge case — prior certification credit:** Alex holds a current CPR/AED certification from a previous employer. Alex uploads the certification card as a training record attachment. Capt. Davis reviews the document, confirms the certification is current and from an accredited provider, and approves it. The Phase 3 CPR/AED requirement is automatically credited — Alex will only need to complete the remaining two EMS requirements when Phase 3 unlocks.

> **[SCREENSHOT NEEDED]:** _The Training Program detail view for Alex Rivera showing Phase 1 (Complete, 4/4), Phase 2 (In Progress, 0/6), Phase 3 (Locked, 1/3 pre-credited), and Phase 4 (Locked, 0/2), with the overall progress bar at 25%._

---

### Part 7: First Shift & Ongoing (April 1)

Alex is assigned to **A Platoon** and works their first shift on April 1 — a 24-hour shift on **Engine 1**.

**Shift completion report filed by the shift officer:**

| Field | Value |
|-------|-------|
| Hours worked | 24 |
| Calls responded | 3 (1 medical, 1 fire alarm, 1 MVA) |
| Skills observed | Hose deployment (Score: 3 — Competent), SCBA donning (Score: 2 — Developing) |
| Tasks completed | Hydrant connection, Equipment inventory |

The shift officer submits the completion report for review. Once approved, the training program is updated automatically:

- **Phase 2 "Hose operations"** — partial credit recorded (1 of 3 required observations completed)
- **Phase 4 "40 hours supervised"** — 24 hours logged toward the 40-hour requirement
- Shift hours are counted in Scheduling toward Alex's monthly attendance

**Edge case — report revision:** The reviewer initially flags the report with a note: "Please add more detail to the SCBA observation — what drills were performed?" The shift officer updates the narrative section with specifics ("Donned SCBA in 90 seconds during morning drill; used SCBA during fire alarm response at 1420"). The reviewer re-reviews and approves the updated report.

**Alex's dashboard after one month shows:**

- **Name:** Alex Rivera
- **Rank:** Probationary Firefighter
- **Station:** Station 1, A Platoon
- **Training:** 25% through Probationary Firefighter Program (Phase 2 in progress)
- **Medical:** 2/2 compliant (physical expires March 2027)
- **Equipment:** All PPE assigned (gloves on backorder)
- **Shifts:** 4 shifts completed, 96 hours logged

---

### Summary: Alex's Status After 3 Months

| Module | Status |
|--------|--------|
| Membership | Probationary Firefighter, Station 1, A Platoon |
| Inventory | Full PPE kit issued (gloves on backorder) |
| Medical | Fully compliant (physical expires March 2027) |
| Training | 25% through Probationary Program (Phase 2) |
| Scheduling | A Platoon, 4 shifts completed, 96 hours logged |
| Finance | Annual dues generated ($100, pending) |

---

### Cross-Module Data Flow

The following diagram shows how data flows between modules during the onboarding process:

```
Prospective Pipeline → converts to → Membership (User record)
                                        ↓
                              Inventory (gear assignment via Impact Planner)
                              Medical Screening (compliance tracking)
                              Training (program enrollment)
                              Scheduling (platoon assignment, shift reports)
                              Finance (dues generation)
                                        ↓
                              Dashboard (unified status view)
```

Key integration points:

- **Pipeline to Membership:** The "Transfer to Membership" action creates a user record, auto-generates a membership number and department email, assigns the default "member" role, and sends the welcome email — all in one step.
- **Pipeline to Elections:** Reaching an Election/Vote pipeline stage auto-creates an election package with the prospect's snapshot and documents.
- **Membership to Inventory:** The Impact Planner queries membership records to identify new members needing gear. Size preferences entered by the member flow into kit assignment matching.
- **Membership to Medical:** New members appear in the Medical Screening module as needing baseline screenings. Compliance status feeds back to the member's profile.
- **Membership to Training:** Program enrollment links the member to a structured curriculum. Shift completion reports auto-credit training requirements.
- **Membership to Scheduling:** Platoon assignment drives shift scheduling. Shift reports flow into training credit and attendance tracking.
- **Membership to Finance:** Member creation triggers dues generation based on the membership tier and billing cycle configured in Finance settings.

---

### Cross-Module Edge Cases

| Scenario | Behavior |
|----------|----------|
| Membership vote fails | Applicant stays in pipeline; can re-apply after configurable waiting period |
| Gear out of stock during onboarding | Partial kit issued; reorder request auto-created; admin notified |
| Drug screen fails | Membership flagged for HR review; medical record shows "Failed" |
| Training program phase requires certification Alex already has | Upload cert as attachment; officer approves; requirement auto-credited |
| Alex goes on leave during probation | Training requirements pro-rated; shifts excluded from compliance |
| Dues not paid by grace period | Status auto-changes to Overdue; late fee applied if configured |

---

**Previous:** [Getting Started](./00-getting-started.md) | **Next:** [Training & Certification](./02-training.md)
