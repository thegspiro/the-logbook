# Schema Drift: Models vs. Migration Chain

Findings from a full audit of the database schema, 2026-08-05. Companion to
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), which is the generated reference for
what the schema *is*. This document covers where the two ways of building that
schema disagree.

---

## Why there are two schemas

The Logbook builds a database two different ways:

| Path | When | Produces |
|---|---|---|
| `Base.metadata.create_all()` | Fresh install (`_fast_path_init` in `main.py`) | **232 tables** from `app/models/` |
| `alembic upgrade head` | Pre-existing database | **203 tables** from the 255-file migration chain |

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
> `ALTER TABLE … ADD COLUMN`. A column whose *type*, *enum value set*, or
> *foreign key rule* differs from the model stays wrong forever.

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

`alembic upgrade head` completes cleanly end to end (all 255 revisions, single
head). The chain is not broken — it is just incomplete relative to the models.

---

## Summary

| Class | Finding | Count | Self-heals? |
|---|---|---|---|
| Durable | Column **type** differs between paths | 38 | No |
| Durable | Foreign key **ON DELETE** rule differs | 18 | No |
| Durable | **Enum value set** differs | 5 | No |
| Durable | `roles`/`user_roles` never renamed to `positions`/`user_positions` | 2 tables | No — see below |
| Self-healing | Tables only in models | 37 | Yes |
| Self-healing | Columns only in models | 15 | Yes |
| Cosmetic | Column nullability differs (model has Python-side default) | 101 | No, but benign |
| Cosmetic | Index present in one path only | 95 | No, but benign |
| Model-side | **Duplicate indexes** — same column indexed twice | 136 | n/a |
| Dead | Columns only in migrations | 2 | n/a |

---

## Durable findings

### 1. `documents.content_html` is `TEXT` in the model, `LONGTEXT` in the migration

**Every fresh install truncates rich-text documents at 64 KB.**

```python
# app/models/document.py:359
content_html = Column(Text, nullable=True)          # MySQL TEXT — 65,535 bytes

# alembic/versions/20260213_0800_add_templates_documents_dynamic_sections.py:64
op.add_column('documents', sa.Column('content_html', mysql.LONGTEXT(), nullable=True))
```

The migration author picked `LONGTEXT` deliberately. The model never matched, and
since the model is what a fresh install gets, new deployments have the narrow
column. A document body over 64 KB raises `Data too long for column` (or is
silently truncated under a non-strict `sql_mode`). The model is the side that is
wrong.

### 2. `organizations.logo` is `MEDIUMTEXT` in the model, `LONGTEXT` in the migration

There is a migration named `20260209_0600_ensure_logo_column_longtext.py` whose
entire purpose is to guarantee this column is `LONGTEXT`. The model says
`MEDIUMTEXT` (16 MB), so on a fresh install that migration's guarantee does not
hold. Lower impact than #1 — 16 MB is a generous ceiling for a base64 logo — but
it is a direct contradiction of a migration's stated intent.

### 3. `users.mfa_secret` is `VARCHAR(32)` on migration-built databases

```python
# app/models/user.py:309 — the value stored here is AES-encrypted
_mfa_secret_encrypted = Column("mfa_secret", String(255))

# alembic/versions/20260118_0001_initial_schema.py:54
sa.Column('mfa_secret', sa.String(32)),
```

No later migration widens it. A raw TOTP secret fits in 32 characters; the
**encrypted** ciphertext this column actually stores does not. On any database
built from the chain, enrolling in MFA truncates the ciphertext and the secret can
never be decrypted — MFA is broken with no error at write time. Self-heal cannot
fix this: the column exists, so `_add_missing_model_columns()` skips it.

### 4. Enum value sets differ — writes fail on values the model considers legal

| Column | Missing on migration-built databases |
|---|---|
| `users.status` | `leave` |
| `member_leaves_of_absence.leave_type` | `new_member` |
| `training_waivers.waiver_type` | `new_member` |
| `form_integrations.integration_type` | `event_request` |
| `store_orders.payment_method` | _(same members, different order — harmless)_ |

Putting a member on leave, or filing a `new_member` waiver, writes a value the
column's `ENUM` does not contain. MySQL rejects it under strict mode and coerces
it to `''` otherwise.

### 5. `public_portal_*` timestamps are `VARCHAR(26)`, not `DATETIME`

```python
# alembic/versions/20260207_0501_create_public_portal_tables.py
sa.Column('created_at', sa.String(length=26), nullable=False)
sa.Column('expires_at', sa.String(length=26), nullable=True)
sa.Column('timestamp',  sa.String(length=26), nullable=False)
```

The models declare `DateTime(timezone=True)`. Eight columns across
`public_portal_api_keys`, `public_portal_config`, `public_portal_data_whitelist`
and `public_portal_access_log` are affected. String columns compare and sort
lexicographically, so API-key expiry checks and access-log range queries give
wrong answers on migration-built databases — and `idx_access_log_timestamp` is
indexing a string.

### 6. Foreign keys created without an `ON DELETE` rule

