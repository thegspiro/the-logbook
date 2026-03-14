# Prospective Members Pipeline Module

Configurable pipeline for managing prospective member applications from initial interest through conversion to full membership.

## Overview

The Prospective Members module provides a complete applicant tracking system for fire departments and emergency services organizations. It enables membership coordinators to define custom pipelines with multiple stage types, track applicants through the process, and convert successful candidates into members.

### Key Capabilities

- **Configurable Pipeline**: Drag-and-drop stage builder with seven stage types (form submission, document upload, election/vote, manual approval, automated email, form dropdown, meeting)
- **Dual View Modes**: Kanban board with drag-and-drop or sortable paginated table
- **Inactivity Timeout System**: Automatic deactivation with configurable timeouts, per-stage overrides, two-phase warnings, and auto-purge
- **Applicant Lifecycle**: Six statuses (active, on_hold, withdrawn, converted, rejected, inactive) with full audit trail
- **Withdraw / Archive**: Applicants can voluntarily withdraw; withdrawn applications are archived and reactivatable
- **Election Package Integration**: Auto-generates election packages when applicants reach an election_vote stage, bundling applicant data for the secretary to build a ballot
- **Desired Membership Type**: Applicants indicate their preferred membership type (regular or administrative) via the interest form; coordinators can change it inline at any pipeline stage
- **Conversion Flow**: Convert successful applicants to regular member (starts as probationary) or administrative member, pre-filled from the applicant's desired membership type
- **Bulk Operations**: Select multiple applicants for batch advance, hold, or reject actions
- **Cross-Module Integration**: Links to Forms (data collection), Elections (membership votes via election packages), and Notifications (alerts)

---

## Architecture

### Frontend Module Structure

```
frontend/src/modules/prospective-members/
├── index.ts                    # Module barrel export
├── routes.tsx                  # Route definitions with lazy-loaded pages
├── types/
│   └── index.ts                # All TypeScript types, enums, constants, helpers
├── services/
│   └── api.ts                  # API service layer (pipelineService, applicantService, electionPackageService)
├── store/
│   └── prospectiveMembersStore.ts  # Zustand store with full state management
├── components/
│   ├── index.ts                # Component barrel exports
│   ├── PipelineBuilder.tsx     # Drag-and-drop stage configuration
│   ├── PipelineKanban.tsx      # Kanban board view
│   ├── PipelineTable.tsx       # Table view with sorting and pagination
│   ├── ApplicantCard.tsx       # Card component for kanban columns
│   ├── ApplicantDetailDrawer.tsx # Slide-out applicant details panel
│   ├── ConversionModal.tsx     # Convert applicant to member modal
│   └── StageConfigModal.tsx    # Stage configuration with timeout overrides
└── pages/
    ├── ProspectiveMembersPage.tsx   # Main page (active/inactive/withdrawn tabs, stats, views)
    └── PipelineSettingsPage.tsx     # Pipeline builder + inactivity configuration
```

### Types

