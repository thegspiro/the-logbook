# Medical Screening Module

Track and manage medical screenings, physicals, drug tests, fitness assessments, and psychological evaluations for members and prospective members.

## Overview

The Medical Screening module provides a centralized system for managing regulatory and organizational health screening requirements. It tracks individual screening records, monitors compliance status, and alerts administrators to upcoming expirations.

### Key Capabilities

- **Screening Requirements**: Define organization-level requirements with configurable frequency, role applicability, and grace periods
- **Screening Records**: Track individual screening history with scheduled/completed dates, provider info, results, and reviewer chain
- **Dual-Entity Support**: Records can be linked to active members or prospective members
- **Compliance Tracking**: Per-user and per-prospect compliance summaries showing current, expiring, and overdue screenings
- **Expiring Alerts**: Query screenings expiring within a configurable window (1-365 days)
- **Review Workflow**: Screenings can be reviewed by authorized personnel with timestamp tracking

---

## Architecture

### Frontend Module Structure

```
frontend/src/modules/medical-screening/
├── index.ts                    # Module barrel export
├── routes.tsx                  # Route definitions
├── types/
│   └── index.ts                # TypeScript types and enums
├── services/
│   └── api.ts                  # API service layer
├── store/
│   ├── medicalScreeningStore.ts     # Zustand store
│   └── medicalScreeningStore.test.ts # Store tests
├── components/
│   ├── ComplianceDashboard.tsx      # Compliance overview dashboard
│   ├── ScreeningRecordForm.tsx      # Create/edit screening records
│   └── ScreeningRequirementForm.tsx # Create/edit requirements
└── pages/
    └── MedicalScreeningPage.tsx     # Main module page
```

### Enums

| Enum | Values |
|------|--------|
| `ScreeningType` | `PHYSICAL_EXAM`, `MEDICAL_CLEARANCE`, `DRUG_SCREENING`, `VISION_HEARING`, `FITNESS_ASSESSMENT`, `PSYCHOLOGICAL` |
| `ScreeningStatus` | `SCHEDULED`, `COMPLETED`, `PASSED`, `FAILED`, `PENDING_REVIEW`, `WAIVED`, `EXPIRED` |

### Key Interfaces

| Interface | Description |
|-----------|-------------|
| `ScreeningRequirement` | Organization-level requirement definition with frequency and role applicability |
| `ScreeningRecord` | Individual screening record with dates, results, and review chain |
| `ComplianceSummary` | Aggregated compliance status for a user or prospect |

---

## Data Models

### `screening_requirements` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `String(36)` | UUID primary key |
| `organization_id` | `String(36)` | FK to organizations |
| `name` | `String(200)` | Requirement name (e.g., "Annual Physical Exam") |
| `screening_type` | `ScreeningType` | Type of screening |
| `description` | `Text` | Detailed description |
| `frequency_months` | `Integer` | Months between required screenings (NULL = one-time) |
| `applies_to_roles` | `JSON` | Array of role IDs this requirement applies to |
| `is_active` | `Boolean` | Whether requirement is currently enforced |
| `grace_period_days` | `Integer` | Days after expiration before marking non-compliant (default: 30) |
| `created_at` | `DateTime` | Creation timestamp |
| `updated_at` | `DateTime` | Last update timestamp |

### `screening_records` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `String(36)` | UUID primary key |
| `organization_id` | `String(36)` | FK to organizations |
| `requirement_id` | `String(36)` | FK to screening_requirements |
| `user_id` | `String(36)` | FK to users (nullable — NULL if prospect) |
| `prospect_id` | `String(36)` | FK to prospective_members (nullable — NULL if user) |
| `screening_type` | `ScreeningType` | Type of screening |
| `status` | `ScreeningStatus` | Current status |
| `scheduled_date` | `DateTime` | When screening is scheduled |
| `completed_date` | `DateTime` | When screening was completed |
| `expiration_date` | `DateTime` | When this screening expires |
| `provider_name` | `String(200)` | Name of medical provider |
| `result_summary` | `Text` | Brief result description |
| `result_data` | `JSON` | Structured result data |
| `reviewed_by` | `String(36)` | FK to users (reviewer) |
| `reviewed_at` | `DateTime` | When review occurred |
| `notes` | `Text` | Additional notes |

---

## API Endpoints

