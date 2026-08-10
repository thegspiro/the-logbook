# Schema Drift: Models vs. Migration Chain

Findings from a full audit of the database schema, 2026-08-05. Companion to
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), which is the generated reference for
what the schema *is*. This document covers where the two ways of building that
schema disagree.

Every finding has been fixed; each records the revision that closed it. One
residual difference is documented at the end as a deliberate non-change.

**The two build paths now produce identical schemas** — same tables, columns,
types, enums, defaults, foreign keys and indexes.

---

## Why there are two schemas

The Logbook builds a database two different ways:

| Path | When | Produces |
|---|---|---|
| `Base.metadata.create_all()` | Fresh install (`_fast_path_init` in `main.py`) | **232 tables** from `app/models/` |
| `alembic upgrade head` | Pre-existing database | **203 tables** from the migration chain |

A fresh install never replays the migration chain — it creates every table from
the models, runs `MIGRATION_ONLY_FILES` and `SEED_DATA_FILES`, then stamps
Alembic at head. **The models are the schema.** Migrations only patch databases
that already exist.

There is also a self-heal pass. On startup `validate_schema()` compares the live
database against `Base.metadata`; on any mismatch `_attempt_schema_repair()` runs
`create_all(checkfirst=True)` and `_add_missing_model_columns()`. This matters
for reading everything below:

> **Self-heal adds missing tables and missing columns. It never alters an
> existing one.** `_add_missing_model_columns()` only ever issues
> `ALTER TABLE … ADD COLUMN`. A column whose *type*, *enum value set*, *default*,
> or *foreign key rule* differs from the model stays wrong forever.

So drift splits cleanly into two classes: **self-healing** (missing tables and
columns — noise, not bugs) and **durable** (everything else — real, permanent
divergence between deployments).

---

## How this was measured

Both paths were built against a real MySQL-family server and the resulting
schemas compared through `information_schema`. This is reproducible:

```bash
# Requires a MySQL 8 / MariaDB server with collation-server=utf8mb4_unicode_ci
# (the collation docker-compose.yml pins — some migrations hardcode COLLATE
#  utf8mb4_unicode_ci, so a server defaulting to another collation fails with
#  errno 150 on the first cross-table FK).

mysql -e "CREATE DATABASE db_migrations; CREATE DATABASE db_models;"

# Path A — the upgrade path
DB_NAME=db_migrations alembic upgrade head

# Path B — the fresh-install path
DB_NAME=db_models python -c "
import app.models
from app.core.database import Base
from sqlalchemy import create_engine
from app.core.config import settings
e = create_engine(settings.SYNC_DATABASE_URL)
Base.metadata.create_all(e)"

# then diff information_schema.COLUMNS / STATISTICS / KEY_COLUMN_USAGE
```

`alembic upgrade head` completes cleanly end to end, on both an empty database
and one already built by `create_all()`. The chain is not broken — it was just
incomplete relative to the models.

---

## Summary

| Class | Finding | Count | Status |
|---|---|---|---|
| Durable | Column **type** differs between paths | 38 | Fixed — `20260805_0101`, `0102`, `0003`–`0006` |
| Durable | Foreign key **ON DELETE** rule differs | 18 | Fixed — `20260805_0005`, `0008` |
| Durable | **Enum value set** differs | 5 | Fixed — `20260805_0003`, `0006` |
| Durable | **Server default** missing on a NOT NULL column | 283 | Fixed — models + `20260805_0007` |
| Durable | `roles`/`user_roles` never renamed to `positions` | 2 tables | Fixed — `20260805_0008` |
| Self-healing | Tables only in models | 37 | Not a defect |
| Self-healing | Columns only in models | 15 | Not a defect |
| Model-side | **Duplicate indexes** — same column indexed twice | 136 | Fixed — models + `20260805_0009` |
| Model-side | **Redundant indexes** — leftmost-prefix / unique-shadowed | 145 | Fixed — models + `20260805_0010` |
| Durable | **Index set** differs between paths | 82 + 37 | Fixed — `20260805_0010` |
| Durable | Foreign keys missing on one path | 8 | Fixed — models + `20260805_0010` |
| Dead | Columns only in migrations | 2 | Fixed — `20260805_0009` |

