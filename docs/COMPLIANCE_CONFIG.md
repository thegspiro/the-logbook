# Compliance Requirements Configuration

Configure organization-wide compliance thresholds, profiles, and automated reporting.

## Overview

The Compliance Requirements Configuration module allows organizations to define how compliance is calculated, create targeted compliance profiles for different membership types and roles, and schedule automated compliance reports.

---

## Configuration

### Threshold Types

| Type | Description |
|------|-------------|
| `PERCENTAGE` | Compliance based on percentage of requirements met (e.g., 80% of requirements = compliant) |
| `ALL_REQUIRED` | Every requirement must be met for compliance |

### Organization Config Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `threshold_type` | `PERCENTAGE` | How compliance is measured |
| `compliant_threshold` | `100.0` | Percentage at or above which a member is compliant |
| `at_risk_threshold` | `75.0` | Percentage below which a member is at-risk |
| `grace_period_days` | `0` | Days after deadline before marking non-compliant |
| `auto_report_frequency` | `NONE` | Automatic report scheduling: `MONTHLY`, `QUARTERLY`, `YEARLY`, `NONE` |
| `report_email_recipients` | `[]` | JSON array of email addresses for report delivery |
| `report_day_of_month` | `1` | Day of month for scheduled reports |
| `notify_non_compliant_members` | `false` | Send notifications to non-compliant members |
| `notify_days_before_deadline` | `[30, 14, 7]` | JSON array of days before deadline to send notifications |

---

## Compliance Profiles

Profiles allow different compliance standards for different groups within the organization.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Profile name (e.g., "Line Officers", "Probationary Members") |
| `description` | `string` | Profile purpose |
| `membership_types` | `JSON` | Array of membership types this profile applies to |
| `role_ids` | `JSON` | Array of role IDs this profile applies to |
| `compliant_threshold_override` | `float` | Override org-level compliant threshold (null = use org default) |
| `at_risk_threshold_override` | `float` | Override org-level at-risk threshold (null = use org default) |
| `required_requirement_ids` | `JSON` | Array of requirement IDs that are mandatory for this profile |
| `optional_requirement_ids` | `JSON` | Array of requirement IDs that are tracked but not required |
| `is_active` | `boolean` | Whether this profile is currently enforced |
| `priority` | `integer` | Resolution order for members matching multiple profiles |

---

## Automated Reports

### Report Types

| Type | Description |
|------|-------------|
| `monthly` | Monthly compliance snapshot |
| `yearly` | Annual compliance summary |

### Report Statuses

| Status | Description |
|--------|-------------|
| `PENDING` | Report generation requested |
| `GENERATING` | Report is being generated |
| `COMPLETED` | Report generated successfully |
| `FAILED` | Report generation failed (see `error_message`) |

### Report Data

Each report stores:
- `report_data` (JSON): Full compliance data at time of generation
- `summary` (JSON): Aggregated statistics
- `emailed_to` (JSON): Recipients who received the report
- `generation_duration_ms`: How long report generation took

---

## API Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/compliance/config` | `training.manage` | Get org compliance config |
| `PUT` | `/api/v1/compliance/config` | `settings.manage` | Create/update compliance config |
| `POST` | `/api/v1/compliance/config/initialize` | `settings.manage` | First-time setup (errors if already exists) |
| `GET` | `/api/v1/compliance/config/requirements` | `training.manage` | Available training requirements for profile setup |
| `POST` | `/api/v1/compliance/config/profiles` | `settings.manage` | Create compliance profile |
| `PUT` | `/api/v1/compliance/config/profiles/{id}` | `settings.manage` | Update compliance profile |
| `DELETE` | `/api/v1/compliance/config/profiles/{id}` | `settings.manage` | Delete compliance profile |
| `POST` | `/api/v1/compliance/reports/generate` | `training.manage` | Generate report (body: `type`, `send_email`, `additional_recipients`) |
| `GET` | `/api/v1/compliance/reports` | `training.manage` | List stored reports (filter: `type`, `year`; pagination: `limit`, `offset`) |

---

## Data Models

### `compliance_configs` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `String(36)` | UUID primary key |
| `organization_id` | `String(36)` | FK to organizations (unique) |
| `threshold_type` | `ComplianceThresholdType` | PERCENTAGE or ALL_REQUIRED |
| `compliant_threshold` | `Float` | Default: 100.0 |
| `at_risk_threshold` | `Float` | Default: 75.0 |
| `grace_period_days` | `Integer` | Default: 0 |
| `auto_report_frequency` | `ReportFrequency` | MONTHLY, QUARTERLY, YEARLY, NONE |
| `report_email_recipients` | `JSON` | Array of email addresses |
| `report_day_of_month` | `Integer` | 1-28 |
| `notify_non_compliant_members` | `Boolean` | Default: false |
| `notify_days_before_deadline` | `JSON` | Array of day counts |
| `updated_by` | `String(36)` | FK to users |

### `compliance_profiles` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `String(36)` | UUID primary key |
| `config_id` | `String(36)` | FK to compliance_configs (cascade delete) |
| `name` | `String(200)` | Profile name |
| `membership_types` | `JSON` | Targeted membership types |
| `role_ids` | `JSON` | Targeted role IDs |
| `compliant_threshold_override` | `Float` | Nullable override |
| `at_risk_threshold_override` | `Float` | Nullable override |
| `required_requirement_ids` | `JSON` | Required training requirements |
| `optional_requirement_ids` | `JSON` | Optional tracked requirements |
| `is_active` | `Boolean` | Default: true |
| `priority` | `Integer` | Default: 0 |

### `compliance_reports` Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | `String(36)` | UUID primary key |
| `organization_id` | `String(36)` | FK to organizations |
| `report_type` | `String(50)` | monthly or yearly |
| `period_label` | `String(50)` | Human-readable period label |
| `status` | `ReportStatus` | PENDING, GENERATING, COMPLETED, FAILED |
| `report_data` | `JSON` | Full compliance data |
| `summary` | `JSON` | Aggregated statistics |
| `error_message` | `Text` | Error details if FAILED |
| `generated_by` | `String(36)` | FK to users |
| `generation_duration_ms` | `Integer` | Processing time |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| First-time initialization via `/config/initialize` when config exists | Returns error — use `PUT /config` for updates |
| Member matches multiple compliance profiles | Resolved by `priority` ordering (lower number = higher priority) |
| Profile threshold override is null | Uses organization-level default threshold |
| Report generation failure | Status set to `FAILED` with `error_message`; can be regenerated |
| Grace period applied | Members remain compliant during grace period after deadline |
| `notify_days_before_deadline` empty array | No pre-deadline notifications sent |
| Organization has no compliance config | Compliance calculations use hardcoded defaults until config is created |

---

## Frontend Page

**URL**: `/compliance/config`
**Permission**: `settings.manage`

The `ComplianceRequirementsConfigPage` provides:
- Organization-level threshold and notification settings
- Compliance profile management (create/edit/delete)
- Report scheduling configuration
- On-demand report generation
- Stored report history

Linked from the compliance officer dashboard navigation.

---

**Document Version**: 1.0
**Last Updated**: 2026-03-14
**Maintainer**: Development Team
