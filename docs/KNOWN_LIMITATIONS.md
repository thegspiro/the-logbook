# Known Limitations & Open Decisions

This page consolidates known limitations and deferred design decisions surfaced
by the ongoing code review (see [review-log.md](./review-log.md) for the raw
findings and rotation). Items here are **intentionally open** — they need an
owner decision or are accepted trade-offs — rather than undocumented bugs. When
one is resolved, move it to the relevant module doc / CHANGELOG and remove it
here.

> Severity reflects review classification, not an SLA. "Open decision" means a
> reasonable person could choose either way; "Accepted" means we've decided to
> live with it for now.

## Authentication & Security

| Item | Status | Detail |
|------|--------|--------|
| **No "regenerate recovery codes" flow** | Open decision | A member can't mint a fresh set of MFA recovery codes from the UI without disabling and re-enrolling. Admin reset exists ([MFA.md → Admin MFA Reset](./MFA.md#admin-mfa-reset)); self-service regeneration does not. |
| **CSRF "no csrf cookie → allow" branch** | Open decision (MED) | The double-submit guard allows a request that carries *no* `csrf_token` cookie, which is broader than its docstring implies. `SameSite=Strict` is the real defense; decide whether to tighten the branch or correct the docstring. (`security_middleware.py`.) |
| **`is_rate_limited` window write-before-check** | Verify (MED) | The sliding-window limiter records the request *before* the count comparison; confirm this matches intended semantics (off-by-one on the first over-limit request). (`security.py`.) |

## Configuration & Docs

| Item | Status | Detail |
|------|--------|--------|
| **`SECRET_KEY` guidance mismatch** | Open decision | README suggests `openssl rand -hex 32` (32 chars) while the documented recommendation is 64 chars (config hard-min is 32). Align the guidance to one number. |
| **`.env.example` defaults to `ENVIRONMENT=production`** | Open decision | In production, config makes `SECURITY_ENFORCE_HTTPS=True` and a non-empty `REDIS_PASSWORD` startup-blocking, neither of which is in the quick-start example — so a by-the-book quick start is blocked at startup. Decide whether the example should default to `development`. |
| **`VITE_WS_URL` / `VITE_ENABLE_PWA` documented but unused** | Open decision | Declared in `vite-env.d.ts` and the env docs but never read in `frontend/src`. Confirm whether they're planned/tooling-only before removing from docs. |

## Training Module

| Item | Status | Detail |
|------|--------|--------|
| **Per-user training endpoints not in `UNCACHEABLE_PREFIXES`** | Open decision (PHI) | `/training/compliance-summary/{id}`, `/requirements/progress/{id}`, `/category-hours/{id}`, and org-wide `/compliance-matrix` / `/expiring-certifications` are cacheable by the SWR client cache. Decide which are PHI-sensitive enough to exclude (see the HIPAA cache rules in CLAUDE.md). |
| **`BIANNUAL` requirement frequency has no date window** | Verify | `training_compliance.py` sums lifetime totals for hours/shift/call requirements on a `BIANNUAL` cadence instead of a 2-year window. Confirm `BIANNUAL` is only used with expiry-bearing certs; otherwise add a 2-year window. |
| **`enrolled_count` is a placeholder** | Open (small feature) | `TrainingProgramsPage` shows a hardcoded "0 enrolled" — there is no `enrolled_count` on the program response yet. Wiring it is a small backend + schema addition. |

## Scheduling Module

| Item | Status | Detail |
|------|--------|--------|
| **`ManualShiftReportPage` local-date pattern** | Open (small fix) | Uses `toISOString().split('T')[0]` for "today", which is UTC-shifted near midnight; should use `getTodayLocalDate(tz)`. Tracked here because it lives in a module outside the current review scope. |
| **Platoon presets cover 3-platoon rotations** | Accepted | Multi-platoon generation offsets are validated for the common 3-platoon presets (24/48, Kelly, 48/96). Departments running non-standard platoon counts should verify the generated tiling. See [SCHEDULING_MODULE.md → Platoon Rotations](./SCHEDULING_MODULE.md#platoon-rotations-added-2026-06-19). |

## Process

The review loop (see [review-log.md](./review-log.md)) advances through one area
per tick and appends findings. New "needs owner decision" items should be
mirrored here so they're visible outside the log.