After the whole `20260805` series — `0001`–`0010` plus `0101` and `0102` —
re-running the comparison gives **0 differences of any kind** on tables both
paths build: 0 type mismatches, 0 foreign key differences (presence or rule),
0 NOT NULL columns without a needed default, 0 index differences, and no table
present in one path but not the other — 1,117 indexes on each side.

The backend suite against a model-built database went from
**2,648 passed / 16 failed / 372 errors** to **3,036 passed, 0 failed,
0 errors**, with warnings down from 52 to 2 — and those two are
`test_database_schema.py`'s own deliberate "soft warning for visibility"
guardrails.

---

## Fixed

### 1. `documents.content_html` was `TEXT` in the model, `LONGTEXT` in the migration

**Every fresh install truncated rich-text documents at 64 KB.**

```python
# app/models/document.py — before
content_html = Column(Text, nullable=True)          # MySQL TEXT — 65,535 bytes

# alembic/versions/20260213_0800_add_templates_documents_dynamic_sections.py:64
op.add_column('documents', sa.Column('content_html', mysql.LONGTEXT(), nullable=True))
```

The migration author picked `LONGTEXT` deliberately; the model never matched.
Since the model is what a fresh install gets, new deployments had the narrow
column and a document body over 64 KB failed to save.

Fixed on both sides: the model now declares
`Text().with_variant(mysql.LONGTEXT(), "mysql")`, and `20260805_0101` widens
databases that were built from the model.

### 2. `organizations.logo` was `MEDIUMTEXT` in the model, `LONGTEXT` in the migration

`20260209_0600_ensure_logo_column_longtext.py` exists purely to guarantee this
column is `LONGTEXT`, but the model said `MEDIUMTEXT`, so on a fresh install
that guarantee did not hold. Same fix, same revision as #1.

> Both of these were originally reported as needing only a model change. That
> was wrong: databases built by `create_all()` — every install created since the
> fast path landed — already had the *narrow* column and needed the ALTER too.
> `20260805_0101` covers them.

### 3. `users.mfa_secret` was `VARCHAR(32)` on migration-built databases

```python
# app/models/user.py:309 — the value stored here is AES-encrypted
_mfa_secret_encrypted = Column("mfa_secret", String(255))

# alembic/versions/20260118_0001_initial_schema.py:54
sa.Column('mfa_secret', sa.String(32)),
```

A raw TOTP secret fits in 32 characters; the **encrypted** ciphertext does not.
On any database built from the chain, enrolling in MFA truncated the ciphertext
so it could never be decrypted — with no error at write time.

Fixed by `20260805_0102`. Secrets already truncated stay unrecoverable, so
affected members must re-enrol.

### 4. Enum value sets rejected values the models consider legal

| Column | Was missing |
|---|---|
| `users.status` | `leave` |
| `member_leaves_of_absence.leave_type` | `new_member` |
| `training_waivers.waiver_type` | `new_member` |
| `form_integrations.integration_type` | `event_request` |

Putting a member on leave, or filing a `new_member` waiver, wrote a value the
column's `ENUM` did not contain. Fixed by `20260805_0003`.

### 5. `public_portal_*` timestamps were `VARCHAR(26)`, not `DATETIME`

Eight columns across `public_portal_api_keys`, `public_portal_config`,
`public_portal_data_whitelist` and `public_portal_access_log`. String columns
compare and sort lexicographically, so API-key expiry checks and access-log
range queries gave wrong answers — and `idx_access_log_timestamp` indexed a
string.

Fixed by `20260805_0004`, which normalises the stored text before converting.
Rows may hold either the ISO form the column was sized for
(`2026-01-01T10:30:00.123456`) or MySQL's rendering of a bound Python datetime
(`2026-01-01 10:30:00.123456`), optionally with a `Z` or `+00:00` suffix; all
four forms convert, and anything unparseable becomes `NULL` (nullable columns)
or the current time (NOT NULL columns) rather than failing the migration.

