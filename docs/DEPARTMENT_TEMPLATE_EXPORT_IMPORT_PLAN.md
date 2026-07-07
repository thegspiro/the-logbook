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
| `positions` (roles) | `slug` (fresh org seeds `DEFAULT_ROLES`) → **create-only**, never overwrite existing/`is_system` (S1) | imported `permissions` must be ⊆ importer's own (S1); `settings` JSON may embed device ids → scrub; null `created_by` |
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
3. Run the 3-phase remap algorithm (§2). Natural-key tables match existing rows
   to avoid duplicating the unique indexes (`idx_position_org_slug`, etc.).
   **Match semantics differ by sensitivity:** `positions` and security-relevant
   config (`public_portal_config`, `compliance_configs`, `notification_rules`)
   are **create-only** — matched rows are skipped, never overwritten (S1/S4);
   benign lookups/folders (`document_folders`, system `Default*` lookups) may
   update. Imported permissions are validated ⊆ importer's own (S1).
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

## 8. Security threat model

Import is "accept an untrusted file and write it across every table" — a
high-risk shape. The controls below are **requirements**, not nice-to-haves; a
code-level `/security-review` must run against the implementation before merge.

### 8.1 Baseline guarantees (foundation)

- **Allowlist export.** A table is exported **only** if it has an explicit
  `TableSpec`. A new model is invisible to the exporter until someone adds a
  spec — new PHI/secret tables cannot leak by default.
- **Secret-column disjointness test.** CI asserts the INCLUDE set shares no
  column with a hard-coded secret blocklist (`users`, `sessions`,
  `integrations`, `public_portal_api_keys`, `external_training_providers`,
  `voting_tokens`, `password_history`, `onboarding_sessions`,
  `facility_access_keys`).
- Export/import are **audited** (actor, source org, target org, per-table
  counts, archive sha256) and run in a **single rolled-back-on-error
  transaction**. `alembic_head` is validated before any write. The manifest is
  an integrity hint only — **never** an authorization or trust control (its
  checksum only detects corruption; an attacker recomputes it).
- **Actor gating — super user only (decided).** Both endpoints are restricted
  to the org **System Owner** (`it_manager`, the sole `*` holder) via a
  dedicated `organization.template.manage` permission granted **only** to
  `it_manager` in `DEFAULT_ROLES` — not to president/other admins, and not the
  broad `settings.manage`. Gate on the permission (explicit, auditable), not a
  hardcoded slug. See §8.4 for exactly which risks this closes and which it does
  not.

### 8.2 Threats and required mitigations

| # | Threat | Severity | Required mitigation |
|---|---|---|---|
| S1 | **Privilege escalation via `positions` upsert.** A crafted `{slug:"member", permissions:["*"]}` overwrites an existing role → every member becomes system owner. | Critical → **Medium** with super-user gating (§8.4): the actor already holds `*`, so it is no longer an escalation, only a confused-deputy footgun from a malicious/tampered file. | Roles remain **create-only** (never update existing/`is_system` roles) — cheap guardrail against the footgun. The subset-of-importer check is moot for a `*` holder but harmless. |
| S2 | **Cross-tenant write / tenant-creation escalation.** Target org taken from input → write into another dept. New-org creation via org-scoped perm → arbitrary tenant creation. | Critical | Merge-mode target org = `current_user.organization_id`, **never** from request/manifest. New-org mode gated behind a **platform/superadmin** permission, not `settings.manage`. Userless-org bootstrap (first admin) is an explicit, separately-authorized step — never auto-inject an account. |
| S3 | **Stored XSS / SSRF / invalid-state injection** — bulk insert bypasses Pydantic validators, enum-lowercasing, and HTML sanitization. Vectors: `email_templates.body_html`/`css`, `minutes_templates.header_config.logo_url`, `notification_rules.config` (webhook URLs), portal `allowed_origins`. | Critical | Route **every** imported row through the same schema validation + sanitization as its normal create path. Sanitize all HTML. Allowlist/validate URL fields. Re-validate CORS origins; never trust them. |
| S4 | **Silent overwrite of security config** via one-per-org upsert — re-enable a disabled public portal, widen `allowed_origins`, slacken rate limits. | High | Security-relevant config (`public_portal_config`, `compliance_configs`, `notification_rules`) is **create-only / never-overwrite**, or requires explicit per-item opt-in in the dry-run confirmation. Never silently enable the portal or broaden origins. |
| S5 | **Fail-open on unhandled ID columns.** A missed FK / JSON id-path inserts the raw archive id → cross-links to real target-org rows or dangling FKs. | High | **Fail closed.** CI/startup guard reflects each INCLUDE model's FKs and asserts every one is in `fk_remap ∪ self_ref ∪ null_columns ∪ null_if_excluded`. Any id not resolvable in the global remap map → null or reject; **never** pass a raw archive id through. |
| S6 | **Secrets/PII inside JSON blobs** below the column-level test — notably **`organizations.settings` holds AES-encrypted email/storage credentials** (`encrypt_settings_secrets`). | High | Do **not** export `organizations.settings` secret sub-keys (or org settings at all beyond a vetted allowlist). Deep-JSON scrubbing; extend the disjointness test to scan JSON payloads, not just column names. |
| S7 | **Untrusted-archive DoS / path traversal** — zip bomb, zip slip, oversized JSON. | Medium | Decompressed-size + entry-count caps; JSON size cap; streaming; **never `extractall`** — sanitize/validate every path in the reserved `files/` stage; bounded import transaction; **rate-limit** both endpoints (export is an exfiltration channel too). |
| S8 | **PII leak via denylist scrubbing** — one missed `user_id`/email/phone column leaks PII into a file that leaves HIPAA controls. | Medium | Invert to an **allowlist for user/PII columns**: auto-null any column that FKs `users.id` or matches PII name patterns unless explicitly allowlisted. |
| S9 | **Plaintext archive at rest, outside platform controls** — contains addresses, org identifiers, internal config. | Medium | Optional **passphrase encryption** of the archive; documented handling expectations; audit file creation. |
| S10 | **CSRF on the state-changing import**; cache exposure. | Low | Multipart import POST carries `X-CSRF-Token` (double-submit); add both endpoints to `UNCACHEABLE_PREFIXES`. |
| S11 | **Dry-run as a cross-tenant preview oracle.** | Low | Dry-run enforces **identical authz** to the real import. |
| S12 | **SQL injection** via dynamic per-table queries. | Low | All table/column identifiers are **static** (from the registry); ORM/parameterized only — never interpolate archive-derived identifiers. |

