# Application Review — Per-Feature Checklist

Every iteration works through these six dimensions for its feature. Not every
item applies to every feature; record "n/a" rather than skipping silently, so a
reader can tell the difference between *checked and clean* and *not checked*.

---

## 1. Correctness & potential issues

- [ ] **Wrong-field / wrong-attribute bugs** — attribute names that don't exist
      on the model (the `i.quantity` vs `quantity_issued` class of bug found in
      inventory). Grep the service's attribute access against the model file.
- [ ] **Silent no-ops** — writes whose result is discarded, `if` branches that
      can never be true, flags read but never persisted, `exclude_unset`
      interacting with `server_default` so a field is dropped from aggregates.
- [ ] **Money / quantity math** — float arithmetic on currency, totals derived
      by increment rather than re-aggregation (drift), missing overspend or
      negative-quantity guards.
- [ ] **State machines** — status transitions that permit illegal moves
      (re-approving a paid item, cancelling a completed one), terminal states
      that can be re-entered.
- [ ] **Concurrency** — read-modify-write on a shared counter without a row
      lock; sequence/number generation racing; idempotency keys absent on
      payment or submission paths.
- [ ] **Pagination / unbounded queries** — list endpoints and exports with no
      limit, `all()` over an org-wide table, N+1 loops issuing per-row queries.
- [ ] **Error handling** — bare `except Exception` masking real failures;
      `ValueError` raised in a service but not converted to a 400 at the
      endpoint; fail-*open* behavior in an access-control helper.
- [ ] **Date/time** — naive datetimes stored where `DateTime(timezone=True)` is
      expected; UTC values rendered raw in the UI (see the banned-API list in
      CLAUDE.md).

## 2. Security

- [ ] **Auth coverage** — every endpoint in the feature carries an auth
      dependency. Enumerate them; a route with no `Depends` is a finding.
- [ ] **Permission gating** — the permission string matches the sensitivity of
      the data (pattern **XC-2**: a `.view` gate on data that warrants `.manage`
      or a self-scope).
- [ ] **Tenant isolation (XC-3)** — every by-id read/update/delete filters
      `organization_id`, or resolves through an already-org-scoped parent.
      `require_permission` does **not** scope the object.
- [ ] **FK validation on write (XC-1)** — client-supplied foreign keys
      (`user_id`, `*_id`) are validated in-org before being stored. Prefer
      `assert_in_org` from `app/utils/org_scoping.py`. Prioritize FKs that get
      eager-loaded back into a response — those are live disclosures.
- [ ] **Self-scoping** — personal/inbox/"my" routes filter on the caller's own
      id, not just the org.
- [ ] **Injection** — raw SQL, `.ilike()` without `escape="\\"`, unescaped user
      text in email HTML (`html.escape`), CSV exports not using `SafeCsvWriter`
      (formula injection), ICS/vCard field escaping.
- [ ] **Secrets** — credentials write-only and redacted on read; no secret
      echoed back in a response; encrypted-at-rest fields actually encrypted.
- [ ] **Outbound requests** — stored URLs re-validated at send time
      (`assert_outbound_url_safe`) to close the DNS-rebinding TOCTOU.
- [ ] **Uploads** — magic-byte MIME check, UUID filenames, no path traversal,
      size cap; deletes remove the backing file.
- [ ] **Rate limiting** — public/unauthenticated surfaces are limited *before*
      any expensive work (bcrypt, DB) happens.
- [ ] **PII / PHI** — sensitive fields are not in cacheable responses
      (`UNCACHEABLE_PREFIXES` in `utils/apiCache.ts`), not in audit/activity log
      payloads, and not disclosed to the wrong audience tier.

## 3. Duplicate code

- [ ] **Within the feature** — near-identical service methods, copy-pasted
      endpoint bodies differing only in a filter, repeated validation blocks.
- [ ] **Against shared utilities** — hand-rolled implementations of things that
      already exist: `assert_in_org`, `SafeCsvWriter`, `safe_error_detail`,
      `toAppError`, `dateFormatting.ts`, the `components/ux/` library, the
      `@utility` classes in `styles/index.css`.
- [ ] **Across features** — the same logic reimplemented in a sibling module
      (two CSV exporters, two "expiring soon" calculators, two email senders).
      Record the pair; propose one owner.
- [ ] **Frontend axios instances** — module `services/api.ts` duplicating the
      global instance's auth/CSRF setup instead of sharing it (Pitfall #7).
- [ ] **Type/schema drift** — the same domain object declared twice (module
      `types/` and global `types/`) and drifting apart.

## 4. Unused / dead code

