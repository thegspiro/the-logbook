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
| 1.8 | Document the supported deployment topology, and that a **remote** database or Redis requires `DB_SSL`/`REDIS_SSL` + a CA | Single-host Compose keeps DB traffic on an internal bridge; a separate DB host puts it on a real wire. See the CI-9 note in Phase 2 |

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

Verified against the implementation 2026-08-02, not just the audit write-ups.

| ID | Item | Why it blocks | Decision |
|---|---|---|---|
| **ORU-8a** | `GET /users/{id}/with-roles` returned the raw ORM user with no visibility filtering while its sibling roster endpoint redacted | The roster's own comment says "redact here too, or the setting is advisory." The detail endpoint was what made it advisory | ✅ **Fixed** — shared `_clear_hidden_contact_fields` / `_load_contact_visibility`, subject and members-managers exempt |
| **ORU-8b** | `without_infrastructure()` stripped mail host, S3 bucket, SSO issuer and OAuth client IDs but not `it_team` — so every authenticated member got the IT roster and the free-form `backup_access` dict | `backup_access` is unstructured operational text; whatever an admin typed there was readable by any account | ✅ **Fixed** — `it_team` emptied for callers without `settings.manage` |
| **FIN-6** | `record_dues_payment` does `amount_paid += amount` with no dedup on `transaction_reference`, overwrites `transaction_reference` / `payment_method` / `notes` on every call, and recomputes a `WAIVED` record to `PAID`/`PARTIAL` | Money, silently wrong, with no ledger to reconstruct from — `MemberDues` stores aggregates only, so a clobbered reference is gone | 🔑 Status guard is unambiguous; real idempotency needs a decision — see below |

**FIN-6, verified 2026-08-02.** Confirmed, and worse than the write-up in two
respects. `finance_service.py:1736-1746` has three defects in eleven lines:

1. **No idempotency.** `amount_paid = amount_paid + amount_paid_arg` with
   nothing consulting `transaction_reference`. A retried or replayed request
   double-credits collections.
2. **Prior payment detail is destroyed, not just duplicated.** `payment_method`,
   `transaction_reference` and `notes` are each assigned `kwargs.get(...)` —
   which returns `None` when the caller omits the field. A second partial
   payment that doesn't resend `notes` blanks the first payment's notes. There
   is no payments ledger: `MemberDues` holds aggregates only, so nothing can be
   reconstructed afterwards.
3. **A waive is silently reversed.** Recording a payment against a `WAIVED`
   record recomputes `status` to `PAID`/`PARTIAL` while leaving `waived_by`,
   `waived_at` and `waive_reason` populated — an internally contradictory row.

The status guard and the field-clobbering are unambiguous bugs, fixable now.
Genuine idempotency needs somewhere to record processed references — a payments
ledger table or a unique constraint — which is a schema decision plus a
migration. **That is the one thing here still needing an owner call.**

ORU-8 was originally carried here as a single item needing a product decision on
what `users.view` may see. On reading the code it is two narrow gaps left behind
by a fix that already landed for the other half of each pair, and both are
closed by reusing machinery that exists. Neither needs a policy decision — the
policy is already expressed in `contact_info_visibility` and in
`without_infrastructure()`; these are the two call sites that don't consult it.

### Deliberately *not* blocking

Documented in `KNOWN_LIMITATIONS.md` and shipped as known:

- **XC-1** (create/update paths storing unvalidated client-supplied FK ids) —
  **reassessed 2026-08-02, moved out of the blockers.** Real and open: the
  shared helper exists at `app/utils/org_scoping.py` and fails closed, but only
  two files import it, and just 6 of 79 service modules carry any in-org FK
  check. What changed my read is *which* instances remain. Per
  `CROSS-CUTTING.md`, every instance with confirmed cross-tenant impact was
  already fixed in place — the elections `meeting_id`/`event_id` leak, apparatus
  operators' foreign `user_id` PII, the membership-pipeline `form_id` write, the
  inventory fail-open, and the forms processors driving cross-module writes. The
  residual is the low-impact class the audit itself describes as
  "mis-attribution / orphan rows, not cross-tenant disclosure," because the
  writes are org-stamped. Rolling the helper across ~73 remaining service
  modules with per-module tests is weeks of mechanical work; gating a release
  candidate on it is disproportionate to a dangling FK. Schedule it as a
  tracked rollout, and require the helper in new create/update paths from now
  on — that part is free.