### 6. Eighteen foreign keys had no `ON DELETE` rule

Created by `op.create_table` without an `ondelete` argument, so MySQL recorded
`RESTRICT` where the model declares `CASCADE` or `SET NULL`: across `elections`,
`candidates`, `votes`, `voting_tokens`, `events`, `event_rsvps`, `apparatus` and
`shifts`. Deleting an election failed instead of cascading, and deleting a
member was blocked by any apparatus record naming them.

Fixed by `20260805_0005`. That revision also collapsed a duplicate it uncovered:
`apparatus.created_by`, `archived_by` and `status_changed_by` each carried **two**
foreign keys — a later migration added the correct `SET NULL` without dropping
the original `RESTRICT`, and the restrictive one still blocked the delete.

`issuance_allowances.role_id` is the one entry it skips, because the model points
it at `positions` and that table does not exist on a chain-built database. It is
part of the open roles/positions question below.

### 7. Twenty-two `VARCHAR` columns should have been `ENUM`

Declared `Enum` in the models but created as `sa.String` by their migrations,
concentrated in the facilities module. A `VARCHAR` accepts any string the
application writes, so the constraint the model expresses was not enforced.

Also `store_orders.payment_method`, an ENUM on both sides but with `cash_app`
and `zelle` appended rather than in the models' order — MySQL stores an ENUM as
an ordinal, so the same ordinal meant a different value depending on which path
built the database.

Fixed by `20260805_0006`, which **checks every column for out-of-range values
before altering anything** and aborts with the offending table, column and
values listed if it finds any. Narrowing a VARCHAR to an ENUM discards values
outside the new set, so this cannot be left to the server's `sql_mode`.

---

### 8. 283 NOT NULL columns had no server default on model-built databases

**This was missed by the original audit** — the comparison checked column types
and nullability but not defaults, and these columns are `NOT NULL` on *both*
paths. Only the default differed:

```python
# app/models/user.py:306
compliance_exempt = Column(Boolean, default=False, nullable=False)
#                                   ^^^^^^^^^^^^^ Python-side only

# alembic/versions/20260308_0200_add_compliance_exempt_to_users.py
sa.Column("compliance_exempt", sa.Boolean(), nullable=False,
          server_default=sa.text("0"))
```

`default=` is applied by SQLAlchemy at flush time, so ORM writes are fine. Any
**raw SQL insert** that omits the column fails with
`(1364, "Field 'compliance_exempt' doesn't have a default value")`.

This is not theoretical. Against a database built from the models, **372 backend
tests error out** on exactly this, because fixtures insert their setup rows with
`text("INSERT INTO users ...")`. The same suite passes against a chain-built
database, which is why it has gone unnoticed.

Scope was **283 columns across 119 tables**. Reproduce with:

```sql
SELECT m.TABLE_NAME, m.COLUMN_NAME, g.COLUMN_DEFAULT AS migration_default
FROM information_schema.COLUMNS m
JOIN information_schema.COLUMNS g
  ON g.TABLE_SCHEMA = 'db_migrations'
 AND g.TABLE_NAME = m.TABLE_NAME AND g.COLUMN_NAME = m.COLUMN_NAME
WHERE m.TABLE_SCHEMA = 'db_models'
  AND m.IS_NULLABLE = 'NO' AND m.COLUMN_DEFAULT IS NULL
  AND g.COLUMN_DEFAULT IS NOT NULL;
```

Fixed on both sides. The models now declare `server_default=` alongside each
`default=`, derived from the model's own Python default so the two cannot
disagree — every one was cross-checked against what the migration chain actually
created, and all 282 agreed. `20260805_0007` sets the same defaults on databases
that already exist, skipping any column that already has one, so it is a no-op
on a chain-built database and safe to re-run.

`training_requirements.requirement_type` is deliberately excluded: its migration
invented a `'hours'` default, but the model treats the column as mandatory, and
silently typing a requirement as "hours" is worse than rejecting the insert.

---

