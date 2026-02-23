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

1. **Add a Prospect** - Click **Add Prospect** and fill in their basic information (name, email, phone, interest reason).
2. **Complete Steps** - Each pipeline stage has steps (action items, checkboxes, notes). Mark steps as completed as the prospect progresses.
3. **Advance** - Move the prospect to the next stage when all required steps are complete.
4. **Upload Documents** - Attach application documents, ID copies, or other requirements to the prospect's record.
5. **Transfer to Member** - When the prospect is approved, click **Transfer to Membership** to convert them to a full member account.

> **Screenshot placeholder:**
> _[Screenshot of a prospect detail drawer showing the prospect's info at the top, the current pipeline stage, step checklist with some items completed, and the "Transfer to Membership" button]_

### Pipeline Configuration

Navigate to **Administration > Members > Pipeline Settings** to:

- Create and customize pipelines
- Add, remove, or reorder stages
- Configure step types (Action, Checkbox, Note)
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

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Email already in use" when adding a member | Each member must have a unique email. Check if the email belongs to an existing or archived member. |
| Member cannot log in after creation | Ensure the welcome email was sent, or manually share the temporary password. Check that the member's status is Active. |
| CSV import rows failing | Review the error details in the preview. Common issues: duplicate emails, missing required fields, date format (use YYYY-MM-DD). |
| Prospect not showing in pipeline | Check the pipeline filter. Prospects may be in a different pipeline or have a status of Withdrawn/Transferred. |
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

**Previous:** [Getting Started](./00-getting-started.md) | **Next:** [Training & Certification](./02-training.md)
