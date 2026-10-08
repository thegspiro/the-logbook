# Feature Documentation Coverage

Which of the application-review rotation's 36 features have documentation, where
it lives, and what is still missing.

**Why this file exists.** The review checklist's documentation dimension asks
"is there a feature doc?", and three separate passes answered it wrongly —
first by looking only for `docs/<FEATURE>.md` when the house convention is
`docs/<NAME>_MODULE.md`, then by missing the `wiki/Module-*.md` series
entirely. A tracked map is cheaper than rediscovering the answer each pass, and
harder to get wrong.

**Audited 2026-10-08.** Re-derive rather than trust this if the docs tree has
moved on.

---

## Two kinds of document, deliberately

Several modules carry **both**, and that is by design rather than duplication:

| Location                | Job                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `docs/<NAME>_MODULE.md` | **Structured reference** — data models, endpoint-and-permission tables, enums, data flows, edge cases, troubleshooting |
| `wiki/Module-<Name>.md` | **Feature narrative** — what the feature does, page-by-page walkthroughs, and the dated change history                 |

`docs/SCHEDULING_MODULE.md` ↔ `wiki/Module-Scheduling.md` is the precedent, and
the two cross-link. When adding one, link the other.

---

## Coverage

Legend: ✅ structured reference exists · 📖 narrative/wiki only · ◐ partial —
covered incidentally by a doc about something else · ❌ nothing

### Tier A

| #   | Feature                        | Structured reference (`docs/`)                                               | Narrative (`wiki/`)             | State |
| --- | ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------- | ----- |
| A1  | Storefront & payments          | `STOREFRONT_MODULE.md`, `STOREFRONT_PAYPAL.md`                               | —                               | ✅    |
| A2  | Auth & session lifecycle       | `MFA.md` (MFA only)                                                          | `Configuration-Security.md`     | ◐     |
| A3  | Scheduled tasks & cron         | —                                                                            | —                               | ❌    |
| A4  | Email templates & delivery     | `EMAIL_DELIVERABILITY.md`, `DROP_NOTIFICATIONS.md#email-template-management` | —                               | ◐     |
| A5  | Course cohorts & syllabus      | —                                                                            | `Module-Training.md` (adjacent) | ❌    |
| A6  | Member lifecycle & offboarding | `DROP_NOTIFICATIONS.md` (drop notices only)                                  | —                               | ◐     |
| A7  | Dashboard & action items       | —                                                                            | —                               | ❌    |
| A8  | Locations & kiosk              | —                                                                            | —                               | ❌    |
| A9  | Platform ops & data lifecycle  | `BACKUP.md`, `DEPLOYMENT.md`, `KEY_ROTATION.md`, `COMPLIANCE.md`             | `Deployment-*.md`               | ◐     |

### Tier B

