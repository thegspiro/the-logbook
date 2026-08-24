# Alembic Migration Tracking

> **Purpose:** Prevent revision-ID collisions and broken `down_revision` chains when
> generating new migration files. Always consult this document before creating a new
> migration.

## Conventions

| Rule               | Detail                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Creating one**   | Run `alembic revision -m "short description"` and **keep the id it generates.** `file_template` in `alembic.ini` already names the file `YYYYMMDD_HHMM_<rev>_<slug>.py`, so listings stay in date order. |
| **Revision ID**    | Whatever `alembic revision` wrote. Do **not** hand-author one, and do not edit it to match the filename.                                                                                                 |
| **down_revision**  | Must point to the revision ID of the **immediately preceding** migration in the chain. Get it from `python scripts/validate_migrations.py` (run from `backend/`), which prints the current head.         |
| **One stale file** | `20260216_0100_add_pipeline_features_and_tables.py.stale` is intentionally excluded from the chain.                                                                                                      |

### Why ids are generated, not hand-authored _(2026-08-17)_

This document used to require the opposite — `YYYYMMDD_SSSS`, a per-day
sequence, with "**No hex/random IDs**" stated as a rule. That rule is what
caused the collisions this document exists to prevent.

Two branches open on the same day each counted from `_0001` and each picked
`_0002`. The files do not overlap, so **git merges them without a word**;
Alembic then refuses to load a chain with one id claimed twice, and the backend
crashes on startup rather than failing at review. That happened **four times**,
the last twice in a single day.

A generated id carries entropy, so two branches cannot pick the same one. The
date lives in the filename, which is what anyone actually reads when scanning
the directory. Nothing in the codebase parses a revision id's structure — the
validator compares them as opaque strings — so the format was never load-bearing.

`scripts/validate_migrations.py` enforces this: a `YYYYMMDD_SSSS` id dated
**2026-08-17 or later** is an error, since the convention changed that day.
The rule is keyed on the date the id already carries rather than on a position
in the chain — a revision anchor would need bumping every time another branch
landed a migration first, and whoever forgot would get a failure blaming a
migration written under the old rules. Everything already written is left
alone; renumbering released history would break every database that has
already stamped those ids.

## Current Head

**Ask the chain, not this file:**

```bash
cd backend && python scripts/validate_migrations.py    # prints the head and the down_revision to use
```

This section used to declare the head in prose, and every migration PR edited
the same lines to update it. That guaranteed a merge conflict on each one, and
it went stale the moment anyone forgot — as it had here, still naming
`20260816_0003` after `20260816_0004` landed. A fact the tooling can derive
should not be transcribed by hand.

What follows is kept as **history** — why the chain forks and merges where it
does. It is not the source of truth for the current head.

<details>
<summary>Historical head notes (2026-05 through 2026-08)</summary>

> **Update (2026-08-17) — the four-head fork, and why three merge revisions
> look redundant.** `20260816_0006` (backfill legacy shift finalization) and
> `20260816_0007` (unify email notification preference) both revise
> `20260816_0005`. **Five pull requests independently noticed that fork and
> each wrote a merge for it. All five merged within the hour**, so the repair
> became the fork: `main` was left with four heads and two files claiming
> revision id `20260816_0008`, which makes the versions directory unloadable —
> `alembic upgrade head` fails outright, a fresh install cannot migrate, and
> the head-count tests fail on every open pull request.
>
> The repair, and the constraints on it:
>
> - `20260816_0008_merge_finalization_and_email_prefs.py` was **deleted**. The
>   duplicate id has to go for Alembic to load _either_ revision, and this file
>   was a no-op merge — the only member of the set whose removal has no schema
>   consequence. `20260816_0008_add_driver_exceptions.py` keeps the id.
> - The two redundant no-op merges (`71d86eba9a9e`, `bb34f8937c89`) were
>   **kept**. A deployment may already have stamped them, and deleting a
>   recorded revision strands that database at an id its chain no longer
>   contains. They are harmless: Alembic runs each ancestor exactly once
>   however many merge paths reach it.
> - `20260817_1847_8050e5a61f34_rejoin_the_four_heads_left_by_.py` names all
>   four surviving heads (`20260816_0008`, `20260816_0009`, `71d86eba9a9e`,
>   `bb34f8937c89`) as its parents.
>
> **The lesson is the one this document already teaches, at a larger scale:**
> run `alembic heads` _before_ writing a migration, and — new here — before
> writing a **merge**. Four of the five authors were each fixing a real
> problem; the cost came from none of them knowing the others were.
>
> **`20260816_0009` was renumbered** from an earlier `20260816_0006`, and
> `20260816_0006` (shift-finalization backfill) was itself renumbered off a
> collided id. Anything already released keeps its id — renumbering stamped
> history would break every database that has recorded it.

