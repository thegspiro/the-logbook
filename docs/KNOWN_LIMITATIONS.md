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

> **Drift check, 2026-08-07.** A sweep of the MED-severity rows found several
> describing code that had since been fixed — the CSRF no-cookie branch, the
> role grant ceiling and last-admin guard (ORU-7), the skills-test
> self-certification half of CS-8, the shared-device PII purge (FE-6/FE-7), and
> the black pin drift. The fixes landed; the rows did not get updated. That
> direction of staleness is the dangerous one: this page is what a compliance
> reviewer reads and what the next audit uses to aim, so overstating open risk
> misdirects effort and understates the product.
>
> Staleness cuts both ways, though, and the sweep itself proved it. FIN-4 was
> initially marked resolved here on the strength of `assert_different_person`
> appearing in `finance_service` — but that guard sits on the **approval** step,
> not on disbursement, so `mark_pr_paid` / `issue_check` / `waive_dues` remain
> gated by `finance.manage` alone. The row is back to ⚠️ Narrowed. Read the
> call site, not the import: "the guard exists in this file" is not the same
> claim as "this path is guarded."
>
> Rows are annotated with the date they were last _verified against the code_,
> not just the date they were written. When you fix something listed here,
> update its row in the same change.

## Authentication & Security

| Item                                                               | Status                            | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSRF "no csrf cookie → allow" branch**                           | ✅ Resolved (verified 2026-08-07) | The branch was tightened and this row had not been updated. `verify_csrf_token` now splits the no-cookie case: a request carrying an `access_token` cookie but no `csrf_token` is **rejected** (403 "Missing CSRF token") as anomalous, and only a request with no session cookie at all — unauthenticated, or a Bearer client whose header browsers never auto-send and which is therefore not CSRF-exploitable — is allowed through. `SameSite=Strict` remains the primary defense. (`security_middleware.py`.)                                                                                                                                                                                                                                                                                                                                                                        |
| **Two logins by the same user in the same second fail with a 500** | Open (MED — found 2026-08-08)     | `create_access_token` encodes only `{sub, exp, iat, type}` — no `jti` or nonce — and `exp`/`iat` serialize to whole seconds. Two logins by one user inside the same second therefore produce a **byte-identical** JWT, which collides with the unique `ix_sessions_token` index and surfaces as `IntegrityError` → HTTP 500. A human cannot normally type fast enough, but automation can: the screenshot pipeline hits it every time `bootstrap_demo.py` and `seed_demo_data.py` run back to back, and a double-submitted login form or two tabs restoring at once would do the same. Found while capturing the equipment-check screenshots. Adding a `jti` would fix it, but token generation is security-sensitive and deserves a considered change rather than an incidental one — the fallback question is whether a duplicate token should 500 or resolve to the existing session. |
| **`is_rate_limited` window write-before-check**                    | Verify (MED)                      | The sliding-window limiter records the request _before_ the count comparison; confirm this matches intended semantics (off-by-one on the first over-limit request). (`security.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Dependencies

| Item                                       | Status                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI `pip-audit` step**                    | ✅ Blocking (2026-07-30)                    | The FastAPI/starlette upgrade pass moved the stack to fastapi 0.141.1 + starlette 1.3.1 (the security-fix line), fastapi-mail 1.6.5, aiosmtplib 5.1.2, PyJWT 2.13.0, cryptography 49.0.0, pydantic-settings 2.14.2, pypdf 6.14.2, email-validator 2.3.0, schemathesis 4.24.3, pytest 9.0.3 (+ pytest-cov 7 / randomly 4.1 / timeout 2.4, required by schemathesis 4.10+). `pip-audit -r requirements.txt` now runs **blocking** in CI with one documented ignore: black 26 (major that reformats the whole repo — PYSEC-2026-2120/2121). Remove the ignore when its blocker clears. The `Backend Lint` black-pin drift described here is ✅ **resolved (verified 2026-08-07)**: the job now pins `black==26.5.1`, matching `requirements.txt`, and `black --check app/ tests/` passes clean at that version (501 files). The CI step carries a comment recording why both sides must pin the same version. Note `alembic/` and `scripts/` are outside the checked paths and are _not_ black-clean — that is the existing scope, not a regression. (The former pyopenssl ignores — PYSEC-2026-2268/2269, forced by pysaml2's `<24.3` cap — were dropped 2026-07-31 along with the unused pysaml2/python-ldap dependencies.) |
| **cryptography held at 49.x**              | ⏸️ Deferred (2026-08-05) — blocked upstream | `PYSEC-2026-3552` / `CVE-2026-69247` against `cryptography==49.0.0`. The only fix is 50.0.0, and it is **uninstallable**: fastapi-mail 1.6.5 pins `cryptography>=49.0.0,<50.0.0`, so `pip install "fastapi-mail==1.6.5" "cryptography==50.0.0"` fails with `ResolutionImpossible`. 1.6.5 is the newest release on PyPI, so no combination of released versions satisfies both; the alternative is dropping fastapi-mail, which the whole templated-email layer sits on. Suppressed in **two** places that must clear together — `--ignore-vuln PYSEC-2026-3552` in `.github/workflows/ci.yml` and `CVE-2026-69247` in `.trivyignore`. **Clears when** fastapi-mail widens the pin: re-run `pip-audit -r backend/requirements.txt` with no ignores, then delete both suppressions and this row.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **No nested `frontend/package-lock.json`** | ✅ Resolved (2026-08-05)                    | The repo is npm **workspaces** (`workspaces: [backend, frontend]`), so the root `package-lock.json` is the only lockfile `npm ci` reads, and `frontend/Dockerfile` copies just `package.json` and runs `npm install`. A stale nested lock had survived since PR #1071, pinning axios 1.13.6 / form-data 4.0.5 / @remix-run/router 1.23.0 while the root lock carried the patched axios 1.19.0 and form-data 4.0.6. Nothing installed from it — but Trivy scans every lockfile it finds, so it reported 12 HIGH advisories against dependency versions the build does not use. Deleted. Do not re-add a per-workspace lockfile; run `npm install` from the repo root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Configuration & Docs

| Item                                                    | Status                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`SECRET_KEY` guidance mismatch**                      | ✅ Resolved (2026-07-31) | Not a mismatch: `openssl rand -hex 32` outputs **64 hex characters** (32 bytes), which meets the 64-char recommendation (config hard-min is 32 chars). README annotated with the output length to prevent the same misreading.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`.env.example` defaults to `ENVIRONMENT=production`** | ✅ Resolved              | `.env.example` and `.env.example.full` both ship `ENVIRONMENT=development` (and docker-compose defaults to development), so the by-the-book quick start is not blocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Frontend env vars documented but unused**             | ✅ Resolved (2026-08-01) | `VITE_WS_URL`, `VITE_ENABLE_PWA`, `VITE_ENV` and `VITE_ENABLE_ANALYTICS` are all read by nothing — not by `frontend/src`, not by `vite.config.ts`. Removed from `vite-env.d.ts`, `frontend/.env.example`, `frontend/setup.sh` and every docs/wiki page. Two were actively misleading: the inventory socket derives its URL from the page origin (which is what makes it work behind a reverse proxy), and the PWA plugin is registered unconditionally, so `VITE_ENABLE_PWA=false` still shipped the service worker whose `NetworkOnly` rule for `/api/` is part of the HIPAA caching posture. Reintroduce one only alongside code that reads it. |

## Training Module

| Item                                                                   | Status               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`BIANNUAL` requirement frequency has no date window**                | Verify               | `training_compliance.py` sums lifetime totals for hours/shift/call requirements on a `BIANNUAL` cadence instead of a 2-year window. Confirm `BIANNUAL` is only used with expiry-bearing certs; otherwise add a 2-year window.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`enrolled_count` is a placeholder**                                  | Open (small feature) | `TrainingProgramsPage` shows a hardcoded "0 enrolled" — there is no `enrolled_count` on the program response yet. Wiring it is a small backend + schema addition (the per-program enrollments endpoint `GET /training/programs/programs/{id}/enrollments` now exists to source it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **No knowledge-test engine (officer-entered scores only)**             | Open (feature)       | `knowledge_test` requirements are satisfied by an officer entering a pass/fail or score % on the requirement (pass/fail derived from `passing_score`, `max_attempts` enforced, attempts recorded). There is no online test-taking flow — question bank, delivery, or auto-grading. That is a deliberate future project; the current support is the lightweight groundwork.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Skills-test completion does not enforce requirement `max_attempts`** | ✅ Resolved          | `assert_attempts_remaining` (`app/services/skills_testing_service.py`) now guards the cap at both ends of the flow: creating an official test — so an examiner is refused before running an evaluation that could not count — and, **since 2026-08-08, validating one** rather than completing it. Opening the examiner role to every member means completion is no longer the moment a result counts, so the cap is spent where the credit is granted; a submission that is never validated never costs the candidate a chance. An attempt is a completed, official, **validated**, non-voided test against that requirement, pass or fail; voided results and unvalidated submissions do not consume a chance, and practice attempts never do. A requirement already completed, verified, or waived is exempt, matching the knowledge-test path and keeping recertification testing possible. |

## Scheduling Module

### Naming: scheduled vs. worked (resolved 2026-08-01)

Shift counts and hours came from three different tables, and two of them
shipped under the _same field name_ with incompatible meanings, so a member
comparing screens saw a discrepancy that looked like a bug. The response
fields now say which measure they are:

| Endpoint                                  | Was                                                     | Now                                                                                                                | Measures                                                         |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /scheduling/summary`                 | `total_shifts`, `shifts_this_week`, `shifts_this_month` | `shifts_scheduled`, `shifts_scheduled_this_week`, `shifts_scheduled_this_month`                                    | Scheduled `Shift` rows                                           |
| `GET /scheduling/summary`                 | `total_hours_this_month`                                | `hours_worked_this_month`                                                                                          | Actual `ShiftAttendance` minutes                                 |
| `GET /scheduling/reports/member-hours`    | `shift_count`, `total_minutes`, `total_hours`           | `shifts_attended`, `worked_minutes`, `worked_hours` (+ `shifts_scheduled`, `scheduled_minutes`, `scheduled_hours`) | Attendance check-in/check-out, with the scheduled plan alongside |
| `GET /training/module-config/my-training` | `shift_stats.total_shifts`, `.total_hours`              | `.shifts_completed`, `.hours_reported`                                                                             | `ShiftCompletionReport` rows                                     |

The member-hours report was then **re-sourced from attendance** (2026-08-01):
an assignment is a plan, not a measurement — a shift can run short or long,
or be assigned and never worked — so anything that credits or pays a member
now uses the measured figure. Scheduled totals ride alongside with a
Difference column, so plan-vs-actual is visible rather than something a
reader has to know to ask about.

| Item                                                                    | Status                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ManualShiftReportPage` local-date pattern**                          | Open (small fix)              | Uses `toISOString().split('T')[0]` for "today", which is UTC-shifted near midnight; should use `getTodayLocalDate(tz)`. Tracked here because it lives in a module outside the current review scope.                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Platoon presets cover 3-platoon rotations**                           | Accepted                      | Multi-platoon generation offsets are validated for the common 3-platoon presets (24/48, Kelly, 48/96). Departments running non-standard platoon counts should verify the generated tiling. See [SCHEDULING_MODULE.md → Platoon Rotations](./SCHEDULING_MODULE.md#platoon-rotations-added-2026-06-19).                                                                                                                                                                                                                                                                                                       |
| **"Shifts completed" has three sources of truth**                       | Open (needs product decision) | A `RequirementType.SHIFTS` requirement is counted from `TrainingRecord`s in `training_service._evaluate_requirement`/`check_requirement_progress`, but from actual `ShiftAttendance` in `scheduling_service.get_shift_compliance` — and the pipeline also credits progress via the `RequirementProgress` ledger. The same requirement can therefore show different numbers on different screens. Reconciling changes established compliance numbers, so it needs an owner decision on the authoritative source before it's unified onto one shared helper. Deferred during the 2026-07-16 lifecycle review. |
| **No formal "active/in-progress" shift state**                          | Accepted                      | `ShiftStatus` is `scheduled`/`cancelled` only; a shift's "activeness" is implied by `start_time`/`end_time` vs. now, and `is_finalized` marks closed. The live readiness panel (2026-07-16) covers most of the operational need without a dedicated state.                                                                                                                                                                                                                                                                                                                                                  |
| **Submitting an equipment check fails when the shift has an apparatus** | ✅ Resolved (2026-08-08)      | Fixed by resolving the id at the boundary rather than picking a winner between the two tables — see [The Two Apparatus Tables](#the-two-apparatus-tables-2026-08-08) below. `shifts.apparatus_id` is polymorphic **by design** (the options endpoint serves full-`Apparatus` ids when that module has records and `BasicApparatus` ids otherwise), so neither "make it a real FK" nor "consolidate the tables" was correct; both would have broken one of the two department types. `app/utils/apparatus_ref.py` classifies the id against both tables, and each consumer asks it instead of assuming.      |

## The Two Apparatus Tables (2026-08-08)

Not a limitation — a piece of the data model that is easy to get wrong, recorded
here because it already produced two production defects that were mirror images
of each other.

**There are two apparatus tables and that is intentional.** `basic_apparatus` is
the lightweight definition onboarding collects (unit number, type, minimum
staffing, riding positions) — enough to staff a shift. `apparatus` is the full
module record, with maintenance history, fuel logs, NFPA compliance and
inventory. A department has one or the other, or both.

**`shifts.apparatus_id` is therefore polymorphic.** It is a bare `String(36)`
with no foreign key, and it holds whichever id `GET /scheduling/apparatus-options`
served the shift form. That endpoint's documented priority is **full `Apparatus`
records > `BasicApparatus` records > hardcoded type defaults**, so the same
column means different things in different deployments.

Nothing enforced that, and the two consumers each assumed the _other_ source:

| Defect                                                                                                       | Who it broke                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_check` copied the shift's id into `shift_equipment_checks.apparatus_id`, a real FK to `apparatus.id` | Every department on `BasicApparatus` — **every** equipment-check submission for a shift with an apparatus 500'd                                                         |
| `create_shift` / `update_shift` validated the id against `BasicApparatus` only                               | Every department on the full Apparatus module — could not assign an apparatus to a shift at all, since the validator rejected the very ids the form had just been given |

Three further consequences of the same root cause, all fixed alongside:

- `_resolve_templates` looked up `Apparatus` by a `BasicApparatus` id, so **no
  equipment-check templates ever resolved** for those departments; and the
  apparatus-type fallback below it read `apparatus.type`, an attribute the model
  does not have (it has `apparatus_type_id` and an `apparatus_type`
  relationship). That `AttributeError` was latent only because the branch was
  unreachable — fixing the id alone would have unmasked it.
- Shift lists loaded apparatus names and min-staffing from `BasicApparatus`
  only, so full-Apparatus departments saw blank unit numbers and lost the
  understaffing badge.
- Two of those lookups had no organization filter (XC-1); resolution is now
  org-scoped throughout.

**The rule: never pass `shifts.apparatus_id` to something that expects one
table.** Use `app/utils/apparatus_ref.py`:

| Helper                                        | Use it for                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `resolve_apparatus_ref(db, id, org)`          | One shift — returns which table the id belongs to, plus `full_id`, `type_slug`, `unit_label` |
| `apparatus_ref_exists(db, id, org)`           | Validating client-supplied input; true for an in-org id in **either** table                  |
| `resolve_apparatus_display_map(db, ids, org)` | A list of shifts — batch, at most two queries                                                |
| `resolve_apparatus_labels(db, ids, org)`      | Same, when only a display string is needed                                                   |

**Storing `NULL` is correct, not lossy.** When a shift's apparatus is a
`BasicApparatus`, `shift_equipment_checks.apparatus_id` is set to `NULL`: that
department has no full apparatus record for the vehicle, and the column is
nullable with `ON DELETE SET NULL` precisely because a check need not be
attributable to one. The check still links to its shift, which carries the
apparatus reference. The apparatus-compliance report is inherently a
full-Apparatus-module feature — it iterates `apparatus` rows — so it was already
empty for those departments and loses nothing.

**Deficiency flags are full-Apparatus only.** `has_deficiency` lives on the
`apparatus` row, so a `BasicApparatus` department gets no deficiency badge from a
failed check. That is a real gap, but it is a _feature_ gap in the lightweight
table rather than a defect, and closing it would mean adding safety state to
`basic_apparatus` — a product decision, not a patch.

## Multi-Tenant Isolation & Module Audit (2026-07-25)

Open items surfaced by the module-by-module security audit
([`docs/module-audit/`](./module-audit/PROGRESS.md)). Applied fixes are in the
CHANGELOG; the items below need an owner decision or are deferred design changes.
Per-module docs under `docs/module-audit/` carry the full lower-severity list.

| Item                                                                                                          | Status                                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Executive-session minutes need a viewer tier below `minutes.manage`?**                                      | Open decision (LOW)                                         | MM-3 is fixed: plain `minutes.view` holders now see only approved, non-executive minutes; `minutes.manage` sees all. Follow-up open decision: if board members who attend executive sessions but don't hold `minutes.manage` should read executive minutes, a dedicated `minutes.view_executive` tier is needed (seed + roles + frontend). Also: frontend `canManage` uses `meetings.manage` while the backend uses `minutes.manage` — roles managing minutes should hold both. **Update (MM2-1, 2026-08-06):** publishing executive minutes to the shared Meeting Minutes document folder is now blocked, because that folder is readable by the broad `documents.view` audience and so bypassed the restriction. Sharing an executive session with a _restricted_ audience is the same build as the `minutes.view_executive` tier above (a restricted document folder or per-document permission), not a one-click publish.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Elections: approval / multi-vote-per-position is silently broken**                                          | ✅ Resolved                                                 | The dedup hash now takes a method-aware discriminator (`rank:<n>` for ranked choice, `cand:<id>` for approval/multi-vote; unchanged for single-vote so existing rows keep their protection), app-level duplicate checks are per-candidate/per-rank, and the ballot UI submits approvals/rankings through the reworked atomic bulk endpoint. (ELEC-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Elections: `rollback_election` can enable double-voting**                                                   | ✅ Resolved (guard)                                         | CLOSED→OPEN rollback is refused for anonymous elections that have votes once the salt is destroyed (the exact unsafe case); rollback with zero votes still works. Preserving the salt was rejected as it would weaken SEC-12. (ELEC-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Elections: voting tokens stored/compared in plaintext**                                                     | ✅ Resolved                                                 | Tokens are now stored as SHA-256 (migration `20260731_0001` hashes existing rows in place with an idempotent hex guard); the raw token exists only in the emailed ballot link and lookups hash the presented value, so DB read access no longer yields live credentials. In-flight links keep working. (ELEC-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Elections: anonymous ballots de-anonymizable via DB read until close**                                      | ✅ Resolved (with residual)                                 | Closing an anonymous election now **purges per-vote IP/user-agent** at the same moment the anonymity salt is destroyed (live ballot-stuffing detection is unaffected while voting is open), and forensics no longer returns the full per-IP vote map — only the thresholded `suspicious_ips` set plus `unique_ip_count`/`ip_metadata_purged`. **Residual closed forward (2026-07-29):** voter-action audit events no longer record an IP for anonymous elections; audit rows written before that change keep their IPs permanently because `ip_address` is part of the tamper-evident hash chain and cannot be scrubbed without breaking `verify_integrity`. (ELEC-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Elections: pre-meeting package attachment dropped on Cloudflare email backend**                             | ✅ Resolved                                                 | The Cloudflare Email Sending API supports base64 attachments (5 MiB total-message cap) — `EmailService` now encodes and sends them on that backend instead of dropping them. Attachments that would exceed the cap are skipped with a warning (the send still succeeds without them).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Documents: summary ignores folder ACL; ACL not hierarchical**                                               | Partially resolved (LOW/design)                             | **Fixed:** `delete_folder` now walks the folder subtree, collects the backing file paths, and removes them after the cascade delete, so a folder delete no longer orphans (potentially sensitive) uploads on disk — matching the single-document delete. **Still flagged (design/behavior):** `get_summary` aggregates span the whole org past the folder ACL (counts only, no names/content — scoping the stats endpoint is a behavior change); `can_access_folder` checks only the folder's own visibility, not its ancestor chain (apparatus/facility child folders are org-visible under leadership-only parents — confirm intent). (DOC-4/5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Equipment-check: read endpoints bypass `equipment_check.view`; compliance metrics stubbed**                 | Partially resolved (LOW)                                    | **Fixed:** `complete_incomplete_check` now re-applies the expired/under-min auto-fail rule before computing counts (matching initial submit — EC-10); `create_report` validates a client-supplied `trainee_id` is in-org when no shift links it (EC-6); `get_report` takes an org filter and all callers pass it (EC-9). **Still flagged:** the detail/read endpoints use bare `get_current_user` (org-scoped but looser than the `.view`-gated list routes — tightening is a deferred behavior decision, EC-7); a few by-id reads used only for changelog text lack an org filter (harmless, EC-8); `get_compliance_report` returns hardcoded `0` for expected/overdue counts (needs a check-cadence model — incomplete feature, EC-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Roles: no ceiling on editing an already-privileged role, and no last-admin lockout guard**                  | ✅ Resolved (2026-08-07)                                    | Closed in two parts. The escalation direction and the last-admin guard already existed: `_enforce_permission_grant_ceiling` blocks granting a role permissions beyond the caller's own (wildcard-aware, CRITICAL alert on a blocked attempt), and `assert_not_last_administrator` prevents stripping the final administrator. The **sabotage** direction was still open exactly as described — the ceiling inspects only the incoming list and early-returns on `[]`, so a `roles.edit` holder who is not a `*` holder could PUT the sole System Owner role with `permissions: []` and wipe it, or with a small in-ceiling set and downgrade it. `_enforce_role_edit_ceiling` now gates on the role's **current** permissions: you may only edit a role already within your own authority. It runs when `role_update.permissions is not None` — i.e. when the permission set is actually being changed — so renaming or re-prioritising a higher role is still permitted; that is a deliberate scoping choice, not an oversight. `delete_role` already refused system roles. Covered by `tests/test_role_edit_ceiling.py`. (ORU-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Users/Orgs: PII and infra config exposed broader than the privacy gate intends**                            | ✅ Resolved (2026-08-02)                                    | Closed in two passes, and the second is worth recording. The roster endpoint was fixed first; `GET /users/{id}/with-roles` was left returning the raw record, so the `contact_info_visibility` setting stayed advisory — anything withheld on the roster was one request away. Both now redact through shared helpers (`_clear_hidden_contact_fields` / `_load_contact_visibility`) that fail closed, with `members.manage` holders **and the subject** exempt — the settings page loads a member's own profile through that endpoint and writes the fields back, so redacting for self would have blanked their own address on the next save. **Date of birth and emergency contacts** are now leadership-only with no setting able to publish them, and disclosure is recorded on the `user_viewed` audit event. On the settings side, `without_infrastructure()` also strips the `it_team` block (names/emails/phones + free-form `backup_access`), which the original identifier strip missed. (ORU-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Orgs: membership-ID generation has no row lock (duplicate IDs under concurrency)**                          | Mostly ✅ resolved                                          | **Fixed:** `generate_next_membership_id` now locks the org row `FOR UPDATE` before reading/incrementing the JSON counter (no more TOCTOU duplicate IDs) and caps the collision-retry loop; the admin update path checks the real `users.edit` permission (was the non-existent `users.update`); `PATCH /settings` deep-merges nested sections instead of shallow-replacing a whole section on a partial update. **Also resolved since:** `member_status` transitions now go through a lifecycle state machine (`ALLOWED_STATUS_TRANSITIONS` in `endpoints/member_status.py`, added 2026-07-31) rather than any-to-any — suspension must resolve to reinstatement or termination rather than laundering into leave/retirement, ARCHIVED is isolated on both sides so the dedicated `/archive` and `/reactivate` endpoints stay the only doors, and a blocked transition returns 400 with the allowed list. Member audit-history org-filtering was unblocked 2026-07-30 by the `audit_logs.organization_id` column and is applied on the log rows. **Nothing deferred remains under ORU-9.** (Verified during app-review A6; this row had still listed the state machine as deferred after it shipped.)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Frontend: PII drafts / offline queue survive logout on a shared device**                                    | ✅ Resolved (verified 2026-08-07)                           | The product decision was made in favour of confidentiality and this row had not been updated. `frontend/src/utils/purgeLocalMemberData.ts` clears the shift-report drafts (localStorage) and all three IndexedDB queues — equipment checks incl. photo blobs, shift reports, and generic training/RSVP submissions — and is awaited by `authStore` on logout. To avoid destroying work silently it first makes a best-effort flush of anything still queued when online, and always reports how many items were discarded so the login page can tell the member. Each store is bounded by a 3 s timeout so no IndexedDB pathology can stall logout. (FE-6/FE-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Public portal: bcrypt-before-rate-limit CPU DoS + non-selective key prefix**                                | ✅ Resolved                                                 | `authenticate_api_key` now runs the client-IP rate limit as its first line — before the DB lookup and the bcrypt verify — so an unauthenticated flood of well-formed `logbook_…` keys is throttled before any expensive work; the redundant in-body IP checks were removed from the key-authenticated endpoints to avoid double-counting. The key prefix is now selective (16 chars: `"logbook_"` + 8 key chars; column widened `String(8)→String(20)`, migration `20260729_0001`) so a lookup returns one candidate → one bcrypt verify. Legacy `"logbook_"` keys self-heal to the selective prefix on next successful auth (no forced re-issue). (PP-4/PP-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Public portal: per-process rate limiter + application-status token plaintext at rest**                      | Open (MED, needs Redis/schema)                              | The in-memory public rate-limit caches are per-worker (true ceiling = workers × limit) and reset on restart — a shared Redis store is needed for a real global limit. The applicant status-check token is stored plaintext and matched by DB `==`, so a DB/backup read yields live 30-day tokens — it should be hashed at rest and looked up by hash. (PP-6) **Resolved from this cluster:** `authenticate_api_key` now throttles the `last_used_at` write (≤ once/60 s per key) and `detect_anomalies` uses 2 COUNT queries instead of 3 (PP-7); the access-log viewer auto-escapes `user-agent`/`referer`/`ip` via JSX (no stored-XSS — PP-5). Accepted design limitations: the whitelist has no per-subfield granularity (a whitelisted `mailing_address` exposes the whole nested dict — intentionally-public org data, not member PII), and the ≥36-bit display code has no per-code lockout (already bounded by the 60/min-per-IP limit).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Onboarding: role editor accepts client-controlled permissions / priority / system-flag**                    | Open (MED/LOW, needs design)                                | `save_session_roles` accepts fully client-supplied role `permissions`, `priority`, and `is_custom` (which sets `is_system`), and keys updates on the client-supplied slug — so an in-progress onboarding session can mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` permission strings (a literal top-level `*` is not injectable, and the completion guard now blocks post-setup replay). Clamping priority, rejecting system-role re-mint, and allowlisting `module_id` would change what the legitimate onboarding role editor can express, so it needs a product decision. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Onboarding: reset trust model, audit durability, and `/status` disclosure**                                 | Open (MED/LOW, needs decision)                              | `/reset` is gated by the onboarding session + CSRF but not the existing owner's re-authentication, so a leaked in-progress session can wipe the owner+org before completion — but blocking reset once an owner exists conflicts with legitimately restarting a botched setup. The `reset_initiated` audit event is written in the same transaction as the deletes, so a failed reset rolls it back (should commit to a durable sink first). `GET /status` returns the org name + setup state to any unauthenticated caller even post-completion (minor info disclosure). `template_service` create/update rely on the pydantic schema never exposing `organization_id`/`is_system` (mass-assignment fragility). (ONB-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Core infra: fail-open TLS/image handling + latent cache isolation gaps**                                    | Partially resolved (2026-08-07)                             | (1) ✅ **Resolved as an opt-in.** Two distinct cases, now separated. "TLS enabled but peer unverified" (`DB_SSL`/`REDIS_SSL` on with no CA → `CERT_NONE`) was already CRITICAL and blocks boot in production/staging, waivable via `SECURITY_ALLOW_UNVERIFIED_TLS` — that configuration looks secure and is not, which is worse than honest plaintext. "No TLS at all" is now governed by **`SECURITY_REQUIRE_TLS`** (default `False`): when set, absent `DB_SSL`/`REDIS_SSL` is promoted from WARNING to CRITICAL and refuses to start. It defaults off precisely because promoting it unconditionally would refuse boot for any prod that terminates TLS elsewhere (private VPC, service mesh, sidecar) — turning it on is the deployment owner's call, which is the ops decision this row was waiting on. Covered by `tests/test_tls_required_config.py`. (2) `optimize_image` fails open — a valid-header decompression bomb or any processing error returns the original bytes unprocessed (storing the bomb, bypassing EXIF/GPS stripping) and it doesn't set a local `MAX_IMAGE_PIXELS`; making it reject changes the avatar/equipment-photo upload contract. (3) Redis TLS disables cert + hostname verification when no CA is configured (`CERT_NONE`). (4) The Redis cache manager provides no tenant namespacing — all current callers use intentionally-global keys (no PHI cached), but there's no guardrail against a future caller caching an org-scoped record under a bare id; `clear_pattern()` is an unused wildcard-delete footgun. (5) WebSocket `accept()` precedes auth (deliberate, so close codes reach the browser). (CI-9/CI-10) |
| **Crypto: AES-256-GCM + 600k PBKDF2 done; MFA recovery-code entropy remains**                                 | Partially resolved (LOW)                                    | **Done:** at-rest field encryption now uses **AES-256-GCM** (authenticated; a tampered value fails closed via `InvalidTag`). Legacy Fernet (AES-128-CBC + HMAC) values remain readable, and `scripts/reencrypt_to_aesgcm.py` backfills existing rows to GCM (run it against staging with a DB backup first — it is dry-run by default; see `docs/AES256_GCM_BACKFILL_RUNBOOK.md`). Once the backfill is verified complete, Fernet read-support can be removed. **Also done (app-review B24):** the KDF work factor for new (`$gcm2$`) values is now **600k** PBKDF2-HMAC-SHA256 iterations (the 100k `$gcm1$` path is read-only for migration-era values). **Still open (deferred, well-mitigated):** MFA recovery codes are 40-bit unsalted SHA-256 (encrypted at rest, single-use, lockout-throttled) — changing it invalidates stored codes, so it's a deferred migration. (CI-5 + PBKDF2 done / recovery-codes CI-10 / CI-4 fail-closed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Security monitoring: `security_alerts` cross-tenant alert read + suppression**                              | ✅ Resolved                                                 | `SecurityAlertRecord` now has an `organization_id` column (migration `20260728_0001`, indexed, backfilled from each alert's `user_id → users.organization_id`), populated at `_add_alert` from the acting user's org (user-less pre-auth / IP-only alerts stay NULL = platform-level). All four service methods take `organization_id` as a required parameter and filter on it: `get_recent_alerts` and `get_security_status` scope every aggregation (failed logins via the org's user ids); `acknowledge_alert`/`resolve_alert` scope the fetch so cross-tenant and missing ids both return a uniform 404 (no suppression, no existence oracle). `get_security_status` no longer returns the raw external-endpoint URL list (another tenant's exfil destinations) — only a process-global count. (SEC-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Security/IP: audit-chain rehash laundering + break-glass gate**                                             | ✅ Resolved                                                 | `rehash_chain` used to recompute `current_hash` from each row's current `event_data` for **every** row, so a privileged operator with DB write access could edit a keyed (v2) row and run rehash to launder the tamper into a valid keyed chain. Rehash now only repairs legacy (unkeyed) rows and **fails closed** (409) on a keyed-row mismatch — it never rewrites a keyed row. And because rehash rewrites the single cross-org chain and there is no platform-super-admin role, `POST /audit-log/rehash` is now disabled (403) unless a server operator sets `AUDIT_ALLOW_CHAIN_REHASH=true` (env = the de-facto platform-admin boundary), so an ordinary org admin holding `audit.export` can no longer trigger a platform-wide chain rewrite. (SEC-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Security/IP: global country-block table + geo fail-open**                                                   | ✅ Resolved                                                 | Geo-blocking is a platform-edge control (enforced before any tenant/auth context, against one shared MaxMind DB + one global blocked-country set), so per-org `CountryBlockRule` rows don't fit the enforcement model. Instead: (1) `GEOIP_FAIL_CLOSED` (default False) makes `is_ip_blocked` block any IP whose country can't be resolved — including the missing/corrupt-DB case — closing the "silently disabled app-wide" hole; private/reserved and allowlisted IPs are still allowed first, so an internal/allowlisted operator can recover. (2) The two mutating country-rule endpoints are gated by `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` (default False), so an org admin can no longer alter the shared cross-tenant blocklist via the API — the operator sets it at deploy time via `BLOCKED_COUNTRIES`. The non-destructive audit-chain ops (`/checkpoint`, read-only `/integrity`) remain on `audit.export`/`audit.view`. (SEC-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Security/Audit: residual exposure & robustness (session_id export, error-payload XSS, users-join scoping)** | Mostly ✅ resolved (one deferred)                           | **Done:** the audit export now emits a non-reversible SHA-256 fingerprint of `session_id` (raw value no longer leaked to `audit.export` holders; not in the hash chain, so integrity checks unaffected). The admin error viewer (`ErrorMonitoringPage`) and public-portal access-log viewer (`AccessLogsTab`) render error/UA/referer text via auto-escaped JSX (no `dangerouslySetInnerHTML`) — no stored-XSS path; `context` stays 4 KB-capped. The dead org-scoped `get_all_active_allowed_ips` method was removed and `IPExceptionType.BLOCKLIST` documented as a reserved placeholder. **Resolved 2026-07-30:** `audit_logs.organization_id` exists (migration `20260801_0009`, backfilled from `user_id`, hash-bound from version 3); all audit read paths filter it directly. (SEC-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Compliance/Skills: self-certification & self-attestation (no separation of duties)**                        | ⚠️ Half resolved (verified app-review A9)                   | **✅ Skills self-certification closed, at both ends:** an examiner can no longer be the candidate on a scored skills test, and **since 2026-08-08 an officer can no longer validate a test they are the candidate in** — `skills_testing.py` calls the shared `assert_different_person` guard (`app/services/separation_of_duties.py`) on both paths, with an `is_practice` carve-out for un-credited self-drilling. The second check is what keeps opening the examiner role to every member from re-opening this: without it an officer could have a peer "examine" them and then sign off their own pass, which is the same fraud one hop removed. **Still open:** `create_attestation` records a client-supplied `compliance_percentage` with nothing recomputed server-side and no second approver, so a compliance officer can attest a number they chose. Closing it needs a computed value or dual-control — a workflow change. (CS-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Compliance: reporting correctness & email abuse-surface polish**                                            | Partially resolved (LOW/MED)                                | **Fixed:** the report email HTML now `html.escape`s the org name, `report_type`, and period label (was raw interpolation of user-controlled values — mail-client HTML/script injection); `report_type` is constrained to `monthly`/`annual` (was free-form, persisted + interpolated). **Still flagged:** monthly reports return the annual dataset relabeled (needs `generate_annual_report` to support a month window — feature); report emailing accepts client-supplied recipients (external auditors are a legitimate case — **owner decision 2026-08-09: allow any recipient, but audit-log each send to a non-member address**; `_email_report` now calls `audit_external_recipients`, which writes an `external_recipient_send` audit event listing every out-of-org address); attestation history over-fetches globally (blocked on the deferred `audit_logs.organization_id` column — availability, not a leak); `records_with_certification` mislabel left as-is (ambiguous intent). (CS-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Finance: no separation of duties on terminal money movement**                                               | ⚠️ Narrowed (verified app-review A9)                        | **✅ The severe case is closed:** the request **approval step** now calls the shared `assert_different_person` guard (`finance_service.py:649`), so one person can no longer both raise a purchase/check request and approve it — a second person must approve before anything is payable. **Still open:** the _disbursement_ actions (`mark_pr_paid`, `mark_expense_paid`, `issue_check`, `void_check`, `record_dues_payment`, `waive_dues`, `unwaive_dues`) are all gated only by `finance.manage`, so the requester can still be the person who executes an already-approved payment. Full three-way separation needs a distinct `finance.disburse`/treasury permission on roles (seed + roles + frontend). (FIN-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Finance: dues administration has no UI — every write is API-only**                                          | Open (MED, missing feature)                                 | `DuesManagementPage` is read-only: schedule filter, status tabs, summary cards and the member dues list. The store exposes only `fetchDuesSchedules` / `fetchMemberDues` / `fetchDuesSummary`, and `duesService` has no `unwaive` or payment-history call at all. So creating a schedule, generating member dues, recording a payment, waiving, reversing a waiver and reading the payment ledger are all reachable only through the API, despite every one of them being an endpoint. `docs/training/11-finance.md` documents the click-paths as the intended UI and now carries a callout saying so; the YouTube shorts for the dues fixes (8m/8n) are written but on hold because there is nothing to film. Closing this is a frontend build-out, not a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Finance: reimbursement/payee records readable by any `finance.view` holder**                                | ✅ Resolved for reimbursements (owner decision, 2026-08-09) | Expense reports (member reimbursements: amounts owed + payee detail) were `finance.view` with no owner scoping. **Fix:** `list_expense_reports`/`get_expense_report` take `restrict_to_user`; the endpoints pass the caller's id unless they hold `finance.manage`, so a plain `finance.view` holder now sees only their own reimbursement submissions while treasurers keep the full org queue. Check-requests and purchase-requests are procurement records (vendor payees, not member out-of-pocket reimbursement) and are left at `finance.view` intentionally. Covered by `tests/test_read_permission_gates.py`. (FIN-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Finance: `record_dues_payment` has no idempotency and overwrites waives**                                   | ✅ Resolved (2026-08-04)                                    | All three defects had one cause: `MemberDues` was the only record of payment — one `amount_paid` total plus one set of detail columns, overwritten by whichever payment was entered last, so a retry was indistinguishable from a second installment. A `dues_payments` ledger (migration `20260802_0001`, backfilled) now holds one row per payment and the columns on `MemberDues` are a projection of it: `amount_paid` is re-derived as the sum of the ledger rather than accumulated, so a double-credit would require a duplicate ledger row, which the uniqueness constraint on `(member_dues_id, transaction_reference)` refuses. Unreferenced cash is deliberately never deduplicated — two identical cash amounts are two payments. `WAIVED`/`EXEMPT` records refuse payment outright, and `POST /finance/dues/{id}/unwaive` (`finance.manage`, reason required) is the deliberate reversal that replaces the old silent one, carrying the erased waive reason into a `finance.dues_waiver_reversed` audit event. `GET /finance/dues/{id}/payments` (`finance.view`) exposes the ledger. (FIN-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Finance: correctness/DoS polish (export, pagination, request numbers, float aggregates)**                   | Partially resolved (LOW/MED)                                | **Fixed:** `add_expense_line_item` recomputes the report total from a fresh `SUM(amount)` aggregate instead of `sum(loaded_collection) + item.amount` (which could double-count/drift). **Still flagged (behavior/schema-change):** `_generate_request_number` `count()+1` race needs a unique-constraint migration + retry; float money math is a module-wide Decimal refactor; unbounded export + in-memory pagination is a DoS-surface refactor touching many endpoints; no overspend guard on spend posting; `get_pending_approvals` returns the org-wide queue rather than the caller's assigned steps. (FIN-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Scheduling: swap accept-path lacks re-validation & self-approval guard; finalize trusts manual_hours**      | Open (LOW/MED, needs design)                                | When a shift swap is _accepted_ by the counterparty (vs. manager approval), the target shift's capacity/cancellation/finalization is not re-validated at accept time and the approver-identity check is looser than the manual-review path. Separately, `finalize_shift` trusts a client-supplied `manual_hours` override with no bound. Both are behavior changes deferred for an owner decision. (SCH-5/6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Recurring: create/update paths trust client-supplied FK ids without an org check (XC-1)**                   | Open (LOW, systemic)                                        | The dominant cross-cutting pattern — create/update methods store `user_id`/`category_id`/`assignee_id`/etc. without verifying the referenced row is in-org. Individually low impact (org-stamped writes → dangling/mis-attributed FKs, not disclosure), but pervasive. Best closed by a shared `assert_in_org(db, Model, id, org_id)` helper rolled out per module. Full instances in [`docs/module-audit/CROSS-CUTTING.md`](./module-audit/CROSS-CUTTING.md) (XC-1/2/3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Application Review — Feature Rotation (2026-08-05)

Owner-decision items from the feature-by-feature review under
[`docs/app-review/`](./app-review/PROGRESS.md).

| Limitation                                                                                       | Status                                                                 | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Documents: folder ACL is per-folder, not hierarchical**                                        | Open (LOW, needs product decision)                                     | `can_access_folder` checks only a folder's own `visibility`/`allowed_roles`, never its ancestors. Apparatus/facility per-item child folders are created `ORGANIZATION`-visibility with no `allowed_roles` even though their parent roots are `LEADERSHIP`, so any `documents.view` holder can read those child folders directly — and the apparatus docstring's "allowed_roles restricted" claim is not actually coded. May be intended (crews seeing their rig's manuals is reasonable); if leadership-only was meant, the fix is a hierarchical ACL that walks the parent chain (perf implications on every folder check). Member personal folders are unaffected (`OWNER`-visibility). Decide intent, then fix either the code or the docstring. (DOC-5)                                                                                                                                                                                                                                                                                                                      |
| **Money disbursement: separation of duties**                                                     | ✅ Resolved (owner decision, option (a), 2026-08-09)                   | The owner chose the cheap `assert_different_person` guard over a new disburse permission tier. A `storefront.manage` holder can no longer mark their _own_ order paid / waive / refund it, and a `finance.manage` holder can no longer mark their _own_ purchase request or expense report paid, issue a check for their own request, or waive their own dues — each compares the actor against the order's member / the request's `requested_by` / the dues member and refuses on a match (mirrors AH-4). The out-of-band reconciliation path (`actor_id=None`) is exempt. Not the broader requester≠disburser tier of option (b); a dedicated `finance.disburse`/`storefront.disburse` permission remains a future enhancement if the department wants to separate the roles generally rather than just block self-dealing. (`storefront_service.py`, `finance_service.py`; `test_money_separation_of_duties.py`.)                                                                                                                                                             |
| **Storefront: `auto_apply_payments` defaults on**                                                | Open (LOW, product decision)                                           | When a PayPal integration's config omits `auto_apply_payments`, it defaults to `True`, so an exact-amount capture settles an order with no human in the loop. Well-guarded (amount must equal the balance exactly; anything else is recorded `AMBIGUOUS`), but it is an implicit default on a money path and should be an explicit choice in the integration setup UI. (SF future-dev #4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Storefront: no reconciliation backfill**                                                       | Open (MED, robustness)                                                 | If PayPal's verify-webhook-signature API is unreachable, the webhook returns 401 and PayPal eventually stops retrying — the capture is then absent from the ledger with no way to re-ingest it. The Transaction Search API (rejected in the service docstring for its multi-hour lag) is the natural backfill source for exactly this case. (SF future-dev #1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Consent enforcement**                                                                          | ✅ Resolved (2026-08-05) for SMS; the other two types have no consumer | `ConsentService.has_consent` had **zero callers** — members could refuse `PHOTO_USE`, `PUBLIC_ROSTER_LISTING` and `SMS_NOTIFICATIONS` and be ignored. Enforcement was blocked on a backfill decision, since "never asked" counts as refused and wiring it in would have stopped SMS to every existing member. **Owner's rule removed the blocker:** messages always go to the member's email, so consent suppresses the text but never the notice. SMS is now consent-gated in both send paths (department-message escalation and the inventory low-stock alert) via a new bulk `granted_user_ids` helper, and email is unconditional — sent for every department message and no longer filtered by the `email_notifications` preference, which still governs the seven reminder/alert flows. **Still open:** `PHOTO_USE` and `PUBLIC_ROSTER_LISTING` have no consumer to gate — there is no public roster or public photo publishing in the app today. Whoever builds them must gate on `has_consent`; the requirement is recorded in the `consent_service` docstring. (AUTH-2) |
| **Cohort room booking is built but has no UI**                                                   | Open (MED, frontend build-out)                                         | `location_id` is accepted by `CourseCohortCreate`, validated in-org via `assert_in_org`, carried on each syllabus row, and drives a real double-booking check that returns `"Location already booked: …"` as a per-class warning at both preview and generation. The service docstring advertises "a room clash the officer chose to accept" as supported. But **no cohort or syllabus UI sets it** — `grep -rn "location_id" src/pages/training/ src/components/training/` returns nothing — so the warning can never fire in practice, and a department scheduling a fifteen-class recruit school into already-booked rooms gets no notice. Same shape as the dues-UI gap above. Closing it needs a location picker in the wizard and syllabus builder plus a product call on whether the room is per-cohort, per-class, or both (the backend supports both). Several smaller fields are API-only for the same reason: `description`, `notes`, `requires_rsvp`, `auto_create_records`, `default_duration_minutes`. (CC-2)                                                      |
| **Public portal: rate limiter is per-process + application-status token is plaintext at rest**   | Open (MED, infra + schema)                                             | The public-portal rate-limit caches are per-worker (true ceiling = workers × limit) and reset on restart — a real global limit needs a shared Redis-backed store. Separately, the 256-bit application-status token is stored plaintext on `ProspectiveMember.status_token` and matched by DB `==`, so a DB/backup read yields live 30-day tokens. It can't simply be hashed, because it's re-read to rebuild the status-check URL in emails and the status response — hashing at rest needs a two-column design (an indexed `status_token_hash` for lookup plus the token stored encrypted for re-display) and a backfill. Both are infra/schema changes. (PP-6)                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Onboarding: role editor accepts client-supplied permissions/priority/system-flag**             | Open (MED-LOW, product decision)                                       | During setup, `save_session_roles` accepts client-supplied `permissions`, `priority`, and `is_custom` (which sets `is_system`), keyed on the client slug — so a session holder can mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` permission strings. A literal top-level `*` is not injectable, and the post-completion guard (ONB-3) blocks abuse once setup is done, so the window is the still-in-progress setup only. Clamping priority, rejecting system-role re-mint, and allowlisting `module_id` would change what the legitimate onboarding role editor can express, so it needs a product decision. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                      |
| **Roles: the org-wide `member` role can be mass-escalated up to the caller's ceiling**           | Open (LOW, product decision)                                           | The baseline `member` role every user carries can be edited to add any permission within the caller's own grant ceiling — so an admin can, in one edit, grant a new capability to every member at once. This is intended (that's how you roll out a capability org-wide) but sharp: there's no dedicated confirmation or guard distinguishing "edit a normal role" from "edit the role literally everyone has." A confirmation step or a dedicated guard on the baseline role is a product decision. (ORU-7c)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Scheduling: swap accept-path skips target re-validation + weaker approver check**              | Open (MED, design change)                                              | When a shift swap is _accepted_ by the counterparty (as opposed to manager approval), the target shift's current state — capacity, cancellation, finalization — is not re-validated at accept time, and the accept path's approver-identity check is looser than the manual-review path. So a swap accepted after the target shift filled up, was cancelled, or was finalized could still go through. Closing it is a behavior change to the swap-accept workflow (what to re-check, and whether to block an accept on a now-invalid target), so it's left for a design decision. (SCH-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Training: auto-approved submissions bypass separation-of-duties**                              | ✅ Resolved (owner decision, 2026-08-09)                               | The manual submission-review path blocks self-approval (the shared `assert_different_person` guard), but the **auto-approve** branch in `create_submission` (`require_approval=False`, or `hours_completed <= auto_approve_under_hours`) immediately spawned a COMPLETED record crediting the member's self-reported hours with **no reviewer at all**. **Fix:** `create_submission` now routes any submission that would credit a certification/requirement (training_type=certification, any certification credential field, or a linked training category) to manual review regardless of the org's auto-approve config — only non-crediting submissions (plain logged hours, skills practice) may auto-approve. See `_credits_certification_or_requirement`. (TR-5)                                                                                                                                                                                                                                                                                                          |
| **Events: public event-request intake has no per-org opt-in or spam parity with forms**          | Open (MED, feature + config)                                           | Any `active` org's outreach event-request pipeline can be filled by anyone who supplies its `organization_id` (discoverable via the public calendar). The only gate is a per-IP rate-limit of 10 — there's no per-org "accept public requests" toggle, and (unlike the forms module) no honeypot or per-org daily cap; each submission writes rows and fires assignee/requester emails. Closing it needs a per-org opt-in setting plus honeypot/daily-cap parity with forms — a feature build-out, not a one-line fix. (EV-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Reports: member/applicant PII exposed at the low `reports.view` grant**                        | ✅ Resolved (owner decision, 2026-08-09)                               | `member_roster` returns each member's email + membership number and `pipeline_overview` returns prospective-member email + full name — both were gated only on `reports.view`. **Fix:** `reports.py` maps those PII-bearing report types to their source-record read permission (`member_roster`→`members.view`, `pipeline_overview`→`prospective_members.view`) via `PII_REPORT_PERMISSIONS` and enforces it in `/generate` and `/saved/{id}/run` (403 if missing); `/available` hides PII reports the caller can't run. Aggregate reports stay at `reports.view`. Covered by `tests/test_read_permission_gates.py`. (RPT-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Grants: no financial state machine or overspend guard**                                        | Open (MED, needs product decision)                                     | No path checks total expenditures against `amount_awarded` / `amount_budgeted`, so `amount_remaining` can go negative; `update_application` applies any status/amount change with no transition guard (a CLOSED/AWARDED grant stays fully editable); and an `awarded → active → awarded` round-trip regenerates a duplicate full set of compliance tasks. Closing it needs a product-defined grant state machine, an overspend policy (hard block vs warn), and idempotent compliance-task generation. (GF-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Grants: `is_anonymous` donations still show donor identity to staff**                          | Open (LOW-MED, product decision)                                       | `DonationResponse` / `DonorResponse` serialize `donor_name`/`donor_email`/`donor_id`/`amount` regardless of the `is_anonymous` flag, and the dashboard's recent-donations list returns donor-identified rows to any `fundraising.view` user. There is no public surface, so this is staff-only — but the anonymity flag currently has no effect. Decide whether an anonymous gift should hide donor identity from `fundraising.view` (vs `.manage`), then enforce it in the response serializers. (GF-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Forms: `require_authentication` / `allow_multiple_submissions` not enforced on public submit** | Open (LOW, needs product decision)                                     | `get_form_by_slug` gates a public form on `is_public` + `PUBLISHED` only. A form flagged both `is_public=True` and `require_authentication=True` still accepts anonymous submissions, and `allow_multiple_submissions=False` isn't enforced server-side (only the per-IP daily cap applies). The fix depends on the intended semantics of "public + require_authentication" — reject it as contradictory, or read it as "public listing, authenticated submit." Decide, then enforce (and add a server-side one-submission-per-identity check for `allow_multiple_submissions`). (FORM-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Integrations: non-secret config readable by any authenticated member**                         | ✅ Resolved (owner decision, 2026-08-09)                               | `list_integrations` / `get_integration` used bare `get_current_user`, so any member read every integration's non-secret config (instance_url, field_mappings, api_base_url). **Fix (minimal-projection option):** the full config `list`/`get` now require `integrations.manage`; a new `GET /integrations/connected` returns only `integration_type`/`status`/`enabled` for any authenticated member, and the cross-module `useConnectedIntegrations` hook was repointed to it so meeting-config/pipeline flows keep working without the integrations-admin permission. Covered by `frontend/src/hooks/useConnectedIntegrations.test.ts`. (INT-3)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Membership pipeline: duplicate-archived-member 409 names the matched member**                  | Open (LOW, product decision)                                           | Creating a prospect who matches a previously-archived member returns a 409 whose message names that member (`"…matches this prospect: <name> (<email>)…"`) so leadership can recognize who to reactivate. The structured `user_id`/`reactivate_url` leak was removed (MP-7 fix) and the frontend never read them, but the sibling `POST /prospects/check-existing` deliberately strips _all_ identity to `status`+`match_type`. Whether the create-path message should likewise avoid naming the archived member — trading leadership convenience for the same minimization — is a product call. When the match is by name rather than email, the message can surface an email the caller didn't supply. (MP-7)                                                                                                                                                                                                                                                                                                                                                                  |
| **Client IP recorded as the proxy address**                                                      | ✅ Resolved (2026-08-05); one historical-data decision open            | `request.client.host` was used instead of `get_client_ip(request)` in 39 places across 8 files, so behind the production nginx every record stored one identical internal IP. Worst case was **elections**: per-vote IPs drive the fraud detection documented in `BALLOT_FORENSICS_GUIDE.md`, so `unique_ip_count` collapsed to 1 and every election permanently tripped the `suspicious_ips` threshold. The sweep also caught a live **availability** bug the survey had missed: `public_portal_security.py` keyed the public-portal _rate limiter_ on the peer IP, so all anonymous visitors shared one bucket and a single caller could lock out everyone (the H5 shape, still live on the public surface). Verified behavior-neutral: identical test results before and after. **Open:** rows already written still hold proxy IPs and are indistinguishable from real ones — recommend noting the cutover date in `BALLOT_FORENSICS_GUIDE.md` rather than rewriting hash-chained audit history. (AXC-1)                                                                     |

## Error Monitoring Coverage (2026-08-07)

What does _not_ reach the Error Monitoring page after the reporting sweep. Each
is an accepted gap with the same root cause: an `error_logs` row is org-scoped
and `organization_id` is NOT NULL, so a failure that cannot be attributed to an
organization has nowhere to go.

| Item                                                                        | Status                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Failures before sign-in reach the page only if the member then signs in** | ⚠️ Narrowed (2026-08-07)             | `POST /errors/log` requires an authenticated session, because an error row is org-scoped. Reports raised while signed out are no longer discarded — they are held in memory and delivered by `flushQueuedReports()` on the next successful login, so a member who hits a 500 on the login screen and then gets in _is_ recorded. **Still open:** a visitor who never signs in (public portal, public forms, a member who gives up at the login screen) reports nothing, and the held queue does not survive a page reload — deliberately, since persisting error text to `localStorage` would put it outside the storage rules the rest of the app follows. Closing it fully needs an anonymous ingestion path with its own org resolution and abuse protection (the endpoint would be unauthenticated and world-writable). |
| **The onboarding client is not instrumented**                               | Accepted (follows from the above)    | `modules/onboarding/services/api-client.ts` calls `fetch` directly rather than an axios instance, so it does not pass through the interceptor that reports API failures. Onboarding traffic is mostly pre-session. If it is ever instrumented, route it through `reportApiError` rather than adding a second transport.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Celery task failures are not reported**                                   | Open (LOW)                           | `persist_error_log` resolves the org from the request's credentials, and a background worker has no request. Scheduled email sends, report generation and similar failures reach Loguru/Sentry only. Closing it means passing an explicit `organization_id` into a request-free variant of the helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Reports can still be discarded under sustained failure**                  | Accepted (bounded, and never silent) | The client caps reports at 20/minute and holds at most 50 undelivered, and abandons a report after 4 delivery attempts. Anything discarded by the two caps is counted and reported as a `REPORTING_THROTTLED` row, so a burst reads as "20 reports plus 340 suppressed" rather than a quiet minute — but the discarded reports themselves are gone, and a report abandoned after 4 failed attempts is not counted anywhere. Raising the caps trades table growth for fidelity; the current values assume a browser tab, not a server.                                                                                                                                                                                                                                                                                       |
| **A 5xx produces two rows**                                                 | Accepted (intentional)               | The backend logs `BACKEND_HTTP_5xx` with the traceback and endpoint; the client logs `API_SERVER_ERROR` with the member and the page they were on. Neither is redundant — the backend row is missing when the failure never reached the app (gateway 502) and the client row is missing for a failure outside a request the user made. They are distinguished by the Source column.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Frontend Routes & Navigation (2026-08-07)

Nothing in the codebase connects a `to=` string to a `path=` string, and
`App.tsx`'s catch-all turns an unmatched target into a silent redirect to the
dashboard — so a dead link produces no error anywhere and reads as a button that
does nothing. `frontend/src/routeIntegrity.test.ts` now walks the source and
checks every literal navigation target against the declared routes, reporting
file, line and target. Known gaps are listed in its `KNOWN_MISSING_ROUTES`
allowance, and a companion test fails if either route ever appears, so the
allowance cannot outlive the gap.

| Item                                                                  | Status                              | Detail                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grants: "Record Donation" points at a screen that was never built** | Open (MED — feature gap, not a bug) | The donors page links to a create-donation route with no matching page. The API client and store already expose the create call, so the gap is the screen alone. `docs/training/12-grants-fundraising.md` documents the flow and carries a screenshot placeholder for it; both stay until the page exists. |
| **Grants: "Add Opportunity" points at a screen that was never built** | Open (MED — feature gap, not a bug) | Same shape as above, from the opportunities page. Documented in the grants training guide.                                                                                                                                                                                                                 |

## Member Lifecycle — The Page That Was Documented but Never Built (2026-08-08)

`docs/training/01-membership.md` described a **Member Lifecycle Management** page
under Members Admin with four tabs — Archived Members, Overdue Returns, Leave of
Absence, Tier Configuration. **No such page exists**, and it appears never to
have. `/members/admin` (`MembersAdminHub.tsx`) declares exactly three tabs:
Member Management, Add Member, Import Members.

The guide has been corrected. This row records the **product** gap, which is
real: for four lifecycle operations the endpoints, permissions and service
methods all exist and are exercised by tests, and only the screens are missing.

> **Correction to a previous entry.** The 2026-08-07 row this replaces stated
> that "tiers are actually configured under organization settings." That was
> wrong — it was taken from a commit message rather than from the code. Tiers are
> _stored_ in `Organization.settings["membership_tiers"]`, but **no settings
> screen reads or writes them**. Read the call site, not the commit message.

Verified 2026-08-08 by searching for consumers of every `memberStatusService`
method in `frontend/src/services/adminServices.ts`:

| Capability                           | API                                                                                                                    | Service method                                                                            | UI consumer                                                                        | State                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------- |
| Change member status (incl. archive) | `POST /users/{id}/status`                                                                                              | `changeStatus`                                                                            | `MemberProfilePage.tsx:296`                                                        | ✅ Shipped           |
| Create a leave of absence            | `POST /users/leaves-of-absence`                                                                                        | `createLeaveOfAbsence`                                                                    | `WaiverManagementPage.tsx:275`                                                     | ⚠️ Works, wrong home |
| List / view leaves                   | `GET /users/leaves-of-absence`, `/users/{id}/leaves-of-absence`                                                        | `listLeavesOfAbsence`, `getMemberLeaves`                                                  | `WaiverManagementPage`, `TrainingWaiversTab`, `MemberProfilePage` (read-only card) | ⚠️ Read-only         |
| Edit / delete a leave                | `PATCH`/`DELETE /users/leaves-of-absence/{id}`                                                                         | `updateLeaveOfAbsence`, `deleteLeaveOfAbsence`                                            | **none**                                                                           | ❌ API only          |
| List archived / reactivate           | `GET /users/archived`, `POST /users/{id}/reactivate`                                                                   | `getArchivedMembers`, `reactivateMember`                                                  | **none**                                                                           | ❌ API only          |
| Overdue property returns             | `GET /users/overdue-property-returns`, `POST .../reminders`, `GET /users/{id}/property-return-preview`                 | `getOverduePropertyReturns`, `processPropertyReturnReminders`, `getPropertyReturnPreview` | **none**                                                                           | ❌ API only          |
| Tier configuration                   | `GET`/`PUT /users/membership-tiers/config`, `POST /users/advance-membership-tiers`, `POST /users/{id}/membership-tier` | `getTierConfig`, `updateTierConfig`, `advanceMembershipTiers`                             | **none**                                                                           | ❌ API only          |

**Why this matters more than a missing screen usually would.** Two of the gaps
are the _reversal_ of an action that does have a UI: you can archive a member
from their profile but cannot un-archive one, and you can put somebody on leave
from Waiver Management but cannot correct the dates afterwards. A one-way door
with no visible handle on the far side is worse than a feature that is simply
absent.

**Two decisions this needs, not one:**

1. **Build the page, or distribute the operations?** A consolidated lifecycle
   page is what the docs assumed. Alternatively archived/reactivate could live on
   the Members list as a filter, and leave-of-absence editing next to where leaves
   are already created. The second is less work and arguably where people would
   look; the first is what four years of documentation has promised.
2. **Does auto-advancement get a trigger?** `POST /users/advance-membership-tiers`
   is called by nothing — no button, no scheduled task. Tier advancement therefore
   never runs on its own. If tiers are meant to be self-maintaining it needs a
   nightly job; if they are meant to be deliberate it needs a button.

Until then the guide documents the API surface directly and says plainly that
there is no screen.

| Item                                                        | Status                            | Detail                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No UI to un-archive a member**                            | Open (MED — one-way door)         | Archiving is available from the member profile; reactivating is API only.                                                                                                                                                                             |
| **No UI to edit or cancel a leave of absence**              | Open (MED — one-way door)         | Creating is available from Waiver Management; correcting the dates is API only. Leaves pro-rate training requirements, so a wrong end date quietly changes somebody's compliance.                                                                     |
| **Leave of absence is created from Waiver Management**      | Open (LOW — discoverability)      | It works, but it is not where a membership coordinator would look for it.                                                                                                                                                                             |
| **No UI for membership tier configuration**                 | Open (MED — feature gap)          | With no tiers configured, a tier change accepts **any** value — validation only engages once tiers exist, so the unconfigured state is also the unvalidated one.                                                                                      |
| **Tier auto-advancement has no trigger**                    | Open (MED — needs a product call) | No button and no scheduled task calls the endpoint, so advancement never runs by itself. See decision 2 above.                                                                                                                                        |
| **No UI for overdue property returns (members)**            | Open (LOW)                        | Three endpoints, no consumer. The Inventory members page shows an "Overdue Returns" figure, which is a different feature and may be the reason this was assumed to exist.                                                                             |
| **Screenshot `01-22-member-lifecycle.png` was mislabelled** | ✅ Resolved (2026-08-08)          | Captured at `/members/admin` but applied under a "Member Lifecycle Management page" caption, so a real screenshot of the Members Admin hub read as evidence that the lifecycle page existed. Caption and manifest `alt` corrected; the image is fine. |

## Apparatus & Facilities — Four Guide Sections With No Screen (2026-08-08)

Found while capturing screenshots for `docs/training/06-apparatus-facilities.md`:
four placeholders in that guide picture screens the frontend does not render.
Same shape as the Member Lifecycle row above — the API is built, the screen is
not — so they are recorded rather than papered over with an approximate image.
Their placeholders are deliberately left open.

| Guide section                     | What the guide pictures                                                                                                | What exists                                                                                                                                                                                                           | State                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Facility **Utilities** section    | Utility accounts (electric, gas, water) with the latest reading, monthly cost and a usage trend chart                  | Nine `facilitiesService` methods over `/facilities/utility-accounts` and `/utility-readings`, **zero UI consumers**. `FacilityDetailPage` renders seven sections and Utilities is not one of them.                    | ❌ API + service only          |
| Facility **Capital Projects**     | Project list with name, budget, status badge and timeline bar                                                          | Five `facilitiesService` methods over `/facilities/capital-projects`, **zero UI consumers**.                                                                                                                          | ❌ API + service only          |
| Apparatus **NFPA Compliance tab** | Applicable standards with per-standard compliance status (green check / red X), last assessment date and next due date | `ApparatusOverviewTab.tsx:242` renders a single card reading "Tracking Enabled" when the flag is set. There is no standards list, no status, no dates. The flag's only other consumer is a checkbox on the edit form. | ⚠️ Flag only, no tab           |
| Apparatus **deficiency banner**   | A banner at the top of the detail page with the deficiency date and a link to the failed equipment check               | A "Deficiency" badge beside the status badge, on both the list row and the detail header. `deficiencySince` is on the TypeScript type and is **never rendered**; there is no banner and no link to the check.         | ⚠️ Badge only, no date or link |

Verified 2026-08-08 by counting non-test consumers of each service method under
`frontend/src`, and by reading the render bodies rather than trusting the type
definitions — `deficiencySince` and the utility/capital-project types are all
declared, which is exactly what makes this class of gap easy to miss.

The guide text has **not** been rewritten here. Two of these are one component
away from being true, and deciding between "build the screen" and "cut the
section" is a product call, not a documentation fix.

## Medical Screening — The Add Record Form Attaches to Nobody (2026-08-08)

**A screening record created through the UI is attached to no member and no
prospect.** `ScreeningRecordForm` builds its create payload from nine fields —
requirement, type, status, three dates, provider, result, notes — and sets
neither `user_id` nor `prospect_id`. Both are on the frontend
`ScreeningRecordCreate` type and both are accepted by
`POST /medical-screening/records`; the form simply has no control for either,
so the value can never be supplied. `MedicalScreeningPage` is the only caller,
and it passes the payload straight through.

This is worse than a missing field. Every compliance view keys off `user_id`:
`getUserCompliance`, `getProspectCompliance` and the expiring-screenings list
all resolve records by the member they belong to. A record entered by hand
therefore counts toward nobody's compliance and shows as "Unknown" wherever
records are listed — a physical exam that was really performed, recorded in the
system, and invisible to the report that decides whether the member is cleared
for duty.

The demo data does not exhibit this because the seeder posts `user_id` to the
API directly, bypassing the form. That is worth knowing before anyone concludes
from a screenshot that the linkage works.

`docs/training/13-medical-screening.md` describes the missing controls in two
places — "the member dropdown" (Add Record, completed physical) and "the
Prospect field populated with a prospective member name, the Member field
blank". Both placeholders are left open.

Two further placeholders in that guide picture per-member compliance screens
that do not exist:

| Guide section                      | What exists                                                                                                                                                                    | State                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Member compliance detail view      | `fetchUserCompliance` / `fetchProspectCompliance` are defined in `medicalScreeningStore` and called by **no component**. `ComplianceDashboard` lists expiring screenings only. | ❌ Store action only |
| Compliance tab filtered to overdue | `ComplianceDashboard` has no filter controls of any kind.                                                                                                                      | ❌ Not built         |

## Grants & Fundraising — Pledges and Fundraising Events (2026-08-08)

Same shape, found while capturing `docs/training/12-grants-fundraising.md`.

- **Pledges.** `fundraisingService.listPledges` / `createPledge` /
  `updatePledge` exist over a working API. The only consumer is a
  `grantsStore` action that no component calls. The grants dashboard's
  "Outstanding Pledges" KPI card linked to `/grants/pledges`, which has no
  route — and because the router's catch-all redirects unknown paths to `/`,
  clicking it bounced the user to the home dashboard with no error. The link
  has been removed (the figure is real, the destination was not); restore it
  when the page ships.
- **Fundraising events.** `listFundraisingEvents` / `createFundraisingEvent` /
  `updateFundraisingEvent`: zero consumers, no route, no page.
- **Recording a donation.** `DonationsPage`'s primary action, "Record
  Donation", linked to `/grants/donations/new` — also routeless, also
  redirected to `/`. No component calls `createDonation` either, so the form
  behind it was never built. The button has been removed; donations reach the
  system through the API (which is how the demo seeder loads them) and through
  no screen. This is the more serious of the two dead links: the pledges one was
  a KPI tile, this was the page's only call to action.

**The module has no navigation entry at all.** Neither `SideNavigation.tsx` nor
`TopNavigation.tsx` mentions grants, and nothing outside the module links to
`/grants` — the only references anywhere in `frontend/src` are the module
catalogue in `types/modules.ts`, the route registration in `App.tsx`, and a
cache prefix in `utils/apiCache.ts`. Enabling the module makes its pages
routable and reachable by typing the URL, and by nothing else. That is why
`docs/training/12-grants-fundraising.md` opens by picturing "the Grants &
Fundraising sidebar navigation showing Dashboard, Opportunities, Applications,
Campaigns, Donors, Donations, and Reports": the guide describes the navigation
the module is missing. That placeholder is left open too.

Verified 2026-08-08 by counting non-test call sites under `frontend/src` for
each service method and each store action, and by searching both navigation
components for the module's route.

## Finance — Five Guide Sections With No Screen (2026-08-09)

Found while capturing `docs/training/11-finance.md`. Five of that guide's nine
placeholders picture screens the frontend does not render; their placeholders
are left open. Four defects found alongside them were fixed — see the commit
that added the purchase request, expense report and check request shots.

| Guide section             | What exists                                                                                                                              | State                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Create Budget form        | `financeStore.createBudget` over a working API, **no component calls it**. `BudgetsPage` is read-only — it has no create control at all. | ❌ Store action only |
| Add Approval Step form    | `ApprovalChainsSettingsPage` renders a chain's steps and offers no way to add, edit or remove one.                                       | ❌ Not built         |
| Create Dues Schedule form | `financeStore.createDuesSchedule`, **no component calls it**.                                                                            | ❌ Store action only |
| QuickBooks export mapping | `GET/POST/PUT /finance/export/mappings` and the `qbAccountName` types exist; no page, no route, no consumer.                             | ❌ API + types only  |
| Export logs               | `GET /finance/export/logs` and an `ExportLog` interface; no page, no route, no consumer.                                                 | ❌ API + types only  |

**Budget detail's transaction history is a stub, not an empty state.**
`BudgetDetailPage` renders `<EmptyState title="No transactions yet">`
unconditionally — there is no fetch behind it and no code path that ever
displays a transaction. The guide's placeholder asks for "a table of linked
transactions below" the progress bar. The stacked progress bar is real and
correct; the table does not exist. This is why that screenshot has been held
back through several rounds of seeding: purchase requests, expense reports and
check requests were all charged against the budgets and the panel still said
"No transactions yet", because nothing could have changed it.

Verified 2026-08-09 by counting non-test call sites for each store action and
service method, and by reading the render bodies.

## Two Migrations Claimed 20260808_0002 — and What It Left Behind (2026-08-09)

Two pull requests merged migrations numbered `20260808_0002`: "drop the
shift_equipment_checks apparatus FK" and "add owns_requirement to
program_requirements". Each was green against the main it branched from — the
collision only existed once both had landed — so nothing caught it until a
clean checkout of main failed three migration-chain tests. Resolved by
renumbering the first to `20260808_0003`; `0002` kept its number because live
databases had already applied it.

**A database can be recorded as having run a migration it never saw.** The same
pair collided at `20260808_0001` a day earlier ("drop the apparatus FK" before
its first renumber, and "add officer validation trail to skills tests"). Any
database that applied the former has `20260808_0001` in `alembic_version` and
will never run the latter — so `skill_tests.validated_at` is missing while
Alembic reports the chain as up to date. It surfaces as a query error, not a
migration error:

    (1054, "Unknown column 'skill_tests.validated_at' in 'SELECT'")

Repair, for a database in that state — run the skipped revision on its own,
then re-mark the chain:

```bash
cd backend
python -m alembic stamp 20260807_0009      # back to the shared parent
python -m alembic upgrade 20260808_0001    # idempotent: adds only what is missing
python -m alembic stamp head               # 0002/0003 were already applied
```

`upgrade head` is **not** the shortcut here: `20260808_0002` uses a bare
`add_column` and fails on a database that already has the column.

**Why the failure is quiet.** `main.py`'s startup fallback resolves a forked
head by renaming one migration file to `.stale`. Startup then logs "Migrations
completed successfully" while one migration has silently been taken out of the
chain. That fallback buys a working dev environment at the cost of hiding the
fork — worth knowing before trusting a green startup log.

**The general rule.** A revision id is a shared namespace across every open
branch, and a date-stamped sequence collides the moment two people work on the
same day. Before merging a migration, re-check `revision` against the current
main rather than against your merge-base.

## Prospective Members — Two Bulk-Action Bars at Once (2026-08-09)

Selecting applicants in the pipeline **table** view renders two selection bars
stacked on top of each other, both reading "N selected":

| Bar   | Rendered by                          | Actions                               |
| ----- | ------------------------------------ | ------------------------------------- |
| upper | `ProspectiveMembersPage` (line ~646) | Print Badges, Advance All, Reject All |
| lower | `PipelineTable` (line ~188)          | Advance, Hold, Reject                 |

`PipelineTable` supports both controlled and uncontrolled selection —
`selected = externalSelected ?? internalSelected` — but it renders its own bar
whenever anything is selected, including when the parent is driving the
selection and has already drawn one. The page passes `selectedApplicants` and
`onToggleSelect`, so both fire.

The overlap is not clean, which is why this is recorded rather than fixed here:
"Advance All" and "Advance" do the same thing on the same selection, **Hold**
exists only on the lower bar, and **Print Badges** only on the upper. Suppressing
either one silently drops an action, so which bar survives — or what a merged
bar should offer — is a product call.

The guide screenshot (`15-11-table-bulk-actions.png`) shows both bars, because
that is what the page does today.

## Skills Testing — No Summary Dashboard (2026-08-09)

`docs/training/09-skills-testing.md` pictures a **Skills Testing Summary
dashboard** with "six stat cards in a 3x2 grid: Total Templates, Published,
…", and elsewhere a **Pending Validation** card on that same dashboard.

There is no such page. Skills testing lives under
`/training/admin?page=skills-testing` with two tabs, Templates and Test
Records. The Templates tab carries **four** stat cards — Templates, Tests This
Month, Pass Rate, Avg Score — and no pending-validation figure anywhere.

Three placeholders in that guide describe this dashboard and are left open.
The validation workflow itself shipped (2026-08-08); what is missing is the
officer-facing surface that would show how much of it is waiting.

## Integrations — No Calendar-Feed Configuration Screen (2026-08-09)

`docs/training/16-integrations.md` pictures an **iCalendar configuration**
listing "generated feed URLs for different filters (All Events, Training Only,
My Shifts) with copy buttons", and again later as "three generated feed URLs
with Copy buttons".

What exists is one feed and one place to get it: `CalendarSubscribeCard` on the
My Shifts tab, which reveals a single personal shifts URL. The `ical` entry in
the integrations catalogue is a card with a description and no configuration
screen behind it — searching `frontend/src` for a feed URL turns up only that
one card. The backend serves exactly one feed route,
`/api/public/v1/calendar/{token}.ics`, scoped to the member's own shifts.

So the filtered feeds the guide describes — all events, training only — do not
exist on either side. Both placeholders are left open. The guide-03 subscribe
card is also deliberately not captured because expanding it exposes the
calendar feed's bearer credential.

Most of the rest of guide 16 needs a live third-party account (a Salesforce
sync status, a connected Cal.com bookings panel, a warning state carrying a
real provider error) and is not capturable from a demo database at all. The
connect _dialogs_ are ordinary forms and have been captured.

## Training — The Competency Heat-Map Nobody Built (2026-08-09)

`docs/training/02-training.md` described **Training Admin > Advanced >
Competency** as "a department-wide readiness heat-map": members down the rows,
competency areas across the columns, colour-coded cells, and a filter bar for
station, rank or category. It even gave the colour key — dark green for expert
through red for a gap.

`CompetencySection` in `frontend/src/pages/TrainingEnhancementsTab.tsx` renders
a card list of matrix _definitions_: one card per position, showing the name,
the position, and a count of skill requirements. No members, no cells, no
filter bar. The legend is the Dreyfus scale (novice → expert), which is a
different set of five labels from the ones the guide listed.

The per-member data does exist — `GET /training/competency/me` and
`/training/competency/members/{id}` both return a member's level per skill,
with score history and a next-evaluation date — so the heat-map is a screen
away, not a schema away. It simply has no screen. The placeholder is left open
and the prose now describes the definitions list that shipped.

## Training — Two Advanced Tabs Are Read-Only (2026-08-09)

The guide told officers to click **Submit Evaluation** on the Effectiveness tab.
There is no such button: `EffectivenessSection` renders the four Kirkpatrick
summary cards and a recent-evaluations table, and nothing else. Evaluations
reach the system only through `POST /training/effectiveness/evaluations`.

Same shape, smaller gap, on Instructors: the qualification a record is tied to
_is_ stored (`course_id`), and the response now carries `course_name`, but the
roster table has no column for it. Its **Status** column reports `verified`,
not expiry, so a lapsed qualification reads "Pending" rather than "Expired".

Both are documented in place rather than left to surprise someone.

## Training — ISO Readiness Scored Every Department at Zero (2026-08-09)

Fixed 2026-08-09; recorded because the failure was invisible rather than loud.

`ISO_CATEGORIES` in `compliance_officer_service.py` matched a training record
to an ISO/FSRS category by testing `record.training_type` against lists like
`["fire_training", "structural_fire", "live_fire", …]`. None of those strings
are members of the `TrainingType` enum, which has exactly six values —
`certification`, `continuing_education`, `skills_practice`, `orientation`,
`refresher`, `specialty`. The test could never be true, for any record, in any
organization. Every category reported 0 hours, 0% compliance, and the overall
readiness gauge read 0% with an FSRS estimate of 0 of 9 points.

Nothing raised: the endpoint returned 200 with a well-formed, entirely zero
payload, which is indistinguishable from a department that has genuinely
recorded no training.

Records are now matched on the training **category** — where departments
actually record fire vs EMS vs hazmat — falling back to the categories on the
record's course, since a record created from a course usually leaves
`category_id` empty. The old `training_type` lists are kept as a second path
for records imported from an external provider's vocabulary.

Two smaller contract bugs went with it: the readiness payload never sent
`total_department_hours`, which the card prints, so every card read "Dept
Total: hrs" with the number missing; and the annual report's
`record_completeness` block omitted `field_details` and `nfpa_1401_compliant`,
which the dashboard reads without guarding — `field_details.map` threw and took
the whole Annual Report tab into the ErrorBoundary.

## Admin — No Scheduled Tasks Page (2026-08-09)

`docs/training/08-admin-reports.md` told administrators to "Navigate to
**Administration > Scheduled Tasks** to view and manage automated tasks", and
listed the columns they would find there: last run, next run, frequency, and an
enabled toggle.

There is no such page. Searching `frontend/src` for "scheduled task" in any
casing returns nothing. What exists is `app/api/v1/endpoints/scheduled.py`:
`GET /scheduled/tasks` lists each task with its recommended cron schedule, and
`POST /scheduled/run-task` triggers one — the latter restricted to a platform
System Owner (`system.run_tasks`) because each task iterates every
organization.

The gap is wider than a missing screen. The API reports the _schedule_ only;
last-run and next-run times and a per-task enabled flag are not persisted
anywhere, so the page the guide describes needs backend work before it needs a
frontend. The placeholder is left open and the prose now says where the tasks
actually live.

## Inventory — Three List Endpoints That Under-Report (2026-08-09)

All fixed 2026-08-09, grouped because they are one mistake made three times: a
list response omits a field the card reads, and the card renders the absence as
a plausible zero rather than an error.

- **Equipment kits.** `EquipmentKitResponse` carries no line items — only the
  detail response does — and `get_equipment_kits` did not eager-load them
  either. The card counts `kit.line_items.length`, so every kit read "0 items",
  including one holding four. Now sends `item_count`.
- **ISO readiness.** The payload never sent `total_department_hours`, which the
  category card prints, so each read "Dept Total: hrs" with the number missing.
- **Annual compliance report.** `record_completeness` omitted `field_details`,
  which the dashboard maps over without guarding — that one did throw, and took
  the whole tab into the ErrorBoundary.

Worth remembering when adding a field to a card: check whether the _list_
endpoint sends it, not just the detail one. Two of these three failed silently
for as long as they existed.

## Events & Elections — Four Guide Sections With No Screen (2026-08-10)

`docs/training/04-events-meetings.md` describes four features that have no
frontend. Each is written in the present tense ("The election detail page now
shows…"), so nothing in the guide signals they are aspirational.

- **Attendance Dashboard.** A table of members with attendance percentage,
  meetings on leave, and voting eligibility. The calculation is real and
  `GET /meetings/attendance/dashboard` serves the data — `meetingsServices.ts`
  even has a `getAttendanceDashboard` client method for it — but nothing in
  `frontend/src` calls that method. The endpoint has no consumer.
- **Send Report Email.** A button on the election detail page to mail
  round-by-round results. The string appears nowhere in the frontend.
- **Upcoming Business Meetings.** A section on the election detail page listing
  meetings the election can be linked to, with **Link to Election** buttons.
  Described three separate times in the guide; neither string exists.

The election↔meeting link those last two describe _is_ real: an election
carries `meeting_id` and `event_id`, and an event shows a **Linked Elections**
card. What is missing is only the election-side UI for setting it — it is set
at creation or through the API.

Related bug found while confirming this, fixed 2026-08-10: `event_id` could
not be set through `PATCH /elections/{id}` at all. See the update-allowlist
note below.

## Elections — An Update Allowlist That Dropped Five Fields (2026-08-10)

Fixed 2026-08-10. `update_election` applies only fields named in
`ALLOWED_ELECTION_UPDATE_FIELDS`, so a widened Pydantic schema can never reach
a read-only column like `organization_id`. Sound guard, silent failure mode: a
field the schema accepts but the list omits is dropped without complaint, and
the endpoint still answers 200 with the old value.

`event_id` was in that state — and worse, the handler validated it was in-org
(the XC-1 cross-tenant check) immediately before discarding it. Linking an
election to an event was impossible and looked like it had worked.

A test asserting the allowlist covers every field `ElectionUpdate` accepts
turned up four more: `auto_open`, `nomination_deadline`,
`reminder_hours_before_close`, `tie_policy`. Two drive scheduled behaviour, so
an election configured to open itself could not be told to stop.

`tests/test_election_update_allowlist.py` now checks the invariant, since the
pattern cannot report its own omissions.

## Audit Log — The Search Box Needs Apply, The Dropdowns Do Not (2026-08-10)

Two filters on the same bar behave differently. The severity and category
selects write straight to the query state and refetch on change; the search
input holds a separate draft that only reaches the query when **Apply** is
pressed. Typing a term and reading the table gives the unfiltered list under a
filled-in search box, with no cue that the term has not been applied.

Not changed — an unconditionally live search on a table this size is a fetch
per keystroke, and the Apply button is a deliberate answer to that. Recorded
because it reads as a bug from the outside, and because it caught this repo's
own screenshot: the first capture of the shift-report filter showed
"shift_report" in the box above 1,865 unfiltered rows. Worth revisiting as a
debounce, or as disabling Apply until the draft differs.

## Prospects — `referral_source` Is Stored But Never Shown (2026-08-10)

A guest sign-in stamps the prospect's `referral_source` with
`"Attended: <event name>"`, and the detail endpoint returns it. No screen
displays it: the applicant detail drawer renders contact details, membership
type, current stage, linked events, progress and stage history, and the
`referral_source` entry in its `FORM_FIELD_LABELS` map applies to _form
submission_ answers, not to the prospect's own column. The list endpoint omits
the field entirely.

The provenance is not lost — the drawer's Linked Events panel names the event
the guest walked in from, which is the same fact by a different route — so this
is recorded rather than fixed. The training guide claimed the drawer showed the
referral source; corrected 2026-08-10 to point at Linked Events, and to say the
stamped text is reachable only through an export or the API.

## Events — Guest Check-In Switched Itself Off On Every Read (2026-08-10)

Fixed 2026-08-10. `_build_event_response` names each field it passes rather
than validating from the ORM row, and it never named `allow_guest_check_in` or
`guest_check_in_creates_prospect`. Pydantic filled the schema default, which
for both is `False`.

The column held `1`; every read said `false`. Worse than a display bug, because
the edit form loads from that same endpoint: opening an event with guest
check-in on and saving _any_ other change wrote the false back and turned the
feature off. Nothing reported it — the write succeeded, the response was 200,
and the checkbox had simply been unticked all along.

`recurrence_exceptions` and `rolling_recurrence` were omitted the same way and
are now passed too.

`tests/test_event_response_completeness.py` asserts the builder names every
field `EventResponse` declares, minus the per-request aggregates callers supply
through `**extra_fields`. A per-field test would not have helped: the next
field added to the schema has exactly this failure mode.

## Events — The Event Form Prefers Free Text Over A Linked Location (2026-08-10)

`EventForm` decides its location mode with `initialData?.location ? 'other' :
'select'`, so an event carrying both a `location_id` and a free-text `location`
opens in "Other (off-site / enter manually)" — and saving from there clears the
`location_id`, since the "other" branch sends it as `undefined`.

The app's own flow never produces that combination: picking a location sets the
id and blanks the string. Only an API client that sets both walks into it,
which is how the demo seeder found it. Left as-is rather than reordering the
precedence, since a saved free-text location is a real signal for genuinely
off-site events; the seeder now sets `location_id` alone, matching what the
form itself writes.

## Equipment Checks — A Checklist Only Reaches Its Own Apparatus Type (2026-08-10)

`_resolve_templates` matches a template to a shift by `apparatus_id` or by
`apparatus_type`, and by nothing else. There is no "applies to every apparatus"
form, so a department that writes one engine checklist has _no_ checklist on its
ladder, brush and rescue shifts — those shifts return an empty checklist list
rather than an unmet one.

That silence propagates. The pre-finalization checklist renders its equipment
row — the green tick or the red cross — only when the shift has end-of-shift
checks to report on, so on a ladder shift the modal says nothing about
equipment at all, and an officer sees a checklist that looks complete because
the section simply is not there. The compliance report has the same blind spot:
apparatus with no matching template are absent, not failing.

Not changed here, because "one template covers everything" is a real modelling
decision rather than a bug fix — a department may well want per-type lists. The
gap worth closing is the reporting one: a shift with no applicable template
should say so, rather than omit the row.

The demo seeder now writes a close-out template per apparatus type it
encounters, which is why the finalization screenshots have an equipment row at
all.

## Screenshot Harness — A Stale Line Number Filled Its Neighbour (2026-08-10)

Fixed 2026-08-10. `apply_placeholders.py` locates a placeholder by line number
with the shot's `anchor` as a fallback. The hint was accepted whenever the
line held _any_ placeholder marker — the anchor was never consulted to confirm
it was the right one:

```python
index = shot["line"] - 1
if 0 <= index < len(lines) and MARKER.match(lines[index]):
    return index          # ...but is it *this* shot's placeholder?
```

Editing prose above a placeholder pushes it down, and the stale number then
lands on whichever placeholder moved into that slot. In this repository the
review-modal shot was written into the Flagged section, under a caption about
re-review buttons, while the modal's own placeholder stayed open. The run
reported six successful replacements and named none of them as suspect — the
failure is only visible by reading the rendered guide.

The hint is now believed only when the anchor is also present in that block;
otherwise it falls through to the anchor search that was already there.
`tests/test_apply_placeholders.py` pins the rule, including the two cases that
must still work: an anchorless shot trusting its hint, and an anchor matching
two placeholders placing neither.

## Shift Reports — An Officer's Call Count Was Overwritten (2026-08-10)

Fixed 2026-08-10. `create_report` auto-populates from the linked shift, and for
the call count it did so unconditionally:

```python
calls_responded = actual_calls          # whatever the officer typed, gone
data_sources["calls_responded"] = "shift_calls"
```

The hours beside it were guarded (`if actual_hours:`); the calls were not. The
report form has an editable call-count field, badged `(auto)` and pre-filled
from the same records, and the guide tells officers they may correct it before
submitting. They could type into it, and the value never survived the request —
answered 201, stored the derived number.

It matters when the two disagree, which is exactly when someone edits: a run
logged against the wrong crew, or a member who rode in on one call and not
another. The fix honours a supplied value and falls back to the derived one
when the field is omitted (`None`, not `0` — a caller may legitimately mean
zero).

The batch path is deliberately unchanged. Its form collects one call count for
the _shift_, not per crew member, so handing that figure to each report would
credit every rider with every run; it now passes `None` explicitly and keeps
deriving per trainee, which is what it has always stored.

## Shift Reports — Auto-Progressed Requirements Are Not Shown (2026-08-10)

Filing a report credits hours, shifts and calls toward matching pipeline
requirements, and the report records which ones in `requirements_progressed`.
Nothing displays it. The column is not in `ShiftCompletionReportResponse`, so
it never reaches the browser, and no view — card, expanded body, review modal —
has a place for it.

The training guide claimed the reports list carried "a status indicator showing
which requirements were auto-progressed"; corrected 2026-08-10 to say where the
credit can actually be seen, which is the member's enrolment progress.

## Shift Reports — Flagged Reports Are Unreachable With Review Off (2026-08-10)

The Review Queue and Flagged buttons render only while the organization has
`report_review_required` on. The review endpoint does not consult that flag, so
a report can be flagged and then become invisible the moment an administrator
switches review off — it is not in the queue, not in Flagged, and Filed by Me
shows it with a badge but no way to act on it.

No data is lost and turning review back on restores the views, so this is
recorded rather than fixed: the alternative is showing a Flagged view to
departments that never flag anything. Worth revisiting as "show the Flagged
view whenever a flagged report exists".

## Inventory — Scanning Has No Screen Of Its Own (2026-08-10)

`inventoryService.lookupByCode` (`GET /inventory/lookup`) has exactly one
consumer: `InventoryScanModal`, which is opened with `mode="checkout"` or
`mode="return"` already decided and a member already chosen. There is no
"scan an item, then pick what to do with it" screen anywhere — no Scan button
on `/inventory`, no route, no component. `docs/training/05-inventory.md`
described one, including quick-action buttons (Check Out, Return, View
Details) that exist nowhere; the section now documents the real flow.

Two smaller mismatches in the same guide, corrected rather than recorded:
there is no **Batch Checkout** or **Batch Return** entry in the admin menu
(both start from a member's row on **Members Equipment**), and the item-detail
assign path takes a member and nothing else — the "assignment date, condition
selector, notes field" the guide listed are not on it.

The scan placeholder is left open for a second reason as well: the capture
harness runs headless with no camera, so the viewfinder cannot be photographed
by the automation even once a screen exists to photograph.

## Skills Testing — A Criterion Type The Scorer Could Not Read (2026-08-10)

The criterion `type` was a free string up to 50 characters. The scorer and the
examiner screen each recognise exactly five values; anything else fell through
to a fallback branch that rendered plausibly and carried no points. The demo
seeder had been writing `"checkbox"` for months. Nothing complained: templates
saved, tests ran, steps were marked — and every scorecard reported
"No percentage could be calculated" with all three sections marked as not
counting, on a sheet that looked fully scored.

Fixed by validating `type` against the known set on the way in, with an error
that names the accepted values. Two things this does **not** cover:

- **Rows already stored** are unaffected — validation runs on input only. The
  seeder repairs its own (`_repair_criterion_types`); a real deployment that
  authored criteria through the API rather than the builder would need a
  migration, and none is written because the builder has only ever offered the
  five.
- **A template of pure pass/fail steps still has no point pool**, and that is
  deliberate — turning `score_pass_fail_criteria` on by default would change
  the meaning of every percentage already on record. Such a sheet scores by
  section average and says so.

## Training — Nothing Creates a Skill Evaluation (2026-08-10)

`SkillEvaluation` is read in two places and written in none.

`GET /training/module-config/skill-names` feeds the linkage indicator on
**Scheduling → Settings → Shift Reports**, which tags each apparatus-type skill
green when its name matches a skill evaluation and amber when it does not.
`ShiftCompletionService._resolve_skill_evaluations` uses the same table to turn
a 1–5 score on a shift report into a `SkillCheckoff` and, through that, into
competency history and pipeline progress.

There is no create endpoint, no update endpoint and no screen. Searching the
backend for a constructor finds only the model definition itself. The only path
by which a department can acquire a row is `org_template_registry`, which copies
the table when an organization is provisioned from a department template — and
that merely moves rows that already exist somewhere.

The consequences are quiet rather than loud, which is why this went unnoticed:

- Every skill tag in the settings panel reads amber, on every department. The
  legend explaining the two colours is gated on `skillEvalNames.size > 0`, so it
  never renders either — the amber is not even labelled.
- Skill scores on shift reports are stored on the report and go no further. No
  checkoff is created, no competency score is recorded, and a pipeline
  requirement waiting on that skill is never progressed. The officer entering
  the score gets no indication that it stopped there.
- `POST /training/skill-evaluations/{id}/check-evaluator`, which decides who may
  sign a skill off, can only ever 404.

Recorded rather than fixed: the missing piece is a skills-definition CRUD screen
with an evaluator-permission editor, which is a feature rather than a repair.
The screenshot placeholder for the linkage tags is held back until there is a
mixed green/amber state to picture — a column of amber would document the gap
as though it were the design — and `docs/training/03-scheduling.md` now says
plainly that every tag reads amber and why.

Note also that the matching is **case-insensitive** on both sides
(`eval_by_lower` in the service, `item.toLowerCase()` in the panel). The guide
previously described it as case-sensitive; corrected.

## Equipment Checks — A Member Could Not Open One (2026-08-11)

EC-7 widened `GET /shifts/{id}/checklists` to accept `equipment_check.view` OR
`equipment_check.submit`, on the explicit grounds that a member holds `.submit`
and "the check-performing flow keeps working". Its siblings were not widened,
and the compartments and items on a template _are_ the check form.

So the member's own page listed every checklist due to them — rig, timing,
date, "0/9 items", **Start Check** — and every route from that list into the
form returned 403. `MyChecklistsPage` calls `GET /templates/{id}` to open a due
checklist, to start an ad-hoc one and to resume a part-finished one, and
`GET /templates` to populate its "Start a Check" picker. All four were
`equipment_check.view` only.

Fixed by accepting either permission on both reads, matching the checklists
endpoint and for the same stated reason. The writes are deliberately untouched
— editing a template stays a manage right — and the test guards that boundary
as well as the widening.

Found while trying to seed a completed and a part-answered checklist for the
demo member: the seeder acts as the member for exactly the reason the product
does, and hit the same 403.

## Scheduling — The Hold-Over Roster Needs Platoons (2026-08-11)

`docs/training/03-scheduling.md` described the hold-over roster as appearing
"when a shift has a gap (member on leave or open position)". The panel is
gated on `platoonsEnabled && shift.platoon && platoonRoster.length > 0` — it is
the _platoon_ roster, and a department that does not run platoons never sees it
however short a shift is. The guide now says so, and points at the crew board's
own Assign controls as the way to fill a gap otherwise.

The screenshot is held back rather than fabricated: picturing it needs platoons
enabled and shifts generated from a platoon pattern, neither of which the demo
department runs, and switching platoons on would put a platoon badge across
every calendar card in the guide's other scheduling screenshots.

## Screenshot Seeding — The Member's Own Checklists (2026-08-11)

Deferred. My Equipment Checklists is scoped to the signed-in member's own
shifts, and the checks the seeder files as the administrator do not appear on
it, so every row reads "Not Started". The page documented as showing a finished
check beside a resumable one can picture neither, and the Resume control and its
progress bar cannot be photographed.

A step to file them as the member was written and removed after two attempts: it
ran clean and filed nothing, and a seeder step that silently does nothing is
worse than no step. It uncovered the 403 recorded above, which was the more
valuable half. Worth another attempt with a fresh idea about which of the
member's shifts carry an unclaimed checklist — the first pass drove it from
`/scheduling/my-shifts`, whose result did not line up with what the page lists.

The same scoping blocks the **incomplete-check warning** ("Submit an incomplete
check? — _N_ of _M_ items have not been checked"), which is raised from the
check form before anything is written and would otherwise be a
straightforward capture. Two attempts to reach the form failed: the checklist
rows are empty for the administrator the harness signs in as, and driving it
through **Start a Check** did not get as far as the template picker either.
Reaching it needs the seeding above, or a member session whose own shift carries
an unstarted checklist.

## Screenshot Seeding — Apparatus Inventory Was Empty For Every Truck (2026-08-11, resolved)

Resolved the same day by `seed_supply_tracking`, which stocks **M-3** with a
catalog of dated consumables, a checklist bound to that apparatus by id, and
deployed-lot rows saying what is aboard. Recorded here because the diagnosis
still applies to any department whose inventory page is bare:

`GET /equipment-checks/apparatus/{id}/inventory` joins template compartments to
an apparatus by `EquipmentCheckTemplate.apparatus_id`. A checklist bound by
`apparatus_type` — what a template that applies to every engine looks like —
supplies checklists for shifts but stocks no particular truck, and a rig with
only type-bound templates shows an empty inventory. That is documented in
`03-scheduling.md` as a callout rather than left for the reader to discover.

Two things the seeding turned up, both now fixed:

- A position nobody has counted reports its **target** as the units aboard — a
  NULL count means "not counted since this was defined", not "empty" — and the
  first swap materializes that assumption as a real undated lot row before
  adding the swapped units on top. A seeder that fills a fresh position without
  counting it to zero first leaves the truck holding roughly double its par
  behind a phantom lot with no number and no date.
- The lot number a position reported came from `CheckTemplateItem.lot_number`,
  the scalar left over from the last swap, while the date beside it came from
  the soonest-expiring deployed lot. On a position carrying several lots those
  are different lots, and the pair reads as one false fact about a specific lot.
  Both now come from the same row (`_soonest_lot_number`).

An id-bound template also attaches to that apparatus's **shifts**, because
`_resolve_templates` matches by `apparatus_id` **or** `apparatus_type`. M-3
carries no seeded shift checklists, so nothing already published moved; a future
template bound to a rig that does needs the neighbouring equipment-check shots
re-captured and diffed before applying.

## Compliance Reports — A "Monthly" Report Contains The Whole Year (2026-08-11)

Open decision, and user-visible.

`ComplianceConfigService.generate_report` accepts `report_type="monthly"` with a
month, builds the right period label ("July 2026"), stores `period_month`, and
then calls `AnnualComplianceReportService.generate_annual_report(org, year=year)`
— the whole year. The comment says "If monthly, filter/annotate the data" but
only the annotation happens: a `report_period` block is added and nothing is
filtered.

The consequences are silent:

- A July report and an October report for the same year hold **identical
  figures**, differing only in their label.
- The stored payload's own `report_type` still reads `annual_compliance`, which
  is the honest name for what it is.
- The summary an officer reads on the Report History row — compliance
  percentage, compliant members, total training hours — is the year's, under a
  month's heading.

Fixing it means giving the annual report builder a date range rather than a
year, and deciding what "compliant in July" should mean for a requirement whose
frequency is annual — a member with an annual requirement met in March is
compliant for the year but did nothing in July. That is a product question, not
a refactor, which is why this is recorded rather than fixed here.

Until it is decided, treat monthly and annual as the same report. The guide says
so.
`backend/tests/test_compliance_report_period.py` pins the current behaviour so
whichever answer is chosen changes something deliberate.

## Email Templates — A Chosen Footer Is Silently Ignored By Most Bodies (2026-08-11)

Open decision, and user-visible.

The footer library gives every template a **Closes with** selector, and the
Footers tab reports "N templates close with this footer". But the closing block
reaches the message as the `{{footer_html}}` variable, and there is no fallback
that appends it: a body without that variable renders **no footer at all**, no
matter what the selector says. Nothing on the screen distinguishes the two —
choosing a footer, saving and sending looks identical either way.

Most shipped bodies do include the variable. Two populations do not:

- **A department that customised a template body** before this release, or since.
- **Any database seeded before the footers release.** Re-seeding never touches a
  template that already exists by name, which is the same drift that left
  `check_type: "presence"` rows behind (see `_repair_seeded_check_types` in
  `scripts/screenshots/seed_demo_data.py`). In the screenshot demo database
  **31 of 35 templates** carry no `{{footer_html}}`, so the Footers tab's count
  of 35 is a count of templates _pointing at_ the footer, not of templates that
  will print it.

The count is not wrong for what it measures — a template really does resolve to
that footer — but read beside a selector that appears to take effect, it
overstates what will happen.

Three options, none obviously right, which is why this is recorded rather than
fixed:

1. **Append the footer when the body omits the variable.** Makes the selector
   always mean something, and changes the output of every customised template
   that deliberately closes its own way.
2. **A repair pass over legacy bodies**, as `check_type` got. Fixes the upgrade
   population without touching deliberate customisation, but has to guess where
   in the body the variable belongs.
3. **Say so in the UI** — mark a template whose body omits `{{footer_html}}`,
   and grey its selector. Smallest change, and leaves the work with the
   administrator.

`backend/tests/test_email_footer_rendering.py` pins the current contract in
either direction, so whichever option is chosen has something deliberate to
change rather than a silent behavioural shift.

## Prospective Members — A Configured Checklist Stage Cannot Be Passed (2026-08-11)

Blocking, for any department that fills in a checklist stage's item list.

`_validate_step_completion` refuses to complete a `CHECKLIST` step until
`action_result.completed_items` holds as many entries as the stage's configured
`items` (when `require_all`, the default). **Nothing in the application ever
writes that key.** `completeStep` sends only notes; there is no partial-progress
endpoint, and no component renders the items as anything tickable. The drawer's
**Checklist Progress** panel reads them back, which is why it says "No checklist
data recorded yet" for every applicant.

So an applicant on a checklist stage with items configured cannot be advanced —
and cannot be skipped either, because **Skip Stage** goes through the same
`complete-step` call and hits the same validator. The only escape is to empty
the stage's item list, or to call the API by hand with the key.

The demo pipeline's Onboarding stage has no items configured, which is why the
board still moves.

Fixing it properly is not a screenshot's worth of work: the items have to be
rendered and ticked somewhere, and the ticks have to persist _before_ the step
is completed — which means either a partial-progress endpoint or teaching
`_validate_step_completion` to count the `action_result` arriving in the same
call. Either is a deliberate change to how a stage is passed, so it belongs in
its own piece of work rather than being slipped in under a documentation pass.

## External Training — The Mapping List Needs a Live Provider (2026-08-11)

Held back. `02-training.md` asked for the Vector Solutions category mapping
list. Category mappings are **discovered by a sync against the provider's API**
— the endpoints expose only GET and PATCH, so there is no supported way to bring
a mapping into being without a real Vector Solutions account answering the sync.

Seeding one would mean writing rows straight into the database and presenting
invented external category names as a real integration's output, which is a
worse outcome than no screenshot. The section now describes the list instead,
which is accurate as far as it goes.

The visit was not wasted: an unmapped category showed a **Map Category** button
with no handler behind it. It is a category dropdown now, wired to the PATCH
endpoint that had been there all along, and covered by
`ExternalTrainingPage.test.tsx`.

## Training — Program Import Has No Preview (2026-08-11)

Not implemented. The guide described a preview of what an imported package would
create, with a **Confirm Import** button. Choosing a file imports it there and
then; the only checkpoint is the structural validation that rejects a file with
no `program` key.

A preview would mean a dry-run mode on `import_program_from_json` returning a
summary rather than committing — worth doing, and not something to bolt onto a
documentation pass. The guide now says plainly that there is no confirmation
step.

## Training — No Warning When a Session Is Ahead of Your Phase (2026-08-11)

Not implemented. `02-training.md` described a dialog shown to a member who
RSVPs to a session tied to a phase they have not reached — "the session belongs
to a later phase", with **Proceed anyway** and **Cancel** — and asked for a
screenshot of it.

Nothing of the sort exists. `TrainingSession.phase_id` is stored, echoed back by
the read endpoints and used to credit attendance, and that is the whole of it:
no service consults it when a member RSVPs or checks in, and no component
renders a warning. Searching the codebase for the wording, and reading the
session service and its endpoints, turns up nothing on either side.

The guide now says what actually happens — you may attend a session for any
phase, and the hours are recorded — so the documentation is no longer wrong. The
feature itself is a real one worth having, but it is a change to the RSVP path
across the API and the UI, not a screenshot, and building it here would have
been a feature shipped under cover of a documentation task.

## Scheduling — The Compliance Report Counts Member-Requirement Pairs (2026-08-10)

`SchedulingReportsPage.tsx` computes the **Total Members** card as
`complianceData.reduce((sum, r) => sum + r.total_members, 0)` — a sum of
**per-requirement cohorts**. A member counted under three requirements counts
three times, so the demo department's 22 members render as "Total Members 66".
The Compliant and Non-Compliant cards sum the same way: the values are
member-requirement pairs and the labels claim members.

**Not fixed.** The payload carries no distinct-member count, so correcting it
means either relabelling the three cards or adding a field to the API — a
product decision rather than a display one. The captured screenshot
(`03-14`) accurately shows current behaviour; this row exists so the guide does
not silently endorse the number.

## Equipment Checks — Two Legacy Columns Still Written, No Longer Authoritative (2026-08-10)

`check_template_items.lot_number` and `.expiration_date` predate
`check_item_deployed_lots`. Since 2026-08-10 a position's expiration is the
**earliest date across its deployed lots** and its count is their **sum**, and
every reader — the supply worklist, the apparatus view, the check form, the
item-to-apparatus lookup — uses those derivations. The two columns are still
written on the single-lot paths and still carry the legacy value the data
migration was seeded from.

**Accepted for now.** Dropping them means auditing every write path in one
change, and they are harmless while nothing reads them for a decision. The risk
is the obvious one: a future reader that reaches for
`item.expiration_date` because it is right there will get whichever lot was
restocked last, which is exactly the bug the table was added to remove. If you
are adding a reader, take the derived value.

## Frontend — ESLint And `tsc` Run Different TypeScript Versions (2026-08-10)

`typescript-eslint` is held at `^8.65.0` rather than the dependabot group's
`^8.66.0`. Bumping it forces npm to re-resolve the package, and **no
`typescript-eslint` release accepts the TypeScript 7.0.2 this repo pins** —
every version caps its peer at `<6.1.0`. The tree resolves today only because
the lockfile carries a second TypeScript (5.9.3) at the root for the linter's
own use.

So the linter type-checks against 5.9.3 while `tsc --noEmit` runs 7.0.2. In
practice that means a type-aware lint rule can disagree with the build, in
either direction.

Neither an explicit root `typescript` pin (still refused by npm) nor
`--legacy-peer-deps` (drops the root copy and hands the linter an unsupported
TypeScript) fixes it honestly. Pulling that thread needs its own change.

Two related facts worth carrying:

- **The lockfile must be regenerated with npm 11** — the version
  `frontend/package.json` requires and both Dockerfile stages install. npm 10
  and npm 11 hoist this tree differently, so a lock built by npm 10 installs a
  different tree under the npm 11 that actually runs in CI and in the image.
- **npm keeps a per-workspace copy of each declared range inside the lock and
  trusts it over the manifest.** When that copy goes stale, `npm ls` reports the
  tree as invalid while `npm ci` still exits 0 — a silent refusal to re-resolve.

## Skills Testing — Offline Support (2026-08-07)

Autosave shipped (2026-08-08) and covers the common data-loss case — a locked
phone or a killed tab with signal still up. Conducting an evaluation with **no
connectivity at all** is a separate, larger piece of work, scoped in
[SKILLS_TESTING_OFFLINE_PLAN.md](./SKILLS_TESTING_OFFLINE_PLAN.md). Three
findings shape it, and two of them need an owner rather than an engineer:

| Item                                                               | Status                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The read path blocks before the write path does**                | Open (scoped, ~4–6 days)    | `/api/*` is `NetworkOnly` in the service worker — deliberately, to keep PHI-adjacent responses out of the SW cache — and `GET /tests/{id}` is the only source of the template structure and prior results. An examiner who loses signal _before_ opening the test has nothing to write into, so queueing writes alone yields a feature that works only when the network fails at exactly the right moment. The `template_snapshot` work already pays for most of this: the client now holds the full structure locally. |
| **The generic offline queue cannot carry a skills test**           | Open (design, not wire-up)  | The queue flushes POST only, while skills tests need repeated PUTs; there is no coalescing, so an hour offline enqueues ~120 stale saves for one test; and nothing orders `POST /complete` after the final PUT, which matters because scoring feeds training-pipeline completion. A PUT replayed against an already-completed test 400s, exhausts its retries and is discarded with a message that does not say which evaluation was lost.                                                                              |
| **May logout keep destroying unsynced work on a shared terminal?** | Open (needs owner decision) | FE-6/FE-7 purges the offline queues on logout, which is right for an equipment check and wrong for a scored evaluation.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Must offline support cover a cold start?**                       | Open (needs owner decision) | This decides whether test ids stay server-generated or become client-minted — a structural choice rather than a later refactor.                                                                                                                                                                                                                                                                                                                                                                                         |

## Process

The review loop (see [review-log.md](./review-log.md)) advances through one area
per tick and appends findings. New "needs owner decision" items should be
mirrored here so they're visible outside the log. The parallel module-by-module
security audit tracks its rotation and per-module findings under
[`docs/module-audit/`](./module-audit/PROGRESS.md); its open decisions are
mirrored in the Multi-Tenant Isolation section above.
