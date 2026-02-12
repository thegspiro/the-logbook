# Prospective Members Pipeline Module

Configurable pipeline for managing prospective member applications from initial interest through conversion to full membership.

## Overview

The Prospective Members module provides a complete applicant tracking system for fire departments and emergency services organizations. It enables membership coordinators to define custom pipelines with multiple stage types, track applicants through the process, and convert successful candidates into members.

### Key Capabilities

- **Configurable Pipeline**: Drag-and-drop stage builder with four stage types (form submission, document upload, election/vote, manual approval)
- **Dual View Modes**: Kanban board with drag-and-drop or sortable paginated table
- **Inactivity Timeout System**: Automatic deactivation with configurable timeouts, per-stage overrides, two-phase warnings, and auto-purge
- **Applicant Lifecycle**: Six statuses (active, on_hold, withdrawn, converted, rejected, inactive) with full audit trail
- **Conversion Flow**: Convert successful applicants to administrative member or probationary member
- **Bulk Operations**: Select multiple applicants for batch advance, hold, or reject actions
- **Cross-Module Integration**: Links to Forms (data collection), Elections (membership votes), and Notifications (alerts)

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
│   └── api.ts                  # API service layer (pipelineService, applicantService)
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
    ├── ProspectiveMembersPage.tsx   # Main page (active/inactive tabs, stats, views)
    └── PipelineSettingsPage.tsx     # Pipeline builder + inactivity configuration
```

### Types

| Type | Description |
|------|-------------|
| `ApplicantStatus` | `'active' \| 'on_hold' \| 'withdrawn' \| 'converted' \| 'rejected' \| 'inactive'` |
| `PipelineStageType` | `'form_submission' \| 'document_upload' \| 'election_vote' \| 'manual_approval'` |
| `InactivityTimeoutPreset` | `'3_months' \| '6_months' \| '1_year' \| 'never' \| 'custom'` |
| `InactivityAlertLevel` | `'normal' \| 'warning' \| 'critical'` |
| `PipelineTab` | `'active' \| 'inactive'` |

### Key Interfaces

| Interface | Description |
|-----------|-------------|
| `Pipeline` | Pipeline definition with stages and inactivity config |
| `PipelineStage` | Stage with name, type, description, and optional timeout override |
| `Applicant` | Full applicant record with activity timestamps and deactivation info |
| `ApplicantListItem` | Lightweight applicant for list views with alert level |
| `InactivityConfig` | Pipeline-level inactivity settings |
| `PipelineStats` | Aggregated statistics including inactive/warning counts |

### Constants

| Constant | Description |
|----------|-------------|
| `TIMEOUT_PRESET_DAYS` | Maps presets to day counts: 3_months=90, 6_months=180, 1_year=365, never/custom=null |
| `TIMEOUT_PRESET_LABELS` | Human-readable labels for timeout presets |
| `DEFAULT_INACTIVITY_CONFIG` | Default config: 3_months, 80% warning, coordinator notifications on |

---

## Pipeline Configuration

### Stage Types

| Type | Icon | Description | Integration |
|------|------|-------------|-------------|
| `form_submission` | FileText | Applicant completes a form | Links to Forms module |
| `document_upload` | Upload | Applicant uploads required documents | File storage |
| `election_vote` | Vote | Membership votes on applicant | Links to Elections module |
| `manual_approval` | CheckCircle | Coordinator manually approves | Internal action |

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
- **Type**: One of the four stage types above
- **Inactivity timeout override**: Optional custom timeout (in days) for this specific stage

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
| Advance | Active | Moves applicant to the next pipeline stage |
| Hold | Active | Sets status to on_hold |
| Reject | Active, On Hold | Sets status to rejected |
| Reactivate | Inactive | Returns applicant to active status |
| Convert | Active (final stage) | Creates member record, sets status to converted |

### Conversion

When an applicant reaches the final pipeline stage and is approved:

1. Coordinator clicks "Convert to Member" in the detail drawer or action menu
2. Conversion modal appears with membership type selection:
   - **Administrative Member**: Non-operational support role
   - **Probationary Member**: New member in probationary period
3. On confirmation, the system:
   - Creates a new member record in the membership module
   - Sets the applicant status to `converted`
   - Records the conversion timestamp

---

## Statistics

The stats bar on the main page shows six metrics:

| Metric | Description |
|--------|-------------|
| Total Active | Count of applicants with `status = 'active'` |
| Converted | Count of applicants with `status = 'converted'` |
| Avg Days to Convert | Average days from application to conversion (converted applicants only) |
| Conversion Rate | Converted / (Total - Active - On Hold) |
| Approaching Timeout | Active applicants in warning or critical alert state |
| Inactive | Count of applicants with `status = 'inactive'` |

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
| `activeTab` | `PipelineTab` | Current tab (`'active'` or `'inactive'`) |
| `inactiveApplicants` | `ApplicantListItem[]` | Inactive applicants for current page |
| `inactiveTotalApplicants` | `number` | Total inactive count |
| `inactiveCurrentPage` / `inactiveTotalPages` | `number` | Inactive list pagination |
| `stats` | `PipelineStats \| null` | Aggregated pipeline statistics |
| `selectedApplicant` | `Applicant \| null` | Currently selected applicant for detail drawer |
| Loading flags | `boolean` | `isLoading`, `isLoadingInactive`, `isReactivating`, `isPurging` |

### Actions

| Action | Description |
|--------|-------------|
| `fetchPipeline()` | Load current pipeline with stages |
| `fetchApplicants(page?)` | Load active applicants with pagination |
| `fetchInactiveApplicants(page?)` | Load inactive applicants with pagination |
| `fetchStats()` | Load pipeline statistics |
| `advanceApplicant(id)` | Move applicant to next stage |
| `holdApplicant(id)` | Put applicant on hold |
| `rejectApplicant(id)` | Reject applicant |
| `reactivateApplicant(id)` | Reactivate inactive applicant |
| `purgeInactiveApplicants(pipelineId, data)` | Permanently delete inactive applicants |
| `updateInactivitySettings(pipelineId, config)` | Update pipeline inactivity configuration |
| `setActiveTab(tab)` | Switch between active/inactive tabs |

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
| `POST` | `/api/v1/prospective-members/applicants/{id}/hold` | `manage` | Put on hold |
| `POST` | `/api/v1/prospective-members/applicants/{id}/reject` | `manage` | Reject applicant |
| `POST` | `/api/v1/prospective-members/applicants/{id}/reactivate` | `manage` | Reactivate inactive applicant |
| `POST` | `/api/v1/prospective-members/applicants/{id}/convert` | `manage` | Convert to member |

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

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#prospective-members-module-issues) for common issues including:

- Inactivity timeout not triggering
- Applicants incorrectly marked inactive
- Cannot reactivate an applicant
- Pipeline statistics showing unexpected values
- Purge operation safety guidance

---

**Document Version**: 1.0
**Last Updated**: 2026-02-12
**Maintainer**: Development Team
