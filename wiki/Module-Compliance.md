# Compliance Module

The Compliance module provides organization-wide compliance tracking, reporting, and monitoring across training, certifications, and regulatory requirements.

---

## Key Features

- **Compliance Dashboard** — Overview of department-wide compliance status
- **Compliance Matrix** — Grid view of all members vs. all active requirements
- **Competency Matrix** — Department readiness heat-map
- **Compliance Summary** — Per-member green/yellow/red indicator on profiles
- **Certification Tracking** — Monitor certification statuses and expiration dates
- **Tiered Alerts** — Automated notifications at 90/60/30/7 days before cert expiration
- **Escalation** — Expired certifications escalate to training, compliance, and chief officers
- **Waiver Adjustments** — Leaves of Absence proportionally reduce requirements
- **Compliance Calculations** — Documented formulas for every requirement type and frequency
- **Reporting** — Annual training reports, compliance trends, member-level detail

---

## How Compliance Is Calculated

### Requirement Statuses

| Status | Meaning |
|--------|---------|
| **Green (Compliant)** | All requirements met, no certification issues |
| **Yellow (At Risk)** | Some requirements incomplete or certifications expiring within 90 days |
| **Red (Non-Compliant)** | Expired certifications or fewer than 50% of requirements met |

### Waiver Adjustment Formula

When a member has an active Leave of Absence:

```
adjusted_required = base_required × (active_months / total_months)
```

A calendar month is waived if the leave covers **15 or more days** of that month.

### Requirement Types Adjusted

| Type | Adjusted | Notes |
|------|----------|-------|
| Hours | Yes | Proportional reduction |
| Shifts | Yes | Proportional reduction |
| Calls | Yes | Proportional reduction |
| Courses | No | Binary completion |
| Certification | No | Valid or not |

---

## API Endpoints

```
GET    /api/v1/training/compliance-matrix    # All members x requirements
GET    /api/v1/training/competency-matrix    # Department readiness
GET    /api/v1/training/compliance-summary/{user_id}  # Member summary card
GET    /api/v1/training/reports/user/{id}    # Individual member report
GET    /api/v1/training/requirements/progress/{id}    # Per-requirement progress
POST   /api/v1/training/certifications/process-alerts/all-orgs  # Cert alert cron
```

---

## Related Documentation

- **[Training Compliance Calculations](../docs/training-compliance-calculations.md)** — Complete formula reference
- **[Training Waivers](../backend/app/docs/TRAINING_WAIVERS.md)** — Waiver system details
- **[Training Module](Module-Training)** — Full training documentation

---

**See also:** [Training Module](Module-Training) | [Security Overview](Security-Overview)
