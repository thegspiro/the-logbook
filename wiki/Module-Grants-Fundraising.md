# Grants & Fundraising Module

The Grants & Fundraising module provides integrated management for grant applications, fundraising campaigns, donor relationships, and financial reporting — tailored to the fire service funding landscape.

---

## Key Features

- **Grant Application Management** — Track applications for AFG, SAFER, FP&S, USDA, and custom grant programs with status pipeline, deadlines, and documentation
- **Fundraising Campaign Engine** — Create and manage fundraising campaigns with goal tracking, progress visualization, and donor attribution
- **Donor Management (Mini-CRM)** — Track donor relationships, contact info, giving history, and communication preferences
- **Grant Notes** — Attach notes to grants with metadata, timestamps, and author tracking
- **Pipeline Stages** — Configurable pipeline for grant application workflow (draft → submitted → under review → awarded → reporting)
- **Financial Reporting** — Grant expenditure tracking, campaign totals, donor giving summaries, and compliance reporting for federal grants
- **FEMA Grant Support** — Pre-configured templates and fields for FEMA AFG, SAFER, and FP&S applications including cost-share calculations and NFIRS/NERIS compliance tracking

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/grants` | Grants Dashboard | `grants.view` |
| `/grants/applications` | Grant Applications | `grants.view` |
| `/grants/applications/:id` | Grant Detail | `grants.view` |
| `/grants/campaigns` | Fundraising Campaigns | `grants.view` |
| `/grants/campaigns/:id` | Campaign Detail | `grants.view` |
| `/grants/donors` | Donor Management | `grants.manage` |
| `/grants/donors/:id` | Donor Detail | `grants.manage` |
| `/grants/reports` | Financial Reports | `grants.manage` |

---

## Data Model

### Core Tables

| Table | Purpose |
|-------|---------|
| `grants` | Grant applications with type, status, amounts, deadlines |
| `grant_notes` | Notes attached to grants (uses `note_metadata` column, aliased as `metadata` in API) |
| `fundraising_campaigns` | Campaign records with goal, raised amount, dates |
| `donors` | Donor contact info and preferences |
| `grant_donors` | Many-to-many linking grants/campaigns to donors |
| `grant_stages` | Pipeline stage definitions for grant workflows |

### Key Enums

| Enum | Values |
|------|--------|
| GrantStatus | draft, submitted, under_review, awarded, denied, reporting, closed |
| GrantType | afg, safer, fps, usda, state, local, private, corporate, foundation, other |
| CampaignStatus | planning, active, paused, completed, cancelled |
| DonorType | individual, corporate, foundation, government |

---

## API Endpoints

```
GET    /api/v1/grants                         # List grants
POST   /api/v1/grants                         # Create grant
GET    /api/v1/grants/{id}                    # Get grant details
PATCH  /api/v1/grants/{id}                    # Update grant
DELETE /api/v1/grants/{id}                    # Delete grant
GET    /api/v1/grants/{id}/notes              # List grant notes
POST   /api/v1/grants/{id}/notes              # Add grant note
GET    /api/v1/grants/campaigns               # List campaigns
POST   /api/v1/grants/campaigns               # Create campaign
GET    /api/v1/grants/campaigns/{id}          # Campaign details
PATCH  /api/v1/grants/campaigns/{id}          # Update campaign
GET    /api/v1/grants/donors                  # List donors
POST   /api/v1/grants/donors                  # Create donor
GET    /api/v1/grants/donors/{id}             # Donor details
GET    /api/v1/grants/reports/summary         # Financial summary report
```

---

## Known Issues & Edge Cases

- **GrantNote `metadata` column:** The model column is `note_metadata` (renamed from `metadata` to avoid SQLAlchemy `Base.metadata` conflict). The API response uses `metadata` via serialization alias. See [Troubleshooting > GrantNote Metadata](Troubleshooting#grants-module-issues-2026-03-05)
- **camelCase serialization:** All response schemas use `alias_generator=to_camel`. If adding new response models, always include `ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)`
- **Donor relationship eager loading:** Grant-donor relationships use `selectinload` to prevent N+1 queries. When adding new relationships, use the same pattern

---

## Permissions

| Permission | Description |
|------------|-------------|
| `grants.view` | View grants, campaigns, and reports |
| `grants.manage` | Create, edit, delete grants and campaigns; manage donors |

---

## Module Flag

Enable via `MODULE_GRANTS_ENABLED=true` in environment or Settings > Organization > Modules.

---

**See also:** [Grants & Fundraising Research](../docs/GRANTS_FUNDRAISING_MODULE.md) | [Troubleshooting](Troubleshooting#grants-module-issues-2026-03-05)
