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

| Item                                                               | Status                                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSRF "no csrf cookie → allow" branch**                           | ✅ Resolved (verified 2026-08-07)                | The branch was tightened and this row had not been updated. `verify_csrf_token` now splits the no-cookie case: a request carrying an `access_token` cookie but no `csrf_token` is **rejected** (403 "Missing CSRF token") as anomalous, and only a request with no session cookie at all — unauthenticated, or a Bearer client whose header browsers never auto-send and which is therefore not CSRF-exploitable — is allowed through. `SameSite=Strict` remains the primary defense. (`security_middleware.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Two logins by the same user in the same second fail with a 500** | ✅ Resolved (verified 2026-08-12)                | `create_access_token` includes a random 128-bit `jti`, so otherwise identical logins no longer collide with the unique `sessions.token` index. `test_access_tokens_created_in_same_second_are_unique` now pins both distinct encoded tokens and distinct decoded IDs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`is_rate_limited` window write-before-check**                    | ✅ Resolved (verified 2026-08-12)                | The implementation cleans the window, checks `len(requests) >= max_requests`, rejects and locks the first request over the allowance, and records only allowed requests afterward. The existing `test_exceeding_limit_triggers_lockout` pins five allowed requests and rejection of the sixth, so there is no write-before-check or off-by-one defect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **OAuth login does not check organization `active`**               | ✅ Resolved (2026-08-25, security review AUTH-1) | `_link_existing_user` (`oauth_service.py`) now filters the org lookup on `Organization.active.is_(True)` and fails closed (`"no_account"`) when no active org is found, mirroring the password-login path exactly instead of dropping the org filter when the lookup comes back empty. Both auth paths now agree. Still true of both paths: deactivating an org does not revoke existing sessions — they simply expire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **`REFRESH_ROTATION_GRACE_SECONDS` is inert**                      | Open (LOW — cleanup, 2026-08-12)                 | The refresh-token rotation grace window was removed (a stale token now revokes all sessions as replay — see CHANGELOG 2026-08-12), but the setting (`config.py:140`, default `30`, with a now-stale comment) and the `user_sessions.previous_refresh_token` column (`user.py:714`, indexed) remain. Nothing reads either; the column is actively nulled on each rotation. Remove the setting, the column, and its index in a follow-up migration rather than leaving a knob that gates nothing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **`POST /mfa/recovery-codes` is not retry-safe**                   | Open (LOW, 2026-09-01, security review AUTH-7)   | Every call generates an entirely new recovery-code set and overwrites the stored hashes (`mfa_regenerate_recovery_codes`, `auth.py`). A request that is retried after the server already committed — a network retry, a double-click, or (pre-`_verify_and_consume_totp`) the cross-endpoint TOTP replay AUTH-7 fixed — but whose _response_ was never seen by the client leaves the user without the codes they were shown: the stored hashes match a set that was displayed once and then lost in transit. AUTH-7's fix narrows one path into this (a retry reusing the _same_ TOTP code now fails cleanly with "Invalid verification code," since the code is already consumed, rather than silently generating a second set) but does not close the general case — a retry with a _fresh_ code still regenerates and overwrites. `mfa_verify_setup`'s one-time recovery-code display has the identical exposure. The right fix is an idempotency-key mechanism (or a short-lived "re-show last-issued codes" path) applied to every secret-shown-once response in this file, which is a product decision on request semantics, not something to guess at in an auth path. |

## Dependencies

| Item                                       | Status                                    | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI `pip-audit` step**                    | ✅ Blocking, no suppressions (2026-08-12) | `pip-audit -r requirements.txt` runs as a blocking CI check with no `--ignore-vuln` exceptions. The stale Black exceptions (PYSEC-2026-2120/2121) were left behind after Black had already been upgraded to 26.5.1; they are now removed. Earlier pyOpenSSL exceptions disappeared with the unused pysaml2/python-ldap dependencies, and the cryptography exception disappeared after removing unused fastapi-mail and upgrading cryptography to 50.0.0. A newly disclosed advisory must therefore either be fixed or explicitly reviewed in a future change rather than matching a legacy blanket exception.                                                        |
| **cryptography held at 49.x**              | ✅ Resolved (2026-08-12)                  | `PYSEC-2026-3552` / `CVE-2026-69247` required cryptography 50, but the unused `fastapi-mail` package capped cryptography below 50. The application sends mail through its own SMTP/provider services and had no production import of `fastapi_mail`; only a historical test stub mentioned it. Removing that dead dependency allowed `cryptography==50.0.0`. The pip-audit and Trivy suppressions were removed together, so both scanners now enforce the fix.                                                                                                                                                                                                       |
| **No nested `frontend/package-lock.json`** | ✅ Resolved (2026-08-05)                  | The repo is npm **workspaces** (`workspaces: [backend, frontend]`), so the root `package-lock.json` is the only lockfile `npm ci` reads, and `frontend/Dockerfile` copies just `package.json` and runs `npm install`. A stale nested lock had survived since PR #1071, pinning axios 1.13.6 / form-data 4.0.5 / @remix-run/router 1.23.0 while the root lock carried the patched axios 1.19.0 and form-data 4.0.6. Nothing installed from it — but Trivy scans every lockfile it finds, so it reported 12 HIGH advisories against dependency versions the build does not use. Deleted. Do not re-add a per-workspace lockfile; run `npm install` from the repo root. |

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

## ONBOARD-1 — The Setup Wizard's Per-Module Configuration Step Is Inert (2026-08-24)

Fifteen of the setup wizard's module cards point at a per-module
"configure permissions" step. **That step reports success and discards the
answer.** `modulePermissionConfigs` is written to the Zustand store and read
back by nothing: no API client method submits it and no backend field
corresponds to it. `handleSave` sets it, toasts "permissions configured!", and
navigates on.

This is CLAUDE.md **Pitfall #19** — a config switch with a UI and no reader —
in its worst form, because the toast actively asserts that something was saved.
An administrator who uses that step to restrict a module during setup will
believe the restriction is in place.

**The Department Store's route was removed rather than repaired**, and that was
the deliberate call: the previous change had _added_ a `configRoute` for
storefront "for parity with its peers", and parity with a screen that changes
nothing is a liability, not a feature. The store now enables directly.

**Why the rest were not removed with it.** Wiring the step up means deciding
whether it edits the positions saved on the previous step or submits
separately — that is its own change, with its own data model question, and
doing it under a storefront bug fix would have been the wrong place. Removing
all fifteen routes without deciding that question would delete the only place
the intent is expressed.

**Whichever way it is resolved, the toast must go first.** A step that silently
does nothing is recoverable; a step that says it succeeded is not.

**Related, and also open:** three module ids offered by checkbox
(`medical_supplies`, `mobile`, `integrations`) grant permissions that **do not
exist**. That predates this window and is not caused by the module-list
reconciliation above.

## Self-Report Attachments — What Happens to the File (2026-08-23)

A member can attach a certificate (PDF/JPG/PNG, 10 MB) to a self-reported
training. Where the bytes end up, and when they are removed, is deliberate —
and partly still open.

**Where they live.** `/app/uploads/training_attachments/self_reported_submissions/<org_id>/`,
under the _training-record_ attachment root on purpose. Approval copies the
submission's attachment dicts onto the `TrainingRecord` verbatim, and the
record download route confines paths to `TRAINING_ATTACHMENT_DIR`; a sibling
directory would 404 every approved certificate from the member's own training
history. `tests/test_training_submission_drafts_attachments.py` asserts the
nesting.

**When they are removed.** Deleting or withdrawing a submission unlinks its
confined attachment paths along with the row. That is safe only because a
submission is deletable in `draft`, `pending_review` and `revision_requested`
alone — never after approval, which is the one state where a `TrainingRecord`
also references the file. **If that guard is ever widened, the delete must
stop unlinking**, or an approved member's evidence disappears from their
training record.

**What is still open:**

| Item                             | Status         | Detail                                                                                                                                                                                                                                                              |
| -------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No retention policy**          | Open (policy)  | Approved certificates are kept indefinitely, which is what a training record is for, but nothing expires them and nothing sweeps an organization's files if the organization itself is removed. Needs a records-retention decision from the department before code. |
| **No malware scanning**          | Open (feature) | Uploads are validated by magic bytes and confined to a server-generated name, so a double extension cannot survive the trip and nothing is executed server-side. They are not scanned. A file served back to an officer is whatever the member uploaded.            |
| **Voided records keep the file** | By design      | `DELETE /training/records/{id}` marks a record `cancelled` rather than removing it, so the correction stays auditable — and the evidence behind the corrected entry stays with it.                                                                                  |

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

| Item                                                                    | Status                                                      | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`ManualShiftReportPage` local-date pattern**                          | Open (small fix)                                            | Uses `toISOString().split('T')[0]` for "today", which is UTC-shifted near midnight; should use `getTodayLocalDate(tz)`. Tracked here because it lives in a module outside the current review scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Platoon presets cover 3-platoon rotations**                           | Accepted                                                    | Multi-platoon generation offsets are validated for the common 3-platoon presets (24/48, Kelly, 48/96). Departments running non-standard platoon counts should verify the generated tiling. See [SCHEDULING_MODULE.md → Platoon Rotations](./SCHEDULING_MODULE.md#platoon-rotations-added-2026-06-19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **"Shifts completed" has three sources of truth**                       | Open (needs product decision)                               | A `RequirementType.SHIFTS` requirement is counted from `TrainingRecord`s in `training_service._evaluate_requirement`/`check_requirement_progress`, but from actual `ShiftAttendance` in `scheduling_service.get_shift_compliance` — and the pipeline also credits progress via the `RequirementProgress` ledger. The same requirement can therefore show different numbers on different screens. Reconciling changes established compliance numbers, so it needs an owner decision on the authoritative source before it's unified onto one shared helper. Deferred during the 2026-07-16 lifecycle review.                                                                                                                                                                                                                                                                                                              |
| **No formal "active/in-progress" shift state**                          | Accepted                                                    | `ShiftStatus` is `scheduled`/`cancelled` only; a shift's "activeness" is implied by `start_time`/`end_time` vs. now, and `is_finalized` marks closed. The live readiness panel (2026-07-16) covers most of the operational need without a dedicated state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Submitting an equipment check fails when the shift has an apparatus** | ✅ Resolved (2026-08-08)                                    | Fixed by resolving the id at the boundary rather than picking a winner between the two tables — see [The Two Apparatus Tables](#the-two-apparatus-tables-2026-08-08) below. `shifts.apparatus_id` is polymorphic **by design** (the options endpoint serves full-`Apparatus` ids when that module has records and `BasicApparatus` ids otherwise), so neither "make it a real FK" nor "consolidate the tables" was correct; both would have broken one of the two department types. `app/utils/apparatus_ref.py` classifies the id against both tables, and each consumer asks it instead of assuming.                                                                                                                                                                                                                                                                                                                   |
| **Count-only call tracking: no cross-unit attach picker**               | Open (MED, feature gap; the report label is the mitigation) | Since 2026-08-18 a department can record call volume without incident detail. Deduplicating one incident two units rolled on requires `attach_call_ids`, and **nothing in the UI sends it**: `get_closeout_state` serves `attachable_calls` deliberately **empty** (`list_calls_in_window` costs two queries per request and no client consumes the result). So two units closing out independently each report their own call, and the department figure is the sum. The mitigation is honest labelling rather than a silent overcount — `GET /scheduling/reports/call-volume` sets `counts_unit_responses: true` and the renderer says **Unit Responses**, **Avg Responses/Day**, **Peak Responses**, with a footnote. The response field stays on the contract so the picker can land without a schema change. Until it does, an accurate department call count in count-only mode requires an API client. (SCHED-10) |
| **Call-volume report carries no preliminary marker**                    | Open (LOW)                                                  | Unfinalized shifts are labelled preliminary where they surface elsewhere; the call-volume report is not. A docstring claiming otherwise was corrected on 2026-08-19 rather than the marker being added, so the gap is recorded rather than hidden. A period read before the last shift of it is closed out under-reports, with nothing on screen saying so. (SCHED-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **`dispatch` / `derived` call sources have no writer**                  | Accepted (forward compatibility)                            | `CallSource.DISPATCH` / `.DERIVED` and the `uq_org_call_external_ref (organization_id, external_ref)` constraint exist so a CAD integration can be added without a migration — the constraint is what would make a re-sync idempotent. Nothing writes either value today; every row is `manual`. (SCHED-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Call Volume Reporting — Five Gaps Between Payload and Screen (2026-08-19)

Found by a Codex review of PR #1573, verified against the source, and confirmed
as documentation defects rather than code regressions — the docs promised
behaviour the read path does not implement. The guides now describe what is
built; these track the code.

Four of the five share one file and one cause: `_generate_call_volume_from_counts()`
puts more in the payload than `CallVolumeRenderer` reads back out. SCHED-10
through SCHED-12 above cover the _write_ side of count-only tracking; these
cover the _read_ side.

| Item                                                         | Status                          | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CSV export mislabels unit responses as "Total Calls"**     | Open (small fix, highest value) | `getCallVolumeExportData()` in `frontend/src/modules/reports/components/renderers/CallVolumeRenderer.tsx` never reads `counts_unit_responses`; the header is the literal `'Total Calls'` in both modes. The on-screen tiles relabel correctly twelve lines above, so **the export is the one presentation that still misleads** — and it is the artifact that reaches a grant officer or an auditor. The flag already travels with the data; the exporter has to branch on it exactly as the renderer does. (SCHED-13)                                                            |
| **A date range spanning a mode change omits one period**     | Open (needs product decision)   | `ReportsService.get_call_volume_report()` picks its source from the organization's **current** `call_tracking.mode` and applies it to the whole range. Switching to `count_only` hides every earlier detailed-mode figure; switching back hides the `org_calls` era. Nothing warns — the number is just smaller. A correct fix reads each shift under the mode in force when it closed, which means recording that mode per shift; the cheap fix warns when the range predates the current mode's adoption. Not a silent-fix candidate: both change published figures. (SCHED-14) |
| **"Total Calls" in detailed mode is not an incident count**  | Open (needs product decision)   | The detailed branch sums `calls_responded` over `ShiftCompletionReport` rows, which are **per trainee** — so a shift with two enrolled trainees contributes its calls twice, and manually filed reports are added alongside. The count-only branch was built carefully to count one incident once; the branch beside it was never held to that standard. Renaming the figure is the honest short-term move; sourcing it from `shift_calls` is the real one. (SCHED-15)                                                                                                            |
| **`by_apparatus_runs` is computed but never displayed**      | Open (small fix)                | `_generate_call_volume_from_counts()` returns per-apparatus run counts; `CallVolumeRenderer` renders summary cards, type totals and the daily table, and never this. Per-unit runs are therefore **API-only**, despite being the figure an apparatus-replacement case actually needs. (SCHED-16)                                                                                                                                                                                                                                                                                  |
| **The report shows type slugs, not the department's labels** | Open (small fix)                | `by_type` is keyed by slug and the renderer prints the key with underscores replaced, so `mva` displays as "mva" whatever the department named it. Storing the slug is deliberate and correct — it is what stops a rename orphaning history — but the read path never resolves it back through `call_types`. Renaming a type consequently has **no visible effect** on past calls in the report. (SCHED-17)                                                                                                                                                                       |

Two adjacent behaviours are **working as designed** and are documented in the
guides rather than tracked here, because the code is right and the earlier
wording was not:

- **The close-out wizard has no separate total field.** `deriveCallTotal()` sums
  the visible type rows including "Not categorised", so the API's short-tally
  behaviour (a `reported_call_count` larger than the breakdown, remainder stored
  as `unclassified`) is reachable only by a client that sends the two
  separately. An officer who leaves the remainder out records a **smaller
  shift** — the guides previously told them to do exactly that, and now tell
  them to use the Not categorised row.
- **A saved zero and a saved blank are indistinguishable.** Both write no
  `OrgCall` rows, both return `reported_call_count: 0`, and hydration renders
  both as empty. The request layer distinguishes an omitted field from an
  explicit null (`count_provided`), which is what lets a correction clear a
  previous count — but that distinction ends at persistence, so no report can
  tell a quiet tour from an unanswered question. Preserving it needs a stored
  marker.

## Scheduling — the Apparatus Tag Resolver Is Not a "Currently Running" Lookup (2026-08-19)

`get_active_shift_for_apparatus()` backs `/scheduling/checkin?apparatus=<id>`,
the form the documentation recommends for a QR code or NFC tag physically
mounted on a truck — it resolves when used, so one sticker outlives every shift.
What it resolves to is looser than the phrase "whichever shift is running",
which several guides used until this was caught:

- The first query takes the **earliest-starting** non-finalized shift whose
  `shift_date` is today, with **no start/end window check**. On an apparatus
  running a day and a night shift, a tap at 2000 resolves to the 0600 shift.
- **`status == cancelled` is excluded nowhere** in any of the three queries —
  only `is_finalized` is. A cancelled shift dated today wins over the one that
  actually ran.
- A stale shift nobody closed out has the same effect, and keeps having it until
  it is finalized.

The consequence is bounded rather than silent: `ShiftCheckInPage` names the
unit, date and hours before the member confirms, so a wrong resolution is
visible to anyone reading the screen — which is why the guides now tell members
to read it. The resolver is unchanged here because tightening it changes which
shift existing QR **and** tag check-ins land on, which is a behaviour change
wanting its own review. (SCHED-18)

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

| Item                                                                                                          | Status                                                                                                                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Executive-session minutes need a viewer tier below `minutes.manage`?**                                      | Open decision (LOW)                                                                                                           | MM-3 is fixed: plain `minutes.view` holders now see only approved, non-executive minutes; `minutes.manage` sees all. Follow-up open decision: if board members who attend executive sessions but don't hold `minutes.manage` should read executive minutes, a dedicated `minutes.view_executive` tier is needed (seed + roles + frontend). Also: frontend `canManage` uses `meetings.manage` while the backend uses `minutes.manage` — roles managing minutes should hold both. **Update (MM2-1, 2026-08-06):** publishing executive minutes to the shared Meeting Minutes document folder is now blocked, because that folder is readable by the broad `documents.view` audience and so bypassed the restriction. Sharing an executive session with a _restricted_ audience is the same build as the `minutes.view_executive` tier above (a restricted document folder or per-document permission), not a one-click publish.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Elections: approval / multi-vote-per-position is silently broken**                                          | ✅ Resolved                                                                                                                   | The dedup hash now takes a method-aware discriminator (`rank:<n>` for ranked choice, `cand:<id>` for approval/multi-vote; unchanged for single-vote so existing rows keep their protection), app-level duplicate checks are per-candidate/per-rank, and the ballot UI submits approvals/rankings through the reworked atomic bulk endpoint. (ELEC-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Elections: `rollback_election` can enable double-voting**                                                   | ✅ Resolved (guard)                                                                                                           | CLOSED→OPEN rollback is refused for anonymous elections that have votes once the salt is destroyed (the exact unsafe case); rollback with zero votes still works. Preserving the salt was rejected as it would weaken SEC-12. (ELEC-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Elections: voting tokens stored/compared in plaintext**                                                     | ✅ Resolved                                                                                                                   | Tokens are now stored as SHA-256 (migration `20260731_0001` hashes existing rows in place with an idempotent hex guard); the raw token exists only in the emailed ballot link and lookups hash the presented value, so DB read access no longer yields live credentials. In-flight links keep working. (ELEC-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Elections: anonymous ballots de-anonymizable via DB read until close**                                      | ✅ Resolved (with residual)                                                                                                   | Closing an anonymous election now **purges per-vote IP/user-agent** at the same moment the anonymity salt is destroyed (live ballot-stuffing detection is unaffected while voting is open), and forensics no longer returns the full per-IP vote map — only the thresholded `suspicious_ips` set plus `unique_ip_count`/`ip_metadata_purged`. **Residual closed forward (2026-07-29):** voter-action audit events no longer record an IP for anonymous elections; audit rows written before that change keep their IPs permanently because `ip_address` is part of the tamper-evident hash chain and cannot be scrubbed without breaking `verify_integrity`. (ELEC-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Elections: pre-meeting package attachment dropped on Cloudflare email backend**                             | ✅ Resolved                                                                                                                   | The Cloudflare Email Sending API supports base64 attachments (5 MiB total-message cap) — `EmailService` now encodes and sends them on that backend instead of dropping them. Attachments that would exceed the cap are skipped with a warning (the send still succeeds without them).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Documents: summary ignores folder ACL; ACL not hierarchical**                                               | Partially resolved (LOW/design)                                                                                               | **Fixed:** `delete_folder` now walks the folder subtree, collects the backing file paths, and removes them after the cascade delete, so a folder delete no longer orphans (potentially sensitive) uploads on disk — matching the single-document delete. **Still flagged (design/behavior):** `get_summary` aggregates span the whole org past the folder ACL (counts only, no names/content — scoping the stats endpoint is a behavior change); `can_access_folder` checks only the folder's own visibility, not its ancestor chain (apparatus/facility child folders are org-visible under leadership-only parents — confirm intent). (DOC-4/5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Equipment-check: read endpoints bypass `equipment_check.view`; compliance metrics stubbed**                 | Partially resolved (LOW)                                                                                                      | **Fixed:** `complete_incomplete_check` now re-applies the expired/under-min auto-fail rule before computing counts (matching initial submit — EC-10); `create_report` validates a client-supplied `trainee_id` is in-org when no shift links it (EC-6); `get_report` takes an org filter and all callers pass it (EC-9). **Still flagged:** the detail/read endpoints use bare `get_current_user` (org-scoped but looser than the `.view`-gated list routes — tightening is a deferred behavior decision, EC-7); a few by-id reads used only for changelog text lack an org filter (harmless, EC-8); `get_compliance_report` returns hardcoded `0` for expected/overdue counts (needs a check-cadence model — incomplete feature, EC-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Roles: no ceiling on editing an already-privileged role, and no last-admin lockout guard**                  | ✅ Resolved (2026-08-07)                                                                                                      | Closed in two parts. The escalation direction and the last-admin guard already existed: `_enforce_permission_grant_ceiling` blocks granting a role permissions beyond the caller's own (wildcard-aware, CRITICAL alert on a blocked attempt), and `assert_not_last_administrator` prevents stripping the final administrator. The **sabotage** direction was still open exactly as described — the ceiling inspects only the incoming list and early-returns on `[]`, so a `roles.edit` holder who is not a `*` holder could PUT the sole System Owner role with `permissions: []` and wipe it, or with a small in-ceiling set and downgrade it. `_enforce_role_edit_ceiling` now gates on the role's **current** permissions: you may only edit a role already within your own authority. It runs when `role_update.permissions is not None` — i.e. when the permission set is actually being changed — so renaming or re-prioritising a higher role is still permitted; that is a deliberate scoping choice, not an oversight. `delete_role` already refused system roles. Covered by `tests/test_role_edit_ceiling.py`. (ORU-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Users/Orgs: PII and infra config exposed broader than the privacy gate intends**                            | ✅ Resolved (2026-08-02)                                                                                                      | Closed in two passes, and the second is worth recording. The roster endpoint was fixed first; `GET /users/{id}/with-roles` was left returning the raw record, so the `contact_info_visibility` setting stayed advisory — anything withheld on the roster was one request away. Both now redact through shared helpers (`_clear_hidden_contact_fields` / `_load_contact_visibility`) that fail closed, with `members.manage` holders **and the subject** exempt — the settings page loads a member's own profile through that endpoint and writes the fields back, so redacting for self would have blanked their own address on the next save. **Date of birth and emergency contacts** are now leadership-only with no setting able to publish them, and disclosure is recorded on the `user_viewed` audit event. On the settings side, `without_infrastructure()` also strips the `it_team` block (names/emails/phones + free-form `backup_access`), which the original identifier strip missed. (ORU-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Orgs: membership-ID generation has no row lock (duplicate IDs under concurrency)**                          | Mostly ✅ resolved                                                                                                            | **Fixed:** `generate_next_membership_id` now locks the org row `FOR UPDATE` before reading/incrementing the JSON counter (no more TOCTOU duplicate IDs) and caps the collision-retry loop; the admin update path checks the real `users.edit` permission (was the non-existent `users.update`); `PATCH /settings` deep-merges nested sections instead of shallow-replacing a whole section on a partial update. **Also resolved since:** `member_status` transitions now go through a lifecycle state machine (`ALLOWED_STATUS_TRANSITIONS` in `endpoints/member_status.py`, added 2026-07-31) rather than any-to-any — suspension must resolve to reinstatement or termination rather than laundering into leave/retirement, ARCHIVED is isolated on both sides so the dedicated `/archive` and `/reactivate` endpoints stay the only doors, and a blocked transition returns 400 with the allowed list. Member audit-history org-filtering was unblocked 2026-07-30 by the `audit_logs.organization_id` column and is applied on the log rows. **Nothing deferred remains under ORU-9.** (Verified during app-review A6; this row had still listed the state machine as deferred after it shipped.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Frontend: PII drafts / offline queue survive logout on a shared device**                                    | ✅ Resolved (verified 2026-08-07)                                                                                             | The product decision was made in favour of confidentiality and this row had not been updated. `frontend/src/utils/purgeLocalMemberData.ts` clears the shift-report drafts (localStorage) and all three IndexedDB queues — equipment checks incl. photo blobs, shift reports, and generic training/RSVP submissions — and is awaited by `authStore` on logout. To avoid destroying work silently it first makes a best-effort flush of anything still queued when online, and always reports how many items were discarded so the login page can tell the member. Each store is bounded by a 3 s timeout so no IndexedDB pathology can stall logout. (FE-6/FE-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Public portal: bcrypt-before-rate-limit CPU DoS + non-selective key prefix**                                | ✅ Resolved                                                                                                                   | `authenticate_api_key` now runs the client-IP rate limit as its first line — before the DB lookup and the bcrypt verify — so an unauthenticated flood of well-formed `logbook_…` keys is throttled before any expensive work; the redundant in-body IP checks were removed from the key-authenticated endpoints to avoid double-counting. The key prefix is now selective (16 chars: `"logbook_"` + 8 key chars; column widened `String(8)→String(20)`, migration `20260729_0001`) so a lookup returns one candidate → one bcrypt verify. Legacy `"logbook_"` keys self-heal to the selective prefix on next successful auth (no forced re-issue). (PP-4/PP-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Public portal: per-process rate limiter + application-status token plaintext at rest**                      | Open (MED, needs Redis/schema)                                                                                                | The in-memory public rate-limit caches are per-worker (true ceiling = workers × limit) and reset on restart — a shared Redis store is needed for a real global limit. The applicant status-check token is stored plaintext and matched by DB `==`, so a DB/backup read yields live 30-day tokens — it should be hashed at rest and looked up by hash. (PP-6) **Resolved from this cluster:** `authenticate_api_key` now throttles the `last_used_at` write (≤ once/60 s per key) and `detect_anomalies` uses 2 COUNT queries instead of 3 (PP-7); the access-log viewer auto-escapes `user-agent`/`referer`/`ip` via JSX (no stored-XSS — PP-5). Accepted design limitations: the whitelist has no per-subfield granularity (a whitelisted `mailing_address` exposes the whole nested dict — intentionally-public org data, not member PII), and the ≥36-bit display code has no per-code lockout (already bounded by the 60/min-per-IP limit).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Onboarding: role editor accepts client-controlled permissions / priority / system-flag**                    | Open (MED/LOW, needs design)                                                                                                  | `save_session_roles` accepts fully client-supplied role `permissions`, `priority`, and `is_custom` (which sets `is_system`), and keys updates on the client-supplied slug — so an in-progress onboarding session can mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` permission strings (a literal top-level `*` is not injectable, and the completion guard now blocks post-setup replay). Clamping priority, rejecting system-role re-mint, and allowlisting `module_id` would change what the legitimate onboarding role editor can express, so it needs a product decision. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Onboarding: reset-audit transaction boundary**                                                              | Open (LOW, transaction-boundary change deferred for care)                                                                     | The `reset_initiated` audit event is written in the same transaction as `/reset`'s deletes, so a failed reset rolls back the audit trail along with the data — it should commit to a durable sink first. **Correction (2026-08-27, security-review feature 30):** the other three items formerly listed in this row are fixed. Reset re-authentication (the existing System Owner must now be authenticated to reset, verified 2026-08-27 — landed 2026-08-21, commit `3d445eb2`, undocumented at the time) and `GET /status` info disclosure (returns a minimal post-completion response, per `docs/module-audit/onboarding.md` ONB-8) were already fixed; `template_service` create/update now strip `organization_id`/`created_by` and route through `apply_updates(skip=...)` instead of a blind `setattr` loop. (ONB-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Onboarding: session TTL has no absolute cap, only a sliding 30-minute window**                              | Open (LOW, policy decision)                                                                                                   | `validate_session` renews `expires_at` by another 30 minutes on every successful call — there is no maximum age tracked from session creation. Three routes (`GET /system-info`, `/security-check`, `/database-check`) call it with `require_csrf=False`, so the **session id alone** (no CSRF token) is enough to keep sliding the expiry indefinitely; a holder of just the session id can keep the pre-completion exploitation window open forever by polling any of those three, rather than it expiring 30 minutes after issuance as the user-facing message implies. (`GET /session/data`, unlike those three, does require the CSRF token — it is not itself part of the bearer-only path.) Capping absolute session lifetime is a policy choice (what the cap should be, and whether routine wizard navigation could ever hit it) rather than a drive-by fix. (ONB2-30-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Onboarding: `/test/email`'s self-hosted SMTP test has no SSRF/private-network protection**                  | Open (MED, policy decision)                                                                                                   | `POST /onboarding/test/email` (`platform: "selfhosted"`/`"other"`) connects via `smtplib` to a fully client-supplied `smtpHost`/`smtpPort` with no hostname/IP validation — the only client-directed outbound connection in the codebase that doesn't route through `app.utils.url_validator` (every webhook/OAuth integration does, but those are HTTP(S)-URL based; this is a raw SMTP host:port, so the existing helper doesn't apply as-is). Reachable pre-auth: obtaining the required onboarding session needs only `POST /start`, which succeeds for anyone until the first organization exists. Differentiated error messages (connection-refused vs. timeout vs. DNS-failure vs. wrong-protocol) let a caller fingerprint what's listening on an internal `host:port` during the bootstrap window — network reconnaissance, not data exfiltration (`smtplib` only speaks SMTP over the socket, so it can't be turned into an HTTP GET against something like a cloud metadata endpoint). Not fixed because the obvious mitigation (block private IPs, mirroring `url_validator`) would break a normal, expected deployment pattern for this app's audience — an on-premises SMTP relay reachable only from the department's internal network — so it is a product-policy tradeoff, not a bug with an obviously-correct fix. (ONB-30-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Core infra: fail-open TLS/image handling + latent cache isolation gaps**                                    | Partially resolved (2026-08-07)                                                                                               | (1) ✅ **Resolved as an opt-in.** Two distinct cases, now separated. "TLS enabled but peer unverified" (`DB_SSL`/`REDIS_SSL` on with no CA → `CERT_NONE`) was already CRITICAL and blocks boot in production/staging, waivable via `SECURITY_ALLOW_UNVERIFIED_TLS` — that configuration looks secure and is not, which is worse than honest plaintext. "No TLS at all" is governed by **`SECURITY_REQUIRE_TLS`** (default `True`): absent `DB_SSL`/`REDIS_SSL` is promoted from WARNING to CRITICAL and refuses to start. A deployment with equivalent transport protection (private network, service mesh, or sidecar) must explicitly set the flag to `False`, so plaintext transport is no longer silently permitted. Covered by `tests/test_tls_required_config.py`. (2) `optimize_image` fails open — a valid-header decompression bomb or any processing error returns the original bytes unprocessed (storing the bomb, bypassing EXIF/GPS stripping) and it doesn't set a local `MAX_IMAGE_PIXELS`; making it reject changes the avatar/equipment-photo upload contract. (3) Redis TLS disables cert + hostname verification when no CA is configured (`CERT_NONE`). (4) The Redis cache manager provides no tenant namespacing — all current callers use intentionally-global keys (no PHI cached), but there's no guardrail against a future caller caching an org-scoped record under a bare id; `clear_pattern()` is an unused wildcard-delete footgun. (5) WebSocket `accept()` precedes auth (deliberate, so close codes reach the browser). (CI-9/CI-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Crypto: AES-256-GCM + 600k PBKDF2 done; MFA recovery-code entropy remains**                                 | Partially resolved (LOW)                                                                                                      | **Done:** at-rest field encryption now uses **AES-256-GCM** (authenticated; a tampered value fails closed via `InvalidTag`). Legacy Fernet (AES-128-CBC + HMAC) values remain readable, and `scripts/reencrypt_to_aesgcm.py` backfills existing rows to GCM (run it against staging with a DB backup first — it is dry-run by default; see `docs/AES256_GCM_BACKFILL_RUNBOOK.md`). Once the backfill is verified complete, Fernet read-support can be removed. **Also done (app-review B24):** the KDF work factor for new (`$gcm2$`) values is now **600k** PBKDF2-HMAC-SHA256 iterations (the 100k `$gcm1$` path is read-only for migration-era values). **Still open (deferred, well-mitigated):** MFA recovery codes are 40-bit unsalted SHA-256 (encrypted at rest, single-use, lockout-throttled) — changing it invalidates stored codes, so it's a deferred migration. (CI-5 + PBKDF2 done / recovery-codes CI-10 / CI-4 fail-closed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Security monitoring: `security_alerts` cross-tenant alert read + suppression**                              | ✅ Resolved                                                                                                                   | `SecurityAlertRecord` now has an `organization_id` column (migration `20260728_0001`, indexed, backfilled from each alert's `user_id → users.organization_id`), populated at `_add_alert` from the acting user's org (user-less pre-auth / IP-only alerts stay NULL = platform-level). All four service methods take `organization_id` as a required parameter and filter on it: `get_recent_alerts` and `get_security_status` scope every aggregation (failed logins via the org's user ids); `acknowledge_alert`/`resolve_alert` scope the fetch so cross-tenant and missing ids both return a uniform 404 (no suppression, no existence oracle). `get_security_status` no longer returns the raw external-endpoint URL list (another tenant's exfil destinations) — only a process-global count. (SEC-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Security/IP: audit-chain rehash laundering + break-glass gate**                                             | ✅ Resolved                                                                                                                   | `rehash_chain` used to recompute `current_hash` from each row's current `event_data` for **every** row, so a privileged operator with DB write access could edit a keyed (v2) row and run rehash to launder the tamper into a valid keyed chain. Rehash now only repairs legacy (unkeyed) rows and **fails closed** (409) on a keyed-row mismatch — it never rewrites a keyed row. And because rehash rewrites the single cross-org chain and there is no platform-super-admin role, `POST /audit-log/rehash` is now disabled (403) unless a server operator sets `AUDIT_ALLOW_CHAIN_REHASH=true` (env = the de-facto platform-admin boundary), so an ordinary org admin holding `audit.export` can no longer trigger a platform-wide chain rewrite. (SEC-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Security/IP: global country-block table + geo fail-open**                                                   | ✅ Resolved                                                                                                                   | Geo-blocking is a platform-edge control (enforced before any tenant/auth context, against one shared MaxMind DB + one global blocked-country set), so per-org `CountryBlockRule` rows don't fit the enforcement model. Instead: (1) `GEOIP_FAIL_CLOSED` (default False) makes `is_ip_blocked` block any IP whose country can't be resolved — including the missing/corrupt-DB case — closing the "silently disabled app-wide" hole; private/reserved IPs are still allowed first, so an internal operator can recover (correction 2026-08-27: allowlisted IPs are no longer part of that recovery path — see the next row). (2) The two mutating country-rule endpoints are gated by `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` (default False), so an org admin can no longer alter the shared cross-tenant blocklist via the API — the operator sets it at deploy time via `BLOCKED_COUNTRIES`. The non-destructive audit-chain ops (`/checkpoint`, read-only `/integrity`) remain on `audit.export`/`audit.view`. (SEC-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Security/IP: approved IP-allowlist exceptions have no effect on geo-blocking enforcement**                  | 🚩 Open — needs a product decision                                                                                            | `IPBlockingMiddleware` calls `geoip.is_ip_blocked(client_ip, set())` unconditionally — the allowlist argument is always empty. This is intentional as of PR #1544 (2026-08-17), which closed a real cross-tenant hole: the middleware previously unioned every org's approved `IPException` rows into one set, so one org's approved travel exception silently let _any_ org's geo-blocked traffic through (this middleware runs pre-auth, with no tenant context to scope an exception to safely). The fix removed the union rather than replacing it with a safe per-tenant mechanism, so the `IPException` request → approve workflow (still fully functional in the API — `PENDING` → `APPROVED`, org-scoped, gated on `security.manage`/`settings.manage`) now persists rows that enforcement never reads. A member whose exception is approved specifically so they can work from a blocked country is still blocked; nothing in the UI/API response explains why. **Needs a decision:** either (a) restore per-IP-only allowlist lookup (keyed on IP alone, not unioned across orgs — the safe version of the original feature), or (b) retire the feature explicitly (relabel/remove the create-exception UI so nobody approves a request that does nothing). Found in security-review INT2-28; see `docs/security-review/SEC2-28-security-audit-ip.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Security monitoring: alert-management endpoints have no admin UI, plus two deeper visibility gaps**         | 🚩 Open — needs a frontend build + a platform-alert design + a backend fix                                                    | `security_monitoring.py`'s 13 alert-management endpoints (`/security/status`, `/alerts`, `/alerts/{id}/acknowledge`, `/alerts/{id}/resolve`, `/audit-log/integrity`\|`/status`\|`/checkpoint`\|`/rehash`\|`/entries`\|`/export`, `/intrusion-detection/status`, `/data-exfiltration/status`, `/manual-check`) have no working frontend consumer — `securityService` in `frontend/src/services/adminServices.ts` wraps five of them but is called from nowhere in the app (confirmed by exhaustive grep). That part is real, but the underlying detectors are not uniformly invisible or uniformly CRITICAL: `detect_session_hijack` and `report_privilege_escalation_attempt` are CRITICAL and already write an org-scoped `log_audit_event` visible via the existing `AuditLogPage` — the gap there is a missing alert-specific ack/resolve UI, not total invisibility. `detect_brute_force` is HIGH (not CRITICAL) and, because every failed login calls it with `user_id=None` unconditionally, its alerts get `organization_id=NULL` and are excluded by every org-scoped query (`get_recent_alerts`/`acknowledge_alert`/`resolve_alert`) — no frontend fix alone closes this; it needs a platform-level alert-viewing design that doesn't weaken existing tenant isolation. `detect_data_exfiltration` is HIGH, escalating to CRITICAL only when the caller's rolling 24h total exceeds 5x the single-transfer threshold (it also accepts a `destination` argument that would escalate an external transfer to CRITICAL, but the sole production call site never supplies it, so that branch is unreachable as wired) and, separately, is gated behind a `Content-Length` response header that `StreamingResponse` never sets — confirmed at three of `EXPORT_ENDPOINTS`' fifteen routes (`admin_hours.py`, `equipment_check.py`, `finance.py`) that build the full CSV in memory but still return it via `StreamingResponse` with no `Content-Length`, so those exports create no exfiltration alert at any size — a backend gap, not a UI one. `EXPORT_ENDPOINTS` is also an exact-match set, so `training_programs.py`'s parameterized `/programs/{program_id}/export` (mounted at `/api/v1/training/programs/programs/{program_id}/export`) can never equal a fixed string in it — one real export route with no exfiltration monitoring at all, by construction rather than a missing header. Closing it needs a prefix/pattern match rather than a fixed set (`docs/security-review/CI2-33-core-infra.md`, re-confirmed still open in `CI-33-core-infra.md`). By contrast `AuditLogPage`, `ErrorMonitoringPage`, and `IPSecurityAdminPage` (this feature's other three backend files) all have working, permission-gated admin screens. Found in security-review SEC2-28 pass 2, corrected during Codex review of the pass-2 PR (severity and visibility were originally overstated for three detectors and understated for the other two); see `docs/security-review/SEC2-28-security-audit-ip.md`. |
| **Security/Audit: residual exposure & robustness (session_id export, error-payload XSS, users-join scoping)** | Mostly ✅ resolved (one deferred)                                                                                             | **Done:** the audit export now emits a non-reversible SHA-256 fingerprint of `session_id` (raw value no longer leaked to `audit.export` holders; not in the hash chain, so integrity checks unaffected). The admin error viewer (`ErrorMonitoringPage`) and public-portal access-log viewer (`AccessLogsTab`) render error/UA/referer text via auto-escaped JSX (no `dangerouslySetInnerHTML`) — no stored-XSS path; `context` stays 4 KB-capped. The dead org-scoped `get_all_active_allowed_ips` method was removed and `IPExceptionType.BLOCKLIST` documented as a reserved placeholder. **Resolved 2026-07-30:** `audit_logs.organization_id` exists (migration `20260801_0009`, backfilled from `user_id`, hash-bound from version 3); all audit read paths filter it directly. (SEC-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Compliance/Skills: self-certification & self-attestation (no separation of duties)**                        | ⚠️ Half resolved (verified app-review A9)                                                                                     | **✅ Skills self-certification closed, at both ends:** an examiner can no longer be the candidate on a scored skills test, and **since 2026-08-08 an officer can no longer validate a test they are the candidate in** — `skills_testing.py` calls the shared `assert_different_person` guard (`app/services/separation_of_duties.py`) on both paths, with an `is_practice` carve-out for un-credited self-drilling. The second check is what keeps opening the examiner role to every member from re-opening this: without it an officer could have a peer "examine" them and then sign off their own pass, which is the same fraud one hop removed. **Still open:** `create_attestation` records a client-supplied `compliance_percentage` with nothing recomputed server-side and no second approver, so a compliance officer can attest a number they chose. Closing it needs a computed value or dual-control — a workflow change. (CS-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Compliance: reporting correctness & email abuse-surface polish**                                            | Partially resolved (LOW/MED)                                                                                                  | **Fixed:** the report email HTML now `html.escape`s the org name, `report_type`, and period label (was raw interpolation of user-controlled values — mail-client HTML/script injection); `report_type` is constrained to `monthly`/`annual` (was free-form, persisted + interpolated). **Still flagged:** monthly reports return the annual dataset relabeled (needs `generate_annual_report` to support a month window — feature); report emailing accepts client-supplied recipients (external auditors are a legitimate case — **owner decision 2026-08-09: allow any recipient, but audit-log each send to a non-member address**; `_email_report` now calls `audit_external_recipients`, which writes an `external_recipient_send` audit event listing every out-of-org address); attestation history over-fetches globally (blocked on the deferred `audit_logs.organization_id` column — availability, not a leak); `records_with_certification` mislabel left as-is (ambiguous intent). (CS-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Compliance: "notify non-compliant members" / reminder-days settings are stored but never sent**             | 🚩 Open — needs a reader built (security-review pass 2, CMP2-1)                                                               | `ComplianceConfig.notify_non_compliant_members` and `.notify_days_before_deadline` are set from `ComplianceRequirementsConfigPage.tsx`'s Notifications panel, persisted, and returned on every `GET /compliance/config` — but no scheduled task or notification sender anywhere in the backend reads either column (confirmed: `grep -rn notify_days_before_deadline backend/app` outside `schemas/`/`models/` returns nothing). A compliance officer who enables the toggle and sets "30, 14, 7" believes members are reminded before their deadline and notified on becoming non-compliant; neither happens. This is the same shape as the `notification_rules` gap CLAUDE.md Pitfall #19 documents. **Partial fix applied:** the panel now carries an explicit "Not yet active" notice so the UI stops implying the feature works (`ComplianceRequirementsConfigPage.tsx`, `docs/security-review/CMP-20-compliance.md` CMP2-1). **Still needed:** a scheduled task (alongside the existing `compliance_auto_reports` task) that evaluates each org's compliance status against `notify_days_before_deadline` and emails members per Pitfall #18 (email-first; SMS only via the `SmsAlert` allowlist if ever added) — a product/architecture decision on cadence and message content, not a drive-by fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Finance: no separation of duties on terminal money movement**                                               | ⚠️ Narrowed (verified app-review A9)                                                                                          | **✅ The severe case is closed:** the request **approval step** now calls the shared `assert_different_person` guard (`finance_service.py:649`), so one person can no longer both raise a purchase/check request and approve it — a second person must approve before anything is payable. **Still open:** the _disbursement_ actions (`mark_pr_paid`, `mark_expense_paid`, `issue_check`, `void_check`, `record_dues_payment`, `waive_dues`, `unwaive_dues`) are all gated only by `finance.manage`, so the requester can still be the person who executes an already-approved payment. Full three-way separation needs a distinct `finance.disburse`/treasury permission on roles (seed + roles + frontend). (FIN-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Finance: dues administration has no UI — every write is API-only**                                          | Open (MED, missing feature)                                                                                                   | `DuesManagementPage` is read-only: schedule filter, status tabs, summary cards and the member dues list. The store exposes only `fetchDuesSchedules` / `fetchMemberDues` / `fetchDuesSummary`, and `duesService` has no `unwaive` or payment-history call at all. So creating a schedule, generating member dues, recording a payment, waiving, reversing a waiver and reading the payment ledger are all reachable only through the API, despite every one of them being an endpoint. `docs/training/11-finance.md` documents the click-paths as the intended UI and now carries a callout saying so; the YouTube shorts for the dues fixes (8m/8n) are written but on hold because there is nothing to film. Closing this is a frontend build-out, not a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Finance: reimbursement/payee records readable by any `finance.view` holder**                                | ✅ Resolved for reimbursements (owner decision, 2026-08-09)                                                                   | Expense reports (member reimbursements: amounts owed + payee detail) were `finance.view` with no owner scoping. **Fix:** `list_expense_reports`/`get_expense_report` take `restrict_to_user`; the endpoints pass the caller's id unless they hold `finance.manage`, so a plain `finance.view` holder now sees only their own reimbursement submissions while treasurers keep the full org queue. Check-requests and purchase-requests are procurement records (vendor payees, not member out-of-pocket reimbursement) and are left at `finance.view` intentionally. Covered by `tests/test_read_permission_gates.py`. (FIN-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Finance: `record_dues_payment` has no idempotency and overwrites waives**                                   | ✅ Resolved (2026-08-04)                                                                                                      | All three defects had one cause: `MemberDues` was the only record of payment — one `amount_paid` total plus one set of detail columns, overwritten by whichever payment was entered last, so a retry was indistinguishable from a second installment. A `dues_payments` ledger (migration `20260802_0001`, backfilled) now holds one row per payment and the columns on `MemberDues` are a projection of it: `amount_paid` is re-derived as the sum of the ledger rather than accumulated, so a double-credit would require a duplicate ledger row, which the uniqueness constraint on `(member_dues_id, transaction_reference)` refuses. Unreferenced cash is deliberately never deduplicated — two identical cash amounts are two payments. `WAIVED`/`EXEMPT` records refuse payment outright, and `POST /finance/dues/{id}/unwaive` (`finance.manage`, reason required) is the deliberate reversal that replaces the old silent one, carrying the erased waive reason into a `finance.dues_waiver_reversed` audit event. `GET /finance/dues/{id}/payments` (`finance.view`) exposes the ledger. (FIN-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Finance: correctness/DoS polish (export, pagination, request numbers, float aggregates)**                   | Partially resolved (LOW/MED)                                                                                                  | **Fixed:** `add_expense_line_item` recomputes the report total from a fresh `SUM(amount)` aggregate instead of `sum(loaded_collection) + item.amount` (which could double-count/drift). **Still flagged (behavior/schema-change):** `_generate_request_number` `count()+1` race needs a unique-constraint migration + retry; float money math is a module-wide Decimal refactor; unbounded export + in-memory pagination is a DoS-surface refactor touching many endpoints; no overspend guard on spend posting; `get_pending_approvals` returns the org's whole approval queue rather than filtering to the caller's own assigned steps — a behavior change, not a scoping bug (the query itself is now confined to the caller's organization; see FIN-9 in `docs/security-review/FIN-05-finance-approvals.md`, which corrected the org-scoping half of this claim — it had actually been platform-wide with no organization filter at all, not merely org-wide). (FIN-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Scheduling: swap accept-path re-validation & self-approval; finalize manual_hours**                         | ✅ Resolved (SCH-6 fixed 2026-08-08; SCH-5 confirmed resolved by a later redesign, security review SCH-15 pass 2, 2026-08-28) | Both halves of this entry were stale by the time of this correction. **SCH-6:** `finalize_shift`'s `manual_hours[].user_id` is validated in-org via `_user_in_org` (module-audit pass, 2026-08-08); the `hours` value itself was already bounded at the schema (`Field(gt=0, le=48)`), so there was never an unbounded override. **SCH-5:** a same-day redesign (`respond_to_swap_offer`, landed 2026-08-24 — before this entry's most recent edit) replaced the general swap-accept path with a narrower one-way-offer accept that manager review (`review_swap_request`) still exclusively handles every two-way exchange. The one-way path re-validates the target shift's live state before moving the seat (`_validate_assignment_candidate(require_mutable=True, reject_past=True, enforce_capacity=True)` — cancellation, finalization, and capacity all checked at accept time) and enforces a strict `target_user_id == responder_id` identity check, tighter than the description here implied. Covered by the dedicated `tests/test_swap_offer_response.py` (17 tests). See `docs/security-review/SCH-15-scheduling.md` → Pass 2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Recurring: create/update paths trust client-supplied FK ids without an org check (XC-1)**                   | Open (LOW, systemic)                                                                                                          | The dominant cross-cutting pattern — create/update methods store `user_id`/`category_id`/`assignee_id`/etc. without verifying the referenced row is in-org. Individually low impact (org-stamped writes → dangling/mis-attributed FKs, not disclosure), but pervasive. Best closed by a shared `assert_in_org(db, Model, id, org_id)` helper rolled out per module. Full instances in [`docs/module-audit/CROSS-CUTTING.md`](./module-audit/CROSS-CUTTING.md) (XC-1/2/3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Application Review — Feature Rotation (2026-08-05)

Owner-decision items from the feature-by-feature review under
[`docs/app-review/`](./app-review/PROGRESS.md).

| Limitation                                                                                                                           | Status                                                                    | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Documents: folder ACL is per-folder, not hierarchical**                                                                            | Open (LOW, needs product decision)                                        | `can_access_folder` checks only a folder's own `visibility`/`allowed_roles`, never its ancestors. Apparatus/facility per-item child folders are created `ORGANIZATION`-visibility with no `allowed_roles` even though their parent roots are `LEADERSHIP`, so any `documents.view` holder can read those child folders directly — and the apparatus docstring's "allowed_roles restricted" claim is not actually coded. May be intended (crews seeing their rig's manuals is reasonable); if leadership-only was meant, the fix is a hierarchical ACL that walks the parent chain (perf implications on every folder check). Member personal folders are unaffected (`OWNER`-visibility). Decide intent, then fix either the code or the docstring. **Confirmed (security review DOC-10, 2026-08-25):** `ensure_facility_folder` was added since this was first flagged and creates its own sub-folders the identical way — same gap, same shape, not a new one. (DOC-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Money disbursement: separation of duties**                                                                                         | ✅ Resolved (owner decision, option (a), 2026-08-09)                      | The owner chose the cheap `assert_different_person` guard over a new disburse permission tier. A `storefront.manage` holder can no longer mark their _own_ order paid / waive / refund it, and a `finance.manage` holder can no longer mark their _own_ purchase request or expense report paid, issue a check for their own request, or waive their own dues — each compares the actor against the order's member / the request's `requested_by` / the dues member and refuses on a match (mirrors AH-4). The out-of-band reconciliation path (`actor_id=None`) is exempt. Not the broader requester≠disburser tier of option (b); a dedicated `finance.disburse`/`storefront.disburse` permission remains a future enhancement if the department wants to separate the roles generally rather than just block self-dealing. (`storefront_service.py`, `finance_service.py`; `test_money_separation_of_duties.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Admin hours: no per-org self-approval override; a resync can grow an already-approved entry past its threshold without re-review** | Open (LOW, product/design decisions; security review AH-21, both passes)  | Two distinct items, both re-confirmed unchanged on pass 2 (2026-08-30) against the current code. (1) The AH-4 self-approval guard (`assert_different_person` in `approve_or_reject`/`bulk_approve`) is unconditional — a genuine sole-officer department has no way to approve their own admin-hours entries and would need a second `admin_hours.manage` holder. A per-org toggle to relax this is a deliberate policy trade-off, not a bug. (2) `credit_event_attendance`'s resync path (`resync=True`, used when a reopened event's corrected check-out time lengthens an attendee's session) updates `duration_minutes` in place on an entry that may already be `APPROVED`, without re-running `_determine_post_clockout_status` — by design, so a correction cannot silently revoke an officer's already-made review decision, but the flip side is the same mechanism never re-evaluates whether the now-longer session should have required review. Closing it needs a product decision (re-queue for review above some growth threshold, vs. leave as-is and rely on the officer noticing) before it can be coded. (`admin_hours_service.py`; `docs/security-review/AH-21-admin-hours.md`.)                                                                                                                                                                                                                                  |
| **Storefront: `auto_apply_payments` defaults on**                                                                                    | Open (LOW, product decision)                                              | When a PayPal integration's config omits `auto_apply_payments`, it defaults to `True`, so an exact-amount capture settles an order with no human in the loop. Well-guarded (amount must equal the balance exactly; anything else is recorded `AMBIGUOUS`), but it is an implicit default on a money path and should be an explicit choice in the integration setup UI. (SF future-dev #4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Storefront: no reconciliation backfill**                                                                                           | Open (MED, robustness)                                                    | If PayPal's verify-webhook-signature API is unreachable, the webhook returns 401 and PayPal eventually stops retrying — the capture is then absent from the ledger with no way to re-ingest it. The Transaction Search API (rejected in the service docstring for its multi-hour lag) is the natural backfill source for exactly this case. (SF future-dev #1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Consent enforcement**                                                                                                              | ✅ Resolved (2026-08-05) for SMS; the other two types have no consumer    | `ConsentService.has_consent` had **zero callers** — members could refuse `PHOTO_USE`, `PUBLIC_ROSTER_LISTING` and `SMS_NOTIFICATIONS` and be ignored. Enforcement was blocked on a backfill decision, since "never asked" counts as refused and wiring it in would have stopped SMS to every existing member. **Owner's rule removed the blocker:** messages always go to the member's email, so consent suppresses the text but never the notice. SMS is now consent-gated in both send paths (department-message escalation and the inventory low-stock alert) via a new bulk `granted_user_ids` helper, and email is unconditional — sent for every department message and no longer filtered by the `email_notifications` preference, which still governs the seven reminder/alert flows. **Still open:** `PHOTO_USE` and `PUBLIC_ROSTER_LISTING` have no consumer to gate — there is no public roster or public photo publishing in the app today. Whoever builds them must gate on `has_consent`; the requirement is recorded in the `consent_service` docstring. (AUTH-2)                                                                                                                                                                                                                                                                                                                                                      |
| **Cohort room booking is built but has no UI**                                                                                       | Open (MED, frontend build-out)                                            | `location_id` is accepted by `CourseCohortCreate`, validated in-org via `assert_in_org`, carried on each syllabus row, and drives a real double-booking check that returns `"Location already booked: …"` as a per-class warning at both preview and generation. The service docstring advertises "a room clash the officer chose to accept" as supported. But **no cohort or syllabus UI sets it** — `grep -rn "location_id" src/pages/training/ src/components/training/` returns nothing — so the warning can never fire in practice, and a department scheduling a fifteen-class recruit school into already-booked rooms gets no notice. Same shape as the dues-UI gap above. Closing it needs a location picker in the wizard and syllabus builder plus a product call on whether the room is per-cohort, per-class, or both (the backend supports both). Several smaller fields are API-only for the same reason: `description`, `notes`, `requires_rsvp`, `auto_create_records`, `default_duration_minutes`. (CC-2)                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Public portal: rate limiter is per-process + application-status token is plaintext at rest**                                       | Open (MED, infra + schema)                                                | The public-portal rate-limit caches are per-worker (true ceiling = workers × limit) and reset on restart — a real global limit needs a shared Redis-backed store. Separately, the 256-bit application-status token is stored plaintext on `ProspectiveMember.status_token` and matched by DB `==`, so a DB/backup read yields live 30-day tokens. It can't simply be hashed, because it's re-read to rebuild the status-check URL in emails and the status response — hashing at rest needs a two-column design (an indexed `status_token_hash` for lookup plus the token stored encrypted for re-display) and a backfill. Both are infra/schema changes. (PP-6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Onboarding: role editor accepts client-supplied permissions/priority/system-flag**                                                 | Open (MED-LOW, product decision)                                          | During setup, `save_session_roles` accepts client-supplied `permissions`, `priority`, and `is_custom` (which sets `is_system`), keyed on the client slug — so a session holder can mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` permission strings. A literal top-level `*` is not injectable, and the post-completion guard (ONB-3) blocks abuse once setup is done, so the window is the still-in-progress setup only. Clamping priority, rejecting system-role re-mint, and allowlisting `module_id` would change what the legitimate onboarding role editor can express, so it needs a product decision. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Roles: the org-wide `member` role can be mass-escalated up to the caller's ceiling**                                               | Open (LOW, product decision)                                              | The baseline `member` role every user carries can be edited to add any permission within the caller's own grant ceiling — so an admin can, in one edit, grant a new capability to every member at once. This is intended (that's how you roll out a capability org-wide) but sharp: there's no dedicated confirmation or guard distinguishing "edit a normal role" from "edit the role literally everyone has." A confirmation step or a dedicated guard on the baseline role is a product decision. (ORU-7c)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Scheduling: swap accept-path skips target re-validation + weaker approver check**                                                  | ✅ Resolved (confirmed by security review SCH-15 pass 2, 2026-08-28)      | Duplicate of the "swap accept-path re-validation & self-approval; finalize manual_hours" row above; kept rather than deleted since this was the original app-review wording and other docs may still cross-reference it. See that row for the resolution mechanism. (SCH-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Training: auto-approved submissions bypass separation-of-duties**                                                                  | ✅ Resolved (owner decision, 2026-08-09)                                  | The manual submission-review path blocks self-approval (the shared `assert_different_person` guard), but the **auto-approve** branch in `create_submission` (`require_approval=False`, or `hours_completed <= auto_approve_under_hours`) immediately spawned a COMPLETED record crediting the member's self-reported hours with **no reviewer at all**. **Fix:** `create_submission` now routes any submission that would credit a certification/requirement (training_type=certification, any certification credential field, or a linked training category) to manual review regardless of the org's auto-approve config — only non-crediting submissions (plain logged hours, skills practice) may auto-approve. See `_credits_certification_or_requirement`. (TR-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Events: public event-request intake has no per-org opt-in or spam parity with forms**                                              | ✅ Resolved (2026-08-17)                                                  | `POST /event-requests/public?organization_id=…` used to accept a submission from anyone who supplied an active org's id (discoverable via the public calendar), gated only by a per-IP limit of 10, while each submission wrote rows and emailed a coordinator. Now closed on all four fronts the entry asked for: **(1) per-organization opt-in** — `events.request_pipeline.accept_public_requests`, default **false**, so a department that never configured outreach accepts nothing; it lives in the settings JSON with a defaults merge, so no migration is required. **(2) Indistinguishable refusal** — a closed department answers exactly as a missing one (404, same detail), because a distinguishable response is an oracle for which departments accept requests. **(3) Honeypot** — an aliased `website` field; a filled one returns the success shape, writes nothing, and does **not** consume the daily allowance. **(4) Human challenge + valid-only daily cap** — the route carries `require_captcha` (the dependency public forms already use) and a per-org ceiling (`public_daily_limit`, default 50) counted only after authorization, honeypot and validation, so junk cannot lock out legitimate submitters. Admins turn intake on under **Events → Settings → Request pipeline → Accept Public Requests**. Covered by `tests/test_event_request_public_intake.py` (6 tests) plus `test_captcha.py`. (EV-5) |
| **Reports: member/applicant PII exposed at the low `reports.view` grant**                                                            | ✅ Resolved (owner decision, 2026-08-09)                                  | `member_roster` returns each member's email + membership number and `pipeline_overview` returns prospective-member email + full name — both were gated only on `reports.view`. **Fix:** `reports.py` maps those PII-bearing report types to their source-record read permission (`member_roster`→`members.view`, `pipeline_overview`→`prospective_members.view`) via `PII_REPORT_PERMISSIONS` and enforces it in `/generate` and `/saved/{id}/run` (403 if missing); `/available` hides PII reports the caller can't run. Aggregate reports stay at `reports.view`. Covered by `tests/test_read_permission_gates.py`. (RPT-3) **Expanded 2026-08-31 (feature-29 pass 3, round 2):** `training_summary`, `training_progress`, `annual_training`, `certification_expiration`, and `compliance_status` (all → `training.manage`) and `admin_hours` (→ `admin_hours.manage`) were found returning the same class of per-member PII at plain `reports.view` and added to the map.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Grants: no financial state machine or overspend guard**                                                                            | Open (MED, needs product decision)                                        | No path checks total expenditures against `amount_awarded` / `amount_budgeted`, so `amount_remaining` can go negative, and `update_application` applies any status/amount change with no transition guard (a CLOSED/AWARDED grant stays fully editable). Closing it needs a product-defined grant state machine and an overspend policy (hard block vs warn). The duplicate-compliance-task half of this finding (an `awarded → active → awarded` round-trip regenerating a duplicate task set) is **resolved** — see GF-14: `_generate_compliance_tasks` now checks a dedicated `compliance_tasks_generated` boolean on `GrantApplication` before doing any work, re-confirmed intact by security-review GF-22 pass 2 (2026-08-30). (GF-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Grants: `is_anonymous` donations still show donor identity to staff**                                                              | Open (LOW-MED, product decision)                                          | `DonationResponse` / `DonorResponse` serialize `donor_name`/`donor_email`/`donor_id`/`amount` regardless of the `is_anonymous` flag, and the dashboard's recent-donations list returns donor-identified rows to any `fundraising.view` user. There is no public surface, so this is staff-only — but the anonymity flag currently has no effect. Decide whether an anonymous gift should hide donor identity from `fundraising.view` (vs `.manage`), then enforce it in the response serializers. (GF-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Grants: dashboard KPI status links don't match the multi-status aggregate the KPI counts**                                         | Open (LOW-MED, needs a filter-UI decision)                                | `GrantService.get_dashboard_data()` counts "Active Grants" as `active` **and** `reporting` applications, and "Pending Applications" as five different statuses (`researching` through `under_review`) — but the KPI cards link to `/grants/applications?status=<one value>`, and `GrantApplicationsPage.tsx`'s status filter is a single-value exact match with no way to represent "two statuses at once." Clicking "Active Grants" therefore shows only `active` applications, silently excluding `reporting` ones the card's own number counted. Closing it needs a UI decision — a synthetic grouped filter option, or restyle the KPI cards as non-filtering summaries — not a drive-by fix. Found by Codex review, security-review PR #2070 (GF-22 pass 2, round 5); see `docs/security-review/GF-22-grants-fundraising.md` GF-27a. (GF-27a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Grants: the applications page loads at most 1,000 applications, in either view**                                                   | Open (LOW-MED, feature gap — needs real pagination)                       | `GrantApplicationsPage.tsx` (pipeline/kanban and table views) has no pagination control in either view — it's built to show the organization's complete application set at once, filtered or not. The fetch requests `limit: 1000` (the backend's own declared ceiling, `PaginationParams`'s `le=1000`), raised from the previous 100 (GF-33), but an organization with more than 1,000 applications overall, or more than 1,000 sharing one status when a status filter is applied, still silently truncates past that point — the newest 1,000 win, older ones are invisible with no indication anything was cut off. Closing it fully needs either real pagination (a page-size control, `skip`/`limit` wired to user paging) or a summary/streaming approach that doesn't load the full set into the browser at once. Found by Codex review, security-review PR #2073 (GF-22 pass 2, round 6); see `docs/security-review/GF-22-grants-fundraising.md` GF-33. (GF-33)                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Grants: reporting sums money as `float`, not `Decimal`**                                                                           | Open (LOW, needs a Decimal-migration decision)                            | `GrantService.get_grant_report` and `FundraisingService.get_fundraising_report` accumulate `amount_requested`/`amount_awarded`/expenditure/donation totals with Python `sum(float(...) for ...)` rather than `Decimal`, so the reported totals are subject to binary-floating-point rounding error instead of being exact. The underlying columns are already `Numeric`/`Decimal` — this is a reporting-path-only issue, not a storage one. Re-confirmed unchanged across every prior pass, most recently security-review GF-22 pass 2 (2026-08-30). Closing it is a module-wide Decimal-arithmetic refactor across both report methods, a deliberate change rather than a drive-by fix. (GF-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Medical supplies: expiring-lot list has no row cap**                                                                               | Open (LOW, needs a product decision — shared across callers)              | `InventoryService.get_expiring_lots` (backs `GET /medical-supplies/lots/expiring`, the equivalent gear-side route, and the low-stock/expiring alert email) has no `limit`/pagination — a department that never clears old zero-or-positive-quantity expired lots gets every matching row back to the start of the `days_ahead` window, unbounded. Not a mechanical medical-supplies patch: the method is shared with the main inventory router and `scheduled_tasks.py`'s alert email, so a cap changes those callers' contracts too (would the alert silently omit rows past the cap?) — needs a decision on page size per caller, not a drive-by limit. Found by Codex review, security-review PR #2075 (MSUP-23 pass 2); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-4. (MSUP-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Reports: date-range filters use UTC, not the organization's local timezone**                                                       | Open (LOW-MED, cross-cutting; needs a reporting-context timezone default) | A report end date of "June 15" is interpreted as June 15 in UTC, not June 15 in the department's own timezone — for a non-UTC organization, a report can still include some of the following day's early records or exclude some of the selected day's late-evening records, depending on the org's UTC offset. Not a regression and not module-specific: `reports_service.py` alone has the identical hard-coded-UTC `datetime.combine(..., tzinfo=timezone.utc)` boundary at 5 separate call sites, and `grant_service.py`/`fundraising_service.py` matched that same established pattern when fixing a strictly worse bug (GF-24 — the boundary previously excluded the entire end date, in every timezone) rather than inventing a one-off fix. `app/utils/org_timezone.py`'s `resolve_scheduling_timezone` is not a drop-in general-purpose answer — its own docstring ties its `America/New_York` fallback specifically to scheduling's historical behavior ("changing it would move existing departments' shift times"), so a reporting-context default needs its own decision, not a borrowed assumption. Closing this needs a coordinated fix across every report date-range filter in the app, not a per-module patch. Found by Codex review on security-review PR #2069, round 2; see `docs/security-review/GF-22-grants-fundraising.md` GF-24a. (GF-24a)                                                                  |
| **Inventory: storage-area barcodes are assigned but the scanner cannot resolve them**                                                | Open (LOW-MED, feature gap; UI copy currently overpromises)               | Since 2026-08-16 every storage area is assigned a sequential `SA-…` barcode, and the Storage Areas form tells the user it is assigned "so it can be scanned". Nothing resolves it: `/inventory/lookup` → `InventoryService.search_by_code` queries `InventoryItem.barcode` / `serial_number` / `asset_tag` / `name` / `size` / `color` only, and the sole query against `StorageArea.barcode` is the allocator's uniqueness check (`_storage_area_barcode_exists`). Scanning a shelf label in `InventoryScanModal` therefore returns nothing. Two ways to close it: extend the scan lookup (and `ScanLookupListResponse`) to return storage-area hits and navigate to the area, or reword the form to say the code is for printed labels only. Until one lands, the UI promises a capability the app does not have. Found by review on PR #1508 while documenting the feature. (INV-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Build: the linter's TypeScript is an npm-auto-installed peer, not a declaration**                                                  | ✅ Resolved (2026-08-24)                                                  | Re-pinned `typescript` to `5.9.3` in `frontend/package.json`, restoring the declared split: the plain name is the version typescript-eslint can load, and `typescript-native` (npm alias of `typescript@7.0.2`) stays the compiler `npm run typecheck` / `npm run build` use through `frontend/scripts/tsc-native.mjs`. Both halves are now declared — `package-lock.json` carries `node_modules/typescript@5.9.3` as a plain dev dependency rather than `"peer": true`, and the nested `frontend/node_modules/typescript@7.0.2` is gone because there is no longer a version conflict to nest around. This restores lockfile regenerability, which was the actual risk: with `typescript` declared at 7.0.2, `rm package-lock.json && npm install` failed with ERESOLVE against typescript-eslint's `>=4.8.4 <6.1.0` peer cap, so a Dependabot bump or any regeneration could not rebuild it. Verified after the change: clean regeneration, `npm ci`, and `--strict-peer-deps` resolution all succeed; typecheck runs on 7.0.2 and type-aware lint on 5.9.3; build, lint (0 warnings) and 4929 frontend tests pass. **A future Dependabot bump of the plain `typescript` past the linter's cap reopens this** — bump `typescript-native` instead. (BUILD-1)                                                                                                                                                                         |
| **Forms: `require_authentication` / `allow_multiple_submissions` not enforced on public submit**                                     | ✅ Resolved (confirmed 2026-08-17)                                        | **The product decision was made in code: "public + `require_authentication`" reads as _public listing, authenticated submit_.** A public form stays discoverable by slug, but submitting requires a session — `api/public/forms.py` returns 401 before the service runs, and `FormsService.submit_public_form` re-checks (`require_authentication and not submitted_by`) so a direct service caller cannot skip it. `allow_multiple_submissions=False` is enforced server-side per authenticated identity and _also_ requires authentication, because an IP or a client-supplied email is trivially bypassed and cannot identify a submitter. The duplicate check takes `SELECT … FOR UPDATE` on the form row first, closing the check-then-insert race where two concurrent submissions from one member both passed. Public submit additionally requires a human challenge (`require_captcha`) and keeps its honeypot. Covered by `test_public_form_enforces_authentication_policy`. (FORM-5)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Integrations: non-secret config readable by any authenticated member**                                                             | ✅ Resolved (owner decision, 2026-08-09)                                  | `list_integrations` / `get_integration` used bare `get_current_user`, so any member read every integration's non-secret config (instance_url, field_mappings, api_base_url). **Fix (minimal-projection option):** the full config `list`/`get` now require `integrations.manage`; a new `GET /integrations/connected` returns only `integration_type`/`status`/`enabled` for any authenticated member, and the cross-module `useConnectedIntegrations` hook was repointed to it so meeting-config/pipeline flows keep working without the integrations-admin permission. Covered by `frontend/src/hooks/useConnectedIntegrations.test.ts`. (INT-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Membership pipeline: duplicate-member conflicts name the matched member**                                                          | ✅ Resolved (2026-08-12)                                                  | Prospect creation and transfer conflicts now give only workflow guidance and never interpolate the matched member's name, email, user id, or reactivation URL. This matches the minimized `POST /prospects/check-existing` projection and prevents a name-only match from revealing an email the caller never supplied. `test_prospect_create_privacy.py` pins both HTTP response boundaries. (MP-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Client IP recorded as the proxy address**                                                                                          | ✅ Resolved (2026-08-05); one historical-data decision open               | `request.client.host` was used instead of `get_client_ip(request)` in 39 places across 8 files, so behind the production nginx every record stored one identical internal IP. Worst case was **elections**: per-vote IPs drive the fraud detection documented in `BALLOT_FORENSICS_GUIDE.md`, so `unique_ip_count` collapsed to 1 and every election permanently tripped the `suspicious_ips` threshold. The sweep also caught a live **availability** bug the survey had missed: `public_portal_security.py` keyed the public-portal _rate limiter_ on the peer IP, so all anonymous visitors shared one bucket and a single caller could lock out everyone (the H5 shape, still live on the public surface). Verified behavior-neutral: identical test results before and after. **Open:** rows already written still hold proxy IPs and are indistinguishable from real ones — recommend noting the cutover date in `BALLOT_FORENSICS_GUIDE.md` rather than rewriting hash-chained audit history. (AXC-1)                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Error Monitoring Coverage (2026-08-07)

What does _not_ reach the Error Monitoring page after the reporting sweep. Each
is an accepted gap with the same root cause: an `error_logs` row is org-scoped
and `organization_id` is NOT NULL, so a failure that cannot be attributed to an
organization has nowhere to go.

| Item                                                               | Status                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Failures before sign-in do not reach the error-monitoring page** | ⚠️ Open                              | `POST /errors/log` requires an authenticated session because each row is organization-scoped. Pre-authentication reports are discarded, and queued reports are cleared on login, logout, or session expiry so error content can never be delivered under a different user's cookies on a shared browser. Closing this limitation safely needs an anonymous ingestion path with its own organization resolution and abuse protection (the endpoint would be unauthenticated and world-writable).                                       |
| **The onboarding client is not instrumented**                      | Accepted (follows from the above)    | `modules/onboarding/services/api-client.ts` calls `fetch` directly rather than an axios instance, so it does not pass through the interceptor that reports API failures. Onboarding traffic is mostly pre-session. If it is ever instrumented, route it through `reportApiError` rather than adding a second transport.                                                                                                                                                                                                               |
| **Celery task failures are not reported**                          | Open (LOW)                           | `persist_error_log` resolves the org from the request's credentials, and a background worker has no request. Scheduled email sends, report generation and similar failures reach Loguru/Sentry only. Closing it means passing an explicit `organization_id` into a request-free variant of the helper.                                                                                                                                                                                                                                |
| **Reports can still be discarded under sustained failure**         | Accepted (bounded, and never silent) | The client caps reports at 20/minute and holds at most 50 undelivered, and abandons a report after 4 delivery attempts. Anything discarded by the two caps is counted and reported as a `REPORTING_THROTTLED` row, so a burst reads as "20 reports plus 340 suppressed" rather than a quiet minute — but the discarded reports themselves are gone, and a report abandoned after 4 failed attempts is not counted anywhere. Raising the caps trades table growth for fidelity; the current values assume a browser tab, not a server. |
| **A 5xx produces two rows**                                        | Accepted (intentional)               | The backend logs `BACKEND_HTTP_5xx` with the traceback and endpoint; the client logs `API_SERVER_ERROR` with the member and the page they were on. Neither is redundant — the backend row is missing when the failure never reached the app (gateway 502) and the client row is missing for a failure outside a request the user made. They are distinguished by the Source column.                                                                                                                                                   |

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

## Finance — Nobody Can Approve Anything (2026-08-12)

`finance.approve` is defined in `app/core/permissions.py`, gates all three
approval endpoints (`GET /finance/approvals/pending`,
`POST /finance/approvals/{id}/approve`, `.../deny`), and is granted by **no
role in the shipped catalogue** — 27 roles, none of them include it.

| Role           | Finance permissions              |
| -------------- | -------------------------------- |
| Treasurer      | `finance.view`, `finance.manage` |
| Fire Chief     | none                             |
| President      | none                             |
| Vice President | none                             |
| IT Manager     | `*`                              |

So the only account that can reach the approval queue is one holding the `*`
wildcard. And that account is then refused by separation of duties —
_"You cannot approve your own purchase request. Separation of duties requires
a second person"_ — for anything it raised itself. In a department using the
shipped roles, every purchase request, expense report and check request stays
in `pending_approval` for ever.

**Needs an owner decision, not a patch.** The fix is to grant
`FINANCE_APPROVE` to whichever roles a department expects to sign off
spending — Treasurer alone is not enough, because the Treasurer is usually the
one raising the request and separation of duties would then block them.
Widening who can authorise money is an authorisation decision and is
deliberately not being made from a documentation pass.

This is also why **budget detail can never show a filled progress bar**: spend
and encumbrance accrue on approval, and no approval can happen. That compounds
the transaction-table stub recorded in the section above — the bar is real code
that is permanently stuck at 0%, and the table below it is not wired at all.

Found 2026-08-12 while trying to seed a budget with charges for
`11-05-budget-detail`.

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

## Screenshot Harness — Camera Viewfinders Cannot Be Photographed (2026-08-12)

Three placeholders asked for a live camera viewfinder with a code being read:
`MemberIdScannerModal` on a desktop browser (`docs/training/03-scheduling.md`),
the inventory scan modal mid-batch and `InventoryScanModal` detecting a barcode
(both `docs/training/05-inventory.md`).

The capture harness runs headless Chromium with no camera device. Chromium's
fake-device flags can supply a synthetic stream, but it is a rolling test
pattern, not a scannable code — and each of these shots is specifically of a
code _being recognised_, which a fake stream cannot produce. Nothing short of a
real camera in front of a real label satisfies them, so all three are retired
rather than left open to be re-surveyed each pass.

The scanning features themselves work; this is a limitation of the automation,
not of the product. If these screens ever have to be documented visually, the
images will have to be taken by hand.

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

## Training — The "Program Completed!" Banner Is Unreachable (2026-08-12)

`Dashboard.tsx` renders a green **Program Completed!** line in an enrollment
card when `enrollment.status === 'completed'`. Nothing can reach it: the only
caller of `getMyEnrollments` is that same page, and it asks for
`getMyEnrollments('active')` — a status filter passed through to
`/training/programs/enrollments/me`. A completed enrollment is therefore never
in the list the card is rendered from, and the string appears nowhere else in
the frontend.

Confirmed against a real completed enrollment: the demo member's Driver /
Operator pipeline is now finished at 100% (seeded, so the completed state has
data behind it at last), and it is simply absent from the dashboard rather than
shown with the banner.

Two readings, and picking between them is a product decision rather than a
correctness fix — which is why this is recorded rather than patched:

- The dashboard _should_ surface recently completed programs, and the filter is
  the bug. A member finishing a programme currently sees it vanish.
- The banner is vestigial from before the filter and should be deleted.

`docs/training/02-training.md` asked for a screenshot of this banner; that
placeholder is retired. Needs an owner decision.

## Integrations — No Detail Page, No Error History, No Event Triggers (2026-08-12)

`docs/training/16-integrations.md` described three things around integration
management that do not exist. All four of its screenshot placeholders are
retired on this basis.

**There is no integration detail page.** `/integrations` is the only route in
`modules/integrations/routes.tsx`; integrations are cards on that one page, and
clicking one does not open anything. The guide said "Click any integration to
see: last sync timestamp, last error message, consecutive error count, sync
history".

**Three of those four fields do not exist either.** The `Integration` model
carries `status` (`available` / `connected` / `error` / `coming_soon`), `config`,
`encrypted_config`, `enabled`, `contains_phi` and `last_sync_at` — and nothing
else. There is no error message, no consecutive-error counter and no sync
history table anywhere in the model or schemas. Nor is there a **Retry Sync**
control: the string appears nowhere in the frontend.

**Messaging integrations have no event-trigger selection.** The guide told
administrators to "select which events trigger notifications" and pictured
checkboxes for New Member, Training Completed, Event Scheduled and Shift Change.
No such control exists — none of those labels appears in the frontend, and the
Slack/Discord/Teams connect dialogs collect a webhook URL. There is no **Test
Connection** button on an integration either (the one in the codebase belongs to
onboarding's email configuration, a different feature).

Two of the four were unreachable for a second, separate reason, worth keeping
distinct from the missing UI: the Cal.com **Bookings** panel does exist and does
work, but it lists bookings fetched live from a real Cal.com account, and the
Slack placeholder asked for a screenshot of the Slack channel itself. Neither is
reachable from a demo environment with no third-party accounts connected.

Needs an owner decision on whether integration health monitoring and per-event
notification routing should be built. This loop does not make that call.

## Inventory — Departure Clearance Is Backend-Only (2026-08-12)

`DepartureClearanceService` is a complete implementation — initiate a clearance
for a departing member, list clearances, resolve each outstanding item with a
disposition, complete or close-incomplete — and `api/v1/endpoints/inventory.py`
exposes it. Nothing in the frontend calls any of it: there is no route, no page,
no service method, and no reference to "departure" or "clearance" in that sense
anywhere in `frontend/src`.

`docs/training/05-inventory.md` documented the whole workflow as if it were a
screen, including a clearance record with per-item disposition dropdowns and
resolve/complete buttons. That screenshot placeholder is retired and the section
now says the workflow is API-only.

The property-return report generated when a member is dropped is a separate,
working feature — see Membership > Property Return Process. It is the clearance
_record_ that has no interface.

Needs an owner decision on whether to build it. This loop does not make that
call.

## Events — There Is No Per-Event Analytics Panel (2026-08-12)

`docs/training/02-training.md` described a post-event analytics panel on the
event detail page, with an attendance-rate pie chart, an average-hours bar, a
participant count, and a breakdown by apparatus showing skills observed per
unit. None of it exists.

What does exist, and is easy to mistake for it:

- **`/events/analytics`** (`EventAnalyticsPage`) — a **department-wide**
  attendance-trends dashboard: summary cards and charts across all events, not
  one event.
- **`/events/:id/analytics`** (`AnalyticsDashboardPage`) — per-event, but it is
  **QR check-in analytics**: total scans, successful and failed check-ins,
  success rate, time-to-check-in, device breakdown, hourly activity. No hours,
  no skills observations, no apparatus breakdown.

The event detail page itself has attendance finalization and a printable
attendance roster, and no analytics section at all. The guide's metrics table
(attendance rate, average hours, skills observations, apparatus used) was
narrative from a worked example presented as a description of a real screen; it
is now marked as such and the screenshot placeholder is retired.

Needs an owner decision on whether the panel should be built. This loop does
not make that call.

## Inventory — Nothing In The UI Can Choose a Temporary Assignment (2026-08-12)

An item assignment carries an `assignment_type` of `permanent` or `temporary`,
`assign_item_to_user` accepts both along with an `expected_return_date`, and the
member-facing equipment lists render a "Permanent Assignments" group and a
"Due:" date — so the concept is visible throughout. No screen can create one:

- `ItemDetailPage` is the only UI caller of `inventoryService.assignItem`, and
  it passes no options, so the API default (`permanent`) always applies.
- `distribute_items` — the bulk flow the guide pictured issuing six SCBA units —
  hardcodes `AssignmentType.PERMANENT`.

Fixed in passing, because it was losing data rather than merely missing a
control: fulfilling an equipment request for an **individually tracked** item
dropped the expected-return date entirely and issued the item permanently. The
fulfil form collects that date, and the pool branch of the same function already
honoured it by creating a checkout. That branch now marks the assignment
temporary and stores the date; two tests in `test_inventory_gaps.py` pin both
outcomes.

Still missing is any control letting an officer choose Temporary directly on an
assign or distribute-items form, which is what
`docs/training/02-training.md` described. That placeholder is retired. Needs an
owner decision on whether the control should exist.

## Elections — The Public Ballot Cannot Be Screenshotted, By Design (2026-08-12)

The public ballot page works; it just cannot be reached by the capture harness,
and the reason is a security property worth keeping rather than a defect to fix.

`_generate_voting_token` returns the raw token exactly once, to its caller, and
stores only its SHA-256 (`module-audit ELEC-5`), so database access never yields
a live credential. The only caller is `send_ballot_emails`, which puts the raw
token into an email and nothing else — the `send-test-ballot` endpoint returns
`{success, message}` and no token. The demo stack runs with `EMAIL_ENABLED`
false and no mail catcher, and the disabled path logs only
`"Email disabled. Would batch-send N messages."` — not the body.

So there is no supported way to obtain a working token in the demo environment,
and the ways to manufacture one all mean defeating the hashing. The placeholder
for the public ballot page in `docs/training/14-elections.md` is retired on that
basis. Filling it would need a mail catcher wired into `dev_env.sh` plus email
enabled for the demo org — a harness change, and the right one if this page ever
has to be documented visually.

## Elections — Proxy Voting Has an Admin Panel But No Ballot Mode (2026-08-12)

`ProxyVotingManagement` exists on the election detail page and configures
proxies. What does not exist is any way to _vote_ as one: `ElectionBallot` has
no reference to proxies at all, and the string "Voting as proxy" (or anything
like it) appears nowhere in the frontend. The guide described a ballot with a
"Voting as proxy for: …" banner above the standard ballot; there is no such
banner and no proxy mode on the ballot.

Note this compounds the ballot limitation below — the in-app ballot is the one
that would need the proxy mode, and it is already the weaker of the two ballots.

Needs an owner decision on whether proxy voting is finished or abandoned. This
loop does not make that call.

## Elections — The In-App Ballot Only Shows Position Races (2026-08-12)

An election can carry three kinds of ballot item — `officer_election`,
`general_vote` and `membership_approval` — and the Ballot Builder happily
creates all three. Members reach a ballot two ways, and the two disagree about
what is on it:

- **The public token ballot** (`BallotVotingPage`, `/ballot?token=…`, the link
  sent by email) reads `election.ballot_items` and renders every item, then
  submits them atomically as `{ballot_item_id, candidate_ids | rankings | …}`.
- **The in-app Cast Vote tab** (`ElectionBallot`, on the election detail page)
  never reads `ballot_items` at all. It derives the ballot from
  `election.positions`, renders the candidates for each, and submits **one
  position at a time** as `{position, …}`.

So an item with no position — a bylaw amendment, a membership approval —
is invisible to anyone voting in the app. It is not refused or flagged: the
ballot simply does not mention it, and the submit button names the one position
it did find ("Submit Vote for Captain"). A secretary who builds a two-item
ballot and watches members vote in-app gets a result for one item and silence on
the other.

Reproducible in the demo data: the seeded "Line Officer Election — 2027 Term"
has a Captain race and an Article IV quorum amendment, and
`docs/training/images/04-42-cast-ballot.png` is the in-app ballot showing only
the former.

This is not a small patch — the in-app component would have to move from the
position model to the ballot-item model the public page already uses, including
its submission shape. Needs an owner decision on whether to converge the two
ballots or retire one of them. This loop does not make that call.

**Update (2026-09-02, security review ELEC-28):** the backend-side half of
this gap is now closed for eligibility purposes — `send_ballot_emails`
correctly snapshots `eligible_positions` on the token for a mixed election
(ELEC-23, ELEC-26 in `docs/security-review/ELEC-06-elections-ballots.md`),
and `/ballot/lookup` correctly returns the eligible positions and their
candidates to that token. But this UI gap means it doesn't matter: a member
eligible **only** for a plain position in a mixed election (ineligible for
every structured ballot item) now correctly receives a live token, opens
`BallotVotingPage`, and sees an **empty ballot** — no positions render, so
there is nothing to vote on. A member eligible for both a position and an
item sees only the item, and submitting it spends the single-use token with
no way back to the position vote. Confirmed the backend's single-vote token
route (`POST /elections/ballot/vote`, `cast_vote_with_token`) that could in
principle carry a positional vote is not called from any current frontend
code — there is no wiring to repurpose, only a route to design a UI and
submission contract around. Through the product today, a plain-position
contest inside a mixed election cannot be voted on by an emailed-token
recipient at all. Not fixed for the same reason as the original finding: it
is a UI/submission-contract design decision, not a mechanical fix.

## Training — The Student View of a Cohort Has No Frontend (2026-08-12)

The API implements it. `GET /training/cohorts/{id}` served to a member on the
roster returns the class timeline in full and `members: []` — the roster,
classmates and per-member progress withheld exactly as intended — and
`GET /training/cohorts/mine` lists the cohorts that member is on. A member who
is _not_ on the roster gets a 404 rather than confirmation the cohort exists.

None of it is reachable from the application:

- `/training/cohorts/:cohortId` is wrapped in
  `<ProtectedRoute requiredPermission="training.manage">`, so a member who
  types the URL gets **Access Denied**, not the reduced view.
- `getMyCohorts()` exists in `trainingServices.ts` and has **no caller**
  anywhere in `frontend/src` — nothing fetches a member's own cohorts.
- Nothing links a member to a cohort. The only navigations to the detail route
  are from `CohortsPage`, which is itself officer-gated.
- `CohortDetailPage` has no member branch. Reached with `members: []` it would
  render a **Roster (0)** tab rather than omitting the tab.

So the access restriction is real and enforced server-side, but the screen the
restriction was designed for was never built. `docs/training/02-training.md`
described the member's view as something a member can open today; that
paragraph has been corrected, and its screenshot placeholder retired.

Finishing it means deciding who may open a cohort page and building the
member's half of `CohortDetailPage` — a permissions decision plus a feature,
not a correctness fix. This loop does not widen route guards, so it needs an
owner.

## Elections — Saved Ballot Templates Accept Fields They Then Discard (2026-08-12)

`POST /elections/templates/saved-ballots` answers **201** to a ballot item
carrying a `candidates` array, and stores the item without it. The safety
guarantee holds — no candidate, voter, vote or token data can reach a template,
because `BallotItem` has no field to hold one — but the caller is told the write
succeeded in full.

The asymmetry is that `SavedBallotTemplateCreate` sets
`ConfigDict(extra="forbid")`, so a stray key at the _template_ level is
rejected with a 422, while a stray key one level down inside `ballot_items` is
silently dropped. Two adjacent parts of the same request body answer the same
mistake differently.

The obvious fix — `extra="forbid"` on `BallotItem` — is not this loop's to make:
`BallotItem` is shared with election creation and update, so tightening it
rejects requests that are accepted today, from clients this repository does not
contain. That is a compatibility decision with an owner, not a correctness fix.
Nothing is at risk in the meantime; the failure mode is a misleading 201, not a
leak.

## Elections — Saved Ballot Templates Have No List Bound or Creation Cap (2026-08-25)

`GET /elections/templates/saved-ballots` (`list_saved_ballot_templates`)
returns every template in the caller's organization with no pagination or
limit, and `POST /elections/templates/saved-ballots` (`save_ballot_template`)
imposes no per-org cap on how many can exist. Access control is sound —
both are `elections.manage`-gated and org-scoped, and each template is
already bounded per-item (250 ballot items, 2,000-character description,
200-character name) — so this is a scaling concern, not a leak: an org that
accumulates many templates over time pays a growing cost on every Ballot
Builder load, with no ceiling.

Not fixed because both remedies are behavior changes needing an owner
decision: pagination changes the response envelope (this codebase's
established `PaginationParams` + slice pattern, e.g. `finance.py`'s
`list_member_dues`, is a drop-in for the backend but a frontend contract
change for the Ballot Builder's template list); a creation cap needs an
actual number picked by a human, the same kind of open-ended limit left to
an owner decision elsewhere (FIN-7's export cap, the various CS-config
thresholds). (Security review ELEC-12,
`docs/security-review/ELEC-06-elections-ballots.md`.)

## Elections — Vote Receipt Verification Takes Its Credential as a GET Query Parameter (2026-09-02)

`GET /elections/{id}/verify-receipt?receipt=...` (`verify_vote_receipt`)
binds `receipt` as a bare scalar parameter on a `GET` route, so it travels
in the URL query string rather than a request body — unlike the other three
public token routes (`/ballot/lookup`, `/ballot/vote`, `/ballot/vote/bulk`),
which all carry their credential in a POST body specifically so it never
lands in server/proxy access logs or browser network history (R-D3). A
receipt hash cannot cast, change, or reveal the content of a vote — it only
confirms a matching vote was recorded, plus its timestamp and position — but
it is still a value tied to one specific voter's one specific ballot, and a
query-string value is more exposed than a body value to logging
infrastructure the application doesn't control.

Not fixed: converting this endpoint to `POST` with the receipt in the body
would be a public API **shape** change, not a mechanical one. This exact
`GET .../verify-receipt?receipt=` contract is documented as a stable,
external-facing endpoint in `wiki/API-Reference.md`, `ARCHITECTURE.md`,
`BALLOT_FORENSICS_GUIDE.md`, and the training materials — any of which may
already have a caller depending on the GET shape — so changing it needs an
owner decision about that external contract, not a guess made during a
security-review pass. (Security review ELEC-14,
`docs/security-review/ELEC-06-elections-ballots.md`.)

## Elections — Manual Ballot Batch Listing Has No Bound (2026-09-02)

`list_manual_ballot_batches` (`GET .../manual-ballots`) returns every
paper-tally batch recorded for an election with `scalars().all()`, eagerly
loads every batch's attestations, and aggregates every associated vote —
with no pagination or per-election cap. Access control is sound
(`elections.manage`-gated, org- and election-scoped, the same trust boundary
as `SavedBallotTemplate` below), so this is a scaling concern rather than a
leak: an election that accumulates many paper-tally sessions over a long
voting window pays a growing, uncapped cost on every load of this listing.

Not fixed for the same reason as the saved-ballot-templates item below:
pagination changes the response envelope (a frontend-affecting contract
change for the manual-ballots admin screen), and a per-election batch cap
needs an actual number picked by a human. (Security review ELEC-16,
`docs/security-review/ELEC-06-elections-ballots.md`.)

## Elections — Two Ballot Items Sharing an Alias String Can't Be Fully Disambiguated Without a Schema Change (2026-09-02)

A legacy ballot item (one persisted without its own `position` field) is
matched by its `title` _or_ its `id` — `ballot_item_candidate_positions()`
needs both, because a real candidate/vote for that item can be stored under
either convention depending on which code wrote it, and matching only one
would silently empty a legitimate item's candidate list. The schema
(`BallotItemInput.unique_item_ids`) enforces only unique **ids** across an
election's ballot items — nothing stops a _different_ item's `title` (or
explicit `position` override) from equaling this item's `id`.

When that collision happens, a stored `Candidate`/`Vote` row carrying that
exact string is genuinely ambiguous: `Vote` has no `ballot_item_id` column,
only `position` (a string) and `candidate_id`, and `Candidate.position`
carries the identical ambiguity — which item a candidate was originally
created "for" is not persisted anywhere once its position string is
stored. Neither table can be joined back to a specific item's identity to
settle the question.

The one instance of this that was concretely reported (security review
ELEC-38) — the duplicate-vote pre-check treating a different item's stored
vote as a re-vote on this item — **is** fixed for votes written after
ELEC-34 (round 7): that check only needs to decide "would this read as a
re-vote," where under-matching is safe as long as a genuine repeat vote is
dedup-hashed against the item's own canonical id, never its title, so the
database's `vote_dedup_hash` UNIQUE constraint still catches an actual
duplicate on that exact item even after a colliding alias is excluded from
the pre-check. `_dedup_scoped_item_aliases()` drops a fallback alias from
the pre-check whenever another item in the same election already claims
that exact string as its own canonical key.

**Correction (security review ELEC-40, round 10):** that "still caught by
the UNIQUE constraint" guarantee does not reach a vote row whose
`vote_dedup_hash` predates the id-based convention itself — i.e. a vote
`cast_vote_with_token` wrote for a legacy item before ELEC-34 landed, back
when the hash was computed against the title (`Vote.position`'s own value
for that route, which ELEC-34 never changed — only the hash input was
redirected to the item's id). For such a row, dropping its title alias
from the pre-check removes the only mechanism that could have caught a
second vote on it: the new vote hashes against the item's id, the old row
against its title, and the two never collide. Genuinely rare in practice —
it additionally requires the same election to already have a title/id
alias collision between two ballot items — but real, and not fixable by
adjusting the pre-check alone without reopening ELEC-38 (there is no way
to keep both fixed with string matching, since the schema still cannot
disambiguate the two colliding items apart from the string itself, per
above). Flagged rather than guessed at; a full fix needs one of: reverting
the pre-check narrowing (accepting ELEC-38's false-positive back) or a
backfill migration re-hashing existing legacy-item votes to the id-based
convention — both are product/data-migration decisions for an owner, not
something to pick during a review pass.

What is **not** fixed, and cannot be with today's schema: full
disambiguation of candidate/vote _ownership_ when two items collide this
way. If both colliding items happen to have real, legitimately
title-keyed/id-keyed candidates stored under the exact same string, there
is currently no way — for candidate-list rendering, eligibility, tallying,
or any other consumer of `ballot_item_candidate_positions()` — to tell
which item a given stored row actually belongs to; the function
necessarily returns the union of both, and the broader (unscoped) alias
matching it produces is deliberately left in place at those other call
sites for exactly that reason. Fixing this fully would need a schema
change — e.g. an explicit `ballot_item_id` column on `Candidate` and/or
`Vote`, populated going forward and backfilled for existing rows where
resolvable — which is a data-model decision for an owner, not something to
guess at during a security-review pass. In practice this requires an
admin to deliberately configure two ballot items whose alias sets collide
in the same election; nothing else in the ballot-authoring UI encourages
or warns against it today. (Security review ELEC-38,
`docs/security-review/ELEC-06-elections-ballots.md`.)

## Users: Roster/Archive/Leave Lists Are Unbounded, Not Just Un-Paginated (2026-08-25)

`list_users_with_roles` (`users.py:601`) and `get_archived_members`
(`member_status.py:723`) return every matching row in the org with no
pagination; `leave_widget_summary` (`member_leaves.py:50`) materializes every
`active` leave to compute its counts, and `MemberLeaveService.list_leaves`
(`member_leave_service.py`) runs an unbounded query before its two callers in
`member_leaves.py` apply an in-memory slice. All four are `members.manage`-gated
and org-scoped — not a leak.

The reason this isn't self-limiting the way it first looks: `archive_member`
changes `User.status` without deleting the row, so archived accounts
accumulate for the organization's entire lifetime rather than being bounded
by current headcount, and leave records aren't deleted either (`end_date`
passing doesn't clear the `active` flag on its own — the deactivate endpoint
does, and only when called). A department open for years pays a growing cost
on every roster and leave-widget load, with no ceiling.

Not fixed for the same reason as the saved-ballot-templates item above:
pagination changes the response envelope for callers that currently expect
the full list (the Members admin page, the leave dashboard widget), which is
a frontend-affecting decision, not a drop-in. (Security review USR-5,
`docs/security-review/USR-07-users-organizations.md`.)

## Users: `GET /users` Sends the Full Admin Roster Record to Every `members.view` Holder (2026-09-02)

`members.view` — held by every default position, per the route's own
docstring — is enough to receive the same `UserListResponse` shape
`members.manage` gets: `username`, `hire_date`, `membership_number`, `rank`,
and `station` for every member in the org
(`app/services/user_service.py:24-91`, `app/schemas/user.py:271-298`). A
2026-09-01/02 frontend change (`frontend/src/pages/Members.tsx`) now presents
a visibly reduced "Member Directory" for callers without `members.manage` —
no username, no Hire Date column, no export/bulk actions — framed as "a
member without the grant gets a directory; a coordinator gets the management
table." That framing implies an access-control boundary that does not exist
server-side: every field the directory view hides is still in the JSON `GET
/users` response reaching that caller's own browser, readable via devtools'
Network tab or a direct authenticated call to the endpoint. Not a
cross-tenant leak (org-scoped throughout) and not on the leadership-only PII
list (DOB, emergency contacts) enforced elsewhere in this module — but a real
mismatch between the UI's implied tiering and the actual wire payload.

Not fixed: `GET /users` is consumed by 25+ frontend files beyond the roster
page (scheduling, messaging, elections, meetings, waivers, shift reports),
several of which need `rank`/`station`/`platoon` at the `members.view` tier
for legitimate, non-directory purposes. Trimming the response naively would
break those callers; the fix needs a decision on whether `GET /users` should
serve two shapes by permission or a narrower directory endpoint should be
split out. (Security review USR-8, `docs/security-review/USR-07-users-organizations.md`.)

## Membership Pipeline — Election Packages Have No List Bound or Creation Cap (2026-08-25)

`GET /prospective-members/election-packages` (`list_election_packages`) runs
`.scalars().all()` with no pagination or limit, and `POST
/prospects/{id}/election-package` (`create_election_package`) imposes no
per-prospect or per-organization cap — there is no unique constraint on
`ProspectElectionPackage.prospect_id` and no "already has a ready package"
check, so every call inserts a new row. Access control is sound — both are
org-scoped and permission-gated (`elections.manage` / `prospective_members.*`)
— so this is the same scaling concern as the two entries above, not a leak:
repeated legitimate package regeneration (e.g. after editing coordinator
notes) accumulates rows, each carrying a PII-bearing snapshot (documents,
coordinator notes, config), without bound.

Not fixed for the same reason as the two entries above: enforcing one ready
package per prospect is a behavior change that could break an intended
"regenerate before the vote" workflow, and pagination on the list endpoint is
a response-envelope/frontend-contract change, not a drop-in. (Security review
MP-10, `docs/security-review/MP-08-membership-pipeline.md`.)

## Medical Screening — Requirement and Record Lists Are Unbounded (2026-08-06, mirrored 2026-08-25)

`list_requirements`/`list_records` (`medical_screening_service.py`) run
`.all()` with no SQL `LIMIT`/`OFFSET`; the endpoints slice the result in
Python, and `get_compliance_status`/`get_expiring_soon` build on the same
unbounded calls internally. Access control is sound — both are org-scoped
and `medical_screening.view`/`.manage`-gated — so this is the same scaling
concern as the entries above, not a leak: an organization with years of
screening history pays a growing per-request cost on every records,
compliance, and expiring-soon load, with no ceiling.

First flagged in `docs/app-review/medical-screening.md` pass 3 (2026-08-06)
as "Future dev"; not fixed for the same reason as the entries above —
SQL-level pagination is a response-envelope/frontend-contract change, not a
drop-in. Mirrored here for the first time in this security review pass.
(Security review MS-6, `docs/security-review/MS-09-medical-screening.md`.)

## Inventory — Two Cross-Member Reads Sit Behind the Baseline `.view` Grant (2026-08-26)

`GET /allowances/check/{user_id}/{category_id}` (allowance usage count) and
`GET /members/{user_id}/size-preferences` (stored uniform/PPE measurements)
both let any authenticated member look up another named member's data by id
using only `inventory.view` — the permission every seeded Member position
holds. This is the same class of gap the `ccea2576`/`d7be097b` commits closed
across most of this module (item history, active/overdue checkouts, the
members-inventory roster) and that this review's own INV-7 finding closed on
the departure-clearance-by-id route, but these two were not part of either
sweep.

Not fixed here because, unlike INV-7, this module has no established
precedent for what the intended gate is: INV-7 had an identically-shaped
sibling route (`/users/{user_id}/clearance`) already gated
self-or-quartermaster, making the fix mechanical. Allowance usage and size
data may be legitimately visible to more roles than clearance/checkout
detail (e.g. an officer approving an allowance request, or a future
supply-ordering workflow needing a colleague's size) — narrowing the gate is
a product decision about who should see it, not a mechanical match. (Security
review INV-8/INV-9, `docs/security-review/INV-11-inventory.md`.)

## Inventory — Ordinary Reorder Edits Bypass the Versioned Workflow (2026-08-28)

`PATCH /reorder-requests/{id}` (`update_reorder_request`) neither locks the
row nor increments `version`, unlike the `/transition`, `/correct-status`,
and `/receipts` endpoints added alongside it. An edit through the plain
PATCH endpoint is not serialized against a concurrent transition/receipt on
the same request, and lowering `quantity_requested` after a partial receipt
can leave `quantity_received` above the new (smaller) total — a state
`receive_reorder`'s outstanding-quantity check does not anticipate.

Not fixed because closing it means choosing between two designs with real
API-contract consequences: requiring every PATCH caller to send
`expected_version` (breaking the existing frontend edit form), or
restricting which fields PATCH may touch once receiving has started (a
product decision about what "editing an order in flight" means). (Security
review INV-16, `docs/security-review/INV-11-inventory.md`.)

## Inventory — "Complete Work" Always Creates a New Maintenance Record (2026-08-28)

`InventoryMaintenancePage.tsx`'s maintenance-completion flow always calls
`createMaintenanceRecord` rather than updating an item's existing open
(scheduled/in-progress) record. The original record is never closed, so it
stays permanently "due" in `getMaintenanceDueItems` alongside the new
completed record — maintenance history and outstanding-work/compliance
reporting disagree even after the item is genuinely back in service.

Not fixed because a correct fix needs to identify which open record a
completion is closing (an item is not currently prevented from having more
than one), which needs new data-fetching in the modal and a decision about
the multiple-open-records case. (Security review INV-17,
`docs/security-review/INV-11-inventory.md`.)

## Membership — Department Email Generation Has No Settings Screen (2026-08-12)

The backend implements department email generation end to end.
`DepartmentEmailSettings` (`enabled`, `domain`, `format`) is a real field on
organization settings, `PUT /organizations/{id}/settings` accepts it, and
`MembershipPipelineService._generate_department_email` uses it when a prospect
is transferred to membership — including the numeric-suffix collision handling
(`john.smith2@…`) the guide describes.

What does not exist is anywhere to set it. The frontend references
`DepartmentEmailSettings` in exactly two places — `types/user.ts` and a type
annotation in `services/userServices.ts` — and no component renders a toggle, a
domain field, or a format selector. `docs/training/01-membership.md` sent
administrators to "Settings > Organization > Department Email", which is not a
section that exists.

The defaults are `enabled: false`, `domain: ""`, `format: first.last`, so out of
the box the feature is off and stays off. Turning it on today requires writing
organization settings through the API. The guide now says so, and its screenshot
placeholder is retired until a screen exists to photograph.

Needs an owner decision: whether to build the settings section or drop the
feature. This loop does not make that call.

## Prospective Members — Two Bulk-Action Bars Render At Once (2026-08-13)

Selecting applicants in **Table** view puts two independent bulk-action bars on
the screen, stacked, each reading "N selected". They come from different
components and neither is a superset of the other:

| Bar                                  | Offers                                |
| ------------------------------------ | ------------------------------------- |
| `ProspectiveMembersPage.tsx` (upper) | Print Badges, Advance All, Reject All |
| `PipelineTable.tsx` (lower)          | Advance, Hold, Reject                 |

The two "advance" buttons run different code paths — `handleBulkAdvance` and
`handleBulkAction('advance')` — and reach the same endpoint, so pressing either
does the same thing. Hold is only on the lower bar; Print Badges only on the
upper. A coordinator has no way to tell that from looking at them.

Found while verifying `15-11-table-bulk-actions`, which pictures both bars. The
guide now describes them as two bars rather than one, because that is what the
screen does.

Needs an owner decision: which bar survives, and where Hold and Print Badges
live afterwards. Merging them changes the documented action list, so this loop
does not make that call.

## Prospective Members — The Progress Track Still Draws Stages Not Yet Reached (2026-08-13)

`regress_prospect` used to leave the stage it vacated marked `in_progress`
rather than returning it to `pending`. That is fixed, but rows written before
the fix survive in any long-lived database, and the applicant drawer draws one
chip per non-pending row — so an applicant can show chips for stages ahead of
the one they are on.

The display no longer _contradicts_ itself: the current-stage marker and the
"N of M stages completed" count both read the progress record's own status
rather than inferring from a `completed_at` stamp, so the ticks and the count
agree with the Current Stage panel. The only symptom left is extra chips.

Self-healing is partial. `seed_demo_data.py` walks an applicant back to the
first stage and forward again when it finds an unfinished stage _behind_ them,
which repairs that class completely. A stale row _ahead_ of an applicant can
only be reset by vacating it, which means advancing them onto it first — and
for the election-vote stage that creates an election package, changing data the
elections guide's screenshots are composed around. Not worth it for a cosmetic
chip.

Needs an owner decision if it matters in production: a one-off data migration
that normalises `prospect_step_progress` against each prospect's
`current_step_id` would clear it in one pass.

## Scheduling — Sign Up Appears On Shifts A Member Cannot Take (2026-08-13)

The Dashboard's Open Shifts panel renders a **Sign Up** button on every open
shift. Rank eligibility is resolved only when the button is pressed:
`handleExpandSignup` fetches the member's eligible positions for that shift and
the expanded card then shows either a position dropdown or the flat message
"Not eligible for this shift."

So a member with no qualifying position gets an inviting green button and a
refusal one tap later. Nothing on the card distinguishes the two cases in
advance, and `openShifts` is not filtered by eligibility before rendering.

`docs/training/03-scheduling.md` had described the opposite — that the button
"only shows for shifts where the member's rank qualifies". It now describes what
the screen does, and `03-62-dashboard-signup-positions` pictures the expanded
dropdown.

Needs an owner decision: pre-fetching eligibility for every visible shift costs
a request per card, so hiding or disabling the button up front is a real
trade-off rather than an obvious fix.

## Storefront — The Payments Tab Cannot Be Screenshotted, By Design (2026-08-13)

`store_payment_events` rows are written from one place: the public PayPal
webhook at `app/api/public/paypal_webhook.py`, which resolves the integration,
verifies the payload against PayPal's verify-webhook-signature API, and only
then records the capture. The authenticated storefront API exposes `GET
/payments`, `POST /payments/{id}/apply` and `POST /payments/{id}/ignore` — read
and resolve, no create.

That is the right shape for a ledger of what an external provider reported: a
hand-written row would be a claim about money movement nobody can substantiate.
It also means a demo department, which has no PayPal account and no verifiable
signature, has an empty Payments tab and always will.

`docs/training/18-storefront.md` therefore documents the tab in prose and its
screenshot placeholder is retired, with the reason in the guide so the next
person does not re-diagnose it. Same shape as the elections public ballot and
the Salesforce connection recorded elsewhere in this file.

## Messaging — Persistent Notices Can Fall Off the Dashboard Card (2026-08-13)

**✅ Resolved (2026-08-13, owner-directed).** The dashboard "Department
Messages" card used to load the **10 most recent** inbox messages with
`include_read` at its default (true), so read non-persistent messages never
dropped off the card and an **unpinned persistent** notice older than the 10
most recent messages disappeared from it — against the training guide's "stays
on the dashboard until leadership takes it down" (MSG2-6,
[app-review/messaging.md](./app-review/messaging.md)). The card now loads with
`include_read: false`: it shows only what still needs attention — unread
messages, unacknowledged ack-required messages, and persistent notices (which
the backend exempts from that filter). A message a member just clicked is
marked read in place rather than removed mid-view; it drops off on the next
load. Persistent notices are ordered ahead of newer non-persistent messages,
so the card's 10-item preview cannot lose a standing notice behind an ordinary
pending-message backlog. Pinned notices remain first within the preview.

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

## Onboarding Cannot Be Resumed Across a Browser Restart (2026-08-15)

**Status: accepted trade-off**, recorded because it is visible to installers and
because the wizard's own behavior makes it look like a bug.

The onboarding session identifier moved from `localStorage` to `sessionStorage`
so that a bearer credential capable of authorizing setup mutations cannot outlive
the tab on a shared or station-kiosk machine. The consequence is that onboarding
is now a **one tab, one sitting** operation: a second tab starts a new server
session, and closing the browser ends the run (as does 30 minutes of inactivity,
which was always true — the server session expires on a sliding 30-minute timer).

What makes this worth recording rather than merely documenting: the wizard's
typed answers live in a _different_ store (`localStorage['onboarding-storage']`),
which the change deliberately did not touch, because they are non-sensitive and
re-typing an entire department profile is a real cost. So reopening `/onboarding`
after a restart **repaints the form** while the session behind it is gone. The
failure surfaces at the next step that saves something, as `401` /
`ONBD_SESSION_INVALID` — not at the repaint, where the user would understand it.

The obvious tightening — clearing `onboarding-storage` whenever the session
identifier is absent — was not done, because it would discard a part-finished
department profile every time an installer glanced at another tab and came back.
An owner may want the opposite trade; the honest middle option is a banner on
wizard load that says the session has expired and the answers shown are a local
draft. Until then the guides carry the caution explicitly (see
[`ONBOARDING.md`](../ONBOARDING.md) → Data Persistence and
[`training/00-getting-started.md`](./training/00-getting-started.md)).

## Medical Screening — The Route Has No Permission Gate (2026-08-16)

**✅ Resolved (2026-08-24, verified by security review MS-4, 2026-08-25).**
`getMedicalScreeningRoutes()` (`frontend/src/modules/medical-screening/routes.tsx`)
now wraps the route in `<ProtectedRoute requiredPermission="medical_screening.view">`,
closed incidentally alongside 20 other officer pages by "Stop seeding
compliance.view to everyone; gate 21 officer pages" (`05b8275b`) — a change
this entry was never updated to reflect. Re-verified directly against the
current file rather than inferred from the commit message.

## DASH-1 — The Main Widget Registry Is Mostly Unread (2026-08-23)

`frontend/src/components/dashboard/widgetRegistry.ts` declares eight widgets,
each with a `permission`, an `aggregatePath` and a `queuePath`. **Only one —
`department-setup` — is read by any screen**, via
`dashboardWidget('department-setup')` in `OrganizationSetupWidget.tsx`. The
other seven are exported, covered by a test that asserts the registry against
itself, and consumed by nothing.

Seven of the eight `aggregatePath` values do not resolve to a mounted route:

| `aggregatePath`                           | Resolves to a mounted route?                                   |
| ----------------------------------------- | -------------------------------------------------------------- |
| `/users/leaves-of-absence/widget-summary` | ✅ yes                                                         |
| `/membership-pipeline/widget-summary`     | ❌ **no** — the route is `/prospective-members/widget-summary` |
| `/organizations/setup-checklist`          | ❌ **no** — the router mounts at `/organization`, singular     |
| `/onboarding/widget-summary`              | ❌ no                                                          |
| `/users/status/widget-summary`            | ❌ no                                                          |
| `/admin-hours/widget-summary`             | ❌ no                                                          |
| `/meetings/widget-summary`                | ❌ no                                                          |
| `/messages/widget-summary`                | ❌ no                                                          |

> **Corrected 2026-08-24 — it is seven of eight, not five.** The two rows now
> marked ❌ were previously recorded as ✅. Both were checked by finding the
> route decorator (`@router.get("/widget-summary")`,
> `@router.get("/setup-checklist")`) without also checking the `include_router`
> prefix in `app/api/v1/api.py` — which is `/prospective-members` and
> `/organization` respectively, not the paths the registry declares. A
> decorator alone never gives the URL. The same mistake produced three wrong
> endpoint URLs in the August 23–24 API reference, caught in review on #1772.

**Status:** Open (LOW — found 2026-08-23, verified against the code the same
day).

Nothing is broken today, because nothing fetches those paths. This is
[pitfall #19](../CLAUDE.md) in its milder form — a declaration without a
reader — and the risk is entirely forward-looking: the next contributor wires
a widget to the registry, trusts a path that sits in a file called a
registry, and gets a 404 from an endpoint that was never built.

| Option                                            | Consequence                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Build the five missing `widget-summary` endpoints | Makes the registry true. Five endpoints of work, each needing its own permission scoping |
| Mark the unwired entries in the file              | Cheap and honest; the registry stops reading as a promise                                |
| Delete the seven unread entries                   | Smallest surface, but discards the design intent the file records                        |

Not resolved here because it is a design decision about how far the widget
layer is meant to go, not a documentation fix.

## SCHEMA-1 — `compartment_name` Is Widened Twice (2026-08-23)

`20260820_1300_d6f4a13c9e20` and `20260821_4c8d7e2a91b3` are the same
migration authored twice: both widen `shift_equipment_check_items.compartment_name` from
`VARCHAR(200)` to `TEXT`, on two different parents. Both are reachable —
`d6f4a13c9e20` through the `9bb38ab9b052` merge, `4c8d7e2a91b3` through the
chain beneath it.

**Status:** Accepted (LOW — found 2026-08-23).

Re-applying the widening is a no-op on a column that is already `TEXT`, so
this costs nothing at upgrade time and does not warrant a corrective
migration. Two things make it worth recording rather than ignoring:

1. **It looks like an error when read cold.** Anyone auditing the migration
   list will find two revisions with the same description and the same
   effect, and has to reconstruct the history to learn it is benign.
2. **The downgrade is not symmetric.** Each `downgrade()` narrows the column
   back to `VARCHAR(200)`. **A downgrade past both will truncate deep
   compartment paths** — the exact data the widening was added to hold.

## Documents — Legal Revision History Is Unbounded (2026-08-25)

`LegalDocumentService.list_revisions` (`legal_service.py`) runs `.all()` with
no pagination or limit, and `GET /legal-documents` (`get_legal_documents`,
`legal_documents.py`) returns every draft and every archived revision's full
body (capped at 100,000 characters each) and change note, for both document
types, on every load of the Governance -> Legal Documents screen. Access
control is sound — org-scoped, `legal.propose`/`legal.publish`/
`settings.manage`-gated — so this is the same scaling concern as the entries
below, not a leak: a department with years of proposal history, or a
`legal.propose` holder repeatedly creating drafts (there is no per-user or
per-org cap on draft creation), pays a growing query and response cost on
every load, with no ceiling.

Not fixed for the same reason as the entries below: pagination changes the
response envelope this screen currently expects (full `drafts`/`history`
arrays inline per document type), a frontend-contract change rather than a
drop-in. (Security review DOC-8, `docs/security-review/DOC-10-documents-legal.md`.)

## Documents — Folder Listing Is Unbounded and N+1 (2026-08-25)

`get_folders` (`documents_service.py`) loads every folder at a given level
(root, or under one `parent_id`) with no `LIMIT`, then issues one additional
`func.count` query per folder to populate its document count — N+1, not just
unpaginated. Access control is sound — org-scoped and filtered through the
same folder-visibility rules the listing enforces — so this is a scaling
concern, not a leak: any `documents.manage` holder can create folders with no
per-org cap, so both the row count and the query count grow with however many
folders a department has created, with no ceiling.

Not fixed for the same reason as the entries above and below: pagination is a
response-envelope/frontend-contract change, not a drop-in. (Security review
DOC-9, `docs/security-review/DOC-10-documents-legal.md`.)

## Equipment Checks — `get_item_deployments` Gates on `.view`, Its Sibling on `.manage` (2026-08-26)

`GET .../deployments` (`get_item_deployments` — which checklist positions
carry a given inventory item) is gated on `inventory.view`, while
`update_deployed_lot`'s equivalent write on the same deployed-lot data
requires `inventory.manage`. Both belong to the same request; a caller who
can only view inventory can still read a full cross-checklist deployment
map, one tier looser than the write it feeds.

Not fixed here: unlike the mechanical INV-7 fix, this pairing has no
identically-shaped sibling already gated the tighter way to copy from, and
tightening a read gate is a behavior change — an existing `inventory.view`
holder's screen would start 403ing — that a security review does not make
unilaterally. `tests/test_permission_gate_composition.py`'s `ALLOWED` dict
already records this pairing as deliberately unadjudicated, for the same
reason. (Security review EC-14 residual,
`docs/security-review/EC-14-equipment-check-shifts.md`.)

## Outbound Integration Requests — The DNS-Rebinding TOCTOU Is Narrowed, Not Closed (2026-08-26, count corrected 2026-08-26)

`assert_outbound_url_safe()` (`app/utils/url_validator.py`) re-resolves an
org-configured integration URL's hostname via `socket.getaddrinfo()`
immediately before an outbound request, to catch a hostname that was
repointed at an internal address since it was saved. **Eight** call sites
share the gap, across three distinct transports:

- **Five** go through the shared `create_integration_client()` (plain
  `httpx.AsyncClient`) and share one remediation:
  `integration_services/{teams,webhook,slack,discord,calcom}_service.py`.
- **Two** construct their own `httpx.AsyncClient` directly rather than going
  through `create_integration_client` — a `create_integration_client` fix
  alone would not reach either; each needs either migrating onto the shared
  client or its own equivalent fix: `audit_ship_service.py`, and
  `external_training_service.py` (`ExternalTrainingSyncService.__init__`,
  found during the training-extended security-review pass — its provider
  base URL is `validate_integration_url`'d at write time and re-validated
  before every outbound call exactly like the other seven, so it shares this
  same TOCTOU shape; not itself a new/distinct gap, just an undercounted
  instance of this one. Its 30s timeout is deliberately longer than the
  shared factory's 10s — a full-catalog LMS sync legitimately runs longer
  than a webhook POST — so migrating it onto `create_integration_client`
  isn't a drop-in swap; the factory would need a per-call timeout override
  first).
- **`push_service.py`** doesn't use `httpx` at all — `_send_one` dispatches
  through `pywebpush.webpush()`, a synchronous library with its own
  connection handling. Pinning a resolved address here needs a
  transport-specific approach, not the httpx-level fix the other seven
  share; it would remain vulnerable if a fix were scoped only to
  `create_integration_client`.

In every one of the eight, the actual request performs its **own**
independent DNS resolution when it connects, separate from the
`assert_outbound_url_safe` check. A hostname that resolves to a public IP
for the check and an internal one moments later (classic DNS rebinding)
passes the check and still reaches the internal address. The function's own
docstring says it "shrink[s] the rebinding window... versus
save-time-to-send" — narrows, not closes — which is accurate; a security
review draft that read this as "closed," and then first wrote it up as six
files sharing one fix, was corrected twice (SCH-10, then a Codex review of
that correction itself), and the count was corrected again when the
training-extended pass found the eighth site.

Not fixed: closing it means pinning the address `assert_outbound_url_safe`
resolved for the actual connection (while preserving the original Host
header / SNI), separately for each of the three transports above — not one
shared-infrastructure change, and not a fix scoped to any single file. Needs
a dedicated cross-cutting pass (the shape SEC-00 exists for) that accounts
for all three transports, not a unilateral fix inside a feature-scoped
review. (Security review SCH-10, `docs/security-review/SCH-15-scheduling.md`;
count corrected by the training-extended pass,
`docs/security-review/TRX-18-training-extended.md`.)

## Training — Bulk/Historical-Import Enum Fields Have No Request-Level Validators (2026-08-26)

`BulkTrainingRecordEntry.training_type`/`.status`,
`HistoricalImportConfirmRequest.default_status`/`.default_training_type`,
and `CourseMappingEntry.new_training_type` have no `@field_validator`,
unlike the single-record `TrainingRecordCreate`/`TrainingRecordUpdate`
schemas, which do. All three are DB-level `Enum` columns on
`TrainingRecord`, so a bad value still reaches the database layer instead
of 422ing at the Pydantic boundary.

Not currently a crash risk: both bulk paths wrap each row's insert in its
own error boundary (`create_records_bulk` flushes per row inside a
try/except; `confirm_historical_import` runs each row in its own
`db.begin_nested()`), so an invalid enum value fails only that one row with
a sanitized message — the rest of the batch still imports.

Not fixed: adding a `@field_validator` to a `List[...]`-carried field
changes the failure mode from per-row partial success to whole-request
rejection, since Pydantic validates the full payload before the endpoint
runs at all. Whether that's the right trade-off for a bulk-import UX (fail
the whole file on one bad row vs. import what's valid and report the rest)
is a product decision, not a drive-by fix. (Security review TR-17 residual,
`docs/security-review/TR-17-training-core.md`.)

## Training — `enroll_member`'s Duplicate-Active-Enrollment Guard Is a Race (2026-08-26)

`TrainingProgramService.enroll_member` checks for an existing ACTIVE
enrollment (SELECT), then inserts a new `ProgramEnrollment` row — with no
unique constraint or row lock backing the check. Two concurrent enroll
calls for the same (user, program) pair can both pass the SELECT before
either commits, producing two ACTIVE enrollment rows for the same member on
the same program.

Data-integrity, not a tenant-isolation or capacity-abuse issue — no
cross-org effect, and the practical impact is a duplicate enrollment record
rather than anything security-relevant.

Not fixed: closing it needs a schema change (a partial unique index on
`(user_id, program_id)` where `status = 'active'`, or an equivalent
row-locking guard matching CLAUDE.md Pitfall #27's shape), which this
rotation's process reserves for a flagged item rather than a drive-by
fix inside an unrelated finding. (Security review TR-17 residual,
`docs/security-review/TR-17-training-core.md`.)

## Training — `GET /training/records` Has No Pagination (2026-08-29)

Unlike the rest of the codebase's per-record list endpoints (e.g.
`events.py`'s `list_events`, which takes `skip`/`limit` with a hard cap),
`list_records` in `training.py` returns every matching `TrainingRecord` row
with no `skip`/`limit`/page bound — an officer with `training.manage` can
trigger a single unbounded read across the whole org's training-record
history, which only grows over a department's lifetime.

Not a tenant-isolation issue (the query is correctly org- and, for
non-officers, self-scoped) and not currently exploitable beyond a large,
slow response — but it is the "no `all()` over an org-wide table" abuse-
resistance gap the review checklist calls out, and the module's own other
list endpoints (courses/categories/requirements) are naturally small
configuration tables where this doesn't apply, which is likely why it went
unnoticed.

Not fixed: `trainingServices.ts`'s `listRecords()` returns a bare array that
callers (`MyTrainingPage`, admin record tables) consume as the complete
set to build client-side stats and tables with no pagination UI. Adding a
server-side cap would silently truncate a large org's data for those
callers rather than degrade gracefully, so it needs a paired frontend
change (a `Pagination` UI or a "load more" affordance) rather than a
backend-only drive-by fix. (Security review TR-17 pass 2,
`docs/security-review/TR-17-training-core.md`.)

## Training — Dashboard Summary Is an Unbounded Per-Request Scan (2026-08-29)

`get_training_dashboard_summary` (`app/api/v1/endpoints/training.py`) loads
every active `User`, every active `TrainingRequirement`, and every
`TrainingRecord` belonging to those users for the org, with no date bound or
row limit, then evaluates each member's applicable requirements in Python.
Until this pass, the endpoint's 30s-fresh/90s-stale frontend cache absorbed
repeated dashboard mounts within that window. TR2-1/TR2-3 (this pass)
correctly excluded it from that cache — the response carries per-member
names, so caching it risked serving stale PII past a permission or record
change — but removing the cache means every dashboard mount or manual
refresh now re-runs this unbounded scan directly against the database.

Not fixed: closing this needs the query itself bounded (e.g. limiting
`TrainingRecord` rows to what each requirement's own lookback/
recertification window actually needs, via the same logic
`training_compliance.py`'s `get_requirement_date_window` already applies) or
reworked into a set-based/aggregate evaluation instead of loading every row
into Python. Either is a service-level query redesign entangled with
`evaluate_member_requirement`'s per-requirement date-window correctness, not
a safe drive-by alongside a cache-exclusion security fix. Same abuse-
resistance class as the `GET /training/records` limitation above; this one
is now more pressing since a cache-based mitigation was correctly removed
out from under it. (Security review TR-17 pass 2,
`docs/security-review/TR-17-training-core.md`.)

## RPT2-29-2 — Saved Report Scheduling Is Stored and API-Writable, but Nothing Reads It (2026-08-27)

`POST /reports/saved` and `PATCH /reports/saved/{id}` fully accept and
persist `is_scheduled`, `schedule_frequency` (daily/weekly/monthly/quarterly),
`schedule_day`, and `email_recipients`. `GET /reports/saved` reports
`next_run_at` back to the caller as though it's live. But no code anywhere
reads these fields to actually generate and email a report:

- `create_saved_report` never computes `next_run_date` — it stays `None`
  forever.
- `scheduled_tasks.py`'s `TASK_RUNNERS` registry has no entry for saved/
  scheduled reports (`run_compliance_auto_reports` is a distinct,
  `ComplianceConfig`-driven feature, not `SavedReport`-driven).
- No Celery beat / APScheduler config exists for this anywhere in the
  backend.

This is CLAUDE.md **Pitfall #19** — a config switch with no reader. A chief
can set `is_scheduled=True`, `schedule_frequency="weekly"`, add
`email_recipients`, see it listed as scheduled, and no report is ever
generated or emailed, with no error at any point.

**Fix applied (2026-08-27):** `SavedReportResponse.enforced` reports `False`
(hardcoded — there is no per-row state to compute; see the comment on
`SavedReport.is_scheduled` in `app/models/analytics.py`) and the frontend's
`SavedReportConfig` type now carries the same field, so a future
saved-reports screen can show a saved report as "not yet automated" rather
than badging it Active. **No UI currently exposes this at all** —
`ReportsPage.tsx` doesn't render saved reports despite `reportsStore.ts`/
`services/api.ts` having full CRUD support for them — so nothing is
mislabeled in the shipped app today; this closes the type gap Codex flagged
on PR #1912 ahead of that screen being built. The underlying scheduling
fields are left writable (no data-model change) — wiring a `TASK_RUNNERS`
entry that scans due `SavedReport` rows, generates, emails via the resolved
creator's permissions (the RPT-3 PII gate lives only in the endpoint layer
today, so a future sender must re-derive or enforce it itself before
emailing any of `PII_REPORT_PERMISSIONS`' report types — `member_roster`,
`pipeline_overview`, `training_summary`, `training_progress`,
`annual_training`, `certification_expiration`, `compliance_status`, and
`admin_hours` — output), advances
`next_run_date`, and builds the saved-reports screen itself is a feature
addition, not a security-review drive-by fix.

**Options for closing it:** (1) implement the `TASK_RUNNERS` reader, or (2)
reject `is_scheduled=True` at the API layer with a clear "not yet supported"
error until a sender exists, rather than the current silent-accept.

## CRON2-31-12/13 — Two Scheduled-Task Gaps Left Open by This Rotation's Pass (2026-08-27)

- **`run_action_item_reminders` has no org loop at all**
  (`scheduled_tasks.py`), so it was never in scope for the CRON-2
  deactivated-org fix or its regression test — it queries
  `MeetingActionItem`/`MinutesActionItem` platform-wide with no join back
  to `Organization.active`. Latent today (nothing sets `Organization.active
= False` yet). Closing it means joining two different action-item tables
  through two different parent tables (`Meeting`, `MeetingMinutes`) to
  `Organization` — a structural change, not a drive-by.
- **`run_admin_hours_auto_close` has no audit trail**
  (`admin_hours_service.py`'s `auto_close_stale_sessions`) — force-closes a
  member's open admin-hours session (a money-adjacent paid-hours state
  change) with no `log_audit_event()` call anywhere in that file. What to
  log (per-session vs. one batched summary event) is a design choice for
  the admin-hours feature to make deliberately.

See `docs/security-review/CRON2-31-scheduled-tasks.md` for the full pass
(12 findings fixed, these 2 flagged).

## CRON-31-7/8 — Two More Scheduled-Task Dedup Trade-offs, and a Redis-Down Fallback (2026-08-31)

A second security-review pass over `scheduled_tasks.py` and the in-process
scheduler in `main.py` fixed six new findings (`docs/security-review/
CRON-31-scheduled-tasks.md`) and flagged three, all deliberate trade-offs
rather than bugs with an obviously-correct fix:

- **`run_end_of_shift_summary` can mark a member "sent" without either
  channel actually reaching them** if both the in-app notification build and
  the email send fail for the same member — the same dedup-stamped-early
  shape CRON2-31-3 fixed elsewhere, but here the realistic exposure is much
  narrower (the in-app half is an in-memory operation, not a flush, so it
  almost never fails on its own) and changing it means deciding whether
  "in-app succeeded, email failed" should count as delivered for this one
  task — a product call.
- **`run_event_reminders` stamps a due reminder interval as sent when zero
  recipients exist yet** (an event targeted at "going" RSVPs, with nobody
  RSVP'd at the moment that interval comes due) — by explicit, commented
  design ("avoid re-processing"), not an oversight. A late RSVP after that
  point will not retroactively receive that specific interval's reminder,
  though closer, not-yet-due intervals still fire normally.
- **The in-process scheduler's Redis-down fallback runs on every worker,
  unguarded.** `main.py`'s `_try_claim_background_task` returns "you may
  run this" on any Redis error, so if Redis is unavailable, every uvicorn
  worker runs the scheduler loop concurrently with no coordination — a
  duplicate-notification risk (two workers processing the same due row),
  not a data-loss or security risk. The alternative (fail closed, run on no
  worker) is worse for this feature: zero scheduled tasks would fire until
  Redis recovers. Mirrors the documented breached-password fail-open
  trade-off in CLAUDE.md's Attack Protection table.

## LOC-3 — The Authenticated Location Display Endpoint Is Dead Code With a Growing Gap List (2026-08-27)

`GET /locations/{id}/display` (`locations.py`) has had **zero frontend
callers** since it was first reviewed on 2026-08-08 — the kiosk fetches
`/api/public/v1/display/{code}` instead, which is a strictly better
implementation (rate-limited, uses the canonical check-in-window helper,
computes `is_valid` correctly, withholds event descriptions).

The 2026-08-08 pass flagged two gaps that would need closing if this
endpoint were ever wired up rather than deleted: it hardcodes
`is_valid=True`/`can_check_in=True`, and never populates the `timezone`
field its public sibling does. The 2026-08-27 security-review pass
(`docs/security-review/LOC2-32-locations-kiosk.md`) found the drift grew a
**third** gap in the meantime: it still emits
`event_description=event.description` while the public path explicitly
nulls that field with a comment ("Don't expose description publicly").

Not fixed either pass, deliberately: deleting or wiring up an endpoint is an
API-surface decision, not a correction. The department decision is the same
as it was — delete this endpoint, or give it a caller and bring it in line
with its public sibling on all three points before that caller ships.

## CI2-33-13 — Injection-Attempt Detection Was Never Implemented (2026-08-27)

`SecurityMonitoringMiddleware`'s docstring claimed "Detect injection
attempts" among its capabilities. The code buffered up to 1MB of every
non-GET/HEAD/OPTIONS request body — including `/api/v1/auth/login` and
`/api/v1/users/password` — into a `request_data["body"]` dict that no code
anywhere in the file ever read back out. `SENSITIVE_ENDPOINTS` was likewise
defined and never consulted. No injection analysis happened at all, ever.

Found by `docs/security-review/CI2-33-core-infra.md` (feature 33). The dead
buffering was removed and the docstring corrected to state plainly that
injection-attempt analysis is not implemented, rather than silently dropping
the claim — but implementing real detection is a product decision this
security-review pass did not make on its own: what patterns to flag, the
false-positive tolerance for a log-only alert vs. a blocking one, and
whether `SENSITIVE_ENDPOINTS` should gate it or every write request should
be in scope. Left as documented future work.

## MM-9 — `approve_meeting` Has No Approval State Machine or Separation of Duties (2026-08-31)

`minute_service.approve_minutes` (the `MeetingMinutes` governance workflow)
requires the record be `SUBMITTED` and refuses to let the submitter also
approve it (`assert_different_person`). `meetings_service.approve_meeting`
(the sibling `Meeting` model — same shape of content: `agenda`/`notes`/
`motions` text, a `DRAFT → PENDING_APPROVAL → APPROVED` status, an
`approved_by`/`approved_at` pair) has neither control: it sets `APPROVED`
unconditionally from any status, and there is no `submitted_by` field or
submit step to compare the approver against in the first place — only
`created_by`.

Closing this needs a product decision, not a mechanical patch: `Meeting` has
no natural "the submitter can't approve their own submission" comparison the
way `MeetingMinutes` does, and blocking approval whenever `approved_by ==
created_by` would also block the common single-secretary workflow of one
person entering and approving a routine meeting record — a materially
different policy than the one MM-5 already established elsewhere. The
options are (a) give `Meeting` its own `submitted_by` field and a submit
step so the same guard MM-5 uses actually applies to the right pair of
people, or (b) leave `Meeting` approval as a lighter-weight, single-actor
record type and accept that its "approval" is closer to a status flag than a
governance control. Neither was chosen here.

Found by `docs/security-review/MM-24-meetings-minutes.md` (feature 24, pass
2). Confirmed not currently reachable from the reviewed frontend (no
`meetingsService.approveMeeting()` call site exists in `frontend/src/**`
today), which lowers today's exploitability but does not change that the API
itself grants any `meetings.manage` holder an unconditional, unaudited-before-
this-pass, untracked approval with no self-check.

## MSG-10 — Narrowing a Department Message's Audience Erases the Acknowledgment Report's Record; an Independent Audit Entry May Survive (2026-08-31)

`MessagingService.reconcile_recipients` rebuilds a published message's audience
when an admin edits its targeting (e.g. switches from "by role" to a corrected
role list). For every member the new audience no longer includes, it hard-
deletes their `DepartmentMessageRecipient` row outright — including `read_at`
and `acknowledged_at`, if they had already read or acknowledged the message.

This is the same information `delete_message`'s own docstring calls
"compliance evidence" and specifically soft-deletes the parent message to
avoid losing (`app/services/messaging_service.py`, `delete_message`) — but
`reconcile_recipients` (same file) discards it via a plain audience edit, no
confirmation, no message deletion involved. A message that "requires
acknowledgment," gets acknowledged by everyone, and then has its role list
tweaked to fix a typo loses every acknowledgment row for anyone who falls
outside the corrected set — `get_acknowledgment_report` would then show them
as never having acknowledged it at all, and they'd drop out of its
denominator entirely.

**This does not necessarily erase all compliance evidence, but the backup is
best-effort, not guaranteed.** `acknowledge_message`
(`app/api/v1/endpoints/messages.py:425-436`) writes an independent
`message_acknowledged` audit-log entry — user id, message id, timestamp —
through the tamper-evident audit hash chain at the moment of acknowledgment,
and `reconcile_recipients` never touches `audit_logs`. When that write
succeeds, it survives the recipient-row deletion and could be used during
remediation to reconstruct who had acknowledged before the audience was
narrowed. But `AuditLogger.create_log_entry` (`app/core/audit.py:265-270`) is
deliberately fail-open — it catches any exception on the write, logs it, and
returns `None` rather than raising, "so audit log failures don't break the
caller's operation" — and `acknowledge_message` never checks that return
value, so the acknowledgment itself still succeeds either way. If the audit
write silently failed (e.g. a transient DB error at flush/refresh), no
`message_acknowledged` row exists, and a later `reconcile_recipients` on that
member leaves nothing — report, inbox, or audit log — behind. What is
reliably lost by the recipient-row deletion is the _report's_ live state
(and, per the visibility mechanism below, the message's presence in that
member's inbox); whether the underlying evidence of the acknowledgment
survives depends on whether that audit write happened to succeed.

Closing this needs a product decision, not a mechanical patch: keeping the
recipient row for anyone with `read_at`/`acknowledged_at` set would preserve
the history, but `get_inbox`/`_visible_message_or_none` currently derive
_visibility_ from the same row (a `JOIN` on `DepartmentMessageRecipient`, no
independent live re-check of `_is_targeted`) — so keeping the row also keeps
the message visible in that member's inbox after they've been un-targeted,
which may or may not be the intended behavior. The options are (a) keep
resolved rows and accept that an already-engaged member keeps seeing a message
they're no longer formally targeted by, (b) add a separate "still visible"
flag so a resolved-but-untargeted row can be excluded from inbox visibility
while its read/ack timestamps survive for reporting, or (c) accept the current
behavior as correct — the audience is a live definition, not a historical one,
and narrowing it is understood to also narrow who the report covers. None was
chosen here.

Found during `docs/security-review/MSG-25-messaging-notifications.md`
(feature 25, pass 2) while reviewing the recipient-materialization
architecture (`DepartmentMessageRecipient`, added since pass 1 by PR #1938).
Not exploitable cross-tenant — `reconcile_recipients` only ever touches
recipients within the message's own org — and requires an admin
(`notifications.manage`) to edit an already-published message's targeting, so
this is a data-integrity/compliance-record risk rather than a security
vulnerability in the access-control sense.

## MSG-12 — A Failed, Stranded, or Throttled Department-Message Delivery Is Never Retried (2026-08-31)

`MessageDeliveryService._claim_delivery` commits a
`DepartmentMessageDelivery` row with `status="pending"` before calling out to
the email/SMS provider — this is what makes a raced or retried `deliver()`
call safe (a second attempt hits the row's unique
`(message_id, recipient_id, channel)` constraint and skips). That same
constraint means **no outcome for a claimed row is ever revisited**, and a
department message is published exactly once — no future `deliver()` call
for that message will come back around. There are three distinct ways a
member ends up not receiving a channel they should have:

- **Stranded `pending`.** If the worker process is killed, OOM-killed, or
  loses its DB connection between the claim commit and `_finish_delivery`'s
  follow-up commit, the row is left in `status="pending"` permanently.
  Narrow blast radius: one recipient/channel/message, and only if a crash
  lands in that exact window.
- **`failed`, from an ordinary provider error.** `_finish_delivery(attempt,
error)` commits the same row as `status="failed"` whenever the provider
  raises, or reports zero successes (`EmailService.send_email` returning
  `(sent, failed)`, `SMSService.send_bulk_sms` returning a count) — no
  crash needed, just a transient outage, a rate limit, or one rejected
  recipient. This is not an edge case: it is the intended, working
  behavior of `_finish_delivery`, hit every time a send legitimately
  fails.
- **Throttled — no row at all.** `_send_email`/`_send_sms` each check the
  org's per-hour escalation limit (`is_rate_limited`, the 30/org/hour
  email and 10/org/hour SMS caps) **before** the loop that calls
  `_claim_delivery` — when the org is over the cap, the whole method
  returns immediately, logs a warning, and never claims a single recipient
  for that channel. No `pending` or `failed` row exists for any of them,
  so a fix that only sweeps `DepartmentMessageDelivery` rows (the
  recommendation below, as originally written) cannot recover this path —
  there is nothing in that table to sweep. This is arguably the worst of
  the three: it needs no crash and no provider outage, just a busy
  message-volume hour, and leaves not even a `failed` row for an admin to
  ever find later, only a log line.

Whichever path a recipient falls into, the channel affected is whichever
one fails, strands, or gets throttled — and email is the "record of
notice" this feature's own module docstring says a member must not be able
to miss, so any one of these three, on the one delivery attempt a message
ever gets, permanently and silently drops that member from the channel of
record for that message.

Closing this needs a product decision, not a mechanical patch, and the
decision has to cover all three paths together — a fix scoped to
`DepartmentMessageDelivery` rows alone (`pending`/`failed`) leaves the
throttled path, which creates no row, completely unaddressed. Open
questions: what counts as eligible for retry (any `failed`/stale-`pending`
row? a cap on attempts?), whether a throttled batch should be recorded
somewhere retriable rather than just logged, whether retry is automatic
via a new scheduled task or surfaced to an admin instead, and — since a
crash could land either before or after the provider actually accepted the
send — whether the department would rather risk an occasional duplicate
delivery (retry unconditionally) or an occasional silent miss (leave it
and alert). None was chosen here.

Found by `docs/security-review/MSG-25-messaging-notifications.md` (feature
25, pass 2, MSG-12); both the `failed`-status path and the throttled/
no-row path were caught by two separate rounds of Codex's review of the PR
recording this finding, broadening it from the `pending`-only scenario
originally reported. No `SMSService`/`EmailService` allowlist or
org-scoping gap involved — this is a reliability gap in an otherwise-correct
idempotency mechanism, not an access-control defect.

## QUAL-1 — Qualifications Can Only Be Written Through a Course, Never Entered Directly (2026-08-26)

`member_qualifications` (`app/models/qualification.py`) **does** have a
supported officer workflow, and an earlier version of this entry wrongly said
it had none. The Course Library exposes a **Certifies** selector
(`CourseLibraryPage.tsx`, `course.grants_qualification`), and recording a
member's completion calls `_sync_qualifications`
(`api/v1/endpoints/training.py:510`) to create or renew the row — from a single
record, a bulk create, an update, and both historical-import paths.

The real gap is narrower: **a qualification cannot be entered, edited or
expired on its own.** There is no panel on the member profile, nothing in
Members administration, and no direct import. Every row has to arrive as a
side effect of a training record against a course whose `grants_qualification`
was set before that record was filed.

That has three practical consequences worth recording:

- **A pre-existing card cannot be recorded without inventing a course
  completion.** A member who has held a Paramedic licence for a decade needs a
  training record dated to match, against a course that certifies it.
- **An expiry is corrected on the record that produced it, not on the
  qualification.** `PATCH /training/records/{record_id}` accepts
  `expiration_date` and re-runs `_sync_qualifications`, which recomputes
  `expires_on` from the supporting records — so a typo is fixed by editing that
  record. **Filing a second completion for a correction would invent training
  history that never happened**; a new record is for a genuine renewal. What is
  missing is any way to reach `expires_on` without going through a training
  record at all.
- **Setting `grants_qualification` on a course is not retroactive.** Records
  filed against that course _before_ the selector was set wrote no
  qualification, and nothing backfills them.

Because shift eligibility reads `expires_on` **as of the shift date**, a stale
or missing row is not cosmetic — it decides who may be rostered.

Closing this is an ordinary piece of UI work: a qualifications panel on the
member profile gated on `members.manage`, plus a CSV import. It was
deliberately out of scope of the change that added the model.

## MIG-1 — Nothing Prevents Two Open Branches From Claiming the Same `down_revision` (2026-08-31)

The week to 2026-08-31 produced **seven forked Alembic heads** — the highest
this project has recorded — every one caused by two branches that were open
simultaneously choosing the same `down_revision`. They were resolved by seven
merge revisions (`cff6124cbb3f`, `b272a5d5535c`, `4b71d80aa2c1`,
`d5e6f7a8b9c0`, `5128feb36dd2`, `5b165386cc5f`, `a0af87c3904a`), the chain
validates to a single head, and no department is affected.

The limitation is in the tooling, not the schema.
`backend/scripts/validate_migrations.py` detects multiple heads **after both
branches have merged** — which is the correct time to fail CI, and far too late
to be cheap. Each fork cost a CI cycle to surface and a follow-up PR to repair,
and one of them (`a0af87c3904a`) had to clean up after two earlier ones.

Nothing warns an author at the point the mistake is made. A branch opened
against head `X` has no way to know another open branch has already claimed
`X` as its parent, because the competing revision does not exist on `main`
yet. Options, none chosen here: a pre-push hook that queries open PRs for
`down_revision` collisions; a convention that a migration's `down_revision` is
rewritten at merge time rather than authoring time; or accepting the merge
revisions as a normal cost of parallel work and simply not treating them as
defects — which is, in practice, what currently happens.

Recorded because the _rate_ is new. Seven in seven days is a signal about how
many branches are open at once, not about anybody's care with Alembic.

## FE3-34-2 — A Failed Client-Side Logout Presents an Unauthenticated UI While the Session Cookies Stay Live (2026-08-31)

`authStore.logout()`'s `try { await authService.logout() } catch { /* Logout
errors are non-critical; cookies are cleared by the backend */ }` proceeds
unconditionally to clear local state and show the login screen. The
comment's premise only holds on the success path: `POST /auth/logout`
(`backend/app/api/v1/endpoints/auth.py:1197-1235`) calls
`_clear_auth_cookies()` only after `AuthService.logout_user()` has deleted
the session row, and on any failure — a network drop, a 5xx, or the
endpoint's own pre-cookie-clear 400 when `logout_user()` returns `False`
(e.g. its `except Exception: return False` on a transient DB error) — the
httpOnly access/refresh cookies are left exactly as they were.

On a shared station computer, this means: Sign Out fails silently, the
screen shows Login, and the previous member's session remains fully valid
and reusable until the tokens naturally expire — the opposite of what the
UI communicates, on the exact threat model this same `logout()` function's
`purgeLocalMemberData()` call two lines below exists to defend.

Not fixed because the safe remediation is a product decision, not a
drive-by patch: retry the server call automatically (how many times, what
backoff, before giving up?), block the UI with an explicit "couldn't
confirm sign-out — please close your browser" message matching the
backend's own 400 copy, or something else. Found in
`docs/security-review/FE3-34-frontend-shared.md` (feature 34, pass 3,
FE3-34-2).

## FE3-34-4 — A Stale In-Flight Cacheable GET Can Write Into the Shared Cache After a Session-Boundary `clearCache()` (2026-08-31)

`clearCache()` (called on login and logout) empties the in-memory response
cache, and `clearInFlight()` (`utils/inFlight.ts`) only clears
_de-duplication_ bookkeeping — its own comment says the old request is
deliberately left to keep running: "never let the old request remove that
one." Nothing cancels an axios request already in flight at a session
boundary, and the response interceptor's `setCache(key, response.data)`
writes unconditionally whenever that request eventually settles. Cache keys
carry no session or user identity — only URL + params.

On a shared kiosk: member A's slow cacheable GET (e.g. `/analytics/metrics`)
is still in flight when they log out and member B logs in (both transitions
call `clearCache()`). A's response arrives afterward and populates the
now-shared cache under an identity-free key. B's next request for the same
URL+params, within the 30-90s fresh/stale window, is served A's data as a
synthetic response with no network round trip — so B's own authorization
for it is never checked.

Requires an in-flight request straddling exactly a login/logout boundary, so
it is a narrow race, but the mechanism is real and unconditional once the
timing lines up. Not fixed because a correct close needs either a
session-generation counter threaded through every `setCache` call site or
`AbortController`-based cancellation of in-flight requests at the session
boundary — both change the cache module's public API and interact with the
existing stale-while-revalidate contract `apiCache.test.ts` locks in, which
is a deliberate design change, not a same-pass patch. Found in
`docs/security-review/FE3-34-frontend-shared.md` (feature 34, pass 3,
FE3-34-4).

## FE3-34-5 — An Offline Queue Item Can Sync Under the Next Member's Identity on a Shared Device (2026-08-31)

None of the three offline queues (`utils/genericOfflineQueue.ts` for
training submissions/RSVPs, `utils/offlineQueue.ts` for equipment checks,
`utils/shiftReportOfflineQueue.ts` for shift reports) records which member
queued an item — no user or session field on any of their stored shapes.
`useOfflineSyncEngine` drains the generic queue automatically on mount or
reconnect using whichever session's cookies are attached to the shared
`api` client _at that moment_; the equipment-check and shift-report queues
drain the same way, page-scoped, whenever their respective forms next
mount.

On a shared station computer: member A queues a training submission while
offline, then does not explicitly log out (a common real pattern — the
shift ends, the browser tab is just left). A later session check
(`authStore.loadUser()`) hits a transient error, and — correctly, per
FE3-34-1 above — no longer purges the queue on a non-auth-confirmed
failure, so the item survives. The UI shows Login. Member B, a different
person, logs in with their own credentials. The moment `AppLayout` mounts
for B, `useOfflineSyncEngine` sees the device online and drains A's queued
item using B's now-current cookies — the backend receives and attributes
A's training submission (or RSVP) as an action B took, silently, with no
error surfaced to either member.

This is a direct consequence of fixing FE3-34-1: before that fix, the same
transient failure would have wiped the queue outright (the data-loss bug
FE3-34-1 closes), which incidentally also closed this attribution path.
Not fixed in the same PR because a correct close needs to tag each queued
item with the identity (or a per-login session marker) of whoever queued
it, and have all three drain paths — the automatic engine and both
page-scoped ones — refuse to flush an item queued under a different
identity than the one currently authenticated (purging it with a notice
instead, matching the existing `lastLogoutPurge` pattern). That spans three
independent subsystems and needs dedicated test coverage per drain path —
landing it alongside FE3-34-1 in the same commit, without that coverage, is
exactly the kind of rushed change to a security-sensitive shared-device
path this rotation's own standing rule warns against. Found in
`docs/security-review/FE3-34-frontend-shared.md` (feature 34, pass 3,
FE3-34-5) — Codex caught this reviewing the very commit that fixed
FE3-34-1.

## Process

The review loop (see [review-log.md](./review-log.md)) advances through one area
per tick and appends findings. New "needs owner decision" items should be
mirrored here so they're visible outside the log. The parallel module-by-module
security audit tracks its rotation and per-module findings under
[`docs/module-audit/`](./module-audit/PROGRESS.md); its open decisions are
mirrored in the Multi-Tenant Isolation section above.
