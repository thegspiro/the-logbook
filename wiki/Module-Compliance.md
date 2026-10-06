# Compliance Module

The Compliance module provides organization-wide compliance tracking, reporting, and monitoring across training, certifications, and regulatory requirements.

---

## Key Features

- **Compliance Dashboard** — Overview of department-wide compliance status
- **Compliance Matrix** — Triage rail of members grouped by standing (since 2026-09-05; see below), with a printable matrix
- **Competency Matrix** — Department readiness heat-map
- **Compliance Summary** — Per-member green/yellow/red indicator on profiles
- **Certification Tracking** — Monitor certification statuses and expiration dates
- **Tiered Alerts** — Automated notifications at 90/60/30/7 days before cert expiration
- **Escalation** — Expired certifications escalate to training, compliance, and chief officers
- **Waiver Adjustments** — Leaves of Absence proportionally reduce requirements
- **Compliance Calculations** — Documented formulas for every requirement type and frequency
- **Reporting** — Annual training reports, compliance trends, member-level detail
- **Compliance Officer Dashboard** — _(2026-03-05)_ Dedicated dashboard for compliance officers with ISO readiness scoring, attestation workflows, and NFPA 1401 record quality analysis
- **ISO Readiness Scoring** — _(2026-03-05)_ ISO 9001/14001/45001 readiness scoring based on attestation completion rates
- **Attestation Workflows** — _(2026-03-05)_ Configurable annual compliance sign-off workflows assigned to members with tracking and reminders
- **NFPA 1401 Record Quality** — _(2026-03-05)_ Training record quality analysis per NFPA 1401 standards (requires ≥10 records for meaningful scores)
- **Requirement Grandfathering** — _(2026-10-03)_ A requirement can exempt members who joined before a cutoff, or give them a catch-up deadline during which an unmet requirement (`catch_up`) counts neither for nor against their standing
- **Department-Date Grading** — _(2026-09-26)_ Every compliance view judges "today" as the department's date rather than the UTC server date
- **Configurable Evaluation Period** — _(2026-05-29)_ Org-wide and per-requirement control over whether the in-progress (current) month counts toward compliance, so members aren't flagged non-compliant mid-month when drills happen late in the period

---

## How Compliance Is Calculated

### Requirement Statuses

| Status                  | Meaning                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| **Green (Compliant)**   | All requirements met, no certification issues                          |
| **Yellow (At Risk)**    | Some requirements incomplete or certifications expiring within 90 days |
| **Red (Non-Compliant)** | Expired certifications or fewer than 50% of requirements met           |

### Waiver Adjustment Formula

When a member has an active Leave of Absence:

```
adjusted_required = base_required × (active_months / total_months)
```

A calendar month is waived if the leave covers **15 or more days** of that month.

### Requirement Types Adjusted

| Type          | Adjusted | Notes                  |
| ------------- | -------- | ---------------------- |
| Hours         | Yes      | Proportional reduction |
| Shifts        | Yes      | Proportional reduction |
| Calls         | Yes      | Proportional reduction |
| Courses       | No       | Binary completion      |
| Certification | No       | Valid or not           |

### Who a Requirement Grades — Grandfathering _(2026-10-03)_

Before a requirement is evaluated for a member, its three nullable dates are
checked against the member's **join date** (`hire_date`, else the account's
creation date; `training_compliance.member_join_date`):

| Requirement carries                                   | Member joined…                        | Result                                                                                 |
| ----------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| `new_member_cutoff_date`, no deadline                 | before the cutoff                     | Not graded at all                                                                      |
| `new_member_cutoff_date` + `existing_member_deadline` | before the cutoff, today ≤ deadline   | Unmet → `catch_up`, due on the deadline; left out of both counts by `tally_standing()` |
| same                                                  | before the cutoff, after the deadline | Graded normally                                                                        |
| `applies_to_joined_before`                            | on or after that date                 | Not graded by this (older) requirement — its newer copy grades them                    |