> **Update (2026-08-16):** The head was **`20260816_0003`**
> (`20260816_0003_add_inventory_vendors.py`). Past `20260814_0004` the chain runs
> `20260816_0001` (`facility_rooms.parent_room_id`, nested rooms) →
> `20260816_0002` (backfill storage-area barcodes) → `20260816_0003`
> (inventory vendors + contact backfill) → `_0004` (medical item type) →
> `_0005` (backfill medical supply grants) → `20260816_0007` (fold the
> duplicate `email` notification preference into `email_notifications`).
>
> **`20260816_0007` was renumbered from `20260816_0002`** — the **fifth**
> same-day collision, and the second one on this date alone: it claimed `_0002`
> off `_0001` while the storage-area barcode backfill held it on main. The
> duplicate-revision guards in `tests/test_alembic_migrations.py` and
> `tests/test_changelog_fixes.py` caught it after merging main, which is what
> they are for — but the cheaper catch is `alembic heads` **before** writing
> the file and **again after merging main**, as the note below has been asking
> for since the third occurrence.
>
> **`20260816_0003` was renumbered from `20260816_0002`** — the vendor branch
> and the storage-area barcode branch both claimed `_0002` off `_0001` on the
> same day, the fourth occurrence of the same-day collision this document
> warns about. The vendor migration (merged second) took the next number and
> chains after the barcode backfill.
>
> **Superseded within the same day (2026-08-16):** the head was
> **`20260816_0001`**
> (`20260816_0001_add_facility_room_parent.py` — `facility_rooms.parent_room_id`,
> for rooms nested inside other rooms). It chains onto `20260814_0004`, so the
> route below is unchanged behind it.
>
> **Superseded within the same day (2026-08-16):** the head was
> **`20260814_0004`**
> (`20260814_0004_revoke_captain_facilities_view_sensitive.py`).
>
> That revision is a **merge**: `down_revision = ("20260814_0003",
"20260813_0020")`. It joins the event-reminder branch to the published
> saved-ballot/reconciliation chain and performs the Captain permission repair,
> leaving one head without changing the published `20260814_0002` / `_0003`
> identities.
>
> Past `20260812_0004` the chain runs `20260813_0001` (shift-template vehicle
> fields) → `_0002` (apparatus crew positions) → `_0006` (backfill training
> result visibility) → `_0007` (reconcile skill-test resume count) → `_0008`
> (backfill `facilities.view_sensitive`) → `_0009` (`manual_batch_ballots_cast`)
> → `_0010` (scheduling module configs) → `_0011` (event mandatory membership
> types) → `20260814_0001` (store open-banner setting) → `_0002` (saved-ballot
> election settings) → `_0003` (reconcile active-prospect emails) → `_0004`
> (**head**). `20260813_0020` (event reminder target) branches off `_0010` and is
> merged back in by `20260814_0004`.
>
> The full ordered route for the 2026-08-10 → 08-16 window, with what each
> revision answers and the required preflight, is in the
> [six-day change audit](./CHANGE_AUDIT_2026-08-10_TO_16.md#alembic-route-upgrade-data-path).
>
> **Superseded (2026-08-12):** The head was **`20260812_0001`**
> (`20260812_0001_add_saved_ballot_templates.py`).
>
> Past `20260810_0008` the chain runs `20260811_0001` (optional equipment-kit
> items) → `20260811_0002` (skill-test return trail) → `20260812_0001`
> (`saved_ballot_templates` — org-scoped reusable ballot snapshots).
>
> **Superseded (2026-08-10):** The head was **`20260810_0008`**
> (`20260810_0008_add_deployed_lots.py`).
>
> Past `20260805_0010` the chain runs `20260806_*` → `20260807_*` →
> `20260808_0001` (skill test validation) → `0002` (owns_requirement) → `0003`
> (drop the shift-equipment-check apparatus FK) → `20260809_0001` (guest
> check-in) → `20260810_0001` (encrypt medical-screening PHI) → `0002`
> (`score_pass_fail_criteria`) → `0003` (email templates track default CSS) →
> `0004` (`email_templates.footer_key`) → `0005` (`expiration_found`) → `0006`
> (restock flag + companions) → `0007` (`quantity_on_truck`) → `0008`
> (`check_item_deployed_lots`).
>
> **`20260810_0005`–`_0008` were renumbered from `_0003`–`_0006`.** `main` landed
> the email-template pair at `_0003`/`_0004` while the check branch was open, and
> both branches had numbered from `20260810_0002`. Two revision IDs with two
> files each is not a merge conflict git can see — it is a chain Alembic refuses
> to load, and the backend **crashes on startup** rather than failing at review.
> This is the third time that has happened; **run `alembic heads` before writing
> a migration and again after merging main.**
>
> **Superseded (2026-08-05):** The head was **`20260805_0010`**
> (`20260805_0010_reconcile_index_set.py`).
>
> Past `20260802_0010` (storefront email templates) the chain runs
> `20260805_0001` (course syllabus and cohorts) → `0002` (merge) → `0101` →
> `0102` → `0003` → … → `0009` → `0010`. The two out-of-sequence ids are
> deliberate: `0101` and `0102` were authored on a branch that claimed `0001`
> and `0002` while the cohort branch already held them, and renumbering those
> two — rather than the seven downstream — kept every id already cited in the
> wiki, the CHANGELOG and `docs/` pointing at the revision it was written about.
>
> **They sit in an `01xx` band on purpose.** They were first relabelled `0010`
> and `0011` — the next two numbers the sequence would hand out — and
> `20260805_0010` was claimed by `reconcile_index_set` on main within the hour,
> recreating the very duplicate the rename existed to remove. Ordinary
> allocation increments by one from `0001` and will not reach `01xx`.
>
> **A date-sequence id is not reserved by writing it.** Two branches pick the
> same number independently and neither notices until both are on main, where
> Alembic warns "present more than once", keeps one of each pair, and drops the
> other from the graph. That left three heads and a silently skipped revision.
> `tests/test_alembic_migrations.py` now fails on a duplicate id, so this
> surfaces in CI rather than in a deployment.
>
> Recent order: `20260801_0020` (storefront tables) and `20260802_0001` (dues
> payments ledger) both branched off `20260801_0019`; **`20260802_0002`** is the
> merge revision that reconciled them, and the storefront chain then continued
> `20260802_0003` → … → `20260802_0010` before `20260805_0001` landed on top.
>
> **A merge revision written on a feature branch goes stale the moment main
> merges the same fork itself.** `20260805_0001` was authored as a second merge
> of `(20260801_0020, 20260802_0001)` while those really were the two heads. By
> the time it merged, main had already reconciled them via `20260802_0002` and
> added eight more revisions, so the tuple parent re-forked the graph — and
> because `backend/main.py` resolves multiple heads by picking the
> lexicographically largest, startup would have upgraded to `20260805_0001` and
> silently skipped `20260802_0003`…`20260802_0010`. Re-parenting it onto the
> real head fixed both. **Re-check `alembic heads` after merging main into a
> branch, not just when writing the migration** — a merge revision is only
> correct against the heads that exist at merge time.
>
> This is the third time the chain has forked (see the 2026-05 and 2026-06 notes
> below). The pattern is always the same — two branches opened the same day off
> a shared parent — and the fix is always the same: one migration takes a tuple
> `down_revision`. **Run `alembic heads` before writing a migration** rather
> than assuming the documented head is current.

> **Update (2026-07-29):** The chain is **linear with a single head**. The
> current head is **`20260729_0001`**
> (`20260729_0001_widen_public_portal_api_key_prefix.py`). **New migrations must
> set `down_revision = "20260729_0001"`.**
>
> Recent migrations, in order: `20260720_0001` (shift training-slot fields +
> shift lifecycle status) → `20260720_0002` (backfill department-message role
> ids) → `20260720_0003` (department-message `scheduled_at`) → `20260720_0004`
> (department-message `deleted_at`) → `20260721_0001` (`users.calendar_feed_token`)
> → `20260722_0001` (`shifts.pass_down_notes`) → … → `20260725_0001` (MFA
> last-timestep) → `20260726_0001` (audit-log `hash_version`) → `20260727_0001`
> (session refresh grace) → `20260728_0001` (`security_alerts.organization_id`) →
> `20260729_0001` (widen `public_portal_api_keys.key_prefix`).
>
> **Note on `20260720_0001`:** a duplicate revision id (two files both claimed
> `20260720_0001`) once made the chain unrunnable. It was resolved by keeping
> `20260720_0001` = `add_training_positions_and_shift_status` and renumbering the
> former duplicate to **`20260720_0004_add_department_message_deleted_at.py`**;
> the chain was relinearized (single root, single head).

> **Note (2026-05-29):** The hand-maintained "Full Revision Chain" table is
> stale and ends at `20260223_0300`; roughly 75 additional migrations exist on
> disk between that revision and the current heads. The chain has also
> **branched** and currently has **two heads** with no merge migration.
>
> _(2026-08-17: the table was removed. It was never brought up to date after
> this note — by then it had fallen ~199 migrations behind — and
> `alembic history` answers the same question without going stale. The chain
> has since been relinearized to a single head.)_

| Field                        | Value                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| **Head revision (branch A)** | `20260528_0002` (`20260528_0002_add_oauth_fields_to_users.py`)                          |
| **Head revision (branch B)** | `20260503_0002` (`20260503_0002_add_include_current_month_to_training_requirements.py`) |
| **Branch point**             | `20260502_0004` (both heads descend from it)                                            |

### Active Branch (2026-05)

`20260502_0004` (drop `training_sessions.approval_required`) has two children,
so the chain forks:

```
20260502_0004
├── 20260503_0001 ──► 20260503_0002   (include_current_month: org + per-requirement)
└── 20260528_0001 ──► 20260528_0002   (rename membership role; oauth user fields)
```

There is no merge migration reconciling these two heads yet. A future migration
should set `down_revision` to **both** heads (a tuple) to merge them, e.g.
`down_revision = ("20260503_0002", "20260528_0002")`, before adding new linear
migrations on top.

</details>

## Adding a new migration

Let Alembic write the id — see [Why ids are generated](#why-ids-are-generated-not-hand-authored-2026-08-17).

```bash
cd backend                                # both tools live here, not at the repo root
python scripts/validate_migrations.py     # note the head it prints
alembic revision -m "add widget table"    # writes YYYYMMDD_HHMM_<rev>_add_widget_table.py
```

Then set `down_revision` to the head from the first command, and leave the
generated `revision` value alone. Re-run the validator before pushing; it fails
on a duplicate id, a broken chain, or a hand-authored id after the cutover.

## Full Revision Chain

```bash
cd backend
alembic history                        # the whole chain, in order
python scripts/validate_migrations.py  # the head, and a check that the chain is sound
```

This section used to hold the chain as a hand-maintained table. It was
abandoned at `20260223_0300` in February and covered 115 of 314 migrations —
37% of a chain it claimed to document in full, which is worse than not being
here at all, because it looks authoritative. Alembic already knows the answer
and cannot go stale.

## Known Non-Standard Revision IDs

These three predate the 2026-08-17 change and did not follow the
`YYYYMMDD_SSSS` convention that was in force at the time. Listed for
recognition, not as a warning — generated hex ids are now the rule, and
`a7f3e2d91b04` is exactly what `alembic revision` produces today. The slug and
the truncated forms are still worth avoiding, since neither carries enough
entropy to be collision-proof:

| Revision ID           | File                                                          | Note                       |
| --------------------- | ------------------------------------------------------------- | -------------------------- |
| `add_meeting_minutes` | `20260212_1200_add_meeting_minutes_tables.py`                 | Human-readable slug        |
| `a7f3e2d91b04`        | `20260213_1400_add_trustee_executive_annual_meeting_types.py` | Alembic auto-generated hex |
| `dc01a`               | `20260219_0100_add_departure_clearance_tables.py`             | Truncated hex              |

## Template for New Migrations

```python
"""Short description of what this migration does

Revision ID: <generated by alembic revision — leave as written>
Revises: <previous_revision_id>
Create Date: YYYY-MM-DD HH:MM:SS.000000
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "<generated by alembic revision — leave as written>"
down_revision = "<previous_revision_id>"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ... your schema changes ...
    pass


def downgrade() -> None:
    # ... reverse of upgrade ...
    pass
```

## Recent Migrations (2026-05)

These migrations were added from May 2026 onward, annotated with what each one
answers — which `alembic history` cannot tell you. It is a commentary on part of
the chain, not the chain itself; run `alembic history` for that. The first four
are a linear run off `20260411_0200`; after `20260502_0004` the chain forks (see
"Active Branch" in the collapsed history notes above).

| Revision ID     | Down Revision                    | Filename                                                                  | Description                                                                                                                                                                                                                                                                                    |
| --------------- | -------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260502_0001` | `20260411_0200`                  | `20260502_0001_backfill_training_config_null_booleans.py`                 | Backfill NULL boolean columns in `training_module_configs`                                                                                                                                                                                                                                     |
| `20260502_0002` | `20260502_0001`                  | `20260502_0002_add_attempt_tracking_to_inventory_notification_queue.py`   | Add `attempt_count` / `last_attempt_at` to `inventory_notification_queue` (delivery circuit breaker)                                                                                                                                                                                           |
| `20260502_0003` | `20260502_0002`                  | `20260502_0003_add_server_defaults_to_training_module_config_booleans.py` | Add DB-level `server_default` clauses to `training_module_configs` boolean flags                                                                                                                                                                                                               |
| `20260502_0004` | `20260502_0003`                  | `20260502_0004_drop_training_session_approval_required.py`                | Drop unused `approval_required` column from `training_sessions`                                                                                                                                                                                                                                |
| `20260503_0001` | `20260502_0004`                  | `20260503_0001_add_include_current_month_to_compliance_config.py`         | Add `include_current_month` (Bool NOT NULL, default true) to `compliance_configs`                                                                                                                                                                                                              |
| `20260503_0002` | `20260503_0001`                  | `20260503_0002_add_include_current_month_to_training_requirements.py`     | Add nullable `include_current_month` override to `training_requirements` (NULL inherits org default) — **head of branch B**                                                                                                                                                                    |
| `20260528_0001` | `20260502_0004`                  | `20260528_0001_rename_membership_committee_chair_to_coordinator.py`       | Rename the "Membership Committee Chair" system position to "Membership Coordinator" (in-place rename, assignments preserved)                                                                                                                                                                   |
| `20260528_0002` | `20260528_0001`                  | `20260528_0002_add_oauth_fields_to_users.py`                              | Add nullable `oauth_provider` / `oauth_subject` to `users` + index `ix_users_oauth_subject` — former head of branch A                                                                                                                                                                          |
| `20260604_0001` | `(20260528_0002, 20260503_0002)` | `20260604_0001_merge_heads_add_shift_assignment_status_index.py`          | **Merge** branches A + B; add composite index `idx_shift_assign_shift_status` on `shift_assignments(shift_id, assignment_status)`                                                                                                                                                              |
| `20260604_0100` | `20260528_0002`                  | `20260604_0100_add_equipment_request_fulfillment_fields.py`               | Add `fulfilled_by` / `fulfilled_at` / `fulfillment_type` / `fulfillment_reference_id` to `equipment_requests`                                                                                                                                                                                  |
| `20260604_0200` | `20260604_0100`                  | `20260604_0200_backfill_inventory_item_barcodes.py`                       | Backfill barcodes for legacy `inventory_items` (superseded by `20260610_0001`)                                                                                                                                                                                                                 |
| `20260610_0001` | `(20260604_0001, 20260604_0200)` | `20260610_0001_sequential_inventory_barcodes.py`                          | **Merge** the two heads; switch inventory barcodes to per-org sequential numbers (`INV-000001` …), reassign existing items, and seed each org's counter in `organizations.settings["barcode"]`                                                                                                 |
| `20260610_0002` | `20260610_0001`                  | `20260610_0002_add_position_settings.py`                                  | Add nullable `positions.settings` JSON column for per-position, per-module UI preferences (e.g. `label_presets` — the label printer a role uses in each module)                                                                                                                                |
| `20260613_0001` | `20260610_0002`                  | `20260613_0001_lowercase_form_category_enum.py`                           | Lowercase the `form_category` enum values to match the `(str, Enum)` convention                                                                                                                                                                                                                |
| `20260618_0100` | `20260613_0001`                  | `20260618_0100_add_user_platoon.py`                                       | Add nullable `users.platoon` column (person-level platoon membership for shift rotations)                                                                                                                                                                                                      |
| `20260618_0200` | `20260618_0100`                  | `20260618_0200_add_shift_platoon.py`                                      | Add nullable `shifts.platoon` column (records the platoon responsible for a generated shift)                                                                                                                                                                                                   |
| `20260622_0001` | `20260618_0200`                  | `20260622_0001_create_inventory_impact_plans.py`                          | Create `inventory_impact_plans` (saved impact-planner scenarios)                                                                                                                                                                                                                               |
| `20260702_0001` | `20260622_0001`                  | `20260702_0001_training_actor_fks_set_null.py`                            | Training actor FKs switched to `SET NULL` (nullable)                                                                                                                                                                                                                                           |
| `20260703_0001` | `20260702_0001`                  | `20260703_0001_drop_dead_columns.py`                                      | Drop dead/unused columns                                                                                                                                                                                                                                                                       |
| `20260707_0001` | `20260703_0001`                  | `20260707_0001_lowercase_screening_and_shift_enums.py`                    | Lowercase medical-screening and shift enum values                                                                                                                                                                                                                                              |
| `20260714_0001` | `20260707_0001`                  | `20260714_0001_add_requirement_link_to_skills_testing.py`                 | Link skills-testing records to training requirements                                                                                                                                                                                                                                           |
| `20260715_0001` | `20260714_0001`                  | `20260715_0001_add_recert_cycle_to_training_programs.py`                  | Add recertification cycle to training programs                                                                                                                                                                                                                                                 |
| `20260716_0001` | `20260715_0001`                  | `20260716_0001_add_certification_eligibility_to_sessions.py`              | Add certification eligibility to training sessions                                                                                                                                                                                                                                             |
| `20260717_0001` | `20260716_0001`                  | `20260717_0001_add_allows_external_credit_to_requirements.py`             | Add `allows_external_credit` to training requirements                                                                                                                                                                                                                                          |
| `20260718_0001` | `20260717_0001`                  | `20260718_0001_add_enrollment_cycle_and_struggling_tracking.py`           | Add enrollment cycle + struggling-member tracking                                                                                                                                                                                                                                              |
| `20260719_0001` | `20260718_0001`                  | `20260719_0001_add_requirement_progress_credit_ledger.py`                 | Add requirement-progress credit ledger                                                                                                                                                                                                                                                         |
| `20260720_0001` | `20260719_0001`                  | `20260720_0001_add_training_positions_and_shift_status.py`                | Add training positions and shift status                                                                                                                                                                                                                                                        |
| `20260720_0002` | `20260720_0001`                  | `20260720_0002_backfill_department_message_role_ids.py`                   | Backfill department-message role ids                                                                                                                                                                                                                                                           |
| `20260720_0003` | `20260720_0002`                  | `20260720_0003_add_department_message_scheduled_at.py`                    | Add `scheduled_at` to department messages                                                                                                                                                                                                                                                      |
| `20260720_0004` | `20260720_0003`                  | `20260720_0004_add_department_message_deleted_at.py`                      | Add `deleted_at` to department messages                                                                                                                                                                                                                                                        |
| `20260721_0001` | `20260720_0004`                  | `20260721_0001_add_user_calendar_feed_token.py`                           | Add per-user calendar feed token                                                                                                                                                                                                                                                               |
| `20260722_0001` | `20260721_0001`                  | `20260722_0001_add_shift_pass_down_notes.py`                              | Add shift pass-down notes                                                                                                                                                                                                                                                                      |
| `20260723_0001` | `20260722_0001`                  | `20260723_0001_add_compartment_container_type.py`                         | Add apparatus compartment container type                                                                                                                                                                                                                                                       |
| `20260724_0001` | `20260723_0001`                  | `20260724_0001_add_inventory_lots_and_check_item_link.py`                 | Add inventory lots + equipment-check item link                                                                                                                                                                                                                                                 |
| `20260725_0001` | `20260724_0001`                  | `20260725_0001_add_user_mfa_last_timestep.py`                             | Add `users.mfa_last_timestep` (TOTP replay guard)                                                                                                                                                                                                                                              |
| `20260726_0001` | `20260725_0001`                  | `20260726_0001_add_audit_log_hash_version.py`                             | Add audit-log hash version (keyed HMAC chain)                                                                                                                                                                                                                                                  |
| `20260727_0001` | `20260726_0001`                  | `20260727_0001_add_session_refresh_grace.py`                              | Add session refresh grace period                                                                                                                                                                                                                                                               |
| `20260728_0001` | `20260727_0001`                  | `20260728_0001_add_security_alert_org_id.py`                              | Add `organization_id` to security alerts                                                                                                                                                                                                                                                       |
| `20260729_0001` | `20260728_0001`                  | `20260729_0001_widen_public_portal_api_key_prefix.py`                     | Widen public-portal API key prefix for selective lookup (PP-4)                                                                                                                                                                                                                                 |
| `20260730_0001` | `20260729_0001`                  | `20260730_0001_add_voting_token_test_and_eligibility.py`                  | Add `is_test` + `eligible_item_ids` to `voting_tokens` (elections security review R-1/R-3)                                                                                                                                                                                                     |
| `20260731_0001` | `20260730_0001`                  | `20260731_0001_hash_voting_tokens_at_rest.py`                             | Hash voting tokens at rest with SHA-256, in place, idempotent hex guard (ELEC-5); downgrade is a deliberate no-op                                                                                                                                                                              |
| `20260801_0001` | `20260731_0001`                  | `20260801_0001_add_voting_token_eligible_positions.py`                    | Add `voting_tokens.eligible_positions` (JSON, nullable) — send-time snapshot of the positions a token holder may vote for (R-D4); NULL = legacy/unrestricted                                                                                                                                   |
| `20260801_0002` | `20260801_0001`                  | `20260801_0002_align_enum_columns_with_models.py`                         | Widen `event_rsvps.status` (+`waitlisted`) and `inventory_notification_queue.action_type` (+`retired`) — model enums gained values the chain never added                                                                                                                                       |
| `20260801_0003` | `20260801_0002`                  | `20260801_0003_add_election_datetime_defaults.py`                         | Add `DEFAULT CURRENT_TIMESTAMP` to election datetime columns (elections, candidates, votes, voting_tokens) — models declare `server_default=func.now()` but 20260118_0004/20260119_0006 created the columns without DB defaults, so ORM inserts of service-created rows failed with error 1364 |
| `20260801_0004` | `20260801_0003`                  | `20260801_0004_add_election_lifecycle_fields.py`                          | Add election lifecycle-automation fields: `auto_open` (opt-in auto-open at start_date), `reminder_hours_before_close` (automatic non-voter reminder window), `reminder_sent_at` (once-only stamp)                                                                                              |
| `20260801_0005` | `20260801_0004`                  | `20260801_0005_add_nominations_and_manual_ballots.py`                     | Nomination phase + paper ballots: `elections.status` ENUM gains `nominations`, `elections.nomination_deadline`, `votes.is_manual` + `votes.recorded_by` (officer-attributed paper-tally votes)                                                                                                 |
| `20260801_0006` | `20260801_0005`                  | `20260801_0006_add_manual_ballot_batch_id.py`                             | Add `votes.manual_batch_id` (indexed) — every paper-tally entry shares a batch id so a mis-keyed batch can be voided in one audited action                                                                                                                                                     |
| `20260801_0007` | `20260801_0006`                  | `20260801_0007_add_manual_ballot_attestations.py`                         | Add `manual_ballot_batches` + `manual_ballot_attestations` — paper batches stay pending (excluded from results) until the org-required number of officers attest them                                                                                                                          |
| `20260801_0008` | `20260801_0007`                  | `20260801_0008_add_tie_policy_roster_snapshot_merge.py`                   | Add `elections.tie_policy`, `elections.eligible_roster_snapshot` (voter roll frozen at open), and `candidates.merged_into_candidate_id` (write-in consolidation alias)                                                                                                                         |
| `20260801_0009` | `20260801_0008`                  | `20260801_0009_add_audit_log_organization_id.py`                          | Add `audit_logs.organization_id` (indexed, backfilled from `user_id`) — org-scoped audit reads; hash chain v3 binds the org on new rows                                                                                                                                                        |
| `20260801_0010` | `20260801_0009`                  | `20260801_0010_grant_equipment_check_submit_to_members.py`                | Data migration: append `equipment_check.submit` to existing system member positions (EC-7 gated the check-flow reads view-OR-submit; new orgs get it from `DEFAULT_POSITIONS`)                                                                                                                 |
| `20260801_0011` | `20260801_0010`                  | `20260801_0011_per_org_finance_request_numbers.py`                        | Replace the global unique on `purchase_requests.request_number` / `expense_reports.report_number` / `check_requests.request_number` with per-org composite uniques (`uq_*_org_number`) — introspection-defensive because these tables are create_all-materialized — head as of 2026-07-31      |

> **Single head:** the chain remains linear — `20260801_0011` was the head as
> of 2026-07-31; later release windows (below) extend it, and the current
> single head is `20260816_0001` — so `alembic upgrade head` is unambiguous.
> `tests/test_alembic_migrations.py` validates the single-head DAG (it
> understands merge migrations).

## August 12–14, 2026 upgrade set

The revisions and their data/permission backfills for this window are listed in
the [three-day change audit](./CHANGE_AUDIT_2026-08-12_TO_14.md#alembic-route-upgrade-data-path).
Of particular importance, active-prospect email reconciliation lives in
`20260814_0003`, not the already released uniqueness migration. Require one
`alembic heads` result, back up first, run `alembic upgrade head`, and inspect
reconciliation output. Do not downgrade to repair a branch fork. Installations
that encountered interim skill resume or saved-ballot revisions are reconciled
by the later forward migrations. `20260814_0004` performs the Captain permission
repair and merges the event-reminder branch into this release chain, producing
the required single head without changing the published `0002`/`0003` identities.

### Active-prospect duplicate preflight

`20260812_0003` creates `uq_prospect_org_active_email` before the later
reconciliation revision. Before upgrading, run:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

A non-empty result is a hard stop. Choose the earliest `created_at` (then lowest
`id`) as keeper after reviewing linked application data, mark the other rows
`inactive`, and require a zero-row recheck. Otherwise the unique-index migration
fails before `20260814_0003` can reconcile anything.

## August 16, 2026 upgrade

Three revisions, linear, revising `20260814_0004`. `20260816_0003` is the
**current single head**.

| Revision        | Revises         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260816_0001` | `20260814_0004` | Adds `facility_rooms.parent_room_id` (VARCHAR(36), nullable), index `idx_facility_rooms_parent`, and self-referential FK `fk_facility_rooms_parent_room` with `ON DELETE SET NULL` — nested facility rooms                                                                                                                                                                                                                                   |
| `20260816_0002` | `20260816_0001` | Backfills barcodes for storage areas that predate auto-assignment                                                                                                                                                                                                                                                                                                                                                                            |
| `20260816_0003` | `20260816_0002` | Creates `inventory_vendors` + `inventory_vendor_contacts`, adds `vendor_id` to items and reorder requests, and backfills a vendor per distinct free-text supplier name (case-folded per org), linking the rows that named it. **Renumbered from `20260816_0002`** after a same-day id collision with the barcode backfill                                                                                                                    |
| `20260816_0007` | `20260816_0005` | Folds the duplicate `users.notification_preferences.email` key into `email_notifications` — the key every sender actually reads — carrying an explicit `email: false` opt-out across before dropping the dead key. Written in Python rather than `JSON_SET`/`JSON_REMOVE`: MariaDB 10.11 is a supported target and has no `CAST(... AS JSON)`. **Renumbered from `20260816_0002`** after the same-day id collision with the barcode backfill |
| Notes:          |

- **`ON DELETE SET NULL`, deliberately never CASCADE.** Removing a room must
  not silently delete the sub-rooms hanging off it (with their kiosk codes and
  stored inventory). The service re-parents children onto the deleted room's
  own parent; the constraint is only the database-level backstop.
- No data backfill: existing rooms upgrade with `parent_room_id = NULL`
  (top-level) and nothing changes until a room is nested. Nesting rules —
  same org, same facility, no cycles, max depth 5 — are enforced in
  `facilities_service.py`, not in the schema.
- The upgrade and downgrade are introspection-guarded (no-op if the table is
  missing or the column already exists/is already gone), so re-running against
  a partially applied state is safe.
- Standard procedure applies: back up, require exactly one `alembic heads`
  result, then `alembic upgrade head`.

## Startup guard: unknown revisions refuse the fresh-database path (2026-08-11)

If the database's stamped revision is not part of the deployed release, the
backend now raises `RuntimeError` ("Refusing destructive fresh-database
initialization…") at startup instead of silently deleting `alembic_version`
and re-running the destructive fresh-install fast path — which could destroy a
real installation whose revision id had merely been renamed. A compatibility
revision (`20260809_0002`, with a dual `down_revision`) keeps databases stamped
with the previously released ids upgradable. If you hit the guard: verify the
deployed version matches the database, back up, reconcile the stamp
(`alembic stamp <equivalent-released-revision>`), then `alembic upgrade head`.
See the matching entry in
[`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md#migration-version-mismatch).
