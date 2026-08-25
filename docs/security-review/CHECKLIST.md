# Security Review — Per-Feature Checklist

Seven dimensions, worked for every feature in the rotation. Not every item
applies everywhere; record **n/a** rather than skipping silently, so a reader
can tell _checked and clean_ from _not checked_.

The first six are the classic surface. The seventh — schema and migration
integrity — is here because a table that exists in one environment and not
another produces 500s that look like application bugs, and because a column
that silently stops being written is a data-loss defect no endpoint test sees.

---

## 1. Authentication coverage

- [ ] Every route in the feature carries an auth dependency. **Enumerate them**
      — a route with no `Depends` is a finding until proven intentional.
- [ ] Intentionally public routes (`api/public/`, login, token-scoped links) are
      listed explicitly, with the compensating control named: rate limit,
      signed token, webhook signature, or capability URL.
- [ ] Token-scoped routes verify the token **before** any expensive work, and
      fail closed on a malformed, expired, or already-consumed token.

## 2. Authorization & role fit

- [ ] The permission string matches the sensitivity of the data — a `.view`
      gate on data warranting `.manage` is the **XC-2** pattern.
- [ ] `require_permission(a, b)` OR-gates: check **every** alternative. One
      broadly-seeded grant in the list opens the endpoint to the whole
      department (CLAUDE.md Pitfall #23).
- [ ] Baseline grants: a permission added to `DEFAULT_POSITIONS["member"]` or
      the `firefighter` rank is a permission every volunteer holds.
- [ ] Self-scoped routes (`/mine`, `/me`, inbox) filter on the caller's own id,
      not merely the org.
- [ ] Separation of duties: the approver cannot be the requester; the reviewer
      cannot be the subject.

## 3. Tenant isolation

- [ ] **XC-3** — every by-id read/update/delete filters `organization_id`, or
      resolves through an already-org-scoped parent. `require_permission` does
      **not** scope the object.
- [ ] **XC-1** — client-supplied FK ids are validated in-org before being
      stored. Prefer `assert_in_org` from `app/utils/org_scoping.py`.
- [ ] Eager-loaded relationships cannot pull another org's row into a response
      through an unfiltered join.
- [ ] Aggregates, counts and exports are org-filtered on **every** branch,
      including the count query that parallels a paginated list.

## 4. Injection & untrusted output

- [ ] Raw SQL, and `.like()` / `.ilike()` without `escape=LIKE_ESCAPE_CHAR`
      (guarded by `tests/test_like_escaping.py`).
- [ ] CSV / spreadsheet exports use `SafeCsvWriter` — never bare `csv.writer`
      (CLAUDE.md Pitfall #15).
- [ ] User text in email HTML is `html.escape`d; ICS / vCard fields are escaped.
- [ ] Uploads: magic-byte MIME check, UUID filenames, no path traversal, size
      cap; deleting the record removes the backing file.
- [ ] Stored outbound URLs are re-validated at send time
      (`assert_outbound_url_safe`) to close the DNS-rebinding TOCTOU.

## 5. Data exposure

- [ ] Secrets are write-only and redacted on read; no credential is echoed back
      in a response; encrypted-at-rest fields are actually encrypted.
- [ ] PII/PHI is absent from audit and activity-log payloads.
- [ ] Endpoints returning PII are in `UNCACHEABLE_PREFIXES` in
      `frontend/src/utils/apiCache.ts`.
- [ ] Error responses go through `safe_error_detail()` — no SQL, paths, or
      tracebacks reach the client.
- [ ] List responses do not over-serialize: a member-facing schema must not
      carry admin-only fields the UI happens not to render.

## 6. Abuse resistance

- [ ] Public and unauthenticated surfaces are rate-limited **before** the
      expensive work (bcrypt, DB, mail).
- [ ] In-memory tracking dicts have a size cap and eviction (Pitfall #9).
- [ ] List endpoints and exports are bounded — no `all()` over an org-wide
      table, no N+1 loop issuing a query per row.
- [ ] Search inputs cannot be turned into a full-table scan (see §4).
- [ ] Fail-closed vs fail-open is deliberate and matches the table in CLAUDE.md
      → _Attack Protection_.

## 7. Schema & migration integrity

- [ ] `ondelete="SET NULL"` columns are `nullable=True` (Pitfall #2), and
      `ondelete` is present wherever a parent delete must not orphan rows.
- [ ] A new model table or column has a migration, **or** is knowingly left to
      the `create_all` + `_add_missing_model_columns` startup path — the
      distinction matters because only the former runs on an existing install.
- [ ] The Alembic chain has a single head and no duplicate revision ids
      (`backend/scripts/validate_migrations.py`).
- [ ] A seeded-grant change is accompanied by a migration that rewrites every
      stored `positions` row carrying it, scoped to `is_system = True`
      (Pitfall #23).
- [ ] JSON columns have one canonical stored shape, normalized on every write
      path, with a migration settling existing rows (Pitfall #20).
- [ ] Nested JSON mutations use `copy.deepcopy()` or `flag_modified()`
      (Pitfall #12).
- [ ] Update paths use `apply_updates` so an explicit `null` clears the column
      instead of being silently dropped (Pitfall #1).