All `NULL` (every row before migration `d058b5e7c1f4`) keeps the old behaviour.
Every screen that decides who a requirement grades — dashboard, matrix and
print, profile card, My Training, member status, competency matrix, forecast,
annual report, CSV/PDF exports (which print N/A) — goes through
`requirement_applies_to_member` with the join date, and
`tests/test_requirement_grandfathering.py` fails on a call that omits it. The
same change made the dashboard, matrix and member-status views honour
role-scoped requirements, which only My Training had enforced; a department
with role-scoped requirements may see those figures move.

> **A missing hire date reads as the account's creation date.** An imported
> roster without hire dates joins "on the import day", so a cutoff on or after
> that day treats veterans as new members. Record hire dates before relying on
> a cutoff (KNOWN_LIMITATIONS, accepted 2026-10-03).

### No Requirements Is "Not Set Up", Not 100% _(2026-09-29)_

`compute_org_compliance_pct` still returns 100 for an organization with no
active requirement; callers check `count_active_requirements()` first and show
**Not set up** / "no requirements set up yet" instead. The annual report likewise
reads **Not applicable** for a requirement that applies to no active member,
instead of a red "0/0 — 0%" (W29-4, closing CMP4-4).

### One Definition of "Who Is Graded, and How" _(2026-10-05)_

