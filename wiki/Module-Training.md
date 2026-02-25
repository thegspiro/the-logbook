# Training Module

The Training module tracks courses, certifications, training requirements, program enrollments, external training integrations, and compliance reporting.

---

## Key Features

- **Training Requirements** — Hours, shifts, calls, course completions, and certifications with annual/quarterly/monthly/rolling frequencies
- **Training Programs** — Structured multi-phase curricula (Flexible, Sequential, Phase-based) with milestone tracking
- **Self-Reported Training** — Members submit training records for officer review and approval
- **Shift Completion Reports** — Officers file post-shift reports that auto-credit hours/shifts/calls toward program requirements
- **Compliance Matrix** — Grid view of all members vs. all active requirements (green/yellow/red)
- **Competency Matrix** — Department readiness heat-map
- **Expiring Certifications** — Tiered alerts at 90/60/30/7 days with escalation for expired certs
- **Compliance Summary** — Per-member green/yellow/red compliance card on profiles
- **Training Waivers** — Leave of Absence auto-linking, waiver management, proportional requirement adjustment. Supports permanent waivers (no end date), New Member waiver type, and multi-select "Applies To" (Training + Meetings + Shifts can be combined)
- **Bulk Record Creation** — Up to 500 records per request with duplicate detection
- **Rank & Station Snapshots** — `rank_at_completion` and `station_at_completion` captured on every record
- **External Integrations** — Connect external training providers with category and user mapping
- **Historical Import** — CSV import with preview and validation
- **Registry Integration** — NFPA Standards, NREMT Certifications, Pro Board one-click import

---

## Pages

| URL | Page | Permission |
|-----|------|------------|
| `/training` | My Training | Authenticated |
| `/training/submit` | Submit Training | Authenticated |
| `/training/courses` | Course Library | Authenticated |
| `/training/programs` | Training Programs | Authenticated |
| `/training/programs/:id` | Program Detail | Authenticated |
| `/training/admin` | Training Admin Hub | `training.manage` |

### Training Admin Tabs

| Tab | Description |
|-----|-------------|
| Officer Dashboard | Department-wide overview, completion rates, members behind schedule |
| Training Waivers | All training waivers with summary cards, status filtering, source tracking |
| Review Submissions | Pending member submissions for approval/rejection |
| Requirements | Create and manage training requirements |
| Create Session | Create training sessions linked to events |
| Compliance Matrix | All members x all requirements grid |
| Expiring Certs | Certifications expiring within 90 days with alert processing |
| Pipelines | Training program management |
| Shift Reports | Shift officer reports with auto-progression |
| Integrations | External training provider connections |
| Import History | CSV import records |

---

## API Endpoints

```
GET    /api/v1/training/records              # List training records
POST   /api/v1/training/records              # Create a training record
POST   /api/v1/training/records/bulk         # Bulk create (up to 500)
GET    /api/v1/training/compliance-summary/{user_id}  # Member compliance card
GET    /api/v1/training/compliance-matrix    # All members x requirements
GET    /api/v1/training/competency-matrix    # Department readiness view
GET    /api/v1/training/requirements         # List requirements
POST   /api/v1/training/requirements         # Create requirement
GET    /api/v1/training/programs             # List programs
POST   /api/v1/training/programs             # Create program
GET    /api/v1/training/enrollments          # List enrollments
POST   /api/v1/training/enrollments          # Enroll member
POST   /api/v1/training/self-reported        # Submit self-reported training
POST   /api/v1/training/shift-reports        # Submit shift completion report
POST   /api/v1/training/certifications/process-alerts/all-orgs  # Run cert alert cron
GET    /api/v1/training/waivers              # List training waivers
POST   /api/v1/training/waivers              # Create training waiver
```

---

## Skills Testing

The Training module includes a **Skills Testing** sub-module for conducting structured psychomotor evaluations (NREMT-style skill sheets).

### Key Capabilities

- **Skill Sheet Templates** — Reusable evaluation definitions with sections, criteria, scoring configuration, versioning, and lifecycle (draft → published → archived)
- **Critical Criteria** — Required criteria that trigger automatic failure, mirroring NREMT auto-fail rules
- **Test Administration** — Examiner selects template + candidate, scores criteria in real time, system calculates pass/fail
- **Scoring Engine** — Automatic section scores, overall percentage, critical criteria compliance, elapsed time
- **Summary Dashboard** — Department-wide statistics (pass rate, average score, tests this month)

### Skills Testing API Endpoints

```
GET    /api/v1/training/skills-testing/templates              # List templates
POST   /api/v1/training/skills-testing/templates              # Create template
GET    /api/v1/training/skills-testing/templates/{id}         # Get template detail
PUT    /api/v1/training/skills-testing/templates/{id}         # Update template
DELETE /api/v1/training/skills-testing/templates/{id}         # Archive template
POST   /api/v1/training/skills-testing/templates/{id}/publish # Publish template
POST   /api/v1/training/skills-testing/templates/{id}/duplicate # Duplicate template
GET    /api/v1/training/skills-testing/tests                  # List tests
POST   /api/v1/training/skills-testing/tests                  # Create test
GET    /api/v1/training/skills-testing/tests/{id}             # Get test detail
PUT    /api/v1/training/skills-testing/tests/{id}             # Update test (save progress)
POST   /api/v1/training/skills-testing/tests/{id}/complete    # Complete test & calculate results
GET    /api/v1/training/skills-testing/summary                # Department-wide statistics
```

### Skills Testing Pages

| URL | Page | Permission |
|-----|------|------------|
| `/training/skills-testing` | Skills Testing Hub | `training.manage` |
| `/training/skills-testing/templates` | Template Management | `training.manage` |
| `/training/skills-testing/tests` | Test Sessions | Authenticated |
| `/training/skills-testing/summary` | Summary Dashboard | `training.manage` |

---

## Related Documentation

- **[Skills Testing Training Guide](../docs/training/09-skills-testing.md)** — Skills testing user guide with realistic NREMT example
- **[Skills Testing Feature Spec](../docs/SKILLS_TESTING_FEATURE.md)** — Full requirements and data model
- **[Training User Guide](../docs/training/02-training.md)** — End-user training guide
- **[Training Compliance Calculations](../docs/training-compliance-calculations.md)** — Formula details and edge cases
- **[Training Waivers & LOA](../backend/app/docs/TRAINING_WAIVERS.md)** — Waiver system documentation
- **[Training Module (Backend)](../backend/app/docs/TRAINING_MODULE.md)** — Backend technical docs

---

**See also:** [Compliance Module](Module-Compliance) | [Scheduling Module](Module-Scheduling)