18 foreign keys carry `CASCADE` or `SET NULL` in the model but were created with
no `ON DELETE` clause by the migration, which MySQL reports as `RESTRICT`:

| Table | Columns | Model rule |
|---|---|---|
| `elections` | `organization_id`, `created_by` | CASCADE / SET NULL |
| `candidates` | `election_id`, `user_id`, `nominated_by` | CASCADE / SET NULL |
| `votes` | `election_id`, `candidate_id`, `voter_id`, `proxy_voter_id` | CASCADE / SET NULL |
| `voting_tokens` | `election_id` | CASCADE |
| `events` | `organization_id` | CASCADE |
| `event_rsvps` | `event_id`, `user_id` | CASCADE |
| `apparatus` | `created_by`, `archived_by`, `status_changed_by` | SET NULL |
| `shifts` | `shift_officer_id` | SET NULL |

On these databases, deleting an election or an organization fails with a foreign
key error instead of cascading, and deleting a member is blocked by any apparatus
record they touched.

### 7. `roles` / `user_roles` were never renamed to `positions` / `user_positions`

The models renamed the concept and kept aliases for compatibility:

```python
# app/models/user.py:537
Role = Position
user_roles = user_positions
```

No migration performs the rename — `rename_table` appears exactly once in the
entire chain, for `meeting_action_items`. So a migration-built database has
`roles` and `user_roles`; the models want `positions` and `user_positions`.

This is the one finding where self-heal makes things *worse* rather than better.
On startup, `create_all(checkfirst=True)` sees `positions` missing and creates it
**empty**. The permission assignments in the old `roles`/`user_roles` tables are
not copied. The result is a database where no member holds any position — that
is, nobody has any permission — with no error raised.

**Whether this can still happen depends on whether any deployment predates the
rename.** If every live install was created after the rename landed, the risk is
theoretical and the stale tables are just dead weight. That is worth confirming
before deciding how much to invest here.

Two related loose ends: `issuance_allowances.role_id` still points at `roles(id)`
in the migration chain but `positions(id)` in the model, and `validate_schema()`
in `main.py` still spot-checks a `roles` table that no longer exists in
`Base.metadata` (harmless — the check skips tables that are absent).

---

## Model-side finding: 136 duplicate indexes

Unrelated to migrations — this one is in the models themselves and therefore
affects **every** deployment. 136 columns carry both `index=True` on the column
*and* an explicit `Index(...)` in `__table_args__`, producing two identical
single-column B-trees:

```python
# app/models/apparatus.py — pattern repeated across the file
apparatus_id = Column(..., index=True)        # -> ix_apparatus_components_apparatus_id
__table_args__ = (
    Index("idx_apparatus_components_apparatus", "apparatus_id"),   # identical
)
```

Every write to these tables maintains both. The concentration is heaviest in
`apparatus`, `facilities`, `training` and `inventory`. Dropping the redundant
half is a pure win — no query plan depends on which of two identical indexes is
chosen.

Full list: `python scripts/generate_schema_docs.py` renders every index per
table, or re-run the audit query in "How this was measured".

---

## Dead columns

Present in migration-built databases, absent from the models — never read or
written by application code:

- `users.membership_id`
- `prospective_members.active_email`

---

## Cosmetic: 101 nullability differences

Almost all are the same shape — the model declares a Python-side default while
the migration declares a server default plus `NOT NULL`:

```python
active = Column(Boolean, default=True)              # model: NULL allowed
sa.Column('active', sa.Boolean(), nullable=False,   # migration: NOT NULL
          server_default=sa.text('1'))
```

Through the ORM these behave identically, because SQLAlchemy supplies the default
on insert. They diverge only for raw SQL inserts and bulk loads, which would leave
`NULL` on a fresh install where a migration-built database would take the server
default. Worth aligning opportunistically; not worth a dedicated migration.

---

## Recommendations

**Fix in the models** (changes what new installs get, no migration needed for
existing ones since they already have the wider column):

1. `documents.content_html` → `LONGTEXT`
2. `organizations.logo` → `LONGTEXT`

**Fix with a migration** (existing databases are the wrong ones; fresh installs
are already correct):

3. `users.mfa_secret` → `VARCHAR(255)`
4. The four enum value sets in finding #4
5. The eight `public_portal_*` timestamp columns → `DATETIME`
6. The 18 foreign key `ON DELETE` rules in finding #6

**Decide first, then act:**

7. `roles` → `positions`. Confirm whether any deployment predates the rename. If
   yes, a data-migrating rename is needed *before* self-heal can create an empty
   `positions` table. If no, drop the dead tables from the chain's tail.

**Cleanup, no urgency:**

8. Remove the 136 duplicate index definitions.
9. Drop `users.membership_id` and `prospective_members.active_email`.
10. Remove the stale `roles` entry from `critical_columns` in `validate_schema()`.

**Prevent recurrence:**

Wire `python scripts/generate_schema_docs.py --check` into CI. It fails when
`app/models/` changes without `docs/DATABASE_SCHEMA.md` being regenerated, which
turns every schema change into a visible diff in review — the point at which
"does this need a migration too?" is a cheap question to ask.