### 9. `roles` / `user_roles` were never renamed to `positions` / `user_positions`

The models renamed the concept and kept aliases for compatibility:

```python
# app/models/user.py:537
Role = Position
user_roles = user_positions
```

No migration performs the rename — `rename_table` appears exactly once in the
entire chain, for `meeting_action_items`. A chain-built database has `roles` and
`user_roles`; the models want `positions` and `user_positions`.

This is the one finding where self-heal makes things *worse*. On startup,
`create_all(checkfirst=True)` sees `positions` missing and creates it **empty**.
The permission assignments in the old tables are not copied, leaving a database
where no member holds any position — nobody has any permission — with no error
raised.

**Whether this is reachable depends on whether any deployment predates the
rename.** The rename landed 2026-07-25 (commit `cb839f4`, the same commit that
introduced `_fast_path_init`). An install created after that date was built by
`create_all()` from models that already had `positions`, so it never had `roles`
at all and is not at risk.

Confirm on any given instance rather than inferring from its creation date — a
deployment can be spun up from an older image tag:

```sql
SHOW TABLES LIKE 'roles';       -- present => predates the rename, at risk
SHOW TABLES LIKE 'positions';   -- present alone => built after, safe
```

Fixed by `20260805_0008`, which handles all three shapes a database can be in
and was tested against each:

| Shape | Meaning | What the revision does |
|---|---|---|
| Only `roles` | Built purely from the chain | Renames both tables in place; every position and assignment is preserved |
| Both | Chain-built, then started against current code — repair created `positions` **empty** | Copies the rows across when `positions` is empty and `roles` is not, then drops the originals |
| Only `positions` | Built by `create_all()` | Nothing to migrate |

The middle shape is the data-loss recovery path. Without it, a database in that
state has no member holding any position, and therefore nobody with any
permission, with no error raised anywhere.

The revision also repoints `issuance_allowances.role_id` at `positions` — the
one foreign key `20260805_0005` deliberately skipped pending this decision.
`validate_schema()` in `main.py` no longer spot-checks the removed `roles`
table; it checks `positions`.

Related loose end: `validate_schema()` in `main.py` still spot-checks a `roles`
table that is no longer in `Base.metadata`. Harmless — the check skips absent
tables — but it should go with whatever resolves this.

### 10. 136 duplicate indexes

In the models, so it affected **every** deployment. 136 columns carried both
`index=True` and an identical explicit `Index(...)` in `__table_args__`,
producing two identical single-column B-trees:

```python
# app/models/apparatus.py — pattern repeated across the file
apparatus_id = Column(..., index=True)        # -> ix_apparatus_components_apparatus_id
__table_args__ = (
    Index("idx_apparatus_components_apparatus", "apparatus_id"),   # identical
)
```

Every write maintained both. Heaviest in `training` (46), `apparatus` (26) and
`facilities` (22). No query plan can prefer one of two identical indexes, so
dropping half is a pure win.

The models now keep only the explicitly named index — that name is the one the
migrations created and the one visible in `__table_args__`. `20260805_0009`
drops the auto-generated `ix_<table>_<column>` twin from databases that have
both, guarded so it only removes a twin when another index with the same leading
column survives: most of these columns are foreign keys, and MySQL refuses to
drop the last index backing one (error 1553).

### 11. Dead columns

Present in chain-built databases, absent from the models, never read or written:

- `users.membership_id`
- `prospective_members.active_email`

Dropped by `20260805_0009`. `users.membership_id` needed care: it is the second
column of the composite index `idx_user_org_membership_id`, and MySQL refuses to
drop a column still inside a multi-column index (error 1072) rather than
rebuilding the index for you, so the index is dropped first.

---

## Residual difference, left deliberately

**146 nullable columns** have a server default on chain-built databases and none
on model-built ones. A raw insert omitting them yields `NULL` rather than the
migration's value — no failure, but `ORDER BY` on such a column sorts
differently between the two. The models declare these nullable, meaning `NULL`
is a legal value, so adding defaults would change their semantics rather than
align them.