| Type | Description |
|------|-------------|
| `ApplicantStatus` | `'active' \| 'on_hold' \| 'withdrawn' \| 'converted' \| 'rejected' \| 'inactive'` |
| `PipelineStageType` | `'form_submission' \| 'document_upload' \| 'election_vote' \| 'manual_approval' \| 'automated_email' \| 'form_dropdown' \| 'meeting'` — see [Stage Types](#stage-types) for details on each |
| `InactivityTimeoutPreset` | `'3_months' \| '6_months' \| '1_year' \| 'never' \| 'custom'` |
| `InactivityAlertLevel` | `'normal' \| 'warning' \| 'critical'` |
| `PipelineTab` | `'active' \| 'inactive' \| 'withdrawn'` |
| `TargetMembershipType` | `'regular' \| 'administrative'` |
| `ElectionPackageStatus` | `'draft' \| 'ready' \| 'added_to_ballot' \| 'elected' \| 'not_elected'` |

### Key Interfaces

| Interface | Description |
|-----------|-------------|
| `Pipeline` | Pipeline definition with stages and inactivity config |
| `PipelineStage` | Stage with name, type, description, and optional timeout override |
| `Applicant` | Full applicant record with activity timestamps, deactivation, and withdrawal info |
| `ApplicantListItem` | Lightweight applicant for list views with alert level |
| `InactivityConfig` | Pipeline-level inactivity settings |
| `PipelineStats` | Aggregated statistics including inactive/warning/withdrawn counts |
| `ElectionPackage` | Bundled applicant data for election ballot creation |
| `ElectionPackageFieldConfig` | Configurable fields for what info to include in election packages |

### Constants

| Constant | Description |
|----------|-------------|
| `TIMEOUT_PRESET_DAYS` | Maps presets to day counts: 3_months=90, 6_months=180, 1_year=365, never/custom=null |
| `TIMEOUT_PRESET_LABELS` | Human-readable labels for timeout presets |
| `DEFAULT_INACTIVITY_CONFIG` | Default config: 3_months, 80% warning, coordinator notifications on |
| `DEFAULT_ELECTION_PACKAGE_FIELDS` | Default included fields: email, documents, stage history on; phone, address, DOB off |

---

## Pipeline Configuration

### Stage Types

| Type | Icon | Description | Integration |
|------|------|-------------|-------------|
| `form_submission` | FileText | Applicant completes a form | Links to Forms module |
| `document_upload` | Upload | Applicant uploads required documents | File storage |
| `election_vote` | Vote | Membership votes on applicant | Links to Elections module via election packages |
| `manual_approval` | CheckCircle | Coordinator manually approves | Internal action |
| `automated_email` | Mail | Sends configurable email to applicant | Email template selection, variable interpolation, send delay |
| `form_dropdown` | ListChecks | Links a form from Forms module for data collection | Links to Forms module via dropdown selector |
| `meeting` | Calendar | Schedule interview or orientation meeting | Links to Events module; auto-links upcoming events |

### Quick Presets (StageConfigModal)

The StageConfigModal includes quick presets for common stage configurations:

| Preset | Type | Description |
|--------|------|-------------|
| President Interview | `meeting` | Pre-configured meeting stage for scheduling a president/chief interview with the applicant |

### Pipeline Builder

The Pipeline Builder (on the Pipeline Settings page) allows coordinators to:

1. **Add stages** using the "Add Stage" button with type selector
2. **Reorder stages** via drag-and-drop
3. **Configure stages** by clicking the pencil icon to open StageConfigModal
4. **Remove stages** with the trash icon
5. **Save pipeline** to persist changes

Each stage can be configured with:
- **Name**: Display name for the stage
- **Description**: Optional description explaining the stage's purpose
- **Type**: One of the seven stage types above
- **Inactivity timeout override**: Optional custom timeout (in days) for this specific stage
- **Auto-advance** (form_submission and document_upload only): When enabled, the prospect is automatically advanced to the next stage when the form is submitted or all required documents are uploaded. Toggled via checkbox: "Auto-advance when form is submitted" / "Auto-advance when documents are uploaded". Default: off
- **Election package fields** (election_vote only): Choose which applicant data to include in election packages (email, phone, address, DOB, documents, stage history, custom coordinator prompt)
- **Email configuration** (automated_email only): Configure email subject, welcome message, FAQ link, next meeting details, custom sections (title + content), and application status tracker. Email is automatically sent when a prospect advances to this stage
- **Form selection** (form_dropdown only): Choose a form from the Forms module for applicant data collection via dropdown selector
- **Event linking** (meeting and others): Link a stage to a specific event for scheduling. Meeting stages auto-link the next upcoming event matching the stage configuration
- **Status page visibility**: Toggle whether the stage appears on the public application status page

---

## Event Linking (2026-03-12)

Coordinators can link upcoming department events to individual applicants in the pipeline, enabling tracking of interviews, orientations, and meetings.

### How It Works

1. **Manual linking**: From the ApplicantDetailDrawer, coordinators can search and link any upcoming event to an applicant
2. **Auto-linking**: When a pipeline stage of type `meeting` activates for an applicant, the system automatically links the next upcoming event that matches the stage configuration
3. **Linked event display**: The ApplicantDetailDrawer shows all linked events with date, time, type, and status

### Database Model

| Table | Description |
|-------|-------------|
| `prospect_event_links` | Links applicants to events with `prospect_id` (FK), `event_id` (FK), `stage_id` (FK, nullable), `linked_by` (FK users), `created_at` |

### API Endpoints

```
GET    /api/v1/membership-pipeline/prospects/{id}/events       # List linked events
POST   /api/v1/membership-pipeline/prospects/{id}/events       # Link an event
DELETE /api/v1/membership-pipeline/prospects/{id}/events/{eid}  # Unlink an event
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| No matching events when meeting stage activates | No link created; coordinator prompted to schedule manually |
| Linked event is cancelled | Shows "Cancelled" badge on applicant's event list |
| Multiple applicants linked to same event | Supported (e.g., group orientation) |
| Event link deleted | Only removes the link; event itself is unchanged |
| Applicant converted to member | Event links are preserved for audit trail |

---

## Inactivity Timeout System

### How It Works

```
Normal ──(warning threshold)──> Warning ──(timeout reached)──> Inactive ──(purge days)──> Purged
  ^                                                                |
  |                                                                |
  +────────────────── (reactivate) ────────────────────────────────+
```

1. **Normal**: Applicant has recent activity within the timeout window
2. **Warning**: Applicant's idle time has passed the warning threshold percentage (default 80%)
3. **Inactive**: Applicant's idle time has exceeded the timeout — automatically deactivated
4. **Purged**: If auto-purge is enabled, inactive applicants are permanently deleted after the purge period

### Configuration

Pipeline-level inactivity settings are configured on the Pipeline Settings page:

| Setting | Default | Description |
|---------|---------|-------------|
| Timeout Preset | 3 months (90 days) | How long before an idle applicant is deactivated |
| Custom Timeout Days | — | Used when preset is "custom" |
| Warning Threshold | 80% | When to show amber warning indicators |
| Notify Coordinator | true | Send notification to coordinator when applicant approaches timeout |
| Notify Applicant | false | Send notification to applicant when approaching timeout |
| Auto-Purge Enabled | false | Automatically purge inactive applicants after a period |
| Purge Days After Inactive | 365 | Days after deactivation before auto-purge |

### Per-Stage Overrides

Individual stages can override the pipeline default timeout. This is useful for stages that naturally take longer:

- **Background checks**: May take weeks longer than normal stages
- **Election/voting**: Scheduled elections may have fixed timing
- **Document collection**: Applicants may need time to gather required documents

To set a per-stage override:
1. Open stage configuration (pencil icon in Pipeline Builder)
2. Check "Use a custom timeout for this stage"
3. Enter the number of days

The effective timeout for an applicant is determined by: `stage override > pipeline default > null (no timeout)`

Helper function: `getEffectiveTimeoutDays(config)` returns the computed timeout in days, or `null` if set to "never".

### Visual Indicators

| Alert Level | Color | Where Shown | Description |
|-------------|-------|-------------|-------------|
| Normal | — | — | No indicator |
| Warning | Amber | Card border, card banner, table icon | "Activity slowing" — approaching timeout |
| Critical | Red | Card border, card banner, table icon | "Approaching timeout" — near deactivation |

### Reactivation

**Coordinator reactivation:**
1. Navigate to the Inactive tab on the main page
2. Click "Reactivate" on an individual applicant, or
3. Select multiple applicants and use bulk reactivate
4. Alternatively, open the applicant detail drawer and click "Reactivate"

**Self-service reactivation:**
- An applicant can resubmit an interest form (via the Forms module)
- The system recognizes the existing application and reactivates it

### Auto-Purge

When enabled, auto-purge permanently deletes inactive applicant records after the configured period.

**Security rationale:**
- Fire department applications contain private information (names, emails, phones, documents)
- Retaining old data unnecessarily increases the impact of potential security incidents
- Auto-purge helps comply with data minimization principles
- The purge confirmation modal warns: "Purging permanently deletes applicant data and cannot be undone"

---

## Applicant Lifecycle

### Statuses

| Status | Badge Color | Description |
|--------|-------------|-------------|
| `active` | Emerald | Actively progressing through the pipeline |
| `on_hold` | Amber | Temporarily paused by coordinator |
| `withdrawn` | Slate | Applicant withdrew their application |
| `converted` | Blue | Successfully converted to a member |
| `rejected` | Red | Application was rejected |
| `inactive` | Slate (dark) | Deactivated due to inactivity timeout |

### Actions

| Action | Available When | Effect |
|--------|---------------|--------|
| Advance | Active | Moves applicant to the next pipeline stage; auto-creates election package if target is election_vote stage; auto-sends email if target is automated_email stage |
| Regress | Active (not first stage) | Moves applicant back to the previous pipeline stage; resets that stage's progress to `IN_PROGRESS`. Logged as `prospect_regressed` |
| Hold | Active | Sets status to on_hold |
| Reject | Active, On Hold, Inactive | Sets status to rejected |
| Withdraw | Active, On Hold | Sets status to withdrawn; archives the application |
| Reactivate | Inactive, Withdrawn | Returns applicant to active status at their previous stage |
| Convert | Active (final stage) | Creates member record, sets status to converted |

### Withdraw / Archive

When an applicant (or their coordinator) decides to withdraw from the process:

1. Click "Withdraw" in the detail drawer or table action menu
2. Confirm the withdrawal in the confirmation prompt (optional reason field)
3. The application moves to the **Withdrawn** tab
4. Withdrawn applicants can be reactivated by a coordinator at any time

The Withdrawn tab on the main page shows all withdrawn applications with name, last stage, withdrawal date, and reason.

### Desired Membership Type

Each applicant has an optional `desired_membership_type` field (`'regular'` or `'administrative'`) indicating what kind of membership they are seeking. The options are presented as **Regular Member** (starts as probationary) and **Administrative Member** (non-operational role). "Probationary" is not offered as a direct choice since it is a transitional status that all regular members pass through, not a membership type applicants select.

**Setting it via forms:** When a Membership Interest Form includes a "Membership Type" question, the answer is auto-mapped to `desired_membership_type` using the form field label mapping system. Recognized labels include: `membership type`, `desired membership type`, `type of membership`, `member type`, `regular or administrative`.

**Changing it in the pipeline:** The Applicant Detail Drawer displays the current membership type as a pair of toggle buttons between the Contact Info and Application Data sections. A coordinator can click the alternate type to change it at any time. The change takes effect immediately via an inline API update.

**How it flows through to conversion:** The Conversion Modal reads the applicant's `desired_membership_type` to pre-select the membership type. If the applicant never specified a type, it defaults to regular. When converting, selecting "Regular Member" creates the member with `probationary` membership status (since all regular members begin with a probationary period).

### Conversion

When an applicant reaches the final pipeline stage and is approved:

1. Coordinator clicks "Convert to Member" in the detail drawer or action menu
2. Conversion modal appears with membership type pre-selected from the applicant's desired membership type:
   - **Regular Member**: Starts as probationary — all regular members go through a probationary period
   - **Administrative Member**: Non-operational support role
3. The coordinator can override the pre-selected type if needed
4. On confirmation, the system:
   - Creates a new member record in the membership module
   - Sets the applicant status to `converted`
   - Records the conversion timestamp

---

## Election Package Integration

When a pipeline includes an `election_vote` stage, the system automatically creates an **election package** when an applicant advances to that stage. This bridges the Prospective Members and Elections modules.

### How It Works

```
Applicant advances to election_vote stage
  → Election package auto-created (status: draft)
  → Coordinator reviews and edits package
  → Coordinator marks package as "Ready for Ballot" (status: ready)
  → Secretary picks up ready packages in Elections module
  → Secretary adds to ballot (status: added_to_ballot)
  → Election completes (status: elected / not_elected)
```

### Election Package Contents

An election package bundles the following applicant data (configurable per stage):

| Field | Default | Description |
|-------|---------|-------------|
| Applicant name | Always | Full name snapshot at package creation |
| Desired membership type | Always | Administrative or probationary (from applicant's `desired_membership_type`) |
| Target role | Always | If assigned |
| Email | On | Applicant's email address |
| Phone | Off | Applicant's phone number |
| Address | Off | Applicant's mailing address |
| Date of birth | Off | Applicant's date of birth |
| Documents | On | All uploaded documents from previous stages |
| Stage history | On | Summary of completed stages and dates |
| Coordinator notes | Editable | Internal notes (not shown to voters) |
| Supporting statement | Editable | Statement shown on ballot or to voters |
| Custom fields | Editable | Additional key-value pairs |

### Configuring Package Fields

In the Stage Configuration Modal for an `election_vote` stage:
1. Scroll to the "Election Package Contents" section
2. Toggle which applicant fields to include
3. Optionally set a custom coordinator prompt

### Package Statuses

| Status | Description |
|--------|-------------|
| `draft` | Package created, coordinator can edit notes and statement |
| `ready` | Coordinator submitted package; available for secretary to add to ballot |
| `added_to_ballot` | Secretary has added this candidate to an election ballot |
| `elected` | Applicant was elected by membership vote |
| `not_elected` | Applicant was not elected |

### Recommended Ballot Item

Each package includes a `recommended_ballot_item` pre-configured from the stage's election settings (voting method, victory condition, anonymous voting, eligible voter roles). The secretary can use these as defaults when building the ballot.

### API Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/prospective-members/applicants/{id}/election-package` | `view` | Get election package for applicant |
| `POST` | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage` | Create election package |
| `PATCH` | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage` | Update election package |
| `GET` | `/api/v1/prospective-members/election-packages` | `view` | List election packages (with status/pipeline filters) |

---

## Statistics

The stats bar on the main page shows up to seven metrics:

| Metric | Description |
|--------|-------------|
| Total Active | Count of applicants with `status = 'active'` |
| Converted | Count of applicants with `status = 'converted'` |
| Avg Days to Convert | Average days from application to conversion (converted applicants only) |
| Conversion Rate | Converted / (Total - Active - On Hold) |
| Approaching Timeout | Active applicants in warning or critical alert state |
| Inactive | Count of applicants with `status = 'inactive'` |
| Withdrawn | Count of applicants with `status = 'withdrawn'` (shown when > 0) |

**Important**: An annotation below the stats bar states: "Statistics include active applicants only. Inactive, rejected, and withdrawn applicants are excluded from conversion rate and averages."

---

## Permissions

| Permission | Description |
|-----------|-------------|
| `prospective_members.view` | View pipeline, applicant list, and details |
| `prospective_members.manage` | Full CRUD: modify pipeline, advance/reject/reactivate applicants, configure settings, purge |

### Default Role Assignments

| Role | Permission |
|------|-----------|
| IT Administrator | Full access (wildcard) |
| Secretary | `prospective_members.manage` |
| Membership Coordinator | `prospective_members.manage` |

---

## Zustand Store

The `useProspectiveMembersStore` manages all module state:

### State

| Field | Type | Description |
|-------|------|-------------|
| `currentPipeline` | `Pipeline \| null` | Current pipeline with stages and config |
| `applicants` | `ApplicantListItem[]` | Active applicants for current page |
| `totalApplicants` | `number` | Total active applicant count |
| `currentPage` / `totalPages` | `number` | Active list pagination |
| `activeTab` | `PipelineTab` | Current tab (`'active'`, `'inactive'`, or `'withdrawn'`) |
| `inactiveApplicants` | `ApplicantListItem[]` | Inactive applicants for current page |
| `inactiveTotalApplicants` | `number` | Total inactive count |
| `inactiveCurrentPage` / `inactiveTotalPages` | `number` | Inactive list pagination |
| `withdrawnApplicants` | `ApplicantListItem[]` | Withdrawn applicants for current page |
| `withdrawnTotalApplicants` | `number` | Total withdrawn count |
| `withdrawnCurrentPage` / `withdrawnTotalPages` | `number` | Withdrawn list pagination |
| `currentElectionPackage` | `ElectionPackage \| null` | Election package for currently viewed applicant |
| `stats` | `PipelineStats \| null` | Aggregated pipeline statistics |
| `currentApplicant` | `Applicant \| null` | Currently selected applicant for detail drawer |
| Loading flags | `boolean` | `isLoading`, `isLoadingInactive`, `isLoadingWithdrawn`, `isLoadingElectionPackage`, `isReactivating`, `isPurging`, `isWithdrawing` |

### Actions

| Action | Description |
|--------|-------------|
| `fetchPipeline()` | Load current pipeline with stages |
| `fetchApplicants(page?)` | Load active applicants with pagination |
| `fetchInactiveApplicants(page?)` | Load inactive applicants with pagination |
| `fetchStats()` | Load pipeline statistics |
| `advanceApplicant(id)` | Move applicant to next stage; auto-creates election package for election_vote stages; auto-sends email for automated_email stages |
| `regressApplicant(id, notes?)` | Move applicant back to previous stage; resets previous stage progress to IN_PROGRESS |
| `holdApplicant(id)` | Put applicant on hold |
| `rejectApplicant(id)` | Reject applicant |
| `withdrawApplicant(id, reason?)` | Withdraw/archive applicant from pipeline |
| `reactivateApplicant(id)` | Reactivate inactive or withdrawn applicant |
| `fetchWithdrawnApplicants(page?)` | Load withdrawn applicants with pagination |
| `fetchElectionPackage(applicantId)` | Load election package for current applicant |
| `updateElectionPackage(applicantId, data)` | Save election package edits |
| `submitElectionPackage(applicantId)` | Mark election package as ready for ballot |
| `purgeInactiveApplicants(pipelineId, data)` | Permanently delete inactive applicants |
| `updateInactivitySettings(pipelineId, config)` | Update pipeline inactivity configuration |
| `setActiveTab(tab)` | Switch between active/inactive/withdrawn tabs |

---

## API Endpoints

### Pipeline Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/prospective-members/pipelines` | `view` | List pipelines |
| `POST` | `/api/v1/prospective-members/pipelines` | `manage` | Create pipeline |
| `GET` | `/api/v1/prospective-members/pipelines/{id}` | `view` | Get pipeline with stages |
| `PATCH` | `/api/v1/prospective-members/pipelines/{id}` | `manage` | Update pipeline (including inactivity config) |
| `POST` | `/api/v1/prospective-members/pipelines/{id}/stages` | `manage` | Add stage |
| `PATCH` | `/api/v1/prospective-members/pipelines/{id}/stages/{stageId}` | `manage` | Update stage |
| `DELETE` | `/api/v1/prospective-members/pipelines/{id}/stages/{stageId}` | `manage` | Remove stage |
| `POST` | `/api/v1/prospective-members/pipelines/{id}/purge-inactive` | `manage` | Purge inactive applicants |

### Applicant Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/prospective-members/applicants` | `view` | List applicants (with filtering, pagination) |
| `POST` | `/api/v1/prospective-members/applicants` | `manage` | Create applicant |
| `GET` | `/api/v1/prospective-members/applicants/{id}` | `view` | Get applicant details |
| `PATCH` | `/api/v1/prospective-members/applicants/{id}` | `manage` | Update applicant |
| `POST` | `/api/v1/prospective-members/applicants/{id}/advance` | `manage` | Advance to next stage |
| `POST` | `/api/v1/membership-pipeline/prospects/{id}/regress` | `manage` | Move back to previous stage |
| `POST` | `/api/v1/prospective-members/applicants/{id}/hold` | `manage` | Put on hold |
| `POST` | `/api/v1/prospective-members/applicants/{id}/reject` | `manage` | Reject applicant |
| `POST` | `/api/v1/prospective-members/applicants/{id}/withdraw` | `manage` | Withdraw applicant from pipeline |
| `POST` | `/api/v1/prospective-members/applicants/{id}/reactivate` | `manage` | Reactivate inactive or withdrawn applicant |
| `POST` | `/api/v1/prospective-members/applicants/{id}/convert` | `manage` | Convert to member |
| `GET` | `/api/v1/prospective-members/applicants/{id}/election-package` | `view` | Get election package |
| `POST` | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage` | Create election package |
| `PATCH` | `/api/v1/prospective-members/applicants/{id}/election-package` | `manage` | Update election package |

### Election Package Endpoints (Cross-Module)

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/prospective-members/election-packages` | `view` | List election packages (filterable by pipeline_id, status) |

### Statistics Endpoint

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/prospective-members/stats` | `view` | Get pipeline statistics |

### Query Parameters (Applicant List)

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | `number` | Page number (default: 1) |
| `per_page` | `number` | Items per page (default: 20) |
| `status` | `string` | Filter by status |
| `stage_id` | `string` | Filter by current stage |
| `search` | `string` | Search by name or email |
| `sort_by` | `string` | Sort field |
| `sort_order` | `'asc' \| 'desc'` | Sort direction |
| `include_inactive` | `boolean` | Include inactive applicants in results |

---

## Automated Email System (2026-03-14)

When a prospect advances to an `automated_email` stage, the system automatically sends a configurable email to the applicant's email address.

### Email Configuration (StageConfigModal)

Each `automated_email` stage supports the following configuration in the stage config:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `email_subject` | `string` | "Update on Your Membership Application" | Email subject line |
| `include_welcome` | `boolean` | `false` | Include a welcome/introduction section |
| `welcome_message` | `string` | — | Custom welcome text (shown when include_welcome is true) |
| `include_faq_link` | `boolean` | `false` | Include a link to the department FAQ |
| `faq_url` | `string` | — | URL to the FAQ page |
| `include_next_meeting` | `boolean` | `false` | Include next meeting details |
| `next_meeting_details` | `string` | — | Meeting date, time, and location text |
| `custom_sections` | `array` | `[]` | Array of `{title, content, enabled}` sections |
| `include_status_tracker` | `boolean` | `false` | Include a link to the application status page |

### How It Works

```
Prospect advances to automated_email stage
  → System loads stage email config
  → Builds HTML email from configured sections
  → Sends via organization's SMTP settings
  → Logs success/failure in prospect activity log
```

### Email Pipeline Architecture

- **Background scheduler**: A background loop in `main.py` polls for pending scheduled emails every 60 seconds
- **Redis coordination**: Uses Redis lock (`lock:run_scheduled_emails`, TTL 120s) to prevent concurrent workers from processing the same emails
- **Worker claim**: A single worker claims the scheduler role via Redis key; claim is released on shutdown and auto-expires on crash
- **Batch processing**: Processes up to 100 pending emails per cycle
- **SMTP provider support**: Gmail (STARTTLS, port 587), Office 365 (STARTTLS, port 587), self-hosted (SSL on 465 or plain on 25)

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Organization has no SMTP settings configured | Email sending is skipped with a warning log; stage advancement is not blocked |
| Email sending fails (SMTP error) | Email marked as `FAILED` with error message; prospect still advances |
| Multiple workers running | Redis lock ensures only one worker processes emails at a time |
| Worker crashes while holding Redis claim | Claim auto-expires after TTL; next cycle reclaims |
| Application shutdown | Redis claim key is explicitly deleted |
| Empty custom section content | Section is omitted from email body |
| HTML in user-provided content | All content is HTML-escaped before inclusion in email template |

---

## Auto-Advance (2026-03-14)

Form submission and document upload stages support auto-advance, which automatically moves the prospect to the next pipeline stage when the stage's condition is met.

### Configuration

In the Stage Configuration Modal:
- **Form submission stages**: Check "Auto-advance when form is submitted"
- **Document upload stages**: Check "Auto-advance when documents are uploaded"

The setting is stored as `auto_advance: boolean` in the stage's `FormStageConfig` or `DocumentStageConfig`.

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Auto-advance disabled (default) | Coordinator must manually advance the prospect |
| Auto-advance enabled, form submitted | Prospect automatically moves to next stage |
| Auto-advance enabled, last stage | Auto-advance does not trigger conversion — coordinator must manually convert |
| Stage config missing auto_advance field | Treated as `false` (defaults to off) |

---

## Stage Regression (2026-03-14)

Coordinators can move a prospect back to the previous pipeline stage using the "Move Back" action in the Applicant Detail Drawer.

### How It Works

1. Coordinator clicks "Move Back" in the applicant detail drawer
2. Optionally enters notes explaining the reason
3. System moves prospect to the previous step
4. Previous step's progress is reset to `IN_PROGRESS`
5. Activity is logged as `prospect_regressed` with source and target stage details

### API

```
POST /api/v1/membership-pipeline/prospects/{prospect_id}/regress
Body: { "notes": "optional reason" }
Response: ProspectResponse
```

### Edge Cases

| Scenario | Behavior |
|----------|----------|
| Prospect is at the first stage | Regression is blocked; prospect returned unchanged |
| Prospect is on hold or inactive | Regression only applies to active prospects |
| Repeated regression | Prospect can be regressed multiple times until reaching the first stage |
| Audit trail | All regressions are logged in the prospect's activity history with user, timestamp, and notes |

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#prospective-members-module-issues) for common issues including:

- Inactivity timeout not triggering
- Applicants incorrectly marked inactive
- Cannot reactivate an applicant
- Pipeline statistics showing unexpected values
- Purge operation safety guidance
- Withdraw/archive not appearing
- Election package not auto-created
- Election package stuck in draft
- Form submissions not appearing in pipeline *(fixed 2026-03-04)*
- Reprocessed submissions not updating prospects *(fixed 2026-03-04)*
- Duplicate prospects not detected *(fixed 2026-03-04)*
- ProspectResponse metadata returning SQLAlchemy MetaData object *(fixed 2026-03-04)*
- Automated email not sending when prospect advances to email stage *(fixed 2026-03-14)*
- SMTP credentials not decrypted before use *(fixed 2026-03-13)*
- IntegrityError when system performs automated pipeline actions *(fixed 2026-03-13)*
- Custom section add/edit not persisting in email config *(fixed 2026-03-13)*
- Scheduled email displaying UTC time instead of local time *(fixed 2026-03-14)*
- Scheduled email loop giving up permanently on stale Redis claim *(fixed 2026-03-14)*

---

## Recent Changes (March 2026)

### March 14, 2026
- **Auto-advance for form submission and document upload stages**: New `auto_advance` config option in `FormStageConfig` and `DocumentStageConfig`. Checkbox in StageConfigModal. When enabled, prospects automatically advance when the form is submitted or documents are uploaded
- **Stage regression (move back)**: New `POST /regress` endpoint and "Move Back" action in the Applicant Detail Drawer. Moves prospect to previous stage, resets progress to `IN_PROGRESS`, logs as `prospect_regressed`
- **Automated email trigger on advance**: Advancing a prospect to an `automated_email` stage now automatically sends the configured email with subject, welcome message, FAQ link, next meeting details, custom sections, and status tracker
- **Email pipeline fixes**: Fixed email not sending on advance, Redis claim recovery, polling interval reduced to 60s, Redis key cleanup on shutdown

### March 13, 2026
- **SMTP provider compatibility**: Fixed sending for Gmail (STARTTLS/587), Office 365 (STARTTLS/587), and self-hosted SMTP servers (SSL/465, plain/25). New `EMAIL_USE_SSL` env var
- **SMTP credential decryption**: Encrypted SMTP passwords are now decrypted before connection
- **Email config from onboarding**: SMTP settings configured during onboarding are persisted to organization settings
- **IntegrityError fix**: Automated actions use `None` instead of `'system'` for `performed_by` FK
- **Custom section reliability**: Fixed custom section add/edit persistence in pipeline email configuration
- **Route ordering**: `GET /scheduled` moved before `GET /{template_id}` to prevent route conflicts
- **Scheduled email date/time fixes**: Removed UTC-based future checks; display times in user's local timezone
- **Message history cleanup**: Added cleanup, date filtering, and email validation to scheduled email pipeline
- **New stage types**: `form_dropdown` (links a Forms module form via dropdown) and `meeting` (schedule interview/orientation with auto-event linking and President Interview preset)

### March 6, 2026
- **Desired membership type field**: Added `desired_membership_type` column to `ProspectiveMember` model (nullable `String(50)`) to track whether an applicant wants to be a regular or administrative member. Options presented as "Regular Member" (starts as probationary) and "Administrative Member" — probationary is not offered as a direct choice since it is a transitional status
- **Form field auto-mapping**: Added label mappings (`membership type`, `desired membership type`, `type of membership`, `member type`) in `prospect_fields.py` so Membership Interest Forms auto-populate the field
- **Inline editing in detail drawer**: Added toggle buttons in the Applicant Detail Drawer between Contact Info and Application Data sections, allowing coordinators to change the desired membership type at any pipeline stage
- **Conversion pre-fill**: The Conversion Modal now pre-selects the membership type from the applicant's `desired_membership_type` instead of always defaulting to probationary
- **Pipeline table column**: The "Target Type" column in the sortable pipeline table displays the applicant's desired membership type

### March 4, 2026
- **Form-to-pipeline integration hardening (13 improvements)**: Label-based field mapping fallback, server-side validation, reprocessing fix, O(N) cleanup query optimization, field compatibility checks, step update lifecycle fix
- **Duplicate prospect detection**: Email-based duplicate detection with coordinator email notification
- **Pipeline form validation**: Pre-save field compatibility check warns about form field / pipeline mapping mismatches
- **Form deletion protection**: Forms linked to active pipelines protected from deletion
- **form.integration_type**: Direct label-mapping path for pipeline integrations
- **ProspectResponse metadata fix**: Changed from `alias="metadata"` to `serialization_alias="metadata"` — Pydantic now reads `metadata_` (JSON column) instead of `metadata` (SQLAlchemy MetaData object)
- **Modal click-through fix**: Modal backdrop no longer intercepts clicks on dialog buttons

---

**Document Version**: 1.4
**Last Updated**: 2026-03-14
**Maintainer**: Development Team
