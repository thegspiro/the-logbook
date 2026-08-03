# Release Candidate Plan — 1.0.0-rc.1

Path from today's `main` to a tagged release candidate. Scope is **release
readiness**, not feature work: what must be true before the build is handed to a
department for real use.

**Legend:** ⬜ not started · 🔄 in progress · ✅ done · 🔑 needs an owner decision

> An RC is a gate, not a label. The rule for every item below: if it would make
> a fire department's first week worse, it blocks; if it would only make ours
> worse, it doesn't.

---

## Where we actually are

Measured 2026-08-02 against `main` @ `7c0c1ab`, CI run
[30752054716](https://github.com/thegspiro/the-logbook/actions/runs/30752054716).

| Signal | State |
|---|---|
| CI on `main` | **Red** — 1 job passed, 5 failed, 5 never ran |
| `npm ci` | **Broken** — lockfile missing `vite@8.2.0` + 37 other entries |
| `pip install -r requirements.txt` | **Broken** — `isort==8.0.1` vs `pylint==3.3.4` (caps `isort<7`) |
| Backend tests | **Never ran on `main`** — install failed first |
| Integration / contract tests, Docker build | **Never ran** — skipped behind the failures |
| Git tags | **None exist** |
| Version | `1.0.0` in `package.json`, everything under `[Unreleased]` |
| Backend lint | ✅ clean (0 flake8 violations, 283 files) |
| Module audit | ✅ complete — 27/27 modules |
| npm advisories | ✅ 11 total, all dev-only transitives; `--omit=dev` → 0 |
| TODO/FIXME markers | ✅ 3 backend, 0 frontend |

Both install blockers are fixed on `claude/pr-1132-review-cx6sps`. With those
landed, nine of eleven CI jobs are verified green; the frontend suite is 2057
tests and the backend 2189.

The headline risk is not a long defect list. It is that **the release plumbing
has been broken long enough that large parts of the system are unmeasured.**
Phase 0 exists to convert unknowns into facts before anyone commits to a date.

---

## Phase 0 — Restore the signal 🔄

Nothing else can be trusted until CI is green end to end.

| # | Item | Status |
|---|---|---|
| 0.1 | Regenerate `package-lock.json`; `npm ci` works from a clean checkout | ✅ done (branch) |
| 0.2 | Resolve `isort`/`pylint` conflict; `pip install -r requirements.txt` works | ✅ done (branch) |
| 0.3 | Align CI lint pins with `requirements.txt` so CI tests the real toolchain | ✅ done (branch) |
| 0.4 | Split the branch into two PRs — backend/CI fix first, npm bump second | ⬜ |
| 0.5 | Land both; confirm a fully green run on `main` | ⬜ |
| 0.6 | **Read the first green run.** Integration, API-contract and Docker jobs execute for the first time — triage whatever they surface | ⬜ |

**0.6 is the real milestone.** Those three jobs run migrations against a live
MySQL, exercise the API contract, and build the shipped image. They have been
dark for an unknown period. Budget for findings here rather than assuming a
clean pass; do not set a date before this completes.

### Exit criteria
- [ ] All 11 CI jobs green on `main`
- [ ] `npm ci` and `pip install -r requirements.txt` both succeed from a clean checkout
- [ ] `docker compose up` brings the stack to healthy on a clean host

---

## Phase 1 — Prove the deployment path ⬜

The audit covered application code thoroughly. It did not cover *install and
upgrade*, which is what a new department actually touches first.

| # | Item | Notes |
|---|---|---|
| 1.1 | Fresh-install rehearsal on a clean host via `install.sh` / `docker-compose.prod.yml` | Follow `docs/DEPLOYMENT.md` verbatim; every correction is a doc bug |
| 1.2 | Migration rehearsal on a **copy of production data** | `alembic upgrade head` on a restored dump, not an empty CI database |
| 1.3 | Rollback rehearsal | Confirm downgrade or restore-from-backup actually works; document whichever is supported |
| 1.4 | Backup/restore rehearsal per `docs/BACKUP.md` | Restore into a fresh stack and verify the app boots against it |
| 1.5 | Onboarding wizard end to end on a clean database | First-run path a new department hits |
| 1.6 | Verify published image tags per `docs/DOCKER-BUILD-PUBLISH.md` | Image the RC actually ships as |
| 1.7 | Seed-data check — every file registered in `SEED_DATA_FILES` applies cleanly | Missing seed data crashes at query time, not migrate time |

### Exit criteria
- [ ] A clean host reaches a working login following only the published docs
- [ ] Migrations verified forward on production-shaped data
- [ ] A documented, rehearsed rollback path exists

---

## Phase 2 — Close the security items that block 🔑

`docs/KNOWN_LIMITATIONS.md` carries ~20 open items from the completed audit.
Most are legitimate accept-and-document. These are the ones I'd hold an RC for,
because each is either PHI exposure or silent data corruption — the two
categories a department cannot detect on its own.

| ID | Item | Why it blocks | Decision |
|---|---|---|---|
| **CI-9** | Production DB/Redis TLS only *warns* instead of blocking startup | A HIPAA deployment can boot with PHI crossing the network in cleartext. Fail-open on the encryption boundary is the wrong default for this product | 🔑 Flipping to fail-closed refuses boot for any production currently running without TLS. Ops call |
| **ORU-8** | `GET /users/{id}/with-roles` serializes full PII (DOB, home address, emergency contacts) to any `users.view` holder, bypassing the `contact_info_visibility` gate the list endpoint honors | The gate exists and is silently bypassed on a sibling endpoint — an inconsistency departments will reasonably assume is enforced | 🔑 Gating changes what `users.view` holders see today |
| **FE-6** | Shift-report drafts (crew names, trainee evaluations) persist in `localStorage`; queued equipment-check payloads persist in IndexedDB. Idle-logout clears neither | Station kiosks are the deployment model. The next member reads the previous member's drafts via DevTools | 🔑 Purging on logout drops unsynced work — product call on whether drafts survive re-login |
| **FIN-6** | `record_dues_payment` does `amount_paid += amount` with no idempotency on `transaction_reference`; recording against a `WAIVED` record silently recomputes it to `PAID` | A retried payment double-credits collections and a waive is destroyed with no audit trail. Money, silently wrong | Fix — needs an idempotency key + status-transition guard |
| **XC-1** | Create/update paths store client-supplied FK ids without verifying they are in-org | The shared helper (`app/utils/org_scoping.py`) already exists and is wired into the confirmed-impact paths. This is finishing a rollout, not designing one | Fix — mechanical, per-module, with tests |

### Deliberately *not* blocking

Documented in `KNOWN_LIMITATIONS.md` and shipped as known:

- **FIN-4 / FIN-5** (separation of duties on disbursement; reimbursement
  visibility) — real, but both need a new `finance.disburse` permission with
  seed + role + frontend work. Volunteer departments frequently have one
  treasurer anyway; document the limitation and schedule for 1.1.
- **CS-8** (examiner can score their own skills test) — same shape; needs a
  candidate≠examiner rule that changes the workflow.
- **ORU-7** (no ceiling on editing a more-privileged role) — the last-admin
  lockout guard already landed, which was the sharp edge.
- **PP-6** (per-process public rate limiter) — the true ceiling is
  workers × limit, not unbounded. Needs shared Redis state; acceptable for an RC.
- **Crypto deferrals** (PBKDF2 at 100k, 40-bit recovery codes) — both stretch
  already-strong secrets and are single-use/lockout-throttled. Changing either
  invalidates stored data; deliberate migrations, not RC work.

### Exit criteria
- [ ] Every blocker above either fixed or explicitly accepted in writing by the owner
- [ ] `KNOWN_LIMITATIONS.md` reflects the RC's actual posture
- [ ] `docs/COMPLIANCE.md` updated with anything accepted that touches PHI

---

## Phase 3 — Release mechanics ⬜

Currently missing entirely — there are no tags, so there is no established
process to follow.

| # | Item |
|---|---|
| 3.1 | Decide and document the versioning scheme (`1.0.0-rc.1` → `1.0.0`) |
| 3.2 | Cut `[Unreleased]` into a dated `1.0.0-rc.1` CHANGELOG section |
| 3.3 | Align `package.json` / `frontend/package.json` versions with the tag |
| 3.4 | Tag `v1.0.0-rc.1` and publish matching Docker image tags |
| 3.5 | Write release notes aimed at a fire chief, not a developer — what's supported, what's known-limited, how to report a problem |
| 3.6 | Define the RC feedback loop: who runs it, for how long, how bugs come back, what promotes RC → GA |

### Exit criteria
- [ ] A tagged, installable artifact exists
- [ ] A named pilot department and a defined soak period
- [ ] A written rule for what promotes the RC to GA

---

## Deliberately out of scope

Worth stating so they don't creep in:

- **Coverage targets.** Frontend 53% / backend 48%, both on ratchet floors that
  block regressions. Raising them is continuous work, not a gate.
- **Prettier drift.** The repo is not prettier-clean and never has been; CI
  doesn't check it. Reformatting mid-release adds risk and hides real diffs.
- **The `isort` `combine_as_imports` change.** Reads better, rewrites 27 files,
  zero functional effect. Post-RC.
- **Feature completion.** Knowledge-test engine, `enrolled_count`, monthly-vs-
  annual reports — all documented gaps, none of which block a candidate.

---

## Sequencing

Phases 0 and 1 are strictly ordered — you cannot rehearse a deployment whose
image doesn't build. Phase 2 runs in parallel with Phase 1 once Phase 0 lands,
since the fixes are independent of deployment rehearsal. Phase 3 is last and
short.

**The gate on committing to a date is 0.6**, not the end of Phase 0. Until the
integration, contract and Docker jobs have run at least once, the size of
Phase 1 is genuinely unknown.

## Open decisions needed

1. **CI-9** — does fail-closed TLS ship in the RC, knowing it refuses boot for
   any production running without TLS today?
2. **ORU-8 / FE-6** — both close real PHI exposure but change existing behavior.
   Fix in the RC, or document and defer?
3. **Pilot** — which department runs the RC, and for how long?