That is the only remaining difference. The index sets, which previously
diverged by 93, are now identical — see finding 12.

### 12. The index set was redundant and inconsistent between paths

Three problems, fixed together by `20260805_0010`:

**145 redundant indexes.** `20260805_0009` had removed 136 *exact* duplicates,
but two subtler kinds survived:

- **Leftmost-prefix duplicates.** A composite index on `(a, b)` already serves
  every query filtering or sorting on `a` alone, so a separate index on `(a)`
  costs writes and returns nothing. Most were an `index=True` on a column some
  composite in `__table_args__` already covered.
- **Non-unique indexes shadowed by a unique one** over the same column. A
  unique index answers everything its non-unique twin could.

**The two paths disagreed**: 82 indexes existed only on chain-built databases,
37 only on `create_all`-built ones.

The models are now the single source of truth. Indexes only the chain had were
adopted where nothing already covered them — an overdue-checkout composite on
`checkout_records`, the reporting-period composite on `compliance_reports`,
`documents(source_type, source_id)`, `item_assignments(item_id, is_active)`,
`training_categories(organization_id, registry_code)`,
`training_requirements(organization_id, year)` and `votes(is_proxy_vote)`.
**Nothing was dropped that a query might want** — only indexes another index
already answers. The model index count went from 985 to 711.

**Eight foreign keys** were fixed in passing. Five are declared by the models
and were never created on chain-built databases (`events.updated_by`,
`event_templates.updated_by`, `event_external_attendees.updated_by`, and both
actor columns on `facility_rooms`). Three are the reverse: `training_records`,
`training_sessions` and `skill_checkoffs` each carry an `apparatus_id` that
`20260218_0400` wires to `apparatus.id` on chain-built databases, while the
model left it an unconstrained column — so fresh installs had no referential
integrity there at all. The models now declare all eight.

Every drop is guarded on another index still leading with the same column, and
creates run before drops, so a foreign key is never left without a backing
index (MySQL error 1553). `inventory_items.uq_item_org_serial_number` is unique
and reports colliding rows up front rather than failing part-way with a bare
1062.

`test_database_schema.py::test_organization_id_is_indexed` was corrected as part
of this. It only inspected `Index` objects, so it missed the `UniqueConstraint`
that is now the sole coverage on three tables — MySQL materialises one as a
unique index, which serves a leftmost-prefix lookup identically. It was also
tightened to require `organization_id` to *lead* an index rather than merely
appear in one: a lone `WHERE organization_id = ?` cannot use an index where the
column sits second.

---

## Since the audit (checked 2026-08-10)

`python scripts/validate_migrations.py` reports **282 migrations, one head**, so
the chain is linear again. Two things happened to it after the 2026-08-05 audit
that are worth recording here:

- **A revision-id collision, now repaired.** Two migrations claimed
  `20260808_0002` (`drop_shift_equipment_check_apparatus_fk` and
  `add_owns_requirement_to_program_requirements`), leaving two heads. The first
  was renumbered to `20260808_0003`; `0002` kept its number because live
  databases had already applied it. **A database can be recorded as having run a
  migration it never saw** — see
  [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md#two-migrations-claimed-20260808_0002--and-what-it-left-behind-2026-08-09)
  for the symptom and the repair.
- **The medical-screening PHI migration was re-pointed onto main's head** after a
  rebase renumbered around it.

Both build paths still agree: the model changes since the audit — `events`
gaining `allow_guest_check_in` and `guest_check_in_creates_prospect`,
`event_external_attendees` gaining `prospect_id` (+ its index), and
`program_requirements` gaining `owns_requirement` — each ship with a matching
migration, and `docs/DATABASE_SCHEMA.md` has been regenerated to match
(**238 tables · 4110 columns · 773 foreign keys**).

---

## Preventing recurrence

Wire `python scripts/generate_schema_docs.py --check` into CI. It fails when
`app/models/` changes without `docs/DATABASE_SCHEMA.md` being regenerated, which
turns every schema change into a visible diff in review — the point at which
"does this need a migration too?" is a cheap question to ask.
