# Department Template Export / Import — Implementation Plan

> Status: **Design proposal for review.** No implementation code has been written yet.
> Scope decided with stakeholder: a **structure-only** ("department template")
> export/import that covers **all 25 modules generically**, excluding members,
> PHI, transactional history, and secrets.

## 1. Goal & Non-Goals

**Goal.** Let an administrator export a department's *configuration and
definitions* — training requirements, inventory categories/allowances, meeting
& event templates, membership pipelines, roles, forms, email templates,
compliance config, etc. — as a single portable file, and import it into a
**fresh instance** to stand a department back up without rebuilding every
element by hand. This directly serves the two stated motivations: painless
platform migration/upgrade, and disaster-recovery ("spin up a second instance
and keep working").

**In scope (INCLUDE — "structure"):** definitional/lookup/template records that
an admin would otherwise recreate manually. See the registry in §3.

**Out of scope (EXCLUDE), by explicit decision:**

- Members/users, positions *assignments*, prospects, sessions, password history.
- PHI: medical screening records, departure clearances, shift narratives.
- Transactional data & history: actual meetings, events, elections/votes,
  budgets/expenses/purchases, donations, training records/progress, item
  assignments, maintenance/fuel/status logs, notification/message logs, audit
  logs.
- Uploaded files: documents, photos, attachments (the folder *structure* is
  kept; the files are not).
- Secrets: password/MFA/OAuth material, API keys/hashes, integration
  credentials (`encrypted_config`), voting tokens, portal API keys, session
  tokens, election anonymity salts.

> Because members are excluded, this is **not** a disaster-recovery *backup* of
> live operations — it is a template/seed. A separate "full clone with data"
> mode (the other option discussed) can be layered on later by flipping tables
> from EXCLUDE→INCLUDE and adding a file-archive stage; the engine below is
> designed so that is an additive change, not a rewrite.

## 2. Architecture: a metadata-driven engine + a declarative registry

Hand-writing serializers for 55+ tables across 25 modules would be a
maintenance sink and would silently rot as the schema evolves. Instead:

- A **single generic engine** (`app/services/org_template_service.py`) walks a
  **declarative registry** of `TableSpec` entries. Each spec names one
  SQLAlchemy model and how to treat it. Adding/adjusting a table = editing one
  registry entry, not writing code.
- The engine handles the mechanics uniformly: org-scoped selection, UUID
  remapping (columns **and** JSON-embedded IDs), self-referential ordering,
  cross-table topological ordering, user-FK scrubbing, natural-key upsert, and
  system-seed dedupe.

### `TableSpec` shape (the heart of the design)

```python
@dataclass(frozen=True)
class TableSpec:
    model: type[Base]                       # SQLAlchemy model
    # How rows are scoped to an org:
    org_scoped: bool = True                 # has organization_id directly
    parent_fk: str | None = None            # else: column that scopes via parent
    # Import identity / conflict handling:
    natural_key: tuple[str, ...] | None = None   # e.g. ("slug",) → upsert on match
    system_seed: bool = False               # is_system rows already seeded per-install → match & skip
    # Reference rewriting on import (old id → new id):
    fk_remap: dict[str, str] = field(default_factory=dict)   # column -> referenced tablename
    self_ref: tuple[str, ...] = ()          # self-referential FK columns (e.g. parent_id)
    json_id_paths: tuple[JsonIdPath, ...] = ()   # JSON paths that embed row IDs to remap
    # Scrubbing for structure-only export:
    null_columns: tuple[str, ...] = ()      # user-FK / audit / secret cols → set NULL
    null_if_excluded: dict[str, str] = field(default_factory=dict)  # col -> tablename; null if target not exported
    regenerate: tuple[str, ...] = ()        # unique tokens/slugs to regenerate, not copy
    conditional_scrub: tuple[ConditionalScrub, ...] = ()  # e.g. approver_value nulled when approver_type==SPECIFIC_USER
```

`JsonIdPath` describes a location inside a JSON column that holds an ID or list
of IDs referencing another table (e.g. `training_courses.category_ids` →
`inventory`/`training_categories`). The engine rewrites these using the global
id map.

### Import id-remap algorithm (3 phases — handles forward refs and cycles)

1. **Map phase.** For every exported row, compute its *target* id:
   - `natural_key`/`system_seed` tables → look up an existing row in the target
     org by the natural key; if found, reuse that id (**upsert**); else mint a
     new UUID.
   - all others → mint a new UUID.
   Result: a complete `old_id → new_id` map across all tables *before* any
   writes.
2. **Rewrite phase.** Using the full map, rewrite every `fk_remap` column,
   every `self_ref` column, and every `json_id_paths` value. Apply
   `null_columns`, `null_if_excluded` (null any FK whose target id isn't in the
   map), `regenerate`, and `conditional_scrub`.
3. **Write phase.** Insert (or update-on-match for upsert tables) in
   **topological order** derived from `fk_remap` + `parent_fk`, with
   intra-table parent-before-child ordering for `self_ref` tables.

Building the *entire* id map up front (phase 1) is what lets JSON arrays that
point at sibling rows (e.g. `prerequisite_course_ids`) and self-referential
chains resolve correctly regardless of write order.

## 3. Export Registry (the INCLUDE set)

All rows below are **structure** and get exported. Everything not listed is
EXCLUDE. `‑` = none. "parent" = no direct `organization_id`, scoped via the
named FK. Sourced from a full per-table audit of every model file.

### Roles, Forms, Comms, Portal (`user.py`, `forms.py`, `document.py`, `notification.py`, `email_template.py`, `public_portal.py`)

| Table | Natural key / seed | Remap / hazards |
|---|---|---|
| `positions` (roles) | `slug` (fresh org seeds `DEFAULT_ROLES`) → **upsert** | `permissions` JSON safe (perm strings); `settings` JSON may embed device ids → scrub; null `created_by` |
| `forms` | — | regenerate `public_slug`; null `created_by` |
| `form_fields` | parent `form_id` | `condition_field_id` self-ref (undeclared FK, remap) |
| `form_integrations` | parent `form_id` | `field_mappings` JSON embeds form-field ids → remap |
| `document_folders` | `slug` for system folders → **upsert** | self-ref `parent_id`; export system/non-owner folders only; null `owner_user_id`/`created_by` |
| `notification_rules` | — | null `created_by`; `config` JSON inspected for ids |
| `email_templates` | `name`/type | null `created_by`/`updated_by` |
| `public_portal_config` | one-per-org (upsert) | — |
| `public_portal_data_whitelist` | parent `config_id` | remap `config_id` |

### Training & Compliance (`training.py`, `skills_testing.py`, `medical_screening.py`, `compliance_config.py`, `admin_hours.py`)

| Table | Natural key / seed | Remap / hazards |
|---|---|---|
| `training_categories` | — | self-ref `parent_category_id`; null `created_by` |
| `training_courses` | — | JSON `prerequisites`, `category_ids` remap |
| `training_requirements` | — | JSON `required_courses`, `required_skills`, `category_ids` remap |
| `training_programs` | `is_template` | JSON `prerequisite_program_ids` remap |
| `program_phases` | parent `program_id` | JSON `prerequisite_phase_ids` remap |
| `program_requirements` | parent `program_id` | FKs `phase_id`, `requirement_id` remap |
| `program_milestones` | parent `program_id` | FK `phase_id` remap |
| `skill_evaluations` | — | **`allowed_evaluators` JSON may embed user_ids → scrub**; `required_for_programs` remap |
| `skill_templates` | — | null `created_by`; JSON structural only |
| `training_module_configs` | one-per-org | JSON `manual_entry_apparatus_ids` remap |
| `self_report_configs` | one-per-org | — |
| `shift_templates` | — | loose `apparatus_id` (no FK) |
| `basic_apparatus` | — | positions JSON (slugs) |
| `recertification_pathways` | — | JSON `required_courses`, `category_hour_requirements`, `prerequisite_pathway_ids`; FKs `source_requirement_id`, `assessment_course_id` |
| `competency_matrices` | — | `skill_requirements` JSON embeds skill_evaluation_ids; loose `role_id`→positions |
| `screening_requirements` | — | `applies_to_roles` JSON (names, safe) |
| `compliance_configs` | one-per-org | scrub `report_email_recipients` (email PII) |
| `compliance_profiles` | parent `config_id` | JSON `role_ids`, `required_requirement_ids`, `optional_requirement_ids`, `admin_hours_requirements` remap |
| `admin_hours_categories` | — | null `created_by`/`updated_by` |
| `event_hour_mappings` | — | FK `admin_hours_category_id` remap |

### Apparatus, Inventory, Facilities, Locations, Ranks (`apparatus.py`, `inventory.py`, `facilities.py`, `location.py`, `operational_rank.py`)

| Table | Natural key / seed | Remap / hazards |
|---|---|---|
| `apparatus_types` | `system_seed` (NULL-org `is_system`) | JSON — ; dedupe system rows |
| `apparatus_statuses` | `system_seed` | dedupe system rows |
| `apparatus_custom_fields` | — | `applies_to_types` JSON = apparatus_type_ids → remap |
| `apparatus_maintenance_types` | `system_seed` | `applies_to_types` JSON remap |
| `evoc_levels` | `system_seed` | FK `training_program_id`→training_programs (remap or null) |
| `equipment_check_templates` | — | null `apparatus_id` (excluded asset); keep type-level templates |
| `check_template_compartments` | parent `template_id` | self-ref `parent_compartment_id` |
| `check_template_items` | parent `compartment_id` | null `equipment_id` (excluded) |
| `inventory_categories` | — | self-ref `parent_category_id` |
| `issuance_allowances` | — | FKs `category_id`, `role_id`→positions remap |
| `storage_areas` | — | self-ref `parent_id`; FK `location_id` |
| `item_variant_groups` | — | FK `category_id` remap |
| `equipment_kits` | — | roles JSON (slugs) |
| `equipment_kit_items` | parent `kit_id` | null `item_id` (excluded); keep `category_id` |
| `facility_types` | `system_seed` | dedupe |
| `facility_statuses` | `system_seed` | dedupe |
| `facility_maintenance_types` | `system_seed` | dedupe |
| `locations` | — | null `facility_id`/`facility_room_id`; regenerate `display_code` |
| `operational_ranks` | `rank_code` | `eligible_positions` JSON (slugs, safe) |

### Meetings/Events (`meeting.py`, `minute.py`, `event.py`, `event_request.py`)

| Table | Natural key / seed | Remap / hazards |
|---|---|---|
| `minutes_templates` | — | `header_config` JSON may embed logo_url; null `created_by` |
| `event_templates` | — | FK `default_location_id`→locations remap |
| `event_request_email_templates` | — | null `created_by` |

### Membership & Finance (`membership_pipeline.py`, `finance.py`)

| Table | Natural key / seed | Remap / hazards |
|---|---|---|
| `membership_pipelines` | `is_template` | JSON `report_stage_groups`/`inactivity_config` may embed step ids |
| `membership_pipeline_steps` | parent `pipeline_id` | FK `email_template_id`→email_templates; `config` JSON may embed ids |
| `fiscal_years` | — | reset `status`/`is_locked` to draft/false |
| `budget_categories` | — | self-ref `parent_category_id` |
| `approval_chains` | — | FK `budget_category_id` remap |
| `approval_chain_steps` | parent `chain_id` | FK `email_template_id`; **`approver_value` embeds user id when `approver_type=SPECIFIC_USER` → conditional scrub** |
| `dues_schedules` | — | FK `fiscal_year_id` remap |
| `finance_export_mappings` | — | name-based, clean |

## 4. Archive format

A single `.zip` (`{slug}-template-{version}.ltx.zip`):

```
manifest.json      # format version, app version, alembic head, source org name,
                   #   created_at (UTC), module list, per-table row counts, sha256 of data.json
data.json          # { "<tablename>": [ {row}, ... ], ... } — INCLUDE tables only, scrubbed
```

- **No `files/` tree** in structure-only mode (documents/photos are EXCLUDE).
  The stage is reserved in the format for the future full-clone mode.
- `manifest.json.alembic_head` gates import: refuse (or warn) if the target
  schema revision differs, to avoid importing into an incompatible schema.
- `data.json` never contains a secret column — enforced structurally (see §8).

## 5. Export flow

1. `GET /api/v1/organizations/template/export?modules=training,inventory,...`
   (default: all). Permission `settings.manage` (+ new `organization.template.export`).
2. Engine iterates registry (filtered to requested modules), selects org-scoped
   rows (direct or via `parent_fk` join), applies `null_columns` /
   `regenerate` / `conditional_scrub`, and **omits system-seed rows** unless
   they are org-custom.
3. Serialize to `data.json`, compute checksums, stream the `.zip` back.
4. `log_audit_event("organization.template.exported", ...)`.

**Referential-completeness guard.** If the admin exports a *subset* of modules,
cross-module references (e.g. `issuance_allowances.role_id`→positions,
`compliance_profiles.required_requirement_ids`→training) may dangle. The engine
computes the closure of required tables and either (a) auto-includes the
referenced structural tables, or (b) nulls the dangling refs and reports them in
the response. Default recommendation: **auto-include the closure** so a subset
export is always self-consistent.

## 6. Import flow

1. `POST /api/v1/organizations/template/import` (multipart: the `.zip` + target
   selector). Permission `settings.manage` (+ new `organization.template.import`).
2. Target modes (see Open Question Q1):
   - **New department** — create a new `Organization` (name/slug from the form),
     run the standard fresh-org seed (roles, system folders, system lookups),
     then import — so upsert/seed dedupe attaches to real existing rows.
   - **Existing (empty/seed-only) org** — merge into the caller's org.
3. Run the 3-phase remap algorithm (§2). Upsert tables (`positions`,
   `document_folders`, system lookups, one-per-org configs) match on natural key
   and update rather than duplicate — respecting the unique indexes
   (`idx_position_org_slug`, etc.).
4. Everything in **one transaction**; roll back entirely on any failure. Return
   a summary: rows created/updated/skipped per table, and any nulled refs.
5. `log_audit_event("organization.template.imported", ...)`.

**Dry-run.** `POST .../template/import?dry_run=true` runs phases 1–2 and the
conflict analysis without writing, returning the same summary as a preview.
This is the safety valve for imports into a non-empty org.

## 7. Correctness hazards & how the registry neutralizes each

| Hazard | Handling |
|---|---|
| Self-referential FKs (`document_folders.parent_id`, `inventory_categories.parent_category_id`, `budget_categories.parent_category_id`, `storage_areas.parent_id`, `check_template_compartments.parent_compartment_id`, `training_categories.parent_category_id`, `form_fields.condition_field_id`) | `self_ref` spec + full-map phase 1 + parent-before-child write ordering |
| **JSON-embedded foreign IDs** (training/compliance are dense with these) | `json_id_paths` spec rewrites them in phase 2 |
| Unique indexes on natural keys (`idx_position_org_slug`, folder slug, one-per-org configs) | `natural_key` → upsert, never blind-insert |
| Rows a fresh org already seeds (`DEFAULT_ROLES`, `SYSTEM_FOLDERS`, `Default*` lookups) | `system_seed`/`natural_key` match-and-reuse; only org-custom rows travel |
| INCLUDE→EXCLUDE FKs (`locations.facility_id`, `equipment_check_templates.apparatus_id`, `check_template_items.equipment_id`, `equipment_kit_items.item_id`) | `null_if_excluded` / `null_columns` |
| Cross-module INCLUDE→INCLUDE FKs (`pipeline_steps.email_template_id`, `approval_chain_steps.email_template_id`, `evoc_levels.training_program_id`, `issuance_allowances.role_id`) | topo sort across modules + closure auto-include (§5) |
| User IDs hidden in value columns (`approval_chain_steps.approver_value` when `SPECIFIC_USER`; `skill_evaluations.allowed_evaluators`) | `conditional_scrub` / `json_id_paths` scrub |
| Unique non-guessable tokens (`locations.display_code`, `forms.public_slug`) | `regenerate` |
| Global (non-org) tables (`onboarding_checklist`) | special-cased; excluded by default (Q3) |
| Stateful config that shouldn't carry live state (`fiscal_years.is_locked`, election/report status) | reset-on-export defaults in the spec |

## 8. Security / HIPAA guarantees

- **Allowlist, not denylist.** A table is exported **only** if it has an
  explicit `TableSpec`. A new model added to the codebase is invisible to the
  exporter until someone deliberately adds a spec — so new PHI/secret tables
  cannot leak by default.
- **No secret column is in any INCLUDE table.** Every credential/token/hash
  lives in an EXCLUDE table (`users`, `sessions`, `integrations`,
  `public_portal_api_keys`, `external_training_providers`, `voting_tokens`,
  `password_history`, `onboarding_sessions`, `facility_access_keys`). A
  unit test asserts the INCLUDE set is disjoint from a hard-coded
  secret-column blocklist, failing CI if the two ever overlap.
- **User-reference scrubbing** nulls every `created_by`/`updated_by`/owner FK
  and the conditional value-column cases, so no member identity rides along.
- Export/import are **audited** and permission-gated (`settings.manage`).
- Import validates `alembic_head` and `manifest` checksums before touching the
  DB, and runs in a single rolled-back-on-error transaction.

## 9. Backend deliverables

- `app/services/org_template_service.py` — engine (export, import, dry-run,
  closure computation).
- `app/services/org_template_registry.py` — the `TableSpec` registry (§3) and
  `SECRET_COLUMN_BLOCKLIST`.
- `app/schemas/org_template.py` — `TemplateManifest`, `TemplateImportRequest`,
  `TemplateImportSummary` (camelCase response via existing `to_camel` config).
- Endpoints appended to `app/api/v1/endpoints/organizations.py`:
  `GET  /organizations/template/export`,
  `POST /organizations/template/import` (`?dry_run=`).
- Permissions: add `organization.template.export` / `.import` to the permission
  catalog; grant to admin/system roles in `DEFAULT_ROLES`.
- Tests: round-trip (export org A → import to fresh org B → assert structural
  parity, id-remap integrity, JSON-ref integrity, no secret/user leakage),
  dry-run, subset-with-closure, upsert-idempotency (import twice → no dupes).

## 10. Frontend deliverables

- New page `pages/DepartmentTemplatePage.tsx` under Settings, route
  `/settings/template` gated by `settings.manage`; link from `SettingsPage` and
  `DepartmentSetupPage`.
- **Export tab:** module multi-select (default all), "Export template" →
  downloads the `.zip`.
- **Import tab:** `FileDropzone` for the `.zip`; target-mode selector (new dept
  vs. this dept); **runs dry-run first** and shows the `TemplateImportSummary`
  preview (created/updated/skipped per module, nulled refs) behind a
  `ConfirmDialog` before committing.
- New module axios instance (or reuse global) with `withCredentials` + CSRF per
  project convention; template endpoints added to `UNCACHEABLE_PREFIXES`.
- Types in `types/`, enums/labels in `constants/enums.ts`, form-value coercion
  with `||` per project rules.

## 11. Phasing

1. **Engine + registry + export** (backend) with the secret-disjointness test —
   shippable and independently useful (admins can pull a template file).
2. **Import + dry-run** (backend) — the risky half; lands with round-trip and
   idempotency tests.
3. **Frontend** export/import UI with dry-run preview.
4. **(Future, additive)** full-clone-with-data mode: flip EXCLUDE→INCLUDE for
   chosen tables + add the `files/` archive stage + members/secrets handling.

## 12. Open questions for stakeholder

- **Q1 — Import target.** Support importing into a brand-new org (create it
  during import) *and* merging into the current org? Or new-org only for now?
  (Recommend: both, with new-org as the primary DR path.)
- **Q2 — Roles/positions.** Confirm positions should travel and **upsert on
  slug** (a new dept wants the same role set + permissions, merged with the
  seeded defaults). (Recommend: yes.)
- **Q3 — Borderline tables.** Exclude `grant_opportunities` (reference catalog,
  nothing depends on it) and the global `onboarding_checklist` (not
  org-scoped)? (Recommend: exclude both from v1.)
- **Q4 — Subset exports.** When exporting a subset of modules, auto-include the
  referenced structural closure (always self-consistent) vs. null-and-report
  dangling refs? (Recommend: auto-include closure.)
