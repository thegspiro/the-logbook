---
name: repo-tenancy
description: Multi-tenant and query-correctness rules for this repository's backend endpoints and services. Use when adding or editing anything under backend/app/api/ or backend/app/services/ — a by-id read/update/delete, a client-supplied foreign key, a permission gate, a search or filter that builds a LIKE pattern, a seat/quota/capacity cap, a scheduled task, or a CSV export. Also use when reviewing an endpoint for cross-tenant leakage (IDOR), or when a security review raises XC-1, XC-2 or XC-3.
---

# Backend endpoint & service rules for The Logbook

**Read `docs/rules/tenancy.md` before writing or changing an endpoint,
service, or query.** It holds the full text. This file gets you there and
states the rule that outranks everything else in this domain.

New rules go in `docs/rules/tenancy.md`, not here — the prose has to sit
somewhere the non-Claude agents on this repository can read it.

## The one that outranks the rest

**Every by-id read, update and delete filters `organization_id`.** A bare
`select(Model).where(Model.id == client_supplied_id)` is an IDOR: filter the
org too, or resolve the row through a parent that was already org-scoped.

`require_permission(...)` does **not** scope the object. It asserts the caller
holds a permission _in their own org_, which constrains nothing about which
org's row they then fetch — so an org-A admin can mutate an org-B row behind a
passing permission check.

This is the dominant finding class in the 2026-07 audit and it has **no
repo-wide machine check**, so its full text stays in `CLAUDE.md` as pitfall
**#14** rather than moving behind this skill. Read it there.

## Before you finish

- A client-supplied FK is validated with `assert_in_org` from
  `app/utils/org_scoping.py` before it is stored — not an ad-hoc per-service
  check. It fails closed.
- Every `like`/`ilike` uses `like_pattern(term)` and passes
  `escape=LIKE_ESCAPE_CHAR`, including patterns the system generated itself.
  Without the kwarg the escaping is inert under `NO_BACKSLASH_ESCAPES` and
  looks correct in review.
- A cap or quota locks the **parent row** and makes the count itself a
  **locking read**. Under REPEATABLE READ a plain `SELECT` behind a lock still
  answers from a stale snapshot; the lock alone buys nothing.
- A CSV that leaves the system is written with `SafeCsvWriter` or
  `SafeDictCsvWriter`, never bare `csv.writer` — a cell starting `=` executes
  when staff open the export.
- Run the guards:

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

## Full text

- [docs/rules/tenancy.md](../../../docs/rules/tenancy.md) — the `org_scoping`
  helper API, the four repo-wide guards CI runs, the `LIKE` rule (#25) and the
  capacity-locking rule (#27) in full, and the `SafeCsvWriter` rule (#15).
- `CLAUDE.md` pitfalls **#14** (org scoping), **#9** (unbounded caches), **#18**
  (email-first notifications) and **#19** (a config switch needs a reader) stay
  in CLAUDE.md — none has a machine check, so none is behind this skill.
