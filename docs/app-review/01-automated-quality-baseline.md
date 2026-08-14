# Application Review 01 — Automated Quality Baseline

**Review dates:** 2026-08-13–2026-08-14

**Rotation:** 1 of 22

**Status:** In progress — keep this rotation open

## Scope completed in this timebox

The first 15-minute review rotation exercised the checks that can run without
database or browser-service setup. Commands were started concurrently so the
timebox measured the repository rather than serial command overhead.

| Check                       | Result                                | Evidence                                                                                                                                |
| --------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend strict typecheck   | Pass                                  | `npm run typecheck` exited 0.                                                                                                           |
| Frontend ESLint             | Pass                                  | `npm run lint` exited 0.                                                                                                                |
| Frontend production build   | Pass with one actionable size warning | Vite built 2,814 modules and generated the PWA; the entry chunk was 692.60 kB minified, above the configured 600 kB warning threshold.  |
| Backend lint and formatting | Pass                                  | Flake8, Black, and isort completed successfully across `app/`, `tests/`, and `alembic/`.                                                |
| Documentation links         | Pass                                  | 249 Markdown files checked with no broken links.                                                                                        |
| Frontend unit coverage      | Pass                                  | The initial run crossed its timebox; the dedicated continuation completed all 3,220 tests in 252 files and passed every coverage floor. |

## Second baseline timebox

The next rotation continued the baseline rather than advancing past unfinished
work. It exposed which remaining checks require the CI service environment.

| Check                            | Result                  | Evidence                                                                                                                                                                     |
| -------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit tests with coverage | Environment-blocked     | Collection reached 815 deselected tests, then stopped on five imports because the container does not include the system `libmagic` library required by `python-magic`.       |
| Install `libmagic1`              | Environment-blocked     | `apt-get update` could not reach the configured Ubuntu repositories through the environment proxy (HTTP 403), so the missing CI system dependency could not be installed.    |
| Endpoint permission docs         | Pass with known backlog | All 1,346 documented route handlers passed the enforcement-mismatch gate; 189 permission-enforcing routes still use the generic “Authentication required” documentation.     |
| Security scan policy             | Pass                    | No dependency-vulnerability suppressions were found.                                                                                                                         |
| npm production dependency audit  | Environment-blocked     | The npm advisory endpoint returned HTTP 403. This is not evidence that dependencies are clean; the CI audit remains required.                                                |
| Python dependency audit          | Environment-blocked     | `pip-audit` is not installed in this container. CI installs the scanner in its security job; installing it locally was not attempted after package-repository access failed. |
| Compose configuration validation | Environment-blocked     | The container has no `docker` executable, so the default, production, minimal, and ARM Compose configurations could not be parsed by Docker Compose.                         |

The backend test attempt also ran under Python 3.14.4, while CI targets Python
3.13. A future local result should not be treated as CI-equivalent unless it
uses the supported interpreter and the same `libmagic1` dependency.

## Third baseline timebox

A dedicated frontend run completed in 9 minutes 18 seconds with four workers:

| Metric     | Result | Configured floor | Margin |
| ---------- | -----: | ---------------: | -----: |
| Statements | 58.06% |              51% |  +7.06 |
| Branches   | 51.27% |              44% |  +7.27 |
| Functions  | 46.91% |              40% |  +6.91 |
| Lines      | 59.69% |              53% |  +6.69 |

All 252 test files and 3,220 tests passed. The earlier incomplete entry is now
resolved; these totals establish the review baseline for future coverage
comparisons.

The Chromium E2E command discovered all 41 configured tests but could not start
them because this container does not contain Playwright's Chromium headless
shell. Every reported failure had the same pre-test `browserType.launch`
failure, so none is evidence of an application regression. CI installs the
version-matched Chromium binary and remains the authoritative E2E environment.

This attempt found a second `__dirname` reference in Vite's source alias. The
first timebox had only updated the build-output path; the E2E dev server still
emitted the native-config-loader warning. The alias now also uses
`import.meta.dirname`, removing the remaining application-owned occurrence.

### Baseline documentation backlog

The 189 understated endpoint docstrings do not fail the existing CI policy, but
they make the generated API reference less useful during permission review.
This is a confirmed application-wide documentation backlog rather than a new
authorization defect: the checker found no route whose documented permissions
contradict enforcement.

**Recommended acceptance criteria:** reduce the warning count to zero, then run
`scripts/check_endpoint_permissions.py --strict` in CI so future generic
“Authentication required” descriptions cannot re-enter the API reference.

The build and test runners also warned that `__dirname` in the ESM Vite
configuration is incompatible with Vite's forthcoming native config loader.
Both config files now use `import.meta.dirname`, which is the ESM-native
equivalent.

## Finding BASE-01 — application entry chunk exceeds its budget

- **Classification:** Performance improvement
- **Priority:** P2
- **Confidence:** Confirmed
- **Reach:** Application-wide initial navigation and PWA installation
- **Effort:** Medium

The production build emitted a 692.60 kB minified entry chunk against the
explicit 600 kB warning threshold. The shell is intentionally precached for PWA
use, so entry growth affects both first-load transfer and the cold installation
download. Raising the warning threshold would hide the regression rather than
improve it.

### Recommended follow-up

1. Generate and inspect a bundle visualization for the entry chunk.
2. Identify libraries and pages pulled into the shell through eager imports.
3. Preserve the deliberately eager login and dashboard path, but lazy-load
   secondary dashboard panels or heavy dependencies that are not required for
   first paint.
4. Add a CI-enforced entry-chunk budget instead of relying only on Vite's
   console warning.

### Acceptance criteria

- The production entry chunk is no larger than 600 kB minified.
- Login and dashboard first paint remain directly reachable without a route
  chunk retry.
- The offline PWA shell remains functional after a cold install.
- A repeatable CI check fails if the entry chunk crosses the agreed budget.

## Remaining baseline work

Do not advance to the architecture rotation until the following are recorded:

- Run backend unit tests with the configured coverage floor in the Python 3.13
  environment after installing `libmagic1`.
- Run database integration and API-contract suites against MySQL and Redis.
- Run Playwright Chromium smoke tests in an environment with the matching
  browser binary installed.
- Run Alembic migration validation against a clean database and an upgrade
  path.
- Run Bandit, `pip-audit`, and `npm audit` in an environment with scanner and
  advisory-service access. The repository security policy check is complete.
- Validate Docker Compose configurations and builds.
- Record durations and environment limitations for each command.

This explicit incomplete state is intentional: a 15-minute schedule is a
checkpoint cadence, not permission to claim unfinished work is complete.