- [ ] **Unreferenced exports** — service methods, endpoints, components, and
      hooks with no caller. Verify with a repo-wide grep before deleting; a
      route may be called by a non-obvious consumer (public portal, kiosk, cron).
- [ ] **Orphaned endpoints** — a backend route no frontend calls. Distinguish
      *dead* (delete) from *API-surface for integrators* (document it).
- [ ] **Dead branches** — conditions that can't be reached, no-op conversion
      blocks, `if x: pass`.
- [ ] **Stale flags** — config/env vars and feature flags that gate nothing (the
      `MODULE_*_ENABLED` and `LDAP_ENABLED` precedent).
- [ ] **Commented-out code and stale TODO/FIXME** — resolve or convert to a
      tracked finding.
- [ ] **Unused imports** — flake8 F401 / TS `noUnusedLocals` catch these; a hit
      here means the gate isn't being run.

## 5. Documentation

- [ ] **Feature doc exists** — is there a `docs/<FEATURE>.md`? Does it describe
      what the code actually does *now*?
- [ ] **Claims match reality** — the audit already found a "hashed tokens" claim
      over plaintext storage and an "AES-256" claim over Fernet AES-128-CBC.
      Verify every security/crypto claim against the implementation.
- [ ] **API surface documented** — endpoints, permissions, and request/response
      shapes; public/integrator endpoints especially.
- [ ] **Permissions documented** — which permission strings the feature defines
      and who is expected to hold them.
- [ ] **Env vars** — every var the feature reads is in `.env.example.full` with
      an accurate default and description.
- [ ] **Migrations** — new migrations registered in `ALEMBIC_MIGRATIONS.md`;
      seed data files registered in `SEED_DATA_FILES`.
- [ ] **CHANGELOG** — user-visible changes from this iteration recorded.
- [ ] **Docstrings on non-obvious logic** — business rules and invariants, per
      the CLAUDE.md comment policy (explain *why*, never restate *what*).

## 6. Areas for future development

Not defects — deliberate opportunities. Record each with enough context to be
actionable later:

- [ ] **Incomplete features** — stubs, hardcoded placeholder returns, "coming
      soon" UI, metrics that always return zero.
- [ ] **Missing test coverage** — which invariants of this feature have no test?
      Name the specific behavior, not "add tests".
- [ ] **Scale limits** — where this feature breaks at 10× data: unpaginated
      exports, per-process rate limiters that need Redis, in-memory caches
      without eviction (Pitfall #9).
- [ ] **UX / accessibility gaps** — missing loading and empty states (the
      `components/ux/` library exists for this), no mobile treatment for a wide
      table (`rwd-table`), unlabeled controls.
- [ ] **Separation of duties** — self-approval paths where the same person can
      request and approve (recurring: admin-hours, finance, skills testing).
- [ ] **Product decisions** — anything requiring the owner to choose. These go
      to `KNOWN_LIMITATIONS.md` as well as the feature file.

---

## Completion gate

A feature is not done until all of these pass. This is non-negotiable per
[CLAUDE.md](../../CLAUDE.md) — including for errors that pre-date the iteration.

```bash
cd frontend && npx tsc --noEmit        # must be 0 errors, repo-wide
cd backend  && flake8 app/ tests/      # must be 0 (run from backend/ for .flake8)
cd backend  && black --check app/ tests/
cd frontend && npx eslint .            # max-warnings 10
cd frontend && npm test -- --run       # no newly failing test
cd backend  && pytest                  # no newly failing test
```

**Baseline as of 2026-08-05:** tsc 0, flake8 0, eslint 0, black clean. Any
non-zero result is therefore something this review introduced or uncovered —
fix it or escalate it, never leave it.

### Known sandbox limitations

Record these as limitations in the findings file rather than reporting a clean
gate you did not achieve:

- **DB-backed pytest cannot run here.** Any test using the `db_session` fixture
  needs MySQL, and the review sandbox has no Docker daemon. Those tests error at
  *fixture setup* with a `pymysql` connection timeout. That signature is an
  environment failure, not a regression — but confirm it looks like that before
  dismissing it, and always report the pass count alongside the error count.
  Tests that don't touch the DB do run and must pass.
- **`isort` may be absent.** `npm run lint:backend` runs
  `isort --check-only`; if it isn't installed, run the other three backend
  checks and say so.
- **Dependency install:** `pip install -r requirements.txt` aborts on the
  Debian-managed PyJWT. Use `pip install --ignore-installed PyJWT -r
  requirements.txt`. `pytest` and its plugins are not in `requirements.txt` and
  need installing separately.
</content>
