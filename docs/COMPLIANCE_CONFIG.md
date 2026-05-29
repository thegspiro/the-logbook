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
| `include_current_month` | `true` | Evaluation-period boundary. `true` counts the in-progress current month; `false` evaluates as of the **end of the previous month** so members are not flagged non-compliant mid-month before they have had a chance to train. See "Evaluation Period (`include_current_month`)" below |
| `auto_report_frequency` | `NONE` | Automatic report scheduling: `MONTHLY`, `QUARTERLY`, `YEARLY`, `NONE` |
| `report_email_recipients` | `[]` | JSON array of email addresses for report delivery |
| `report_day_of_month` | `1` | Day of month for scheduled reports |
| `notify_non_compliant_members` | `false` | Send notifications to non-compliant members |
| `notify_days_before_deadline` | `[30, 14, 7]` | JSON array of days before deadline to send notifications |

---

## Evaluation Period (`include_current_month`) (2026-05-03)

Departments run training on different cadences. A department that drills at the
**end** of every month would, under a naive mid-month dashboard, see members
flagged non-compliant simply because the in-progress month has not had its drill
yet. The `include_current_month` control lets an org choose where the compliance
evaluation window ends.

### Org default vs per-requirement override

| Setting | Location | Type | Meaning |
|---------|----------|------|---------|
| Org default | `compliance_configs.include_current_month` | `Boolean` NOT NULL, default `true` | Applies to every requirement that does not set its own value |
| Per-requirement override | `training_requirements.include_current_month` | `Boolean` nullable | `NULL` inherits the org default; `true`/`false` explicitly overrides for that one requirement (migration `20260503_0002`) |

### Resolved "as-of" date

The two values are resolved by pure helpers in `app/services/training_period.py`:

- `effective_include_current_month(requirement_value, org_default)` — returns the
  requirement value when it is not `NULL`, otherwise the org default.
- `resolve_as_of_date(today, include_current_month)`:
  - `True` → `today` (the in-progress month counts).
  - `False` → last day of the previous month, computed as
    `today.replace(day=1) - timedelta(days=1)`.

The resolved as-of date drives the requirement date window, waiver proration
(active vs waived months), and overdue checks. It is threaded through
`training_compliance.py` (`get_org_include_current_month`,
`evaluate_member_requirement`, `_evaluate_member_compliance`),
`TrainingService.evaluate_requirement_detail`, `CompetencyMatrixService`,
`AnnualComplianceReportService`, and the `get_compliance_summary`,
`get_compliance_matrix`, and `get_my_training_summary` endpoints.

### Deliberate exception: certificate "expiring soon" lookahead

The certificate "expiring soon" lookahead **always uses the real
`date.today()`**, never the resolved as-of date. For example,
`CompetencyMatrixService` computes `expiring_threshold = date.today() + 90 days`
independently of `include_current_month`. Excluding the current month must not
hide a certificate that is genuinely about to expire.

### Legacy behavior

An organization with no `compliance_configs` row has the current month
**included** (`get_org_include_current_month` returns `True` when no config
exists), preserving pre-2026-05 behavior.

> **Note:** This is distinct from the rolling "Evaluation Period (Date Windows)"
> concept documented in `training-compliance-calculations.md`, which governs how
> far back a requirement's window reaches. `include_current_month` only moves the
> *end* of that window between today and the end of last month.

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
| `include_current_month` | `Boolean` | NOT NULL, default `true`. When `false`, evaluation stops at the end of the previous month (migration `20260503_0001`) |
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
| Organization has no compliance config | Compliance calculations use hardcoded defaults until config is created; the in-progress current month **is** included (legacy behavior preserved) |
| `include_current_month = false` mid-month | Compliance evaluates as of the last day of the previous month; the in-progress month does not count against members |
| Requirement `include_current_month = NULL` | Inherits the org-level `include_current_month` default |
| Certificate expiring within 90 days while `include_current_month = false` | Still surfaces as "expiring soon" — the lookahead uses the real `date.today()`, not the resolved as-of date |

---

## Frontend Page

**URL**: `/compliance/config`
**Permission**: `settings.manage`

The `ComplianceRequirementsConfigPage` provides:
- Organization-level threshold and notification settings
- An **"Evaluation Period"** checkbox on the Thresholds tab that toggles the org
  `include_current_month` default (2026-05-03)
- Compliance profile management (create/edit/delete)
- Report scheduling configuration
- On-demand report generation
- Stored report history

The per-requirement override (`inherit` / `include` / `exclude`) is set in the
`RequirementModal` on the `TrainingRequirementsPage`.

Linked from the compliance officer dashboard navigation.

---

**Document Version**: 1.1
**Last Updated**: 2026-05-29
**Maintainer**: Development Team
