---
name: repo-migrations
description: This repository's Alembic migration rules. Use when writing, editing, reviewing or debugging anything under backend/alembic/versions/ — a new revision, an add_column or alter, a data backfill, seed or lookup rows, a change to a seeded permission grant, a downgrade, or a migration that fails on a fresh database. Also use when asked to run alembic revision/upgrade/downgrade, or when a migration takes CI red.
---

# Migration rules for The Logbook

**Read `docs/rules/migrations.md` before writing or changing a migration.** It
holds the full text; this file exists to get you there and to state the two
rules that cost the most when they are missed.

The prose lives in `docs/` rather than here because `AGENTS.md` makes these
repository rules, not Claude-only rules, and the other agents working this
repository cannot read `.claude/skills/`. Keep it that way: new rules go in
`docs/rules/migrations.md`, not in this file.

## The two that hurt most

1. **A table you are altering may not exist yet.** 40 of 254 tables are built
   only by `create_all()` at app startup, and CI runs `alembic upgrade head`
   against an empty database before anything starts the app. Reflecting or
   altering such a table raises `NoSuchTableError` and kills the whole upgrade,
   not just the one step — four matrix jobs, not one. Guard the step on the
   table's existence. `backend/tests/test_migration_create_all_tables.py`
   enforces this and names the tables.

2. **A published revision is frozen.** Alembic records a revision as applied by
   id, so editing one in place does nothing for any installation that already
   stamped it — which is exactly the set the edit exists to reach. Ship the
   delta as a new child revision that supersedes it.

## Before you finish

- `downgrade()` must do real work; a bare `pass` fails
  `test_downgrade_is_not_empty_pass`. If the migration genuinely cannot be
  reversed, say so in its docstring and preserve what the old shape carried
  implicitly.
- `DROP TABLE` carries `IF EXISTS`.
- Let Alembic generate the filename from `alembic.ini`'s `file_template`.
- Run the guards: `cd backend && python3 -m pytest tests/test_alembic_migrations.py tests/test_migration_create_all_tables.py`
- Verify a migration by running it against a real database — `alembic upgrade head`
  on a fresh one — not by re-reading its source. Every rule in
  `docs/rules/migrations.md` was written after source-reading missed something.

## Full text

- [docs/rules/migrations.md](../../../docs/rules/migrations.md) — how the
  schema is actually built, the hygiene rules CI enforces, the `create_all`
  rule, and the seeded-grant rule.
- `CLAUDE.md` pitfalls **#8** (seed data / `SEED_DATA_FILES`), **#12** (JSON
  column mutation) and **#20** (canonical JSON shape) stay in CLAUDE.md — they
  have no machine check, so they are not behind this skill.