- **FE-6 / FE-7** (device-local PII surviving logout on a shared terminal) —
  **already fixed; verified 2026-08-02.** `utils/purgeLocalMemberData.ts` clears
  all four stores (shift-report drafts, the equipment-check / shift-report /
  generic offline queues, photo blobs included), is awaited inside
  `authStore.logout()`, and is reached by the idle path too because
  `useIdleTimer` calls that same `logout()`. Each store is bounded at 3s so no
  IndexedDB pathology can stall logout, the purge is non-throwing by
  construction so it cannot strand a member signed in, and the discarded count
  is surfaced on the login page rather than the work vanishing silently. The
  product question this item was carrying — do drafts survive re-login — has
  already been answered *no*, deliberately, with the reasoning recorded in the
  module docstring. Nothing left to decide.
- **CI-9** (production DB/Redis TLS only warns) — **reassessed 2026-08-02, does
  not block.** The audit line reads as fail-open on encryption; the code isn't.
  The genuinely dangerous case — `DB_SSL=True` with no `DB_SSL_CA`, i.e.
  encrypted but unverified, a config that *looks* secure and isn't — already
  raises `RuntimeError` and refuses to start in production/staging, waivable
  only via an explicit `SECURITY_ALLOW_UNVERIFIED_TLS` that re-warns every boot
  (`main.py:1290-1309`). What merely warns is `DB_SSL=False`, which is the
  honest state: nobody is misled into believing they have TLS. And in the
  supported topology it is close to moot — MySQL and Redis deliberately expose
  no host ports (SEC-14) and sit on the internal `intranet-network` bridge, so
  that traffic never leaves the host. The user-facing encryption boundary,
  which is the one carrying PHI over a real network, is separately enforced by
  `SECURITY_ENFORCE_HTTPS` as a startup-blocking CRITICAL. Making `DB_SSL`
  itself mandatory would refuse boot for essentially every single-host install
  in exchange for protection against an attacker who already has root on the
  box — and could read `DB_PASSWORD` out of the environment anyway. The real
  residual risk is a **remote** database (managed MySQL, separate DB host),
  where the traffic does cross a wire; that is a deployment-profile
  documentation item, tracked as 1.8 above, not a startup gate.
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

1. **FIN-6 idempotency model** — a payments ledger table, or a uniqueness
   constraint on `(dues_id, transaction_reference)`? A ledger also fixes the
   destroyed-payment-history problem and is the more honest model for money;
   the constraint is smaller. Either needs a migration. The status guard and
   the field-clobbering are getting fixed regardless — they need no decision.
2. **DOB and emergency contacts** — surfaced while fixing ORU-8, not previously
   tracked. Both endpoints expose `date_of_birth` and `emergency_contacts`
   (names and phone numbers of members' family, who are not department members)
   to any `users.view` holder, and `MemberProfilePage` renders the emergency
   contacts section for any viewer — `canEdit` gates editing, not viewing.
   Unlike ORU-8 there is no policy to apply: `contact_info_visibility` has no
   flag for either. Officers plausibly *should* see emergency contacts; the
   whole membership plausibly should not. Needs a product call.
3. **Pilot** — which department runs the RC, and for how long?

> **Note on how these were triaged.** Phase 2 was first assembled from the
> audit write-ups in `docs/module-audit/` rather than the implementations, and
> the write-ups proved unreliable in **both** directions — CI-9 read far worse
> than the code, FE-6 was already fixed, ORU-8 was half-fixed with a narrower
> remainder, FIN-6 was worse than described, and XC-1's dangerous instances
> were already closed. Every Phase 2 entry has now been read against the
> source. The general lesson: `KNOWN_LIMITATIONS.md` lags the code, so treat it
> as a list of things to check, not a list of things that are true.
