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
| **`enrolled_count` is a placeholder** | Open (small feature) | `TrainingProgramsPage` shows a hardcoded "0 enrolled" — there is no `enrolled_count` on the program response yet. Wiring it is a small backend + schema addition (the per-program enrollments endpoint `GET /training/programs/programs/{id}/enrollments` now exists to source it). |
| **No knowledge-test engine (officer-entered scores only)** | Open (feature) | `knowledge_test` requirements are satisfied by an officer entering a pass/fail or score % on the requirement (pass/fail derived from `passing_score`, `max_attempts` enforced, attempts recorded). There is no online test-taking flow — question bank, delivery, or auto-grading. That is a deliberate future project; the current support is the lightweight groundwork. |
| **Skills-test completion does not enforce requirement `max_attempts`** | Open (small) | A passing `SkillTest` marks its linked pipeline requirement complete, but the Skills Testing flow doesn't block creating/completing further tests once the linked requirement's `max_attempts` is reached (only the officer-entered knowledge-test scoring path enforces the cap). |

## Scheduling Module

| Item | Status | Detail |
|------|--------|--------|
| **`ManualShiftReportPage` local-date pattern** | Open (small fix) | Uses `toISOString().split('T')[0]` for "today", which is UTC-shifted near midnight; should use `getTodayLocalDate(tz)`. Tracked here because it lives in a module outside the current review scope. |
| **Platoon presets cover 3-platoon rotations** | Accepted | Multi-platoon generation offsets are validated for the common 3-platoon presets (24/48, Kelly, 48/96). Departments running non-standard platoon counts should verify the generated tiling. See [SCHEDULING_MODULE.md → Platoon Rotations](./SCHEDULING_MODULE.md#platoon-rotations-added-2026-06-19). |
| **"Shifts completed" has three sources of truth** | Open (needs product decision) | A `RequirementType.SHIFTS` requirement is counted from `TrainingRecord`s in `training_service._evaluate_requirement`/`check_requirement_progress`, but from actual `ShiftAttendance` in `scheduling_service.get_shift_compliance` — and the pipeline also credits progress via the `RequirementProgress` ledger. The same requirement can therefore show different numbers on different screens. Reconciling changes established compliance numbers, so it needs an owner decision on the authoritative source before it's unified onto one shared helper. Deferred during the 2026-07-16 lifecycle review. |
| **Member-hours report uses scheduled, not actual, hours** | Open (needs product decision) | `get_member_hours_report` sums scheduled assignment durations (`start_time`→`end_time`), not actual `ShiftAttendance` duration, so it can diverge from hours actually worked/credited. Confirm intended semantics before changing (report title vs. data source). |
| **No formal "active/in-progress" shift state** | Accepted | `ShiftStatus` is `scheduled`/`cancelled` only; a shift's "activeness" is implied by `start_time`/`end_time` vs. now, and `is_finalized` marks closed. The live readiness panel (2026-07-16) covers most of the operational need without a dedicated state. |

## Multi-Tenant Isolation & Module Audit (2026-07-25)

Open items surfaced by the module-by-module security audit
([`docs/module-audit/`](./module-audit/PROGRESS.md)). Applied fixes are in the
CHANGELOG; the items below need an owner decision or are deferred design changes.
Per-module docs under `docs/module-audit/` carry the full lower-severity list.

| Item | Status | Detail |
|------|--------|--------|
| **Draft / executive-session minutes readable by any `minutes.view` holder** | Open decision (MED) | `get/list/search_minutes` apply no status filter and there is no confidential/executive permission tier, so unapproved drafts and executive-session content are visible to any viewer. Decide whether to gate unpublished reads and add an executive tier. (MM-3) |
| **Elections: approval / multi-vote-per-position is silently broken** | Open (MED, needs design) | The vote-dedup unique hash excludes `candidate_id`, so a legitimate second vote for the same position (approval voting / `max_votes_per_position > 1`) collides and is rejected. Fix is conditional on voting method and must not weaken single-vote dedup. (ELEC-3) |
| **Elections: `rollback_election` can enable double-voting** | Open (MED, needs design) | Reopening a closed election after the anonymity salt was destroyed lets a voter who already voted vote again (their recomputed hash differs). Decide: preserve the salt, or forbid rollback once it's destroyed. (ELEC-4) |
| **Elections: voting tokens stored/compared in plaintext** | Open (MED) | Tokens are high-entropy (512-bit) but stored and looked up in plaintext, despite model/endpoint docstrings claiming "hashed." DB read access yields live ballot credentials. Recommend storing a SHA-256 of the token (migration) and correcting the docstrings. (ELEC-5) |
| **Elections: anonymous ballots de-anonymizable via DB read until close** | Open (MED, documented limitation) | Anonymous votes store a deterministic `voter_hash` keyed by a salt in the same `elections` row, plus IP/user-agent, so DB-read access can map votes to voters until `close_election` nulls the salt; `get_election_forensics` exposes per-IP distributions to admins. Minimize stored IP/UA for anonymous elections; treat forensics as break-glass. (ELEC-6) |
| **Documents: `delete_folder` orphans subtree files; summary ignores folder ACL; ACL not hierarchical** | Open (LOW/design) | `delete_folder` removes DB rows but leaves the subtree's files on disk (the single-document delete now cleans up); `get_summary` aggregates span the whole org past the folder ACL; `can_access_folder` checks only the folder's own visibility, not its ancestor chain (apparatus/facility child folders are org-visible under leadership-only parents — confirm intent). (DOC-4/5) |
| **Equipment-check: read endpoints bypass `equipment_check.view`; completion skips auto-fail rule; compliance metrics stubbed** | Open (LOW) | Several detail/read endpoints use bare `get_current_user` (org-scoped, but inconsistent with the `.view`-gated list routes); `complete_incomplete_check` doesn't re-apply the expired/under-min auto-fail rule the initial submit uses; `get_compliance_report` returns hardcoded `0` for expected/overdue counts. (EC-6/7/10/11) |
| **Recurring: create/update paths trust client-supplied FK ids without an org check (XC-1)** | Open (LOW, systemic) | The dominant cross-cutting pattern — create/update methods store `user_id`/`category_id`/`assignee_id`/etc. without verifying the referenced row is in-org. Individually low impact (org-stamped writes → dangling/mis-attributed FKs, not disclosure), but pervasive. Best closed by a shared `assert_in_org(db, Model, id, org_id)` helper rolled out per module. Full instances in [`docs/module-audit/CROSS-CUTTING.md`](./module-audit/CROSS-CUTTING.md) (XC-1/2/3). |

## Process

The review loop (see [review-log.md](./review-log.md)) advances through one area
per tick and appends findings. New "needs owner decision" items should be
mirrored here so they're visible outside the log. The parallel module-by-module
security audit tracks its rotation and per-module findings under
[`docs/module-audit/`](./module-audit/PROGRESS.md); its open decisions are
mirrored in the Multi-Tenant Isolation section above.