| #   | Feature                    | Structured reference (`docs/`)                                                    | Narrative (`wiki/`)                                                          | State |
| --- | -------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----- |
| B1  | medical-screening          | `MEDICAL_SCREENING_MODULE.md`                                                     | —                                                                            | ✅    |
| B2  | apparatus                  | **`APPARATUS_MODULE.md`** _(new 2026-10-08)_                                      | `Module-Apparatus.md`                                                        | ✅    |
| B3  | inventory                  | **`INVENTORY_MODULE.md`** _(new 2026-10-08)_                                      | `Module-Inventory.md`, `Inventory-NFC-Tags.md`                               | ✅    |
| B4  | facilities                 | —                                                                                 | —                                                                            | ❌    |
| B5  | elections                  | —                                                                                 | `Module-Elections.md`                                                        | 📖    |
| B6  | meetings & minutes         | `MEETING_MINUTES_MODULE.md`                                                       | —                                                                            | ✅    |
| B7  | equipment-check            | —                                                                                 | `Module-Apparatus.md` (a section), `Module-Testing-Checklist.md`             | 📖    |
| B8  | documents                  | `MEETING_MINUTES_MODULE.md#documents-module`                                      | —                                                                            | ◐     |
| B9  | membership pipeline        | `PROSPECTIVE_MEMBERS_MODULE.md`                                                   | —                                                                            | ✅    |
| B10 | messaging & communications | `COMMUNICATIONS_MODULE.md`                                                        | `Module-Communications.md`                                                   | ✅    |
| B11 | notifications              | `DROP_NOTIFICATIONS.md` (drop notices only)                                       | —                                                                            | ◐     |
| B12 | integrations               | —                                                                                 | `Integration-Calcom.md`, `-Claude-MCP.md`, `-Documenso.md`, `-Salesforce.md` | 📖    |
| B13 | forms                      | `FORMS_MODULE.md`                                                                 | —                                                                            | ✅    |
| B14 | grants & fundraising       | `GRANTS_FUNDRAISING_MODULE.md`                                                    | `Module-Grants-Fundraising.md`                                               | ✅    |
| B15 | admin-hours                | —                                                                                 | `Module-Admin-Hours.md`                                                      | 📖    |
| B16 | reports & analytics        | —                                                                                 | —                                                                            | ❌    |
| B17 | events                     | —                                                                                 | `Module-Events.md`                                                           | 📖    |
| B18 | training                   | `TRAINING_PROGRAMS.md`, `training-compliance-calculations.md`                     | `Module-Training.md`                                                         | ✅    |
| B19 | scheduling                 | `SCHEDULING_MODULE.md`                                                            | `Module-Scheduling.md`                                                       | ✅    |
| B20 | finance                    | `FINANCE_MODULE.md`                                                               | —                                                                            | ✅    |
| B21 | orgs, roles & users        | `ROLE_SYSTEM_README.md` (repo root), `DEPARTMENT_OFFICERS.md`, `PLATOON_SETUP.md` | `Module-Governance-Org-Chart.md`                                             | ◐     |
| B22 | compliance & skills        | `COMPLIANCE.md`, `COMPLIANCE_CONFIG.md`, `SKILLS_TESTING_FEATURE.md`              | `Module-Compliance.md`                                                       | ✅    |
| B23 | security, audit & IP       | `COMPLIANCE.md`, `KEY_ROTATION.md`                                                | `Configuration-Security.md`                                                  | ◐     |
| B24 | core infra                 | `PORT_CONFIGURATION.md`, `DOCKER-BUILD-PUBLISH.md`, `TYPESCRIPT_SAFEGUARDS.md`    | `Development-*.md`                                                           | ◐     |
| B25 | onboarding                 | `ONBOARDING_FLOW.md`, `ONBOARDING.md` (repo root)                                 | —                                                                            | ✅    |
| B26 | public-portal              | `PUBLIC_PORTAL_MODULE.md`                                                         | —                                                                            | ✅    |
| B27 | frontend shared            | `CLAUDE.md` conventions, `MOBILE_ACCESSIBILITY_REVIEW_*.md`                       | `Development-Frontend.md`                                                    | ◐     |

Not in the rotation but documented: `LABEL_PRINTING_MODULE.md`,
`MEDICAL_SUPPLIES_MODULE.md`, `PUBLIC_API_DOCUMENTATION.md`,
`wiki/Module-Governance-Legal.md`, `wiki/Member-ID-Cards.md`.

---

## Summary

| State                                   | Count |
| --------------------------------------- | ----: |
| ✅ Structured reference exists          |    15 |
| 📖 Narrative only, no `docs/` reference |     5 |
| ◐ Partial — covered incidentally        |    10 |
| ❌ Nothing                              |     6 |

Counts verified against the tables above programmatically, not by eye — the
first hand count of this table was wrong in two rows.

### The six with nothing

`A3` scheduled tasks & cron · `A7` dashboard & action items · `A8` locations &
kiosk · `B4` facilities · `B16` reports & analytics · and `A5` course cohorts &
syllabus.

`A3` is the most consequential of these: `scheduled_tasks.py` is one of the
largest files in the backend and nothing documents which tasks exist, what
their intervals are, or which features silently depend on them. Several review
findings have turned on exactly that question.

### The five with a narrative but no structured reference

`B5` elections · `B7` equipment-check · `B12` integrations · `B15` admin-hours ·
`B17` events. Each has a wiki page describing what it does, and no single place
stating its data shapes, endpoint gates and invariants.

---

## When you write one

1. Name it `docs/<NAME>_MODULE.md`, matching the existing twelve.
2. Follow the structure of
   [MEDICAL_SCREENING_MODULE.md](./MEDICAL_SCREENING_MODULE.md) (the shortest
   complete example) or [APPARATUS_MODULE.md](./APPARATUS_MODULE.md).
3. **Generate the endpoint, permission, enum and column tables from the code**
   rather than writing them from memory, and say in the document when they were
   generated and how to re-derive them. Counts in prose rot: this repository has
   already carried an `assert_in_org` call-site count that was wrong twice over
   (17 → 16 → 19), and an endpoint count that drifted within two days.
4. Do not duplicate a list that already exists in the wiki page — defer to it
   and link both ways.
5. Register the new file in [README.md](./README.md): both the numbered module
   index and the "where do I find X" lookup table.
6. Update this file's coverage table.
