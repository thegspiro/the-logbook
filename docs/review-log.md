# Ongoing Review Log

A recurring `/loop` reviews the codebase ~every 30 min for **security issues,
incomplete sections, feature improvements, and documentation gaps**. Each tick
covers one area, records findings here, fixes what's clearly correct and
low-risk (security hardening, doc fixes), and surfaces larger items (feature
work, ambiguous changes) for owner review rather than auto-implementing.

## Rotation (advances each tick)
1. Core auth & security — middleware, dependencies, security.py, CSRF, sessions
2. Documentation — README, CLAUDE.md, `.env` examples, API docs accuracy
3. Training module
4. Events module
5. Finance module
6. Inventory module
7. Elections module
8. Communications module
9. Membership / users module
10. Frontend cross-cutting security — apiCache exclusions, token handling, XSS

(After area 10, wrap back to 1.)

## Findings log

### Tick 1 — Area 1: Core auth & security
Layer is well-hardened overall (Argon2id, JWT alg allowlist, server-side
session validation + idle timeout, refresh rotation/replay revocation,
fail-closed rate limiting, pure-ASGI middleware, SameSite=Strict cookies,
double-submit CSRF, hashed reset tokens). Findings:

**Needs owner decision (verified):**
- **[HIGH] MFA surfaced but not implemented.** `mfa_enabled` is stored and
  returned by `/auth/me`, but there is **no TOTP/MFA verification anywhere**
  in the backend (no `pyotp` usage, no MFA challenge endpoint) — login issues
  full session cookies on password alone. Either implement an MFA challenge
  step or stop advertising `mfa_enabled` to clients. (`auth.py` login flow;
  `auth.py:176` /me.)
- **[MED] `must_change_password` not enforced server-side.** Set/cleared in
  `auth_service.py` but no dependency gates other endpoints when true — only
  the frontend honors it. (`dependencies.py` get_current_active_user.)
- **[MED] CSRF "no csrf cookie → allow" branch** is broader than its docstring
  claims (allows any request lacking the cookie, not just the first
  post-login). SameSite=Strict is the real defense; tighten or fix the
  docstring. (`security_middleware.py:535-545`.)
- **[MED] `is_rate_limited`** writes the request to the sliding window before
  the count check; verify against intended semantics. (`security.py:686-719`.)

**Fixed this tick (clearly-correct):**
- `decode_token` docstring now states it does not verify token type or
  server-side session (use AuthService.get_user_from_token). (`security.py`.)

**Reclassified:**
- `validate_url` optional-TLD "SSRF" item → **dead code** (no callers);
  requiring a TLD would break internal hostnames. No change.

Confirmed clean: JWT alg confusion, username enumeration, refresh
rotation/replay, session invalidation on password change/reset, cookie
attributes (Pitfall #6), pure-ASGI middleware (Pitfall #4), unbounded caches
(Pitfall #9), IP-spoofing/XFF handling, global CSRF wiring, SQL injection,
permission matching. No TODO/FIXME/stubs.

### Tick 2 — Area 2: Documentation
**Fixed this tick (verified, clearly-correct):**
- `package.json` `dev:backend` ran `uvicorn app.main:app` but the app is at
  `backend/main.py` → fixed to `main:app` (the primary `npm run dev` backend
  was broken).
- `package.json` `db:seed` pointed to a non-existent `scripts/seed_data.py`
  (and `db:reset` chained it) → seeding actually runs via Alembic
  `SEED_DATA_FILES` during `db:migrate`; `db:seed` is now an informational
  echo and `db:reset` is rollback+migrate.
- `README.md` tech stack: Python 3.11+→3.13, React 18→19.
- `README.md` dead links removed/repointed (`QUICK_START_GITHUB.md`,
  `ARCHITECTURE_REVIEW_AND_IMPROVEMENT_PLAN.md` don't exist).
- `.env.example` DB name/user (`the_logbook`/`logbook_user`) aligned to the
  canonical `intranet_db`/`intranet_user` used by config.py, docker-compose,
  `.env.example.full`, and CLAUDE.md.
- CLAUDE.md frontend env table: added `VITE_SESSION_KEY` (used in
  `onboarding/utils/security.ts` but undocumented).

**Needs owner confirmation:**
- README's `openssl rand -hex 32` (32 chars) for `SECRET_KEY` is below the
  documented 64-char recommendation (config.py hard-min is 32). Align guidance.
- `.env.example` defaults `ENVIRONMENT=production`, but config.py makes
  `SECURITY_ENFORCE_HTTPS=True` and `REDIS_PASSWORD` startup-blocking
  requirements in production — neither is in `.env.example` or CLAUDE.md's
  Required-Production table, so a by-the-book quick-start is blocked at
  startup. Decide whether `.env.example` should default to `development`.
- `VITE_WS_URL` / `VITE_ENABLE_PWA` are documented but never read in
  `frontend/src` (only declared in `vite-env.d.ts`). Confirm whether
  planned/used by tooling before removing from docs.

### Tick 3 — Area 3: Training module
**Fixed this tick (verified, clearly-correct):**
- **[HIGH IDOR] `GET /training/submissions/{id}`** returned another member's
  submission (potential PHI) to any same-org member — the access check only
  404'd cross-org. Now: org boundary first, then owner-or-`training.manage`,
  else 403. (`training_submissions.py`.)
- **[HIGH] Waiver create** trusted `data.user_id` with no org check — now
  validates the member belongs to the caller's org (404 otherwise).
  (`training_waivers.py`.)
- **[MED/HIGH] Bulk record create** fetched members unscoped and created
  records for any user_id — now scopes the member query to the org and
  rejects rows targeting non-members. (`training.py` create_records_bulk.)
- **[MED/HIGH] Historical import confirm** wrote records straight from the
  client `row.user_id` — now validates each against an org-scoped member set
  and rejects outsiders. (`training.py` confirm_historical_import.)

**Needs owner decision (logged):**
- `GET /training/records` (list) is gated by auth only — any member can list
  all org training records (others' certs/scores). Decide: require
  `training.manage`, or restrict non-officers to their own records.
- Per-user training endpoints missing from `UNCACHEABLE_PREFIXES`:
  `/training/compliance-summary/{id}`, `/requirements/progress/{id}`,
  `/category-hours/{id}`, plus org-wide `/compliance-matrix` /
  `/expiring-certifications`. Decide which are PHI-sensitive enough to exclude.
- BIANNUAL requirement frequency yields no date window
  (`training_compliance.py:118`) → sums lifetime totals for hours/shift/call
  requirements rather than the 2-year cycle. Confirm BIANNUAL is only used
  with expiry-bearing certs, else add a 2-year window.
- `TrainingProgramsPage.tsx:289` shows a hardcoded "0 enrolled" — no
  `enrolled_count` exists; wiring it is a small backend+schema feature.
- `ManualShiftReportPage.tsx:120` uses the banned `toISOString().split('T')[0]`
  local-date pattern (UTC shift); switch to `getTodayLocalDate(tz)`.

Confirmed clean: most single-record endpoints org-scope correctly;
`|| undefined` used on form values; no bare `toHaveBeenCalledWith()`; no
TODO/FIXME stubs; `safe_error_detail()` in import error paths; rolling-period
proration math (`adjust_required`/`count_waived_months`) verified correct.
