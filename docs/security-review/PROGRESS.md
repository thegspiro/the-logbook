# Security Review — Progress Tracker

A feature-by-feature security pass over the whole application, driven by
`/loop 30m /security-review`. Each iteration works one feature through
[`CHECKLIST.md`](./CHECKLIST.md), records findings in
`docs/security-review/<feature>.md`, applies only safe/verified fixes, flags
the rest, passes the completion gate, and opens a pull request.

**One PR at a time.** An iteration that finds a security-review PR still open
tends that PR — CI, review comments, conflicts — instead of starting the next
feature. The rotation cannot outrun its own review queue.

**Legend:** ⬜ pending · 🔄 in progress · ⏳ awaiting PR merge · ✅ done

---

## Open PR

| Field       | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| PR          | [#1805](https://github.com/thegspiro/the-logbook/pull/1805) |
| Branch      | `claude/security-review-perm`                               |
| Feature     | 02 Permissions & roles                                      |
| CI          | just opened; not yet checked                                |
| Threads     | none yet                                                    |
| Last tended | 2026-08-25 — opened                                         |

---

## Relationship to the existing review passes

This rotation is **not** a replacement for the two that came before it, and it
must not re-derive their conclusions:

| Pass                   | Lens                                                | Where                |
| ---------------------- | --------------------------------------------------- | -------------------- |
| Module audit (2026-07) | tenant isolation, XC-1/2/3                          | `docs/module-audit/` |
| Application review     | correctness, duplication, dead code, doc accuracy   | `docs/app-review/`   |
| **Security review**    | the seven dimensions in `CHECKLIST.md`, PR per pass | here                 |

Each iteration reads the matching file in the other two directories first and
starts from their **open** findings. Re-verifying something they left open is
in scope; re-reporting something they fixed is not.

---

## Rotation

Ordered by risk: unauthenticated and money-handling surfaces first, then the
data-carrying modules, then the supporting infrastructure.

| #   | Feature                   | Prefix | Principal code                                                                                                                                  | Status   |
| --- | ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 00  | Cross-cutting baseline    | SEC    | whole-codebase sweeps; see `SEC-00-cross-cutting-baseline.md`                                                                                   | ✅ #1799 |
| 01  | Auth & session lifecycle  | AUTH   | `endpoints/auth.py`, `auth_service.py`, `mfa_service.py`, `oauth_service.py`                                                                    | ✅ #1804 |
| 02  | Permissions & roles       | PERM   | `dependencies.py`, `core/permissions.py`, `roles.py`, `operational_ranks.py`, `officers.py`, `org_chart.py`                                     | ⏳ #1805 |
| 03  | Public surface & webhooks | PUB    | `api/public/*` (20 unauth routes), `paypal_webhook.py`, `integrations_webhook.py`, `salesforce_webhook.py`                                      | ⬜       |
| 04  | Storefront & payments     | SF     | `endpoints/storefront.py`, `storefront_service.py`, `utils/storefront_payments.py`                                                              | ⬜       |
| 05  | Finance & approvals       | FIN    | `endpoints/finance.py`, `finance_service.py`, `public/finance_approvals.py`                                                                     | ⬜       |
| 06  | Elections & ballots       | ELEC   | `endpoints/elections.py` (token-scoped voting)                                                                                                  | ⬜       |
| 07  | Users & organizations     | USR    | `users.py`, `organizations.py`, `member_status.py`, `member_leaves.py`                                                                          | ⬜       |
| 08  | Membership pipeline       | MP     | `membership_pipeline.py`, `membership_pipeline_service.py`                                                                                      | ⬜       |
| 09  | Medical screening (PHI)   | MS     | `medical_screening.py`, `medical_screening_service.py`                                                                                          | ⬜       |
| 10  | Documents & legal         | DOC    | `documents.py`, `station_documents.py`, `legal_documents.py`                                                                                    | ⬜       |
| 11  | Inventory                 | INV    | `endpoints/inventory.py` (6539 L), `inventory_service.py`                                                                                       | ⬜       |
| 12  | Facilities                | FAC    | `endpoints/facilities.py` (3724 L), `facilities_service.py`                                                                                     | ⬜       |
| 13  | Apparatus & NFC           | AP     | `apparatus.py`, `nfc_tags.py`                                                                                                                   | ⬜       |
| 14  | Equipment check & shifts  | EC     | `equipment_check.py`, `shift_completion.py`                                                                                                     | ⬜       |
| 15  | Scheduling                | SCH    | `scheduling.py`, `scheduling_module_config.py`, `calcom_sync.py`                                                                                | ⬜       |
| 16  | Events & requests         | EV     | `events.py`, `event_requests.py` (public submission path)                                                                                       | ⬜       |
| 17  | Training core             | TR     | `training.py`, `training_programs.py`, `training_sessions.py`                                                                                   | ⬜       |
| 18  | Training extended         | TRX    | `training_submissions.py`, `training_enhancements.py`, `training_waivers.py`, `external_training.py`, `course_cohorts.py`, `course_syllabus.py` | ⬜       |
| 19  | Skills testing            | SKT    | `endpoints/skills_testing.py` (3723 L)                                                                                                          | ⬜       |
| 20  | Compliance                | CMP    | `compliance_config.py`, `compliance_officer.py`                                                                                                 | ⬜       |
| 21  | Admin hours               | AH     | `admin_hours.py`                                                                                                                                | ⬜       |
| 22  | Grants & fundraising      | GF     | `grants.py`, `grant_service.py`, `fundraising_service.py`                                                                                       | ⬜       |
| 23  | Medical supplies          | MSUP   | `medical_supplies.py`                                                                                                                           | ⬜       |
| 24  | Meetings & minutes        | MM     | `meetings.py`, `minutes.py`                                                                                                                     | ⬜       |
| 25  | Messaging & notifications | MSG    | `messages.py`, `message_history.py`, `notifications.py`, `email_templates.py`                                                                   | ⬜       |
| 26  | Forms                     | FORM   | `endpoints/forms.py`, `public/forms.py`                                                                                                         | ⬜       |
| 27  | Integrations              | INT    | `integrations.py`, `salesforce_sync.py`                                                                                                         | ⬜       |
| 28  | Security, audit & IP      | SEC2   | `security_monitoring.py`, `ip_security.py`, `audit_logs.py`, `error_logs.py`                                                                    | ⬜       |
| 29  | Reports & analytics       | RPT    | `reports.py`, `analytics.py`, `platform_analytics.py`, `dashboard.py`, `labels.py`                                                              | ⬜       |
| 30  | Onboarding                | ONB    | `api/v1/onboarding.py` (24 unauth bootstrap routes)                                                                                             | ⬜       |
| 31  | Scheduled tasks           | CRON   | `scheduled.py`, `services/scheduled_tasks.py`                                                                                                   | ⬜       |
| 32  | Locations & kiosk         | LOC    | `locations.py`, `admin_hub.py`                                                                                                                  | ⬜       |
| 33  | Core infrastructure       | CORE   | `core/security_middleware.py`, `core/middleware.py`, `core/database.py`, `core/config.py`                                                       | ⬜       |
| 34  | Frontend shared           | FE     | `utils/apiCache.ts`, module axios instances, `ProtectedRoute`, global stores                                                                    | ⬜       |

**35 iterations per full pass.** After 34 the rotation wraps to 00, which
re-runs the whole-codebase sweeps against whatever has landed since.

---

## Log

- **(init, 2026-08-25)** Rotation created at the owner's request: a 30-minute
  loop running an application-wide, feature-by-feature security review with a
  pull request per iteration. Feature partition derived from the current
  endpoint inventory (66 files in `api/v1/endpoints/`, 11 in `api/public/`),
  ordered by risk rather than alphabetically.
- **SEC-00 cross-cutting baseline ⏳** — five whole-codebase sweeps. Four came
  back clean with the mechanism named (CSV injection, `SET NULL` nullability,
  proxy-IP attribution, Alembic chain integrity); the fifth found a live class
  and closed it. **SEC-1/2/3: LIKE-wildcard handling** — 2 sites interpolated
  raw user input into a LIKE pattern, 47 escaped the input but never declared
  `ESCAPE '\'` (inert under `NO_BACKSLASH_ESCAPES`), and the transform that
  `app/utils/sql_search.py` was written to own had been copy-pasted into 15
  files while exactly one call site used the helper. All 76 `like`/`ilike`
  calls now pass `escape=LIKE_ESCAPE_CHAR`, the transform has one
  implementation, and `tests/test_like_escaping.py` fails on reintroduction of
  either half. **SEC-4** — a pre-existing mis-attribution in the inventory
  barcode search, found by the flake8 run the sweep forced. Next: 01 auth &
  session lifecycle.
- **SEC-00 cross-cutting baseline ✅ merged** — PR #1799 merged 2026-08-25
  08:34:59Z.
- **01 Auth & session lifecycle ✅ merged** — PR #1804 merged 2026-08-25.
- **01 Auth & session lifecycle ⏳** — two prior app-review passes
  (`docs/app-review/auth-session.md`, 2026-08-05 and 2026-08-08) already did a
  six-lens sweep; this iteration re-verified those claims against current code
  (still accurate) and applied the checklist dimensions those passes covered
  lightly. **AUTH-1 (MED)** — OAuth login never adopted the 2026-08-12
  organization-active check that password login got, and fell back to an
  unscoped user lookup (a latent tenant-isolation gap) when its org lookup
  came back empty; fixed to filter on `Organization.active` and fail closed,
  mirroring password login exactly. **AUTH-2 (NIT)** — the prior pass's route
  count (25) and "refresh grace window intact" claim had both drifted from
  current code (26 routes; the grace window was deliberately removed
  2026-08-12); corrected in `auth-session.md`. See
  `AUTH-01-auth-session.md` for the full write-up. Next: 02 permissions &
  roles.
- **02 Permissions & roles ⏳** — `roles.py`/`role_service.py`/
  `dependencies.py`/`core/permissions.py` carry an extremely thorough
  privilege-escalation history (module audit + 4 app-review passes through
  2026-08-09); spot-checked the ceiling machinery still holds unchanged (git
  log: zero commits to those 3 files since). `officers.py`, `org_chart.py`,
  and `operational_ranks.py` are new since that pass (added 2026-08-21/24) and
  carry no prior audit — read in full. **PERM-1 (LOW)** — `GET
/operational-ranks/validate` backs a `settings.manage`-gated screen but had
  no server-side permission check of its own; any authenticated member could
  call it directly and see which members have a misconfigured rank. Fixed to
  match its CRUD siblings. **PERM-2 (LOW)** — `seed_defaults` had a narrow
  concurrent-first-load race (two admins opening a brand-new org's Settings at
  once) that surfaced as an uncaught 500 instead of the ranks simply loading;
  now rolls back and returns the already-seeded set. See
  `PERM-02-permissions-roles.md` for the full write-up. Next: 03 public
  surface & webhooks.