### Requirements

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/medical-screening/requirements` | `medical_screening.view` | List requirements (filter: `is_active`, `screening_type`) |
| `GET` | `/api/v1/medical-screening/requirements/{id}` | `medical_screening.view` | Get single requirement |
| `POST` | `/api/v1/medical-screening/requirements` | `medical_screening.manage` | Create requirement |
| `PUT` | `/api/v1/medical-screening/requirements/{id}` | `medical_screening.manage` | Update requirement |
| `DELETE` | `/api/v1/medical-screening/requirements/{id}` | `medical_screening.manage` | Delete requirement |

### Records

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/medical-screening/records` | `medical_screening.view` | List records (filter: `user_id`, `prospect_id`, `screening_type`, `status`) |
| `GET` | `/api/v1/medical-screening/records/{id}` | `medical_screening.view` | Get single record |
| `POST` | `/api/v1/medical-screening/records` | `medical_screening.manage` | Create record |
| `PUT` | `/api/v1/medical-screening/records/{id}` | `medical_screening.manage` | Update record (sets `reviewed_by`, `reviewed_at`) |
| `DELETE` | `/api/v1/medical-screening/records/{id}` | `medical_screening.manage` | Delete record |

### Compliance

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/medical-screening/compliance/{user_id}` | `medical_screening.view` | User compliance summary |
| `GET` | `/api/v1/medical-screening/compliance/prospect/{prospect_id}` | `medical_screening.view` | Prospect compliance summary |
| `GET` | `/api/v1/medical-screening/expiring` | `medical_screening.view` | Expiring screenings (query: `days=30`, range 1-365) |

---

## Permissions

| Permission | Description |
|-----------|-------------|
| `medical_screening.view` | View requirements, records, and compliance status |
| `medical_screening.manage` | Full CRUD: create/update/delete requirements and records |

---

## Frontend Components

### MedicalScreeningPage

Main module page with:
- **Compliance Dashboard**: Overview of member screening compliance across all requirement types
- **Requirements tab**: List and configure screening requirements
- **Records tab**: View and manage individual screening records

### ComplianceDashboard

Displays:
- Compliance rate by screening type
- Members with expiring screenings
- Overdue screenings requiring attention
- Drill-down to individual member compliance

### ScreeningRequirementForm

Create/edit form with:
- Name, description, screening type
- Frequency (months) — leave empty for one-time screenings
- Role applicability selector
- Grace period configuration
- Active/inactive toggle

### ScreeningRecordForm

Create/edit form with:
- Member or prospect selector
- Requirement and screening type
- Scheduled and completed dates
- Provider name
- Result summary and structured data
- Notes field

---

## Data Flows

### Screening Lifecycle

```
Requirement Defined
  → Record Created (status: SCHEDULED)
  → Screening Completed (status: COMPLETED or PASSED/FAILED)
  → Review (optional: PENDING_REVIEW → reviewed_by/reviewed_at set)
  → Expiration (based on frequency_months from completed_date)
  → Next Screening Due (new record created)
```

### Prospect-to-Member Conversion

When a prospective member is converted to a full member:
- Existing screening records linked via `prospect_id` are preserved
- Records can be re-linked to the new `user_id` for continuity

### Cross-Module Integration

| Module | Integration |
|--------|-------------|
| Prospective Members | Screening records can be linked to prospects; compliance status visible in pipeline |
| Compliance | Medical screening compliance feeds into overall compliance calculations |
| Notifications | Expiring screening alerts can trigger email notifications |

---

## Configuration

### Feature Flag

```
MODULE_MEDICAL_SCREENING_ENABLED=true
```

Enable in **Settings > Organization > Modules** or via environment variable.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Record linked to both user_id and prospect_id | Rejected by service validation — must be one or the other |
| `frequency_months = NULL` | One-time screening that does not recur and has no automatic expiration |
| Grace period after expiration | Member remains compliant during grace period; becomes non-compliant only after grace period expires |
| Expiring query with days=0 or >365 | Clamped to valid range (1-365) |
| Requirement deactivated | Existing records preserved; requirement excluded from future compliance calculations |
| Screening waived | Status set to `WAIVED`; excluded from compliance calculations |
| Provider name not provided | Optional field; no provider info displayed in compliance dashboard |

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Module not visible in navigation | Feature flag not enabled | Enable `MODULE_MEDICAL_SCREENING_ENABLED` in Settings > Modules |
| Compliance shows 0% | No requirements defined | Create at least one active screening requirement |
| Prospect screening missing after conversion | Records need re-linking | Verify `user_id` is set on the converted member's screening records |
| Expiration dates not calculating | Missing `frequency_months` or `completed_date` | Ensure both are set for recurring screenings |

---

**Document Version**: 1.0
**Last Updated**: 2026-03-14
**Maintainer**: Development Team