- **Profiles everywhere.** The Department Compliance card and the annual and
  monthly compliance reports now grade through compliance profiles exactly as the
  matrix and dashboard percentage do (narrowed requirement lists, threshold
  overrides, the org's at-risk tier). Departments with profiles, or a compliant
  threshold under 100%, will see the card and the report move; stored reports
  keep their old figures.
- **Not applicable members leave every percentage.** A member nothing grades
  (no requirement applies, a profile selects none, or all are in catch-up) shows
  **N/A**, not 100%. The dashboard percentage is blank when nobody is graded, and
  "X of Y members current" counts graded members. The annual report's executive
  summary adds `graded_members` and `not_applicable_members`.
- **Required roles match the member's rank.** A requirement's `required_roles`
  holds rank slugs; every screen used to compare them with position ids, so a
  requirement scoped only by role applied to nobody. It now grades the members of
  those ranks everywhere, in the annual report, and in Scheduling's Shift
  Compliance report — which also now honours required membership types.
  Profile `role_ids` are unchanged (position ids).
- **Certification name matching is legacy-only.** A completed record whose
  course name merely contains a certification requirement's name (a "CPR
  Refresher" crediting "CPR") still counts only on or before the requirement's
  `name_match_until` date. The upgrade (migration `60aaf273de27`) sets it, on
  every requirement that exists, to the day it runs; requirements created later,
  and every requirement on a fresh install, never match by name and need a linked
  course, the training type or the registry code.
- **Attestations record the server's figure.** The form has no Compliance % box;
  it records the department's percentage as of the period's last day
  (`compliance_as_of`), refuses a period that has not started, and has a quarter
  picker (quarterly attestations were previously refused for a missing quarter).
- **Faster grading, same answers.** The graders load only the records inside each
  requirement's window; a test grades an eight-year department bounded and
  unbounded and requires identical output.

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

## Recent Changes (2026-05-29)

### Configurable Evaluation Period (Current vs. Prior Month)

Departments run training on different cadences. A dashboard that always counts
the in-progress month can flag members as non-compliant before they have had a
chance to train that month. The evaluation period is now configurable:

- **Org default:** `compliance_configs.include_current_month` (Boolean, default
  `true`). `true` counts the in-progress month; `false` stops evaluation at the
  end of the **previous** month
- **Per-requirement override:** `training_requirements.include_current_month`
  (nullable). `NULL` inherits the org default; `true`/`false` overrides it
  explicitly
- **Helper:** `resolve_as_of_date(today, include)` (in
  `services/training_period.py`) returns `today` when included, otherwise the
  last day of the previous month. This "as-of" date drives the requirement
  window, waiver proration, and overdue checks
- **Exception:** the certification **"expiring soon"** lookahead always uses the
  actual current date (the department's, since 2026-09-26), never the resolved
  as-of date — upcoming expirations are not shifted by the evaluation period

### UI

- **"Evaluation Period" checkbox** on the Compliance Requirements > Thresholds
  tab (`/training/compliance-config`) sets the org default. _(2026-09-29)_ A
  refused save now shows the server's reason (e.g. "at_risk_threshold must be
  less than or equal to compliant_threshold") instead of "Failed to save
  configuration"; _(2026-10-03)_ the page fits a 320px phone and treats a
  malformed config response as a load error
- A **per-requirement select** (inherit / include / exclude) overrides the
  default for individual requirements

### Member Self-Export Gating

The org `allow_member_report_export` setting controls whether members may export
their own training records (CSV/PDF). When disabled, the member export endpoint
returns 403. See the [Training Module](Module-Training#member--officer-exports).

---

## Related Documentation

- **[Training Compliance Calculations](../docs/training-compliance-calculations.md)** — Complete formula reference
- **[Training Waivers](../backend/app/docs/TRAINING_WAIVERS.md)** — Waiver system details
- **[Training Module](Module-Training)** — Full training documentation

---

**See also:** [Training Module](Module-Training) | [Security Overview](Security-Overview)

## The Compliance Matrix becomes a queue you can work _(2026-09-05)_

The member × requirement icon grid is replaced by a **triage rail**. Every cell
said only "met" or "not met", so a coordinator could see who was short without
seeing by how much, and the screen offered nowhere to go next.

Members — or requirements, on the other axis — are now grouped by standing,
ordered worst-first, and stepped through one at a time, with the numbers behind
each status on the row: _"6 of 24 hours"_, _"Lapsed 41 days ago"_, _"Expires in
26 days"_.

### ⚠️ Your compliance percentages may move

Two grading defects were fixed, and both were in the pessimistic direction:

- **A member exempt from a requirement could never reach 100%.**
  `completion_pct` divided by every active requirement while counting only the
  ones applicable to the member, so anyone whose membership type excused them
  from one was capped below full compliance no matter what they did. The
  denominator is now the requirements actually asked of them, reported
  alongside as `requirements_met` / `requirements_total`.
- **A certification expiring soon read as a failure.** The tally counted only
  the `met` tone, so a member holding a card valid for another 26 days rendered
  under "Compliant" reading _"1 of 2 met · 1 open item"_ — a contradiction on
  the face of the screen. **A cert valid today is met today**; the tone is a
  renewal warning, and the orange "Due soon" pill still marks the row.

### The dashboard link lands filtered

The Needs Attention widget has been linking to `?status=noncompliant` all along
and the grid ignored it, dropping the coordinator into the full unfiltered
roster. Clearing the chip drops the parameter too, so a refresh does not
silently re-apply a filter that was just dismissed.

### API

`GET /training/compliance-matrix` gains optional per-cell progress
(`progress_current`, `progress_required`, `progress_unit`, the pre-waiver
`base_required`, `waived_months`, and the evaluation window), per-requirement
meta (type, frequency, target, unit), and a top-level `as_of`.

**Additive only** — the four original cell keys are unchanged, so the printable
report and any other consumer keep working.

`as_of` matters more than it looks: compliance is evaluated through a cut-off,
not through the viewer's clock, and each requirement can move its own via
`include_current_month`. Measuring expiry from the browser's `new Date()` had
turned a certificate the backend had accepted into a lapsed cell.

### Actions are limited to ones with something behind them

Print, a CSV export written through the formula-injection-safe `buildCsv`, and
links to member training records. **The mock's Notify and Assign buttons had no
endpoint** — a control wired to nothing invites somebody to believe a message
was sent.

### A screen reports what the backend decided

This redesign is the worked example behind CLAUDE.md pitfall #29. Four things
the backend already defines were re-derived in the frontend and drifted from
every one of them: which requirements grade a member, the compliant/at-risk
thresholds, when a requirement is at risk, and who the "non-compliant" deep
link means. None raised, none failed a test, and each produced a number that
looked plausible on its own — visible only by opening two screens and noticing
they disagree.
