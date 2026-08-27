# Security Review 00 — Cross-Cutting Baseline

**Prefix:** `SEC` · **Iteration:** 00 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2) · **PR:** [#1799](https://github.com/thegspiro/the-logbook/pull/1799) (pass 1)

---

## Pass 2 (2026-08-27) — re-sweep after rotation pass 1

Pass 1 completed the full 35-feature rotation (#1799–#1918) and closed SEC-1
through SEC-4 with two of the five sweeps converted into standing guard tests
(`test_like_escaping.py`, `test_database_schema.py::TestColumnConstraints::
test_set_null_fks_are_nullable`). This pass re-runs the same five sweeps
against everything that landed during pass 1 and since (the endpoint count grew
by one file — `app/api/prospect_privacy.py`, a `Depends()` helper module with
no routes of its own, not a new router — and the Alembic chain grew from 355 to
381 revisions). It does not re-derive pass 1's conclusions; it re-verifies them
against current code, per the rotation's own rule.

| #   | Class swept                      | Method                                                                                                                              | Result                                                                                                                                   |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`                                                                | **clean** — 0 sites, unchanged                                                                                                           |
| 2   | `SET NULL` on `NOT NULL` columns | `test_set_null_fks_are_nullable` (guard test added pass 1)                                                                          | **clean** — passes                                                                                                                       |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                                                                                          | **clean** — same 3 hits as pass 1 (2 comments, 1 deliberate use inside `get_client_ip`)                                                  |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py --strict`                                                                                   | **clean** — 381 revisions, single head `8fb3757b80ec`, no duplicate ids                                                                  |
| 5   | LIKE-wildcard handling           | `test_every_like_call_declares_the_escape_character` + `test_wildcard_escaping_lives_only_in_sql_search` (guard tests added pass 1) | **clean** — both pass; no new `.like()`/`.ilike()` call site has reintroduced a raw copy of the transform or dropped the `escape=` kwarg |

**Route auth coverage re-check:** an AST walk of every `@router.<verb>`
decorator in `api/v1/endpoints/`, `api/v1/onboarding.py`, and `api/public/`
found 68 routes with no recognized auth dependency (pass 1: 69 — the
one-route difference is a rename/refactor within the same already-accounted
surface, not a new gap). Every route is still confined to the same five
features pass 1 named: auth (14), event_requests.py's 4 public routes,
elections.py's 4 token-scoped routes, onboarding.py's 24 bootstrap routes, and
the public/* surface (22, including `salesforce_sync.py`'s OAuth callback).
**No new ungated route outside those five features.**

No findings this pass. All five pass-1 invariants hold; two are now enforced
by tests rather than by review, exactly as pass 1 intended.

**Completion gate (pass 2):** `flake8`/`black --check`/`isort --check-only`
clean across `app/ tests/ alembic/`; `validate_migrations.py --strict` passed;
`test_like_escaping.py` (2/2) and the `SET NULL` guard test pass; `tsc
--noEmit` 0 errors; `eslint .` 0 errors (10 pre-existing warnings, same set as
feature 34's gate). No code changes this pass — documentation only.

---

## Pass 1 (2026-08-25)

**Scope:** whole codebase — `backend/app/` (66 v1 endpoint files, 11 public
endpoint files, 108 services, 42 model modules, 355 Alembic revisions).

The rotation opens with the sweeps that only make sense run against everything
at once. A per-feature iteration cannot establish "this class does not exist
anywhere"; it can only establish "not here". Running them first also means the
34 feature iterations that follow inherit the invariants instead of re-checking
them by hand.

---

## Scope

**Read in full:** `app/utils/sql_search.py`, `app/utils/csv_export.py`,
`app/utils/org_scoping.py`, and every call site the five sweeps returned.

**Swept mechanically** (AST or grep over all of `backend/app/`): LIKE/ILIKE
escaping, CSV writer selection, `request.client.host` usage, `SET NULL`
nullability, route auth coverage, and model-vs-migration table/column drift.

**Not read:** the feature internals themselves. This iteration establishes
class-level absence or presence, not per-feature verdicts — those are
iterations 01–34. A clean sweep here does **not** mean a feature is clean.

---

## Sweep results

| #   | Class swept                      | Method                                                                              | Result                                                                                                                                                                   |
| --- | -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`                | **clean** — 0 sites; every exporter uses `SafeCsvWriter`                                                                                                                 |
| 2   | `SET NULL` on `NOT NULL` columns | grep every `ondelete="SET NULL"`, check the 3 lines that follow for `nullable=True` | **clean** — 0 sites; also guarded by `tests/test_database_schema.py::test_set_null_fks_are_nullable`                                                                     |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                                          | **clean** — 3 hits, all non-runtime: 2 explanatory comments and 1 deliberate `direct_ip` inside `get_client_ip` itself. AXC-1 closed this class and it has stayed closed |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py`                                            | **clean** — 355 revisions, single head `f2a91c7d6b04`, no duplicate ids, no orphans                                                                                      |
| 5   | LIKE-wildcard handling           | AST walk of every `.like()` / `.ilike()` call                                       | **3 findings — SEC-1/2/3, all fixed below**                                                                                                                              |

A sixth sweep (model↔migration drift) is written up under
[Schema & migration notes](#schema--migration-notes) — it found no defect, but
what it found instead is load-bearing enough to record.

---

## Route auth coverage

An AST walk of every route decorator in `app/api/` found **69 routes with no
auth dependency in the signature**, split as:

- **20 in `api/public/`** — the intentionally public surface (portal, calendar,
  display, `security.txt`, legal, four inbound webhooks, three finance
  approval-token routes, two public form routes).
- **49 in `api/v1/`** — 24 onboarding bootstrap routes, 15 auth routes (login,
  register, OAuth initiate/callback, password reset), 4 token-scoped ballot
  routes, 4 public event-request routes, the public calendar, the Salesforce
  OAuth callback, and `GET /` on the API root.

Every one of these is public **by design**. That is not the same as verified:
each needs its compensating control checked (rate limit before the expensive
work, signed/consumed token, webhook signature). That check is the substance of
iterations **01 auth**, **03 public surface**, **06 elections**, **16 events**
and **30 onboarding**, and the inventory above is recorded here so those
iterations start from a list rather than re-deriving one.

**No route outside those five features was found ungated.**

---

## Verified good ✅

- **Every CSV that leaves the system is formula-safe.** Zero uses of raw
  `csv.writer` remain in `app/`; `SafeCsvWriter` prefixes any cell opening with
  `= + - @ \t \r`. Mechanism: sweep 1, plus the class was closed repo-wide by
  the 2026-07 audit and has not regressed.
- **No `ondelete="SET NULL"` column is `NOT NULL`.** Mechanism: sweep 2, backed
  by an existing metadata test, so this is guarded rather than merely observed.
- **Client IP attribution is uniform.** Every runtime site resolves through
  `get_client_ip(request)`, which honours `TRUSTED_PROXY_IPS` and falls back to
  the peer address. Mechanism: sweep 3.
- **The migration chain is single-headed and consistent.** Mechanism: sweep 4,
  which the CI gate also runs.
- **All 76 `like`/`ilike` calls declare `escape=LIKE_ESCAPE_CHAR`**, and the
  wildcard-escaping transform has exactly one implementation. Mechanism:
  `tests/test_like_escaping.py`, added this iteration — this is now an
  invariant, not a snapshot.

---

## Findings

### SEC-1 — MED — Raw user input interpolated into a LIKE pattern — ✅ FIXED

**What:** two search paths built their pattern by direct interpolation, with no
wildcard escaping at all.

**Where:**

- `backend/app/services/messaging_service.py:124` — `pattern = f"%{search.strip()}%"`
- `backend/app/api/v1/endpoints/message_history.py:80` — `pattern = f"%{search}%"`

**Failure scenario:** a user with `settings.manage` types `%` into the
department-message search box. The pattern becomes `%%%`, which matches every
row, so the "search" silently returns the org's entire message table — and the
paginated list's count query scans all of it. `_` behaves the same way at
single-character granularity: searching `a_c` also returns `abc`, so a member
looking for one record gets a set they did not ask for and has no way to tell
the filter was ignored.

**Impact:** both queries are correctly org-scoped, so this is **not** a
cross-tenant leak. What it is: a filter that can be made to not filter, on two
list endpoints, with an unbounded scan behind it. The wrong-results half is the
part a user would never notice.

**Fix:** both now build the pattern with `like_pattern()` and pass
`escape=LIKE_ESCAPE_CHAR`.

### SEC-2 — MED — Wildcard escaping present but never declared to the database — ✅ FIXED

**What:** 47 call sites escaped the search term correctly and then emitted
`LIKE`/`ILIKE` **without an `ESCAPE` clause**.

**Where:** 12 files, chiefly `inventory_service.py` (19 sites),
`forms_service.py` (7), `apparatus_service.py` (4),
`membership_pipeline_service.py` (3), `documents_service.py` (3),
`facilities_service.py` (3).

**Failure scenario:** MySQL's default LIKE escape character depends on
`sql_mode`. Under `NO_BACKSLASH_ESCAPES` — a mode a DBA can enable for
standards compliance, and which some managed MySQL offerings set — the
backslashes the escaping inserted are treated as literal characters rather than
escapes. Every wildcard the transform was written to neutralize comes back, and
the codebase reverts to SEC-1 behaviour across all 47 sites at once. The
project already knew this: `app/utils/sql_search.py`'s own docstring says
"MySQL's default varies by mode and cannot be relied on implicitly" and "the
result must be passed with `escape=LIKE_ESCAPE_CHAR`; without it the escaping
is inert".

**Impact:** latent rather than live — on the default `sql_mode` these queries
behave correctly today. It is recorded as MED rather than LOW because the
failure is configuration-triggered, silent, simultaneous across the whole
application, and invisible in code review: the escaping _looks_ present.

**Fix:** every `like`/`ilike` call in `app/` now passes
`escape=LIKE_ESCAPE_CHAR` — 76 of 76, no exceptions. That includes the 21 sites
that had been passing a raw `"\\"` literal (now the shared constant) and the
four whose pattern is system-generated (`"ORD-2026-%"`,
`"reminder_sent:%"`, `"%probationary%"`, `"{prefix}-{year}-%"`). Declaring the
escape character on those four is **inert**, not wrong — their `%` is not
preceded by a backslash, so it stays a wildcard — and covering them is what
makes the invariant exception-free, so the guard test needs no allowlist to
grow stale.

### SEC-3 — LOW — The escaping transform was copy-pasted into 15 files — ✅ FIXED

**What:** `app/utils/sql_search.py` exists specifically to own this transform.
Its docstring names the seven modules it was copy-pasted into and says "it lives
here so a fix or a subtlety lands in one place rather than seven". Exactly one
call site — `storefront_service.py` — actually imported it. Fifteen other files
carried their own copy, including one nested inside a function
(`membership_pipeline_service.py`'s local `_escape`).

**Where:** `apparatus`, `grant`, `notifications`, `inventory`, `minute`,
`equipment_check`, `meetings`, `documents`, `forms`, `facilities`,
`membership_pipeline`, `fundraising` services, plus `audit_logs.py`,
`skills_testing.py` and `message_history.py`.

**Failure scenario:** this is the mechanism behind SEC-2. Each copy of the
transform obliged its author to remember the `escape=` kwarg independently, and
47 of them did not. A single owner makes the two halves inseparable.

**Impact:** the duplication is why the defect class existed at all, and why it
would have come back.

**Fix:** all 15 now call `like_pattern()`. The transform exists once, in
`sql_search.py`. `finance_service.py`'s local variable named `like_pattern` was
renamed `number_prefix` so it cannot shadow the helper.

### SEC-4 — MED — Inventory barcode search attributes the wrong matched field — ✅ FIXED

**What:** `search_items_by_code` runs its DB query against the LIKE-escaped
pattern (correct), then re-scans the returned rows **in Python** to decide which
field matched — and compared against the _escaped_ string rather than the raw
input.

**Where:** `backend/app/services/inventory_service.py:3392` (was
`safe_lower = safe_code.lower()`).

**Failure scenario:** a member scans or types an asset tag containing `%`, `_`
or `\` — e.g. `50%`. The escape transform turns it into `50\%`. The database
correctly returns the item whose `asset_tag` is `50%`, but the Python loop then
tests `"50\%" in "50%"`, which is false for every field, so the match falls
through to the `matched_field = "name"` default. The UI reports the item was
found by _name_ when it was found by _asset tag_, and `matched_value` shows the
item's name instead of the code that was scanned.

**Impact:** wrong attribution in a scanning workflow, silently — the item is
still returned, so nothing looks broken. Pre-existing; not introduced by this
change. It surfaced because collapsing the duplicated transform removed the
`safe_code` variable, and `flake8` then reported `F821 undefined name
'safe_code'` at the line that had been misusing it. The lint rule found a
correctness bug the tests did not.

**Fix:** compare against `code.lower()` — the raw input — with a comment stating
why the escaped form is the wrong comparand.

---

## Schema & migration notes

The model-vs-migration sweep compared every `__tablename__` and `Column` in
`app/models/` against every `create_table` / `add_column` / raw `ALTER TABLE` in
the 355 Alembic revisions. It reports:

- **37 model tables that no migration ever creates** — `positions`,
  `integrations`, `error_logs`, `event_requests`, `prospects`, `budgets`,
  `approval_step_records`, and 30 more.
- **49 model columns that no migration ever adds**, across 17 tables.
- **0 migration-created tables with no model.**

**This is not a finding.** It is the documented, deliberate shape of this
deployment: application startup runs `Base.metadata.create_all(checkfirst=True)`
followed by `_add_missing_model_columns` (`backend/main.py:274–350`), and that
is how model-only tables and later-added model columns actually materialize.
`backend/scripts/repair_schema.py` exists so CI reproduces the same state, and
its docstring names the exact count — "37 tables exist in the models with no
migration that creates them" — along with the seven contract-test failures that
resulted when CI skipped the step.

Recording it here for two reasons. First, so a later iteration does not
rediscover it and file it as a critical drift bug. Second, because it is a
standing risk worth stating plainly even though it is working as designed:
`create_all` does not carry the `ondelete` behaviour, index set, or column
ordering that a hand-written migration does, so a table born from `create_all`
and a table born from a migration are not guaranteed identical. Checklist
dimension 7 asks each feature iteration which path its tables took.

Chain integrity itself is clean: 355 revisions, one head, no duplicates.

---

## Guard tests added

`backend/tests/test_like_escaping.py` — two tests, both source-walking:

1. `test_every_like_call_declares_the_escape_character` — every `.like()` /
   `.ilike()` in `app/` passes `escape=LIKE_ESCAPE_CHAR`. Asserts SEC-2's
   invariant with no allowlist.
2. `test_wildcard_escaping_lives_only_in_sql_search` — the transform
   `.replace("%", "\\%")` appears in exactly one file. Asserts SEC-3's.

Verified to fail on reintroduction: removing the `escape=` kwarg from one call
in `documents_service.py` fails test 1 and names the file and line; restoring it
passes.

---

## Completion gate

| Check                                                 | Result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/`                  | ✅ 1216 files unchanged                             |
| `isort --check-only app/ tests/ alembic/`             | ✅ clean — see the note below                       |
| `python3 -m pytest tests/ -k "<19 touched services>"` | ✅ **1715 passed, 1 skipped, 0 failed**, 325 errors |
| `backend/scripts/validate_migrations.py`              | ✅ 355 revisions, single head                       |
| `tsc --noEmit` / `eslint .`                           | n/a — no frontend file changed this iteration       |

The 325 errors are the sandbox's missing MySQL (`OperationalError(2003, "Can't
connect to MySQL server on 'localhost'")` at fixture setup), the same limitation
recorded in `docs/app-review/PROGRESS.md`'s baseline.

The same selection was run against unmodified `HEAD` in a separate git
worktree, which is what makes the result evidence rather than an assertion:

| Run                 |   Passed | Skipped |  Errors |
| ------------------- | -------: | ------: | ------: |
| `HEAD` (unmodified) |     1713 |       1 |     325 |
| this branch         | **1715** |       1 | **325** |

The error count is identical, so nothing moved from passing to erroring. The
`+2` is exactly the two tests added in `test_like_escaping.py`. That is the
standard AXC-1 set for a mechanical sweep, and it is the claim being made here:
behaviour-neutral to the suite, not merely still green.

### The gate that was reported clean and was not

`isort` was not installed in this sandbox and the first push went out without
it, on the reasoning that `black` and `flake8` both passed and CI would run the
real thing. CI did, and it failed: `storefront_service.py` had its
`sql_search` import placed after `storefront_payments` instead of before it.

The cause is specific and worth recording, because it is the one file where the
import was not newly added — it already existed at line 58, my sweep stripped it
along with the misplaced ones, and the AST pass that put it back inserts after
the _last_ top-level import rather than in sorted position. Every other file got
a new import that happened to sort correctly; this one did not.

`isort==8.0.1` (CI's pin) was then installed and run over `app/ tests/
alembic/`. One line moved. `black`, `flake8` and the guard test were re-run
after it and all still pass.

**The lesson is in the command file now** (Step 6): run all three linters
against `alembic/` too, and install a missing one at CI's pinned version rather
than noting it as unavailable. An import inserted programmatically is precisely
the change `isort` exists to catch, so "the other two linters passed" was never
evidence about this one.
