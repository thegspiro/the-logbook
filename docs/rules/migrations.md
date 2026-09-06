# Migration Rules

The full text of this repository's Alembic rules. `CLAUDE.md` carries a
one-line statement of each and links here; the `repo-migrations` skill loads
this file when a session starts touching migrations.

**It lives in `docs/` rather than inside the skill on purpose.** `AGENTS.md`
states that CLAUDE.md's technical rules are "repository rules, not Claude-only
rules", and the agents acting on them are not all Claude — Codex opens review
rounds on this repository and cannot read `.claude/skills/`. A rule filed
somewhere only one reader can reach is a rule the other readers will break. So
the prose sits on a path everything can open, and the skill is a pointer to it.

The `docs-links` CI job resolves every relative link in tracked Markdown, so a
pointer that stops matching this file's path or headings fails the build rather
than rotting quietly.

## Contents

- [How the schema actually comes into being](#how-the-schema-actually-comes-into-being)
- [The hygiene rules CI already enforces](#the-hygiene-rules-ci-already-enforces)
- [A Migration Must Tolerate a Table Only `create_all` Builds](#a-migration-must-tolerate-a-table-only-create_all-builds)
- [A Seeded Rank Grant Reaches the Database Through a Position](#a-seeded-rank-grant-reaches-the-database-through-a-position)
- [What stayed in CLAUDE.md](#what-stayed-in-claudemd)

---

## How the schema actually comes into being

Read this before the rules; several of them are only sensible in its light.

**The models are the schema of record. Migrations are alterations on top.** Not
the reverse, which is the intuition most Alembic projects run on and the one
that produces broken migrations here.

Three mechanisms build a database in this repository:

1. `alembic upgrade head` replays the migration chain.
2. `main.py`'s `_fast_path_init()` calls `Base.metadata.create_all()` and stamps
   Alembic at head — the path a fresh install takes instead of replaying 400+
   migrations.
3. `backend/scripts/repair_schema.py` adds columns the models declare and no
   migration creates, and runs on startup.

Two consequences follow, and both have taken CI red:

- **40 of the schema's 254 tables are created by `create_all` and by no
  migration at all.** A migration that alters one of them must tolerate its
  absence — see the `create_all` rule below.
- **`alembic upgrade head` alone does not produce a working schema.** On a
  freshly migrated database `repair_schema.py` still adds a dozen columns. A
  migration that assumes otherwise is testing a database no deployment has.

CI runs `alembic upgrade head` against an **empty** database in the integration
and contract jobs, before anything calls `create_all`. That is the environment
your migration has to survive.

---

## The hygiene rules CI already enforces

`backend/tests/test_alembic_migrations.py` fails the build on each of these.
They are listed here because that test is the only place they were written
down, and a rule nobody can find is one people rediscover by breaking it.

| Rule                                                                                        | Enforced by                                                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Exactly one base migration, and exactly one head                                            | `TestMigrationChain::test_exactly_one_base_migration`, `::test_exactly_one_head`                     |
| The chain is complete and every migration is reachable from the base                        | `::test_chain_is_complete`, `::test_all_migrations_reachable_from_base`                              |
| No duplicate revision ids; forks resolve into a single head                                 | `TestNoDuplicateRevisions`                                                                           |
| Every file has a `revision`, an `upgrade()` and a `downgrade()`                             | `TestMigrationFileQuality::test_all_migrations_have_*`                                               |
| `downgrade()` is not a bare `pass` — an irreversible migration is a decision, not a default | `::test_downgrade_is_not_empty_pass` (merge migrations, which `pass` in both directions, are exempt) |
| `DROP TABLE` always carries `IF EXISTS`, so a re-run is idempotent                          | `::test_no_drop_table_without_if_exists`                                                             |
| Date-based revision ids run in chronological order along the chain                          | `::test_date_based_revisions_are_chronologically_ordered`                                            |
| A legacy revision id stays in the graph once published                                      | `TestRenumberedRevisionCompatibility`                                                                |

**Naming.** `alembic.ini` sets a `file_template` of
`%(year)d%(month).2d%(day).2d_%(hour).2d%(minute).2d_%(rev)s_%(slug)s`, so a new
migration is `YYYYMMDD_HHMM_<rev>_<slug>.py`. Let Alembic generate the name; do
not hand-write one.

`test_filename_matches_revision_id` checks the older `YYYYMMDD_NNNN` convention
only, where the revision id _is_ the filename prefix. Files on the current
hash-revision template fall outside that check — a gap in coverage, not
permission to diverge from the template.

---

## A Migration Must Tolerate a Table Only `create_all` Builds

_CLAUDE.md pitfall #26, 2026-08-25._

**40 of this schema's 254 tables are never created by any migration.**
`event_requests`, `prospects`, the whole finance-approval set (`budgets`,
`budget_categories`, `check_requests`, `expense_reports`, ...) and more come
into being when `main.py`'s `_fast_path_init()` calls `create_all()` and
stamps Alembic at head — the deployment model
`app/utils/enum_normalization` documents.

**A table renamed into existence by a migration does not belong on this
list, even if no migration ever `create_table`s it under its current name.**
`positions`/`user_positions` looked like textbook examples — no
`op.create_table("positions", ...)` anywhere in the chain — until a
2026-08-31 review (`docs/security-review/MSG-25-messaging-notifications.md`,
MSG-11) added an unnecessary guard on exactly that reasoning, then had to
revert it once empirical testing (a real `alembic upgrade head` against a
fresh database, not just re-reading the migration source) showed the tables
already exist by then: `20260805_0008_rename_roles_to_positions.py` renames
`roles`/`user_roles` — created outright by the initial schema migration —
to `positions`/`user_positions`, and is a required upgrade-path ancestor of
every later migration that touches them. `backend/tests/
test_migration_create_all_tables.py`'s `_tables_created_by_migrations` now
credits `op.rename_table` destinations for exactly this reason — trust that
function's output (or an empirical fresh-database run) over a manual grep
for `create_table`.

That is deliberate, and it is also a trap, because **CI runs `alembic upgrade
head` against an empty database** in the integration and contract jobs, before
anything calls `create_all`. Reflecting a column on a table that is not there
raises `NoSuchTableError`, and that kills the entire upgrade — not just the one
step:

```python
# WRONG — dies on any database that has not started the app yet
def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}

if not _has_column("event_requests", "staffing_shift_id"):
    op.add_column("event_requests", sa.Column(...))

# CORRECT — require the table as well as the absent column
def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()

if _has_table("event_requests") and not _has_column("event_requests", "..."):
    op.add_column("event_requests", sa.Column(...))
```

**Skipping is correct, not merely safe.** A table `create_all` builds later is
built from the models, which already declare the new column.

This was live on 2026-08-24: two migrations adding columns to `event_requests`
failed on every fresh database, which is four red matrix jobs (MySQL 8.0 and
MariaDB 10.11 × integration and contract), not one. Fifteen of the sixteen
existing migrations that touch such a table already guarded; the pattern was
simply undocumented.

**Rule:** before altering a table in a migration, check whether any migration
creates it. If none does, guard the step on the table's existence.
`tests/test_migration_create_all_tables.py` enforces this and was clean when
written, so any failure is new.

**Related, same root:** `alembic upgrade head` alone does not produce a working
schema. On a freshly migrated database `scripts/repair_schema.py` still adds a
dozen columns the models declare and no migration creates. Treat the models as
the schema of record and migrations as alterations on top — not the reverse.

---

## A Seeded Rank Grant Reaches the Database Through a Position

_CLAUDE.md pitfall #23, 2026-08-24._

`operational_ranks` has no `permissions` column. Rank defaults resolve at
runtime from `OPERATIONAL_RANKS` via `get_rank_default_permissions`, which
makes "removing a grant from a rank needs no data migration" sound obviously
true. It is false, and the reason is one line of aliasing:

```python
# permissions.py — DEFAULT_POSITIONS
"firefighter": {
    ...
    "permissions": OPERATIONAL_RANKS["firefighter"]["default_permissions"],
},
```

`DEFAULT_POSITIONS["firefighter"]["permissions"]` **is** the rank's list — the
same object. Onboarding creates a system _position_ with slug `firefighter`
carrying a copy of it, and `dependencies.py` unions every assigned position's
stored permissions. So the rank's grants do reach the database, by way of a
position, and an installation that already ran onboarding keeps them until a
migration rewrites that row.

This cost a review round on #1795: `compliance.view` was revoked from the
`member` position only, and would have stayed live for everyone holding the
Firefighter position on every existing department.

It also defeats naive analysis. A survey that reads each role's body looking
for `SOMETHING.name` literals sees an empty list under `firefighter`, because
the entry is a reference — which is how the gap was missed in the first place.

**Rule:** changing a seeded grant means changing the registry **and** writing a
migration that covers every stored `positions` row carrying it — for a rank
grant, both the `member`-style position and the rank-mirroring one. Scope the
`UPDATE` to `is_system = True`: a position the department **created** is theirs.
Verify the migration by running it against a real table rather than by
reading it; `20260824_2140_31e2816df7c3` and its precedent
`20260814_0004` are the shape to copy. `tests/test_baseline_member_grants.py`
asserts the day-one grant set on all three registry entries by name, aliasing
or not, so the persisted path is covered rather than inferred.

**`is_system = True` does not mean the row is unedited** _(2026-09-04)_. It
separates the seeded positions from ones the department added — nothing more.
`RoleService.update_role` (`app/services/role_service.py`) explicitly permits
editing a **system** position's `permissions` and leaves the flag set, so a
seeded row may hold exactly what an administrator chose. An earlier version of
this rule said the scope preserved "a department's own customized position",
and three migrations were written against that reading.

Nothing in the row distinguishes a grant the seed wrote from one an
administrator added, so decide by direction rather than by guessing provenance:

- **Revoking** a grant that discloses other members' data — reporting,
  rosters, compliance, another member's record — is unconditional. Leaving it
  in place on an unrecognized row keeps the disclosure open; the cost of being
  wrong is an administrator re-adding it on the positions screen.
- **Adding** a grant is gated on some positive evidence the row is an
  unrepaired seed. An unconditional add overrides a department that removed the
  grant deliberately, and a missing benign grant discloses nothing.

Do not try to recognize an unedited row by matching its whole permission list:
`20260901_1320_f7b3c8d2e569` did, and every later migration that touched those
rows moved them out of the match. A snapshot of a whole row is pinned to the
build that produced it, so it also misses every row written by any _other_
build — silently, while reading as though it covered them. `b4d1c8e37f52` was
written that way and had to be superseded by `c7a4e91d3b68`: gate instead on a
signal no build could have produced, which for an addition is usually the
**absence of the very grants being added** when nothing in the editor can emit
them. That answer cannot drift, because adding a module to the registry cannot
move a row across it. Say in the migration's docstring which direction you chose
and what it costs when it is wrong.

**Superseded, not edited — and the distinction is the whole repair.** The first
attempt at that fix rewrote `b4d1c8e37f52` in place, which changes nothing where
it matters: Alembic records a revision as applied by id, so an installation that
already ran the narrow version never executes the widened body, and the rows it
skipped are exactly the ones the widening exists to reach. A published revision
is frozen (pitfall #20) and the delta belongs in a child revision — the shape
`f3b8d0c26a17` states plainly: "A new revision is also the only thing that
reaches an installation which already stamped either version." Being sure
nothing has upgraded yet is not a substitute; that is another unverifiable
premise, which is the failure this rule already exists to stop.

---

## What stayed in CLAUDE.md

Three neighbouring rules were deliberately **not** moved here. The test for
whether a rule may be reached through a skill is whether a missed trigger costs
a red build rather than a shipped defect. These have no machine check, so they
stay where they are always in context:

| Rule                                                                   | Why it stayed                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pitfall #8** — seed data ordering and `SEED_DATA_FILES` registration | Nothing asserts that a seed migration is registered. `grep -rn SEED_DATA_FILES backend/tests/` returns nothing; the only references are the definition and the loop in `main.py`. A missed registration ships as missing seed data on fresh installs. |
| **Pitfall #12** — JSON columns and `dict()` shallow copies             | Behavioural tests exercise `deepcopy` / `flag_modified` per feature, but nothing flags a new shallow copy. It is also a service-layer rule rather than a migration one.                                                                               |
| **Pitfall #20** — one canonical shape per untyped JSON column          | Its migration-relevant half (a published migration body is frozen; an irreversible backfill says so) is inseparable from its write-path half. Splitting a coherent rule across two documents is how the halves drift.                                 |

If you add a guard for any of these, move the rule here and leave the one-line
statement behind — that is the whole pattern.
