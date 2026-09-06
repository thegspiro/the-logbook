# Backend Endpoint & Service Rules

What this repository enforces about writing or changing a backend endpoint,
service, or query. `CLAUDE.md` carries a one-line statement of each rule and
links here; the `repo-tenancy` skill loads this file when a session starts
touching `app/api/` or `app/services/`.

It lives in `docs/` rather than inside the skill for the reason given in
[migrations.md](./migrations.md): `AGENTS.md` makes these repository rules, and
the other agents acting on them cannot read `.claude/skills/`.

## Contents

- [The rule that did not move: org-scope every by-id query](#the-rule-that-did-not-move-org-scope-every-by-id-query)
- [Validating a client-supplied FK: `app/utils/org_scoping.py`](#validating-a-client-supplied-fk-apputilsorg_scopingpy)
- [The guards CI already runs](#the-guards-ci-already-runs)
- [A `LIKE` Pattern Is Built by `like_pattern`, and the `ESCAPE` Clause Is Not Optional](#a-like-pattern-is-built-by-like_pattern-and-the-escape-clause-is-not-optional)
- [A Capacity Check Is a Read-Then-Write, and Needs the Row Locked](#a-capacity-check-is-a-read-then-write-and-needs-the-row-locked)
- [CSV / Spreadsheet Exports: Always Use `SafeCsvWriter`, Never Raw `csv.writer`](#csv--spreadsheet-exports-always-use-safecsvwriter-never-raw-csvwriter)
- [What stayed in CLAUDE.md](#what-stayed-in-claudemd)

---

## The rule that did not move: org-scope every by-id query

**Read CLAUDE.md pitfall #14 in full. It is not reproduced here, and this file
does not cover it.**

That is deliberate, and it is the most important thing on this page. Pitfall
#14 is the dominant finding class in the 2026-07 module audit — cross-tenant
reads and writes — and it is the one rule in this domain with **no repo-wide
machine check**. `backend/tests/test_org_scoping.py` tests the _helper_ below;
per-feature suites (`test_scheduling_org_scoping.py`,
`test_audit_org_scoping.py`, `test_event_attachment_org_scoping.py` and
others) cover the features they name. Nothing scans for a by-id query that
forgot its `organization_id` filter.

So a missed trigger on this rule ships a cross-tenant leak rather than failing
a build, which is exactly the case the always-on/on-demand split exists to keep
out of a skill. It stays in `CLAUDE.md`, where it is in context whether or not
anything triggers.

In one line, so this page is not silent on it: **a bare
`select(Model).where(Model.id == client_supplied_id)` is an IDOR.** Filter
`organization_id` too, or resolve the row through a parent that was already
org-scoped — and note that `require_permission(...)` does **not** do this for
you: it asserts the caller holds a permission _in their own org_, which is no
constraint at all on which org's row they then fetch.

---

## Validating a client-supplied FK: `app/utils/org_scoping.py`

Pitfall #14c says to validate that a client-supplied foreign key belongs to the
caller's organization before storing it. This is the helper that does it, and
it is documented nowhere else.

| Function                                                     | Use                                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `await assert_in_org(db, Model, entity_id, organization_id)` | The default. Raises `ValueError` (→ 400) at the top of a service create/update.  |
| `await is_in_org(db, Model, entity_id, organization_id)`     | When you need the boolean — e.g. an optional FK that may legitimately be `None`. |
| `await assert_all_in_org(db, Model, ids, organization_id)`   | A list of ids in one call.                                                       |

It **fails closed**: a falsy `entity_id`, a falsy `organization_id`, a row that
does not exist, and a row in another org all resolve the same way — not
in-org. A caller that wants "unset is allowed" passes through on `None` before
calling, rather than relying on the helper to be permissive.

`model` must expose `id` and `organization_id`. Ids are compared as strings, to
match the `String(36)` UUID primary keys the models use.

Prefer it over an ad-hoc per-service check. The point of one implementation is
that the fail-closed behaviour is decided once; the piecemeal checkers added
after the audit are what it replaced.

---

## The guards CI already runs

These are enforced and written down nowhere but the tests themselves. Each
exists because the gap it closes had already shipped.

| Guard                            | What it fails on                                                                                                                                                                                                                                                                                  | Test                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Endpoint auth coverage           | A handler under `app/api/v1/endpoints` with no auth dependency (`get_current_user`, `require_permission`, …) that is not on the reviewed public allowlist. Adding to that allowlist is a deliberate security decision, not a formality.                                                           | `test_endpoint_auth_coverage.py`      |
| Permission registry reachability | A `require_permission("x.y")` whose permissions are **all** unregistered — the endpoint is then reachable only by a `*` superadmin and no role can ever be granted it. This is how the entire medical-screening feature became unreachable. A legacy name left in an OR with a valid one is fine. | `test_require_permission_registry.py` |
| Scheduled task wiring            | A task in `TASK_RUNNERS` that is in neither `TASK_INTERVALS_SECONDS` nor the manual-only set — documented, manually triggerable, and never auto-fired in production. Five tasks were in that state.                                                                                               | `test_scheduled_task_coverage.py`     |
| Raw CSV writers                  | A `csv.writer` or `csv.DictWriter` outside `app/utils/csv_export.py` — an export whose cells reach Excel unneutralized. The 2026-07 audit found six at once.                                                                                                                                      | `test_csv_writer_sweep.py`            |
| Per-org loop isolation           | A per-org scheduled runner that does not commit each org's work and roll back a failed org, letting one org's failure poison the rest.                                                                                                                                                            | `test_cron_org_loop_isolation.py`     |

Run them together when you touch an endpoint, a permission gate, or a
scheduled task:

```bash
cd backend && python3 -m pytest \
  tests/test_endpoint_auth_coverage.py \
  tests/test_require_permission_registry.py \
  tests/test_scheduled_task_coverage.py \
  tests/test_cron_org_loop_isolation.py \
  tests/test_like_escaping.py \
  tests/test_capacity_locking.py \
  tests/test_csv_writer_sweep.py
```

---

## A `LIKE` Pattern Is Built by `like_pattern`, and the `ESCAPE` Clause Is Not Optional

_CLAUDE.md pitfall #25, 2026-08-25._

A user's search string reaches SQL as a **pattern**, not a literal. SQLAlchemy
parameterizes the value, so this is not injection — but `%` and `_` inside that
parameter are still wildcards. A member who types `%` gets every row the org
has, and the paginated list's count query scans all of it.

Escaping the term is only half the fix. `.ilike(pattern)` with no `ESCAPE`
clause leaves the escape character up to MySQL's `sql_mode`: under
`NO_BACKSLASH_ESCAPES` the backslashes are literal and every wildcard comes
back. The escaping _looks_ present in review and does nothing at runtime.

```python
# WRONG — the filter stops filtering the moment somebody types "%"
pattern = f"%{search}%"
q.where(Model.name.ilike(pattern))

# WRONG — escaped, but the database was never told what the escape char is
safe = search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
q.where(Model.name.ilike(f"%{safe}%"))

# CORRECT
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern
q.where(Model.name.ilike(like_pattern(search), escape=LIKE_ESCAPE_CHAR))
```

**Rule:** never hand-roll the transform — `app/utils/sql_search.py` owns it, and
the fifteen copies that existed before 2026-08-25 are why forty-seven call sites
forgot the kwarg. Pass `escape=LIKE_ESCAPE_CHAR` on **every** `like`/`ilike`,
including one whose pattern is system-generated (`"ORD-2026-%"`): it is inert
there, and covering it is what leaves the invariant with no exceptions to
maintain. `tests/test_like_escaping.py` enforces both halves.

**Related:** when a query escapes a term for SQL and then re-checks the result
in Python, the Python side compares against the **raw** input. Comparing against
the escaped form is how the inventory barcode search came to report the wrong
`matched_field` for any code containing `%`, `_` or `\`.

---

## A Capacity Check Is a Read-Then-Write, and Needs the Row Locked

_CLAUDE.md pitfall #27, 2026-08-25._

Anything with a limit — seats on a shift, `max_attendees` on an event, a role
on an outreach signup sheet — is enforced by counting what is already there and
then inserting. Two requests arriving together both read the count before
either commits, both decide there is room, and the limit is exceeded by exactly
the number of people who tapped at once. It is invisible in testing, because
one request never races itself.

It takes **two** changes, and the second is the one everybody misses.

**1. Lock the parent row**, to serialize the decision:

```python
# WRONG — two members both see the last seat
shift = await self.get_shift_by_id(shift_id, organization_id)

# CORRECT — serialize on the row everyone contends for
shift = await self.get_shift_by_id(shift_id, organization_id, for_update=True)
```

Lock the parent, not the rows being counted: the seats that would conflict do
not exist yet, so there is nothing to lock; the shift/event/request row is the
one thing both transactions already share.

**2. Make the count itself a locking read**, or the lock buys nothing:

```python
# STILL WRONG — the row is locked and the count is stale anyway
occupied = await self.db.execute(select(func.count()).where(...))

# CORRECT
occupied = await self.db.execute(select(func.count()).where(...).with_for_update())
```

Under InnoDB's default REPEATABLE READ — which is what this app runs, no
`isolation_level` is set on the engine — a plain `SELECT` answers from the
snapshot taken at the transaction's **first** read, and acquiring a row lock
does not refresh it. Every one of these checks runs behind an endpoint that
already loaded the shift or the event, so the snapshot predates the lock. The
second transaction blocks, waits, acquires the lock, counts — and sees the
tally from before the first one committed. Demonstrated on this schema:

```
T2 reads (snapshot taken)
T1 locks parent, counts 0, inserts, commits
T2 locks parent  ->  plain count: 0   locking count: 1   (truth: 1)
```

A locking read is defined to see the latest committed version, which is why it
is the fix. `SELECT ... FOR UPDATE` on the count is not there for the lock.

This is easy to get wrong and invisible in review, because the code reads as
correct and the comment above it says so. `event_service` carried the comment
"event row is locked, so this count is consistent" from the day it was written;
the row was locked and the count was not consistent.

**Enforce the lock wherever the limit is enforced.** Shift assignment briefly
locked only for self-signup, on the reasoning that an officer may overfill a
crew deliberately. Half true: the _headcount_ cap is waived for officers, the
_named-seat_ cap is not — a seat on a crew is one seat whoever fills it — so
two officers, or an officer racing a member, still raced for the last Driver
seat. Check which caps actually run on each path before making the lock
conditional on any of them.

Found on 2026-08-24 in the outreach role seats and the outreach signup sheet
(two coordinators each creating a shift, one orphaned), on 2026-08-25 in
generic shift seat capacity, which had the same shape since it was written, and
the same day in all five capacity counts, which were locking the right row and
then reading a stale number.

**Rule:** when adding a feature with a cap, a quota, or a one-per-thing
invariant, ask what happens if two requests arrive in the same millisecond. If
the answer involves a count followed by an insert, lock the parent row **and**
make the count a locking read. `tests/test_capacity_locking.py` asserts both
halves at every site.

---

## CSV / Spreadsheet Exports: Always Use `SafeCsvWriter`, Never Raw `csv.writer`

_CLAUDE.md pitfall #15._

Exported CSVs are opened in Excel / Google Sheets, which **execute** any cell
whose value begins with `=`, `+`, `-`, `@` (or a leading tab/CR) as a formula.
Free-text fields written to an export — member names, notes, item descriptions,
memos — are attacker-influenceable, so a member named `=cmd|…` runs a formula on
whatever staff member opens the export (formula/CSV injection). The
2026-07 module audit found this live in six separate exporters that used raw
`csv.writer`.

```python
# WRONG — a cell starting with = / + / - / @ executes in Excel/Sheets
import csv
writer = csv.writer(output)

# CORRECT — SafeCsvWriter neutralizes every cell (drop-in, same interface)
from app.utils.csv_export import SafeCsvWriter
writer = SafeCsvWriter(output)
```

**Rule:** Any CSV that leaves the system (member exports, compliance reports,
finance/QuickBooks exports, audit hand-offs) MUST be written with
`SafeCsvWriter` from `app/utils/csv_export.py` — never bare `csv.writer`. It
prefixes formula-trigger cells with a `'`, transparent to the reader. The same
applies to any other spreadsheet-bound output.

`tests/test_csv_writer_sweep.py` enforces this: an AST sweep over `app/` and
`scripts/` failing on any `csv.writer` / `csv.DictWriter` outside
`app/utils/csv_export.py`, plus the import form (`from csv import writer`) that
would otherwise walk around it. Readers are untouched — `csv.reader` and
`csv.DictReader` parse input and cannot inject a formula into anything.

---

## What stayed in CLAUDE.md

The gate is that a rule may only be reached on demand if a missed trigger costs
a red build rather than a shipped defect. Four rules in this domain fail it and
stay always-on:

| Rule                                                                | Why it stayed                                                                                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pitfall #14** — org-scope every by-id query and FK                | No repo-wide check exists, and it is the highest-severity class here. See above.                                                                                                 |
| **Pitfall #9** — unbounded in-memory caches                         | No guard. `test_onboarding_rate_limit_scopes.py` covers one feature's scoping, not the size-cap rule.                                                                            |
| **Pitfall #18** — email-first, SMS behind the `SmsAlert` allowlist  | `test_notification_channels.py` covers the resolver's negative space, but nothing flags a new direct `SMSService` call at a feature call site, which is the shape the rule bans. |
| **Pitfall #19** — a config switch needs a reader before it has a UI | `test_notification_rules_gate_senders.py` asserts the senders consult `notification_rules`. That is one mechanism; the general rule has no general guard.                        |

Each of these becomes movable the day it gets a check. **Pitfall #15 already
did**: it sat in this table until `test_csv_writer_sweep.py` was written, and the
rule moved up into this file the same day. That is the pattern working as
intended — the way to shorten this table is to write the guard, not to relax the
gate.
