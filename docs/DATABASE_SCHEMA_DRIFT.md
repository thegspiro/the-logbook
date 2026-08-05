# Schema Drift: Models vs. Migration Chain

Findings from a full audit of the database schema, 2026-08-05. Companion to
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), which is the generated reference for
what the schema *is*. This document covers where the two ways of building that
schema disagree.

Most of what follows has been fixed — each finding records the revision that
closed it. Two items remain open and are listed at the end.

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
| Durable | Column **type** differs between paths | 38 | Fixed — `20260805_0001`–`0006` |
| Durable | Foreign key **ON DELETE** rule differs | 18 | Fixed — `20260805_0005` (17 of 18) |
| Durable | **Enum value set** differs | 5 | Fixed — `20260805_0003`, `0006` |
| Durable | **Server default** missing on a NOT NULL column | 283 | **Open** — see below |
| Durable | `roles`/`user_roles` never renamed to `positions` | 2 tables | **Open** — needs a decision |
| Self-healing | Tables only in models | 37 | Not a defect |
| Self-healing | Columns only in models | 15 | Not a defect |
| Model-side | **Duplicate indexes** — same column indexed twice | 136 | Open, no urgency |
| Dead | Columns only in migrations | 2 | Open, no urgency |

After `20260805_0001`–`0006`, re-running the comparison gives **0 type
mismatches** and **1 remaining foreign key difference** (the deferred
`issuance_allowances.role_id`, which depends on the roles/positions decision).

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
`Text().with_variant(mysql.LONGTEXT(), "mysql")`, and `20260805_0001` widens
databases that were built from the model.

### 2. `organizations.logo` was `MEDIUMTEXT` in the model, `LONGTEXT` in the migration

`20260209_0600_ensure_logo_column_longtext.py` exists purely to guarantee this
column is `LONGTEXT`, but the model said `MEDIUMTEXT`, so on a fresh install
that guarantee did not hold. Same fix, same revision as #1.

> Both of these were originally reported as needing only a model change. That
> was wrong: databases built by `create_all()` — every install created since the
> fast path landed — already had the *narrow* column and needed the ALTER too.
> `20260805_0001` covers them.

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

Fixed by `20260805_0002`. Secrets already truncated stay unrecoverable, so
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

## Open

### A. 283 NOT NULL columns have no server default on fresh installs

**This is the largest remaining divergence, and it was missed by the original
audit** — the comparison checked column types and nullability but not defaults,
and these columns are `NOT NULL` on *both* paths. Only the default differs:

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

Scope: **283 columns across 119 tables**. Reproduce with:

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

The fix is to add `server_default=` to the models alongside the existing
`default=`, so `create_all()` emits the same DDL the migrations do. It is
mechanical but touches most model files, so it is called out here rather than
bundled into the revisions above.

### B. `roles` / `user_roles` were never renamed to `positions` / `user_positions`

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
rename.** If every live install was created after it, the risk is theoretical
and the stale tables are dead weight to drop. If not, a data-migrating rename is
needed *before* self-heal can create the empty table. That question has to be
answered before the right migration can be written, which is why
`20260805_0005` skips `issuance_allowances.role_id` rather than guessing.

Related loose end: `validate_schema()` in `main.py` still spot-checks a `roles`
table that is no longer in `Base.metadata`. Harmless — the check skips absent
tables — but it should go with whatever resolves this.

### C. 136 duplicate indexes

In the models, so it affects **every** deployment. 136 columns carry both
`index=True` and an identical explicit `Index(...)` in `__table_args__`,
producing two identical single-column B-trees:

```python
# app/models/apparatus.py — pattern repeated across the file
apparatus_id = Column(..., index=True)        # -> ix_apparatus_components_apparatus_id
__table_args__ = (
    Index("idx_apparatus_components_apparatus", "apparatus_id"),   # identical
)
```

Every write maintains both. Heaviest in `apparatus`, `facilities`, `training`
and `inventory`. Dropping the redundant half is a pure win — no query plan
depends on which of two identical indexes is chosen.

### D. Dead columns

Present in chain-built databases, absent from the models, never read or written:

- `users.membership_id`
- `prospective_members.active_email`

---

## Preventing recurrence

Wire `python scripts/generate_schema_docs.py --check` into CI. It fails when
`app/models/` changes without `docs/DATABASE_SCHEMA.md` being regenerated, which
turns every schema change into a visible diff in review — the point at which
"does this need a migration too?" is a cheap question to ask.
