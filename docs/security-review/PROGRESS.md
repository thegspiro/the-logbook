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

None open — feature 23 (medical supplies) in progress.

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

| #   | Feature                   | Prefix | Principal code                                                                                                                                  | Status          |
| --- | ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 00  | Cross-cutting baseline    | SEC    | whole-codebase sweeps; see `SEC-00-cross-cutting-baseline.md`                                                                                   | ✅ #1799        |
| 01  | Auth & session lifecycle  | AUTH   | `endpoints/auth.py`, `auth_service.py`, `mfa_service.py`, `oauth_service.py`                                                                    | ✅ #1804        |
| 02  | Permissions & roles       | PERM   | `dependencies.py`, `core/permissions.py`, `roles.py`, `operational_ranks.py`, `officers.py`, `org_chart.py`                                     | ✅ #1805        |
| 03  | Public surface & webhooks | PUB    | `api/public/*` (20 unauth routes), `paypal_webhook.py`, `integrations_webhook.py`, `salesforce_webhook.py`                                      | ✅ #1806        |
| 04  | Storefront & payments     | SF     | `endpoints/storefront.py`, `storefront_service.py`, `utils/storefront_payments.py`                                                              | ✅ #1807        |
| 05  | Finance & approvals       | FIN    | `endpoints/finance.py`, `finance_service.py`, `public/finance_approvals.py`                                                                     | ✅ #1809        |
| 06  | Elections & ballots       | ELEC   | `endpoints/elections.py` (token-scoped voting)                                                                                                  | ✅ #1810        |
| 07  | Users & organizations     | USR    | `users.py`, `organizations.py`, `member_status.py`, `member_leaves.py`                                                                          | ✅ #1814        |
| 08  | Membership pipeline       | MP     | `membership_pipeline.py`, `membership_pipeline_service.py`                                                                                      | ✅ #1815        |
| 09  | Medical screening (PHI)   | MS     | `medical_screening.py`, `medical_screening_service.py`                                                                                          | ✅ #1816        |
| 10  | Documents & legal         | DOC    | `documents.py`, `station_documents.py`, `legal_documents.py`                                                                                    | ✅ #1826        |
| 11  | Inventory                 | INV    | `endpoints/inventory.py` (6539 L), `inventory_service.py`                                                                                       | ✅ #1835        |
| 12  | Facilities                | FAC    | `endpoints/facilities.py` (3724 L), `facilities_service.py`                                                                                     | ✅ #1836        |
| 13  | Apparatus & NFC           | AP     | `apparatus.py`, `nfc_tags.py`                                                                                                                   | ✅ #1838        |
| 14  | Equipment check & shifts  | EC     | `equipment_check.py`, `shift_completion.py`                                                                                                     | ✅ #1842        |
| 15  | Scheduling                | SCH    | `scheduling.py`, `scheduling_module_config.py`, `calcom_sync.py`                                                                                | ✅ #1846, #1847 |
| 16  | Events & requests         | EV     | `events.py`, `event_requests.py` (public submission path)                                                                                       | ✅ #1848        |
| 17  | Training core             | TR     | `training.py`, `training_programs.py`, `training_sessions.py`                                                                                   | ✅ #1851        |
| 18  | Training extended         | TRX    | `training_submissions.py`, `training_enhancements.py`, `training_waivers.py`, `external_training.py`, `course_cohorts.py`, `course_syllabus.py` | ✅ #1873        |
| 19  | Skills testing            | SKT    | `endpoints/skills_testing.py` (3723 L)                                                                                                          | ✅ #1901        |
| 20  | Compliance                | CMP    | `compliance_config.py`, `compliance_officer.py`                                                                                                 | ✅ #1902        |
| 21  | Admin hours               | AH     | `admin_hours.py`                                                                                                                                | ✅ #1903        |
| 22  | Grants & fundraising      | GF     | `grants.py`, `grant_service.py`, `fundraising_service.py`                                                                                       | ✅              |
| 23  | Medical supplies          | MSUP   | `medical_supplies.py`                                                                                                                           | 🔄              |
| 24  | Meetings & minutes        | MM     | `meetings.py`, `minutes.py`                                                                                                                     | ⬜              |
| 25  | Messaging & notifications | MSG    | `messages.py`, `message_history.py`, `notifications.py`, `email_templates.py`                                                                   | ⬜              |
| 26  | Forms                     | FORM   | `endpoints/forms.py`, `public/forms.py`                                                                                                         | ⬜              |
| 27  | Integrations              | INT    | `integrations.py`, `salesforce_sync.py`                                                                                                         | ⬜              |
| 28  | Security, audit & IP      | SEC2   | `security_monitoring.py`, `ip_security.py`, `audit_logs.py`, `error_logs.py`                                                                    | ⬜              |
| 29  | Reports & analytics       | RPT    | `reports.py`, `analytics.py`, `platform_analytics.py`, `dashboard.py`, `labels.py`                                                              | ⬜              |
| 30  | Onboarding                | ONB    | `api/v1/onboarding.py` (24 unauth bootstrap routes)                                                                                             | ⬜              |
| 31  | Scheduled tasks           | CRON   | `scheduled.py`, `services/scheduled_tasks.py`                                                                                                   | ⬜              |
| 32  | Locations & kiosk         | LOC    | `locations.py`, `admin_hub.py`                                                                                                                  | ⬜              |
| 33  | Core infrastructure       | CORE   | `core/security_middleware.py`, `core/middleware.py`, `core/database.py`, `core/config.py`                                                       | ⬜              |
| 34  | Frontend shared           | FE     | `utils/apiCache.ts`, module axios instances, `ProtectedRoute`, global stores                                                                    | ⬜              |

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
- **02 Permissions & roles ✅ merged** — PR #1805 merged 2026-08-25. A Codex
  review comment caught a real regression in the PERM-2 fix before merge
  (a plain `db.rollback()` would have expired `current_user` and raised
  `MissingGreenlet` on the next request-scoped access) — corrected to a
  SAVEPOINT (`begin_nested`), verified empirically against a live DB
  connection, replied, and resolved.
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
- **03 Public surface & webhooks ⏳** — 6 of 12 files already carried thorough
  prior coverage (`public-portal.md`, `integrations.md`, `forms.md`,
  `storefront.md`); spot-checked and confirmed unchanged. `display.py` grew
  3x (119→401 L, the new guest QR check-in feature) since the last audit —
  re-read in full, verified tenant-safe and enumeration-resistant. Five files
  (`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
  `security_txt.py`) had no prior audit at all — read in full. **PUB-1
  (LOW)** — the Salesforce inbound webhook had no cap on payload record
  count; a validly-signed but oversized request could drive unbounded DB
  work inside the per-request rate limit. Fixed with a 500-record cap.
  **A Codex review comment on the PR caught a real ordering bug in that
  fix** — the cap check ran after the replay-fingerprint mark, so a
  rejected oversized request still got fingerprinted "seen," and a
  provider's retry of the same payload would be mistaken for an
  already-handled duplicate (200) instead of being validated again. Fixed by
  moving payload-shape validation before the replay check. **PUB-2 (NIT)** —
  documented `legal.py`'s single-org guard, which was already correct but
  unexplained. **PUB-4 (MED)** — **a second Codex review comment correctly
  challenged this iteration's own initial conclusion**: the finance
  token-approval path's lack of a self-approval check had been recorded as
  "verified safe" on the reasoning that the token path has no Logbook
  identity to compare — true for POSITION/PERMISSION/SPECIFIC_USER approver
  types, but wrong for `EMAIL`-type steps, where the approver's identity
  _is_ the literal email on the step. Fixed: `approve_by_token` now blocks
  self-approval when the step's approver email matches the requester's,
  unless the step explicitly sets `allow_self_approval`. **PUB-3 (INFO)** —
  recorded that the finance approval tables are `create_all`-only by design,
  matching the documented pattern elsewhere. See
  `PUB-03-public-surface-webhooks.md` for the full
  write-up. Next: 04 storefront & payments.
- **03 Public surface & webhooks ✅ merged** — PR #1806 merged 2026-08-25.
- **04 Storefront & payments ⏳** — already the most heavily-audited module
  in the codebase (module audit + 2 app-review passes, called "the
  best-defended module reviewed to date"); re-verified all established
  invariants hold unchanged and read the one file with no prior coverage
  (`storefront_preview_service.py` — clean). Found via git history, not
  re-derivation, that module-audit's previously-open SF-4 (`storefront.order`
  held by one endpoint) was resolved 2026-08-24 by a position-editor fix
  (`_VIEW_IMPLIED_PERMISSIONS`) — corrected that doc to mark it resolved.
  **A Codex review comment on the PR caught that the initial "no new
  findings" conclusion was wrong on three counts**: the git-history sweep
  had missed 5 real commits (this repo's history is squashed/rewritten, so
  `--since` and ancestry checks can't be trusted — matches the same issue
  AUTH-01 already documented); one of those 5 was a real gap — **SF-6 (MED)**
  — `record_payment` (the shared engine `mark_order_paid`/
  `waive_order_payment`/`refund_order` all delegate to, and also its own
  directly-callable endpoint) had no separation-of-duties check unlike its
  three siblings, letting a `storefront.manage` holder settle their own
  order's payment; and a still-open prior-review item (unbounded
  `/orders/export`) had been silently dropped instead of carried forward.
  Fixed SF-6, carried the export item forward as still-open, corrected the
  write-up. Closed one cheap test-coverage gap the 2026-08-08 app-review had
  flagged: added a regression test for the refund amount's `gt=0` constraint.
  See `SF-04-storefront-payments.md` for the full write-up. Next: 05 finance
  & approvals.
- **04 Storefront & payments ✅ merged** — PR #1807 merged 2026-08-25 12:39
  UTC.
- **05 Finance & approvals ⏳** — the most heavily audited module in the
  codebase before this pass even started (module audit + 4 app-review
  passes). Re-verified FIN-1/2 (`_validate_finance_fks`, 13 call sites), FIN-3
  (dues self-scoping), FIN-4 (`assert_different_person` disburse-side SoD),
  FIN-6 (dues-payment ledger + idempotency) all hold unchanged. All 66 routes
  enumerated and confirmed `require_permission`-gated. **FIN-9 (MED, fixed)**
  — `get_pending_approvals` queried `ApprovalStepRecord` with no organization
  filter at all, scanning every tenant's pending approval steps (not merely
  "the org-wide queue" the prior passes' notes described) before the
  per-record `_get_entity_info` call silently discarded anything foreign from
  the response — no data leaked, but the query cost scaled with the whole
  platform's pending-approval volume on every approver's inbox load. Fixed by
  resolving each entity type's org-scoped id set first and filtering the
  record query on it before the N+1 follow-up loop runs. **Four Codex review
  comments on the PR all caught real issues and were fixed**: (1) the initial
  fix materialized each entity type's id set into a Python list before
  filtering — a large org's full request history — rewritten to pass
  correlated subqueries into `.in_()` so the database does the filtering; (2)
  the regression test only asserted on the returned list, which
  `_get_entity_info`'s own filter would have passed even under the old,
  unfiltered query — rewritten to spy on `_get_entity_info` and assert the
  foreign record's id never reaches it; (3) the write-up's "12 finance
  tables, all `create_all`-only" claim was wrong on both counts — 15 tables,
  and `dues_payments` has a real (conditional) creating migration a
  single-line-only grep pattern missed; corrected with the accurate
  breakdown; (4) the "zero logic commits since Aug 9" premise was itself
  wrong — a broader sweep (not path-filtered `git log`, which this repo's
  rewritten history can mislead, per AUTH-01/SF-04) surfaced a real Aug 16
  commit (`3dd2b28b`, token-approval locking) the original sweep missed;
  corrected, though the current-code review this pass actually ran already
  covered that commit's effect. See `FIN-05-finance-approvals.md` for the
  full write-up. Next: 06 elections & ballots.
- **05 Finance & approvals ✅ merged** — PR #1809 merged 2026-08-25 15:49
  UTC.
- **06 Elections & ballots ⏳** — the most heavily audited module in the
  codebase (module audit + 13 R-findings + 5 R-D findings + 5 app-review
  passes, all closed). File sizes have nearly doubled since the module-audit
  header was written (`elections.py` 2,721→3,809 L, 46→65 routes;
  `election_service.py` 4,616→7,962 L) with no discrete finding ever called
  out for the growth — cross-checked the current route list against
  everything every prior pass named and nearly all of it is accounted for
  (voter-overrides, proxy-authorizations, manual-ballots, attendees,
  eligibility-roster, package assembly — each individually documented across
  the R/R-D/ELEC2 series; only the header counts were never bumped).
  **One feature outside the module-audit/app-review/security-review doc set
  found:** `SavedBallotTemplate` (migration `20260812_0001`) — org-scoped
  list/create/delete, `elections.manage` gated, `extra="forbid"` schema
  accepting only configuration fields (no election/voter/candidate/token/
  result data), audit-logged. Access-control clean. Also re-verified all 31
  `select(Election)` call sites in `election_service.py` for tenant
  isolation (28 direct, 3 safe-by-construction) — no FIN-9-shaped unscoped
  scan here. Corrected the stale endpoint/line counts in
  `module-audit/elections.md` (NIT). **Two Codex review comments on the PR
  both caught real issues**: (1) the route-inventory table's "61
  permission-gated" claim conflated authenticated with permission-gated —
  5 voter-facing routes (`check_eligibility`/`cast_vote`/`cast_bulk_votes`/
  `get_results`/`cast_proxy_vote`) are authenticated-only by documented
  design (self-scoped, not a gap), corrected to 56 gated + 5
  authenticated-only + 4 public; (2) `SavedBallotTemplate`'s list/create
  were recorded as clean when they're actually unbounded — no pagination on
  the list, no per-org cap on creation — a real dimension-6 (abuse
  resistance) gap the initial pass missed by checking access control only.
  **ELEC-12 (LOW/MED, flagged, not fixed)** — both remedies are
  behavior-change judgment calls (response-envelope pagination, an
  arbitrary creation cap), so flagged rather than guessed; mirrored into
  `KNOWN_LIMITATIONS.md`. Also caught in my own review before push: the
  write-up initially claimed `SavedBallotTemplate` was "previously
  undocumented," but `KNOWN_LIMITATIONS.md` already carries a 2026-08-12
  ship-time entry on it (a different angle — schema tolerance, not access
  control); corrected. See `ELEC-06-elections-ballots.md` for the full
  write-up. Next: 07 users & organizations.
- **06 Elections & ballots ✅ merged** — PR #1810 merged 2026-08-25 16:59
  UTC.
- **07 Users & organizations ⏳** — the highest-risk surface by design
  (privilege escalation): module audit iteration 21 (three parallel readers)
  - 4 dedicated app-review passes, all closed except ORU-7c (unchanged).
    Re-verified the privilege-ceiling functions, PII redaction gates, and
    settings-secret redaction are still wired at every documented call site.
    **An 8-issue Codex review round on the PR** corrected the initial pass's
    "no defect found" conclusion — 6 fixed, 2 doc-corrected: **USR-1**
    (leave-of-absence create/update/delete never wrote an audit event despite
    the event types existing since the audit-history feature shipped — now
    fixed, 3 tests), **USR-2** (MED — the audit-history query's actor-fallback
    clause had no target check, so an event where the viewed member acted ON
    someone else leaked that other member's event_data into the viewed
    member's history — narrowed to only fire on genuinely self-inherent
    events, DB-backed regression test verified to fail without the fix),
    **USR-3** (two real, emitted audit event types — admin MFA reset,
    compliance exemption change — were invisible in member history because
    neither was in the endpoint's allowlist — added), **USR-4** (a schema
    test looked up the pre-rename table name `user_roles` instead of
    `user_positions` and had been silently skipping instead of verifying
    anything — fixed, now passes for real), **USR-5** (flagged — the
    "no defect" pass's unbounded-list dismissal was wrong: archived accounts
    and leave records accumulate for an org's entire lifetime rather than
    being bounded by current headcount; 2 more instances found in this
    module's own files beyond the 2 the first pass checked; not fixed,
    pagination is a response-envelope decision same as ELEC-12), plus a
    corrected route-inventory claim (3 org-wide reads use bare `get_current_user`
    with no self-check — already-audited ORU-8b pattern, not a gap) and a
    corrected test-coverage claim (added a source-inspection guard test since
    the cited helper-level tests don't exercise the actual route call sites).
    See `USR-07-users-organizations.md` for the full write-up. Next: 08
    membership pipeline.
- **07 Users & organizations ✅ merged** — PR #1814 merged 2026-08-25 18:18
  UTC.
- **08 Membership pipeline — 5 fixed, 1 flagged (via Codex on the draft PR),
  plus 1 more found and fixed while fixing one of those.** First drafted as a
  "no new findings" re-verification pass; Codex's review of that draft PR
  caught five real issues the draft had missed, and fixing one of them
  (`update_prospect` dropping explicit nulls) surfaced a second, unguarded
  path to the exact `TRANSFERRED`-manipulation bug PR #1811's own Codex
  review had already fixed on the dedicated status endpoints — the generic
  `PUT /prospects/{id}` reaches the same status column and had none of that
  fix's guards. Fixed: the explicit-null drop itself (now routes through
  `apply_updates`, this service's established pattern elsewhere); the second
  `TRANSFERRED` path (closed the same way as the first); `/approve-step`
  returning the full applicant record — DOB, address, coordinator notes — to
  a signer authorized only by the role they hold, not by view permission
  (now returns a minimal `{prospect_id, step_id, step_completed}` result);
  and `PUT`/`DELETE /interviews/{id}` bypassing the router-wide self-access
  guard, because those routes carry no `{prospect_id}` path parameter for it
  to key on (added a dedicated `block_self_interview_access` dependency).
  Flagged, not fixed: unbounded election-package listing/creation, the same
  class as ELEC-12/USR-5 — pagination and a creation cap are both
  behavior/contract changes needing an owner decision. Full completion gate
  re-run after the fixes (flake8/black/isort/migrations/228 pipeline tests +
  37 PII-exposure tests/tsc, all green). See `MP-08-membership-pipeline.md`
  for the complete writeup, including the revision note explaining the
  draft-vs-final split. Next: 09 medical screening (PHI).
- **08 Membership pipeline ✅ merged** — PR #1815 merged 2026-08-25 19:43
  UTC.
- **09 Medical screening (PHI) — 2 fixed, 1 re-flagged, 1 doc correction.**
  Module-audit (MS-1–MS-3) and app-review (four passes, MS-1/MS-2/MS-3/
  MS2-4/MS2-5) had no open findings — MS-1 (PHI plaintext) was closed in
  app-review pass 4 via `EncryptedText`/`EncryptedJSON`; re-verified
  genuinely intact (model columns, migration, reversibility all checked).
  Reviewed the two pieces added since the 2026-08-09 baseline in full:
  `GET /compliance/me` (self-scoped, structurally IDOR-safe — no id param —
  minimal-detail response) and a new medical-screening → membership-pipeline
  auto-advance integration (org-scoped and gated through the same
  `_assert_movable`/stage-completion checks MP-08 reviewed). **MS-4** (doc
  correction): `KNOWN_LIMITATIONS.md` and `APPLICATION_PAGES.md` both
  claimed the frontend route was ungated; it was fixed the day before this
  review (`05b8275b`, "gate 21 officer pages") and neither doc was updated —
  both corrected. **MS-5** (fixed): `update_record`/`update_requirement`
  wrote every field with a bare `setattr`, so an explicit null on a NOT NULL
  column (`status`/`screening_type`/`name`) 500'd as a raw `IntegrityError`
  instead of a clean 400 — the same failure shape MS2-5 fixed for an
  out-of-enum string, just for the null case its validator doesn't cover.
  Rewritten to use `apply_updates`. **MS-6** (flagged): unbounded
  requirement/record lists, the same class as FIN-9/ELEC-12/USR-5/MP-10 —
  first flagged in app-review pass 3 but never mirrored into
  `KNOWN_LIMITATIONS.md` until now. Two more LOW items re-verified still
  accurate, left open, not re-flagged. See `MS-09-medical-screening.md`.
  Next: 10 documents & legal.
- **09 Medical screening (PHI) ✅ merged** — PR #1816 merged 2026-08-25
  22:39 UTC. No Codex findings on this one — clean pass.
- **10 Documents & legal — no new findings.** The rotation row bundles three
  files, but only `documents.py` had ever been reviewed
  (`docs/module-audit/documents.md` DOC-1–6,
  `docs/app-review/documents.md` four passes); `station_documents.py` and
  `legal_documents.py` — and their backing services — had no prior review at
  all. Re-verified `documents.py`: DOC-1/2/3/6 still fixed; DOC-4 (summary
  ignores folder ACL) and DOC-5 (ACL not hierarchical) still open, unchanged
  — DOC-5 confirmed to extend identically to a facility-folder hierarchy
  added since the last pass. First full review of the other two: the
  station-document print path (shift roster / apparatus check sheet to a
  receipt printer) correctly inherits scheduling's own pass-down-notes
  access rule and equipment-check's own position-narrowing rather than
  re-deriving looser ones; the legal-document propose/publish workflow is
  org-scoped throughout, uses `apply_updates` correctly, and — checked
  through to the frontend — the one path here where an authenticated write
  reaches an anonymous audience (the public `/privacy`/`/terms` pages)
  renders custom text as plain JSX, never `dangerouslySetInnerHTML`, so it
  cannot inject markup. No code changes. See `DOC-10-documents-legal.md`.
  Next: 11 inventory.
- **10 Documents & legal ✅ merged** — PR #1826 merged 2026-08-26 03:19 UTC
  (the follow-up applying the 11-comment Codex round from #1821, DOC-19–21,
  plus the consolidated #1827 download-endpoint work, DOC-18/22–26 — see the
  log entries above for the full history). #1827 closed as superseded.
  Next: 11 inventory.
- **11 Inventory — 2 fixed, 2 flagged.** Re-verified INV-1/2/3/5/6 from the
  module audit still hold and that INV-4's ~13-method XC-1 FK-scoping sweep
  (app-review pass 4) is genuinely closed. Corrected a stale endpoint count
  in `module-audit/inventory.md` (132, not 116, even at that doc's own
  commit — this repo's squashed history means the doc's stated snapshot was
  already out of date when it was written, not a sign of undocumented
  growth). Enumerated all 132 routes (0 unauthenticated). **INV-7 (MED,
  fixed)** — `GET /clearances/{clearance_id}` was gated on the baseline
  `inventory.view` while every sibling clearance route, including the
  identically-shaped `/users/{user_id}/clearance`, requires
  `inventory.manage`; the recent `ccea2576`/`d7be097b` permission-tightening
  commits missed this one route. Tightened to match; no frontend caller
  exists (the feature is backend-only per `KNOWN_LIMITATIONS.md`).
  **LBL-1 (LOW, fixed)** — `POST /labels/print` (a shared cross-module route
  bundled with this feature since the module audit reviewed it together)
  echoed the printer transport's raw error, including its configured LAN
  host:port, to any caller holding just the target module's `.view`
  permission — this rotation's own recent DOC-10 pass had fixed the
  identical leak in `station_documents.py` and assumed (incorrectly, for
  this one route) that all of `labels.py`'s printer routes were
  `settings.manage`-gated. Fixed the same way: log server-side, generic 502
  to the caller. Flagged: **INV-8** (allowance-usage-by-member) and **INV-9**
  (size-preferences-by-member), both cross-member reads on the baseline
  `.view` grant with no established sibling precedent for the intended gate
  — owner decision, mirrored to `KNOWN_LIMITATIONS.md`. Full completion gate
  green: flake8/black/isort/migrations clean, full 8302-test backend suite
  passed. See `INV-11-inventory.md` for the complete write-up. Next: 12
  facilities.
- **11 Inventory ✅ merged** — PR #1835 merged 2026-08-26 04:47 UTC. No
  review-bot findings on this one (Codex reported it had hit its usage
  limit for security reviews); CI green on the first run.
- **12 Facilities — 4 fixed, 1 doc correction (via Codex on the draft PR).**
  First drafted as "no new findings, no code changes" — re-verified FAC-1
  through FAC-5 all hold (including the HIGH-severity FAC-5 sensitive-family
  gate) and read the new `GET /{facility_id}/folders` bridge to the generic
  Documents module for IDOR/org-scoping only (clean). **A Codex review of
  that draft caught 5 real issues the draft missed.** Fixed:
  **FAC-6 (HIGH, availability)** — `ensure_facility_folder`'s get-or-create
  had no locking or uniqueness constraint, so two concurrent first-accesses
  to a facility's folders could both insert a duplicate, after which every
  later read raised `MultipleResultsFound` — a permanently broken endpoint
  for that facility. Fixed with an organization-row lock (Pitfall #27
  shape). **FAC-7 (MED)** — 6 update methods plus the module's shared
  `_apply_updates` helper (19 call sites total) hand-rolled a blind
  `setattr` loop, so an explicit null on a NOT-NULL column (e.g.
  `Facility.name`) 500'd as a raw `IntegrityError` instead of a clean 400 —
  the same class MS-5 already fixed elsewhere. Routed through the shared
  `apply_updates` utility. **FAC-8 (LOW)** — `FacilityPhotoResponse`/
  `FacilityDocumentResponse` leaked the internal storage `file_path` to any
  `facilities.view` holder; now excluded, matching the Documents module's
  own `DocumentResponse` precedent. **FAC-9 (LOW)** — the new folder
  endpoint's `document_count` crossed the `documents.view` permission
  boundary (the same aggregate-disclosure class as DOC-4, still open in the
  Documents review); now redacted to `null` for callers without
  `documents.view`/`.manage`. **FAC-4 correction**: the draft (and every
  app-review pass before it) claimed facility search was "wired but not
  exposed" — Codex caught that this is stale; `GET /facilities`/`/page`
  both forward `search` and the frontend calls it. Corrected in
  `module-audit/facilities.md` and `app-review/facilities.md`. Full
  completion gate green including the full 8317-test backend suite. See
  `FAC-12-facilities.md` for the complete write-up. Next: 13 apparatus &
  NFC.
- **12 Facilities ✅ merged** — PR #1836 merged 2026-08-26 10:56 UTC.
- **13 Apparatus & NFC — 1 fixed, no defect in either new feature.**
  Apparatus itself re-verified clean (AP-1/AP2-1/AP2-2 all still closed).
  First full review of `nfc_tag_service.py` (member ID cards + check-in
  stations) and `driver_exception_service.py` (EVOC-requirement bypass, tied
  into scheduling) — both new since the last pass, neither previously
  audited, and both already well-hardened (hashed card UIDs,
  separation-of-duties on the exception approval, a locking conditional
  UPDATE for the approval race). **AP-6 (LOW, fixed)** — tracing the NFC
  admin-hours check-in path surfaced a missing `organization_id` filter on
  `AdminHoursService.clock_out_by_category`'s own query; not exploitable
  today (both callers pass the caller's own id and entries are
  org-consistent by construction), but closed on the query itself rather
  than continuing to rely on that invariant holding. A sibling method
  (`clock_out`) with the same shape is left for the Admin Hours module's own
  turn (feature 21). Full completion gate green, full 8388-test backend
  suite. See `AP-13-apparatus-nfc.md` for the complete write-up. Next: 14
  equipment check & shifts.
- **13 Apparatus & NFC ✅ merged** — PR #1838 merged 2026-08-26 12:31 UTC.
  A Codex review round caught that the new guard test's org-scoping
  assertion was hollow (checked the whole compiled statement rather than
  its WHERE clause); fixed, and the same pre-existing flaw in a sibling
  test in the same class was fixed alongside it.
- **14 Equipment check & shifts — no new findings, no code changes.** The
  most heavily audited module by finding-count in the rotation (11 fixes
  in the module audit alone, including a HIGH cross-tenant apparatus write,
  plus 3 more from app-review). Re-verified all 14 prior fixes hold.
  `equipment_check.py` grew from 34 to 47 routes since the last pass — a
  new supply-officer stock swap/consume/recount feature (9 endpoints
  touching `InventoryLot` quantities, the exact shape of surface this
  module's history shows is where its defects live). Read all nine, and
  their service methods, in full. Found them already correctly
  org-scoped, and the one concurrency-sensitive operation
  (`swap_item_lot`) correctly locking three separate rows in a
  deliberately fixed order to avoid both an overconsumption race and a
  lock-ordering deadlock. No defect found. Full completion gate green,
  full 8500-test backend suite. See `EC-14-equipment-check-shifts.md` for
  the complete write-up. Next: 15 scheduling.
- **14 Equipment check & shifts — correction: a Codex review of the above
  draft caught 3 real issues it missed.** (1) `report_item_used` was an
  unlocked read-modify-write on deployed-lot quantities — fixed with a
  row lock plus a locking read on the item's deployed lots, same order as
  `swap_item_lot`. (2) A submit-only caller could inflate a deployed
  lot's quantity via `update_deployed_lot` (only metadata changes were
  blocked, not increases) and then use that inflated figure as
  `swap_item_lot`'s submitter cap — fixed by requiring manage permission
  for a quantity increase under `allow_metadata_change=False`. (3) None
  of the 9 new supply endpoints were in the frontend's
  `UNCACHEABLE_PREFIXES` despite carrying reporter names and free-text
  notes — fixed by adding `/equipment-checks`. A 4th thread (the
  pre-existing `get_item_deployments` `.view`-vs-`.manage` gate gap) was
  confirmed already deliberately unadjudicated and mirrored into
  `docs/KNOWN_LIMITATIONS.md` rather than fixed. Same shape as FAC-12's
  draft-vs-final split. `EC-14-equipment-check-shifts.md` rewritten with
  a Revision note and the EC-12/EC-13/EC-14 write-ups. Guard tests added
  for all three fixes. Full completion gate green, full 8542-test backend
  suite, frontend `tsc`/`eslint`/`vitest` clean.
- **14 Equipment check & shifts ✅ merged** — PR #1842 merged 2026-08-26.
  All 4 Codex review threads replied to (with the fixing commit hash) and
  resolved; all 16 CI checks green on the merged head, no merge conflict.
  Next: 15 scheduling.
- **15 Scheduling — PR #1846 opened.** `scheduling.py` and
  `scheduling_service.py` have roughly doubled in size since the last
  full read (module-audit iteration 19 + 4 app-review passes,
  2026-08-06..09): endpoints ~1,900 → 3,437 L (92 routes), service
  ~5,000 → 7,018 L. Re-read both in full rather than treating the growth
  as incremental, plus `standing_shift_service.py` (570 L, recurring
  member shift claims) and the `scheduling_module_config`/`calcom_sync`
  surface, neither previously reviewed. SCH-1 through SCH-8 all
  re-verified still fixed, no regressions. One new finding: SCH-9 (LOW,
  XC-1) — `create_shift_call`/`update_shift_call` stored a
  client-supplied `responding_members` user-id list with no in-org
  check, the one exception to this file's otherwise-universal
  client-supplied-user-id discipline; `compute_member_call_counts` sums
  this column, so a foreign id could inflate an unrelated org's
  member's call-count statistic. Fixed via the same `_user_in_org`
  helper used everywhere else in the file. Guard tests added
  (`test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping`).
  Full completion gate green, full 8544-test backend suite. See
  `SCH-15-scheduling.md` for the complete write-up.
- **15 Scheduling ✅ merged (#1846), Codex round follow-up opened
  (#1847).** #1846 was merged by the repo owner before its Codex review
  round finished, leaving 3 findings unaddressed on `main`: a real
  efficiency gap (SCH-9's original per-id validation loop — up to 100
  serial queries) and two inaccurate claims in the draft's own write-up
  (SCH-9's cross-tenant impact was overstated — there is no cross-tenant
  failure scenario, since every reader of `responding_members` is scoped
  to one already org-validated shift/trainee first; and a "Verified
  good" claim that `calcom_service.py` closes the DNS-rebinding TOCTOU
  was wrong — it narrows the window, and the same repo-wide pattern
  exists in 5 other integration services). Followed the merged-branch
  protocol: rebased the one unmerged commit onto latest main rather than
  reusing or discarding it, pushed to a fresh branch, opened #1847.
  SCH-9 downgraded to NIT with corrected text; the DNS-rebinding gap
  filed as SCH-10, flagged (cross-cutting, not scheduling-specific) and
  mirrored into `KNOWN_LIMITATIONS.md`. Replied to and resolved all 3
  Codex threads on the now-merged #1846, referencing #1847. Full
  completion gate green, full 8556-test backend suite.
- **15 Scheduling — #1847 ✅ merged.** A second Codex round on #1847
  itself caught that the SCH-10 correction had undercounted its own
  affected surface — six files sharing one fix, when it's actually seven
  callers of `assert_outbound_url_safe` across three distinct transports
  (five via the shared `create_integration_client`, one hand-built
  `httpx.AsyncClient` in `audit_ship_service.py`, one `pywebpush` in
  `push_service.py` — neither of the latter two reachable by a fix
  scoped to the shared client factory). Corrected in both
  `SCH-15-scheduling.md` and `KNOWN_LIMITATIONS.md`; replied to and
  resolved the thread. All 16 CI checks green on the merged head, no
  merge conflict. Next: 16 events & requests.
- **16 Events & requests — PR #1848 opened.** `events.py`,
  `event_requests.py`, and `event_service.py` grew 15-30% since the last
  full read (module-audit iteration 17 + 4 app-review passes,
  2026-08-06..09); read all three in full plus the new
  `event_request_service.py` (extracted from `event_requests.py`'s
  endpoint file since the last audit). EV-1 through EV-10, EV2-1, EV2-2
  all re-verified still fixed, no regressions. One new finding: EV-11
  (LOW, XC-1) — `create_recurring_event`'s client-supplied `template_id`
  was not org-validated, unlike `location_id` checked two lines above it
  — fixed via the existing org-scoped `get_template()`. A first draft of
  the fix also wrongly added the same check to `create_event`, based on
  a misread of the schema (`EventCreate` has no `template_id` field at
  all); this failed all 16 tests in `test_event_lifecycle.py` and was
  caught and reverted by running the full suite before opening the PR,
  not by external review. Full completion gate green, full 8557-test
  backend suite. See `EV-16-events-requests.md` for the complete
  write-up.
- **16 Events & requests ✅ merged** — PR #1848 merged 2026-08-26. No
  review threads; all 16 CI checks green on the merged head, no merge
  conflict. Next: 17 training core.
- **17 Training core — PR #1851 opened.** The largest feature reviewed so
  far: `training.py`, `training_programs.py`, `training_sessions.py`, and
  their 3 backing services (~11,000 L combined), split off from the
  module-audit's single "Training" unit (8 endpoint files, 154 endpoints)
  — `training_submissions.py`/`training_enhancements.py`/
  `training_waivers.py`/`external_training.py`/`course_cohorts.py`/
  `course_syllabus.py` are feature 18. `training_program_service.py` grew
  36% since the module audit (4,027 → 5,482 L); read all six in-scope
  files in full, split across 3 parallel reads. TR-1/2/4/7/9/10
  re-verified still hold. 3 new findings, all fixed: TR-11 (MEDIUM, XC-1)
  — program JSON-import stored a client-supplied `category_ids` array
  unvalidated, the one requirement-creation path in the file missing the
  `assert_all_in_org` guard every sibling path has; also fixed a missing
  `except ValueError` wrapper on the import endpoint (a pre-existing
  latent-500 this fix's own new raise would have hit too). TR-12 (LOW/MED,
  XC-3) — two `User` lookups in `training_service.py` had no org filter,
  reachable by a `training.manage` officer supplying a foreign org's
  `user_id` (existence oracle + a cross-org membership_type read feeding
  tier-exemption logic). TR-13 (LOW/MED, XC-1) — `course_id` was never
  org-validated on 3 record-create paths, unlike `user_id`/`category_id`
  on the same endpoints. Also closed 1 stale carried-forward flag (doc
  correction, not code): the training-sessions "dangling FK batch" is
  already resolved via `_validate_linkage_ids`, corrected in
  `docs/app-review/training.md`. 2 items flagged (enum validation gap in
  bulk/historical-import paths; `enroll_member`'s duplicate-enrollment
  race), mirrored into `KNOWN_LIMITATIONS.md`. Full completion gate green,
  full 8663-test backend suite. See `TR-17-training-core.md` for the
  complete write-up.
- **17 Training core ✅ merged** — PR #1851 merged 2026-08-26. No review
  threads (Codex reported it had hit its usage limit for security reviews,
  same as #1835); CI ran clean. Next: 18 training extended.
- **18 Training extended — PR #1873 opened.** The other half of the
  training module's module-audit unit: `training_submissions.py`,
  `training_waivers.py`, `training_enhancements.py`, `external_training.py`,
  and `course_cohorts.py`/`course_syllabus.py` — the last two never read by
  any prior audit or review pass at all (~10,000 L across 12 files
  combined). Read in full across 4 parallel reads, each briefed with the
  specific prior findings/flagged items for its files so the pass
  re-verified rather than re-derived. 10 findings, all fixed: **TRX-1
  (HIGH, confirmed live)** — `bulk_enroll_members`'s prerequisite-gate
  error strings resolved a foreign org member's real name via an unscoped
  batch `User` lookup; not caught by the TR-17 pass despite
  `training_program_service.py` being in that iteration's file list, since
  this is an error-message path, not a by-id read/update/delete. **TRX-2 /
  TRX-5 / TRX-5b** — blind `setattr` on NOT NULL columns (external-provider,
  cohort, syllabus-class updates), routed through `apply_updates`. **TRX-3**
  — `GET /effectiveness/evaluations` had no permission gate at all and
  leaked every member's free-text self-evaluations org-wide; confined
  non-officers to their own submissions, mirroring the file's own
  `get_member_competencies`/`.../me` split. **TRX-4 (MEDIUM)** — cohort
  class reschedule/cancel mutated and **committed** before checking the
  class belonged to the URL's cohort, and cancel's audit-log call sat after
  that check — a cross-cohort request cancelled a real class with zero
  audit trail while telling the caller 404; fixed by scoping the fetch to
  `cohort_id` before any write. **TRX-6 through TRX-10** — six
  client-supplied FK ids unvalidated in-org (waiver `requirement_ids` —
  also corrected a stale "not projected" premise, it is projected;
  submission `category_id`; 5 recertification-pathway FKs; 2
  multi-agency-exercise FKs; xAPI `source_provider_id`). Verified good, no
  code change: the cohort-generation transaction's full id chain, and the
  roster-membership-gated cohort read's org-scoping + PII redaction.
  Corrected a stale count in the SCH-10 `KNOWN_LIMITATIONS.md` entry
  (`external_training_service.py`'s own httpx client is an 8th affected
  site, not among the original 7). Full completion gate green, full
  8778-test backend suite. See `TRX-18-training-extended.md` for the
  complete write-up.
- **18 Training extended ✅ merged** — PR #1873 merged 2026-08-26. A Codex
  review round caught 3 real issues before merge (see prior log entry) —
  all fixed and threads resolved. **Separately, while getting CI green,
  found and fixed two pre-existing, repo-wide-blocking regressions on
  `main` unrelated to this feature**: `InventoryAdminHub.tsx` (introduced
  by #1894) failed `npm run lint`/`npm run build` for every open PR that
  merged main in (a banned `.toLocaleDateString()` call with no timezone
  parameter, three un-narrowed `severity` literals, and a banned
  `bg-red-600` fill) — fixed via standalone PR #1899, also merged. A Codex
  review on #1899 caught a real bug in that fix's own first draft (two
  calendar-date fields shifting a day west of UTC) — fixed and verified.
  While driving #1899 to green, also discovered a second pre-existing
  gap: the fire-chief officer-visibility test's `@pytest.mark.integration`
  fix (first surfaced during #1873's own CI, apparently authored by
  another session) had only ever been merged directly into #1873's
  branch, never through its own PR onto `main` — so `main` itself, and
  any fresh branch cut from it, still failed `Backend Unit Tests` on that
  same MySQL-connection error. Ported the identical one-line fix into
  #1899 so it closes on `main` for good rather than resurfacing on the
  next branch. Both PRs fully green (16/16 checks) before merge. Next:
  19 skills testing.
- **19 Skills testing ⏳** — reviewed `endpoints/skills_testing.py` (grown
  2.6x to 3,723 L since the 1,412 L last audited) and
  `skills_testing_service.py` (1,207 L) in full via 3 parallel background
  agents, cross-checked against `docs/module-audit/compliance-skills.md`
  and `docs/app-review/compliance-skills.md`. Re-confirmed CS-1, CS-2,
  CS-8/CS-10, LIKE escaping (Pitfall #25) and CSV injection guarding
  (Pitfall #15) all still intact. Four new findings, all fixed: **SKT-1**
  `update_template`'s blind `setattr` loop could raise an unhandled 500 on
  an explicit null against a NOT NULL column, now routed through
  `apply_updates`. **SKT-2/SKT-3** `void_test` and
  `return_test_for_correction` had no separation-of-duties check unlike
  their siblings `create_test`/`validate_test` (CS-8) — an
  officer-candidate could void their own unfavorable result or force
  unlimited free redo cycles on their own submission; both now call
  `assert_different_person`. **SKT-4** `assert_attempts_remaining`'s
  `max_attempts` cap was a read-then-write with no row lock (Pitfall #27,
  independently corroborated by all 3 review agents) — fixed with both
  halves the pitfall requires: a `FOR UPDATE` lock on the candidate's
  `RequirementProgress` row, and the spent-count query itself made a
  locking read. Fixing the new lock query broke 5 pre-existing tests whose
  mocked `db.execute` result queues didn't account for the extra call —
  reordered, not a logic change. Full local completion gate green:
  flake8/black/isort clean, migrations validated, 380/380 skills-scoped
  tests and the full 8814-test backend suite pass. Findings doc:
  `docs/security-review/SKT-19-skills-testing.md`. PR #1901 opened and
  subscribed. Next: 20 compliance, once #1901 merges.
- **19 Skills testing ✅ merged** — PR #1901 merged 2026-08-26. Codex review
  caught two real issues in the SKT-4 capacity-lock fix before merge: (P1)
  locking the candidate's `RequirementProgress` row rather than something
  guaranteed to exist — `_validate_requirement_link` never requires an
  active enrollment, so the lock could silently serialize on nothing; (P2) a
  lock-ordering deadlock risk, since `validate_test` locks its specific
  `SkillTest` row before calling into the capacity check, so two concurrent
  validations could each hold their own test row and then deadlock waiting
  on the capacity lock in reverse order of each other. Fixed by locking
  `TrainingRequirement` instead (the row already fetched first, guaranteed
  to exist for every capped test) via a new `lock_attempt_capacity` helper,
  and by having `validate_test` acquire that lock — through a non-locking
  peek at the test's `requirement_id` — before locking the test row, fixing
  the ordering as well as the target. Replied to both review threads with
  the fix and resolved them. Full local completion gate re-verified green
  (391/391 skills-scoped, 8816/8816 full suite) before pushing the revision;
  CI came back 16/16 green with no further comments. Next: 20 compliance.
- **20 Compliance ⏳** — this module already had the deepest prior coverage
  in the rotation (module-audit iteration 22 + 4 app-review passes through
  2026-08-09); read `compliance_officer.py`+service, `training_compliance.py`,
  and `compliance_config.py`+service+model+schema in full via 3 parallel
  background agents, re-confirming CS-1, CS-3, CS-6, CS-7, CS-8 (skills
  half), CS-9 recipient audit, and no IDOR/SQL-injection all still intact.
  **CMP-1/CMP-2** `update_compliance_config`/`update_compliance_profile`
  discarded an explicit null before the service ever saw it
  (`exclude_none=True`), so a profile's threshold override ("null = use org
  default") could never actually be cleared — fixed with `exclude_unset=True`
  - `apply_updates`. **CMP-3** a first-write race on `ComplianceConfig`
    surfaced as a raw 500 — now a clean 400. **CMP-4** `get_incomplete_records`
    silently capped its scan at the 500 most-recently-completed records with no
    signal to the caller, so older incomplete records on any org with more
    history were permanently invisible — fixed by pushing the predicate into
    SQL. **CMP-5** `report_type`'s real 3-value set (`monthly`/`annual`/
    `yearly`, the last used only by a scheduled task bypassing the HTTP schema)
    was undocumented at the schema layer and contradicted by a stale model
    comment — tightened to a `Literal`. **CMP-6** dict-key id-normalization
    parity for `ContributedHoursService`/`_get_admin_hours_summary` (both added
    since the last audit, both reintroducing the un-normalized pattern CS-9 had
    already fixed elsewhere in the same file) — guarded with a UUID-object
    regression test. **CMP-7** `create_attestation`'s percentage bound was
    schema-only; added a service-layer check to match its sibling validations.
    CS-8 attestation dual-control (re-confirmed no narrow fix exists — the
    record has no "subject" field to compare against the actor at all) and
    CS-9 monthly windowing remain flagged as product decisions, not bugs. Two
    design observations raised for owner awareness rather than fixed (a
    broader permission grant and a `compliance_exempt`-filtering inconsistency
    on the new contributed-hours endpoint — both look intentional per their
    docstrings). Full local completion gate green: flake8/black/isort clean,
    migrations validated, 269/269 compliance-scoped and 8833/8833 full backend
    suite pass. Findings doc: `docs/security-review/CMP-20-compliance.md`. PR
    #1902 opened and subscribed. Next: 21 admin hours, once #1902 merges.
- **20 Compliance ✅ merged** — PR #1902 merged 2026-08-26. Codex review
  caught one real regression in the CMP-4 fix before merge: the SQL
  location predicate checked only `location IS NULL`, but the Python
  fallback logic (`not r.location`) also treats `location=""` as missing —
  a value the training schemas allow — so a completed record with
  `location=""` and no `location_id` was silently excluded from the new SQL
  scan, the opposite of what the fix was for. Corrected to
  `location IS NULL OR location = ''`, matching the Python check exactly;
  replied and resolved the review thread. Full local completion gate
  re-verified green (270/270 compliance-scoped, 8834/8834 full suite)
  before the final push; CI came back 16/16 green with no further comments.
  Next: 21 admin hours.
- **21 Admin hours ⏳** — this HIGH-sensitivity module (self-credit/SoD risk)
  already had thorough prior coverage (module-audit iteration 15 + 4
  app-review passes through 2026-08-09); read `admin_hours.py` and
  `admin_hours_service.py` in full via 3 parallel background agents,
  re-confirming AH-1 through AH-6 all still intact. **AH-7 (HIGH)**
  `get_user_hours_compliance` resolved a client-supplied `user_id` with no
  `organization_id` filter — a caller with compliance access could pull
  compliance/membership data for a member of a different organization;
  independently flagged by two agents. **AH-8** `clock_out` was the one
  query in this module not yet org-scoped — literally deferred to this
  exact rotation turn by a same-day sibling commit
  (`clock_out_by_category`'s own fix). **AH-9** `update_category`'s blind
  `setattr` loop → `apply_updates`. **AH-10** `clock_in` was a read-then-
  write race with no lock (Pitfall #27) — fixed with a lock on the user's
  own row plus a locking active-session read. **AH-11** event-hour-mapping
  percentage totals could race past 100% — `FOR UPDATE` added, residual
  first-insert gap noted rather than hidden. **AH-12** `edit_pending_entry`
  now applies the same future/24h-cap/overlap guards `create_manual_entry`
  already had (closes a "parity nit" prior passes explicitly left open).
  **AH-13** 4 unguarded `datetime.fromisoformat` call sites → clean 400s.
  **AH-14** 3 `source_rsvp_id`-keyed queries (new since last audit) gained
  `organization_id` filters. Per-org SoD toggle and a resync
  approval-integrity gap (documented as deliberate in the code) remain
  flagged as product decisions. Full local completion gate green:
  flake8/black/isort clean, migrations validated, 604/604 admin_hours+event
  scoped and 8845/8845 full backend suite pass. Findings doc:
  `docs/security-review/AH-21-admin-hours.md`. PR #1903 opened and
  subscribed. Next: 22 grants & fundraising, once #1903 merges.
- **21 Admin hours ✅ merged** — PR #1903 merged 2026-08-26. Codex review
  caught one real deadlock risk in the AH-11 fix before merge: the first
  version of `update_event_hour_mapping`'s percentage-check locked only
  the _other_ mappings for a source, excluding the target row being
  updated. Two concurrent updates to two different mappings under the same
  source could each lock the row the other was about to write to, then
  each block writing their own row at flush — a lock-order inversion
  InnoDB resolves by killing one side as a deadlock (surfaced as a 500).
  Fixed by locking the complete set of mappings for the source — including
  the target — in one query ordered consistently by id, so a second
  transaction reaching the same source queues behind the first instead of
  each holding what the other needs. `create_event_hour_mapping` doesn't
  share this failure mode (a fresh INSERT never needs to acquire a write
  lock on an existing row). Replied and resolved the review thread. Full
  local completion gate re-verified green (8846/8846 full suite) before
  the final push; CI came back 16/16 green with no further comments.
  Next: 22 grants & fundraising.
- **22 Grants & fundraising** — read `docs/module-audit/grants-fundraising.md`
  (iteration 14, GF-1 through GF-9) and `docs/app-review/grants-fundraising.md`
  (4 passes through 2026-08-09, GF-10 through GF-12) first; three parallel
  agents then read `grants.py`, `grant_service.py`, `fundraising_service.py`
  in full, re-confirming GF-1 through GF-12 and surfacing six new findings.
  **GF-13 (HIGH, most severe of the whole rotation so far)**
  `GrantOpportunity.applications` carried `cascade="all, delete-orphan"`
  while `GrantApplication.opportunity_id` is `ondelete="SET NULL"` — deleting
  an opportunity with linked applications either crashed or silently deleted
  every one of those applications and their full financial history. Fixed by
  removing the cascade and adding `passive_deletes=True`; guarded by a new
  real-DB integration test (`test_grant_opportunity_delete_db.py`), invisible
  to a mocked session. **GF-14** an awarded->active->awarded round-trip
  duplicated the auto-generated compliance task set — idempotency guard
  added, scoped narrowly so it doesn't presume an answer to GF-7's broader
  state-machine question. **GF-15** three read-then-write aggregate
  recomputes (campaign total, donor stats, budget item spent) had no lock —
  Pitfall #27 fix applied to all three (lock the parent row, make the SUM
  itself a locking read). **GF-16** ten update methods across both services
  used blind `setattr` loops -> converted to `apply_updates`. **GF-17/GF-18**
  two by-id queries (`_notes_with_authors`, the budget-item fetch inside the
  GF-15 fix) gained `organization_id` filters for defense-in-depth
  consistency; neither was independently exploitable. GF-7 (broader
  state-machine/overspend question), GF-8 (`is_anonymous` enforcement), GF-9
  (float money math) re-confirmed unchanged and stay flagged as product
  decisions, per every prior pass. Full local completion gate green:
  flake8/black/isort clean, migrations validated (no migration needed —
  GF-13's fix is ORM-relationship-only), 45/45 grant+fundraising scoped and
  8849/8849 full backend suite pass. Findings doc:
  `docs/security-review/GF-22-grants-fundraising.md`. PR #1904 opened and
  subscribed. Next: 23 medical supplies, once #1904 merges.
- **22 Grants & fundraising ✅ merged** — PR #1904 merged 2026-08-26.
  Codex review caught two real issues before merge, both fixed in the same
  PR: (P1) the parent-lock fixes for GF-15 left `create_donation`/
  `create_expenditure` (and the reassignment branches of
  `update_donation`/`update_expenditure`) inserting/updating the
  FK-carrying child row _before_ locking the parent — InnoDB's own FK
  check on that insert takes a shared lock on the parent, so two
  concurrent writes to the same parent could each hold a shared lock and
  then both try to upgrade to the exclusive FOR UPDATE lock the recompute
  takes, deadlocking; fixed by acquiring the parent lock(s) first, via new
  `_lock_campaign`/`_lock_donor`/`_lock_budget_item` helpers. (P2) the
  GF-14 idempotency guard matched on `task_type`, which is fully
  client-settable on manual task creation with no status restriction — an
  officer's own pre-award task of the same type could make the guard
  believe generation had already run and silently skip the real thing;
  replaced with a dedicated `compliance_tasks_generated` boolean on
  `GrantApplication` (migration `472a1e34aa84`). Both fixes replied to and
  resolved on their review threads. CI also caught the generated
  `docs/DATABASE_SCHEMA.md` going stale after the new column — regenerated
  and pushed. Full local completion gate re-verified green (8855/8855 full
  suite) before the final push; CI came back green with no further
  comments. Next: 23 medical supplies.