### 8.3 DR-scope caveat (not a vuln, but security-relevant)

Structure-only export carries **no users**, so a "spin up a second instance"
import yields a **userless org with no way to log in**. Full disaster recovery
therefore still requires a separate, deliberately-authorized member/credential
bootstrap. This is intentional (per the structure-only decision) but must be
stated so operators don't mistake a template import for a complete DR restore.

### 8.4 What super-user gating does and does not cover

Restricting both endpoints to the System Owner is **necessary but not
sufficient**. The trust boundary is the **file, not the person** — a super user
handling a template obtained elsewhere, or a tampered/corrupt archive, is still
fully exposed to the content-driven threats.

**Closed / reduced by actor restriction:**

- **S1** — no longer an escalation (actor already holds `*`); downgraded to a
  create-only footgun guard.
- **S2 (actor half)** — far fewer accounts can trigger export/import; smaller
  exfiltration and misuse surface.

**Unchanged by actor restriction — must still be built:**

- **S3** (stored XSS / SSRF from imported content) — a super user's session is a
  *higher-value* XSS target, not a lower one.
- **S5** (fail-open ID passthrough) — a data-integrity defect, privilege-agnostic.
- **S6** (secret/PII leakage on export, e.g. `organizations.settings`) — the
  leak is in the file's contents, not the exporter's rights.
- **S7** (zip bomb / zip slip / DoS) — privilege-agnostic.
- **S4** (security-config overwrite) — remains a real footgun; keep
  never-overwrite.

**Structurally not solvable by "super user":** there is **no cross-org platform
super user** — `it_manager` is org-scoped, and even platform-analytics is
`settings.manage` filtered to the caller's org. So S2's **tenant-creation** half
cannot be authorized by super-user gating. → **v1 supports merge-into-your-own-
org only**; new-org-creation import is deferred until a genuine platform-admin
tier exists.

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
- Permission: add `organization.template.manage`, granted **only** to
  `it_manager` in `DEFAULT_ROLES`; gate both endpoints on it (§8.1). New-org
  mode is out of v1 (no platform-admin tier exists — §8.4).
- Security controls from §8.2 are backend deliverables, not follow-ups:
  create-only role import + permission-subset check (S1), server-derived target
  org (S2), per-row schema revalidation + HTML/URL sanitization (S3),
  never-overwrite security config (S4), the FK-coverage fail-closed guard (S5),
  deep-JSON scrubbing + `organizations.settings` exclusion (S6), archive
  size/entry/path limits + rate limiting (S7).
- Tests: round-trip parity + id/JSON-ref integrity; **no secret/user/PII
  leakage** (column *and* JSON scan); FK-coverage guard; **abuse tests** —
  permission-escalation template rejected (S1), cross-tenant target rejected
  (S2), XSS/SSRF payloads sanitized (S3), security-config not overwritten (S4),
  unmapped-id fail-closed (S5), zip bomb/slip rejected (S7); dry-run authz
  parity; upsert-idempotency (import twice → no dupes).

## 10. Frontend deliverables

- New page `pages/DepartmentTemplatePage.tsx` under Settings, route
  `/settings/template` gated by `organization.template.manage` (System Owner
  only, §8.1); link from `SettingsPage` / `DepartmentSetupPage`.
- **Export tab:** module multi-select (default all), "Export template" →
  downloads the `.zip`.
- **Import tab:** `FileDropzone` for the `.zip` (imports into **this org** only
  in v1 — no new-org mode, §8.4); **runs dry-run first** and shows the
  `TemplateImportSummary` preview (created/updated/skipped per module, nulled
  refs) behind a `ConfirmDialog` before committing.
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

- **Q1 — Import target. DECIDED:** super-user-gated, **merge-into-your-own-org
  only** for v1 (target = session org, server-derived). New-org-creation import
  deferred — no platform-admin tier exists to authorize it safely (§8.4).
- **Q2 — Roles/positions. DECIDED:** positions travel, import is **create-only**
  (never overwrite existing/`is_system` roles). With super-user gating this is a
  footgun guard rather than an anti-escalation control (§8.4), but kept.
- **Q3 — Borderline tables.** Exclude `grant_opportunities` (reference catalog,
  nothing depends on it) and the global `onboarding_checklist` (not
  org-scoped)? (Recommend: exclude both from v1.)
- **Q4 — Subset exports.** When exporting a subset of modules, auto-include the
  referenced structural closure (always self-consistent) vs. null-and-report
  dangling refs? (Recommend: auto-include closure.)
