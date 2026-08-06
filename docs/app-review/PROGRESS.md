# Application Review — Progress Tracker

Completion-driven rotation. Each iteration takes the **next pending feature**,
works it through [`CHECKLIST.md`](./CHECKLIST.md), records findings in
`docs/app-review/<feature>.md`, applies only safe/verified fixes, flags the
rest, and passes the completion gate before marking the feature done.

**Legend:** ⬜ pending · 🔄 in progress · ✅ done

---

## Tier A — never reviewed (front-loaded)

The [module audit](../module-audit/PROGRESS.md) covered 27 modules but these
areas were never in its rotation. They carry the most unknown risk, so they run
first. Storefront alone is ~11k lines of payment-handling code that has never
been through a review pass.

| # | Feature | Code | Prefix | Status |
|---|---------|------|--------|--------|
| A1 | Storefront & payments | `endpoints/storefront.py` (1597 L), `services/storefront_service.py` (2965 L), `storefront_notification_service.py` (987 L), `email_templates_storefront.py` (512 L), `utils/storefront_payments.py`, `public/paypal_webhook.py`; `modules/storefront` (29 files, 7965 L) | SF | ✅ |
| A2 | Auth & session lifecycle | `endpoints/auth.py` (1405 L), `services/auth_service.py` (970 L), `mfa_service.py`, `oauth_service.py`, `consent_service.py` | AUTH | ✅ |
| A3 | Scheduled tasks & cron | `endpoints/scheduled.py` (60 L), `services/scheduled_tasks.py` (4570 L), `cert_alert_service.py`, `property_return_reminder_service.py` | CRON | ✅ |
| A4 | Email templates & delivery | `endpoints/email_templates.py` (671 L), `services/email_template_service.py` (2739 L), `email_service.py` (1633 L) | MAIL | ✅ |
| A5 | Course cohorts & syllabus | `endpoints/course_cohorts.py` (697 L), `course_syllabus.py` (273 L), `services/course_cohort_service.py` (1442 L), `course_syllabus_service.py` (353 L); `pages/CourseLibraryPage.tsx` | CC | ✅ |
| A6 | Member lifecycle & offboarding | `services/departure_clearance_service.py` (572 L), `property_return_service.py` (529 L), `member_archive_service.py` (322 L), `member_anonymization_service.py` (283 L), `membership_tier_service.py` (267 L), `retention_service.py` (224 L) | LIFE | ✅ |
| A7 | Dashboard & action items | `endpoints/dashboard.py` (456 L), `services/attendance_dashboard_service.py` (329 L); `pages/Dashboard.tsx`, `ActionItemsPage.tsx`, `modules/action-items` | DASH | ✅ |
| A8 | Locations & kiosk | `endpoints/locations.py` (294 L), `services/location_service.py` (279 L); `pages/LocationKioskPage.tsx` | LOC | ✅ |
| A9 | Platform ops & data lifecycle | `services/admin_continuity_service.py` (216 L), `audit_ship_service.py` (136 L), `data_export_service.py` (169 L), `separation_of_duties.py` (70 L) | OPS | ✅ |

## Tier B — second pass over the audited 27

These already had a **security** pass (see `docs/module-audit/<module>.md`).
This pass carries the broader lens: duplication, dead code, documentation
accuracy, correctness beyond tenant isolation, and future-development
opportunities. Re-verify the security findings that were left open, but do not
re-derive the ones already fixed — read the module-audit file first and start
from its open list.

| # | Feature | Prefix | Status |
|---|---------|--------|--------|
| B1 | medical-screening | MS2 | ⬜ |
| B2 | apparatus | AP2 | ⬜ |
| B3 | inventory | INV2 | ⬜ |
| B4 | facilities | FAC2 | ⬜ |
| B5 | elections | ELEC2 | ⬜ |
| B6 | meetings & minutes | MM2 | ⬜ |
| B7 | equipment-check | EC2 | ⬜ |
| B8 | documents | DOC2 | ⬜ |
| B9 | membership pipeline | MP2 | ⬜ |
| B10 | messaging & communications | MSG2 | ⬜ |
| B11 | notifications | NOTIF2 | ⬜ |
| B12 | integrations | INT2 | ⬜ |
| B13 | forms | FORM2 | ⬜ |
| B14 | grants & fundraising | GF2 | ⬜ |
| B15 | admin-hours | AH2 | ⬜ |
| B16 | reports & analytics | RPT2 | ⬜ |
| B17 | events | EV2 | ⬜ |
| B18 | training | TR2 | ⬜ |
| B19 | scheduling | SCH2 | ⬜ |
| B20 | finance | FIN2 | ⬜ |
| B21 | orgs, roles & users | ORU2 | ⬜ |
| B22 | compliance & skills | CS2 | ⬜ |
| B23 | security, audit & IP | SEC2 | ⬜ |
| B24 | core infra | CI2 | ⬜ |
| B25 | onboarding | ONB2 | ⬜ |
| B26 | public-portal | PP2 | ⬜ |
| B27 | frontend shared | FE2 | ⬜ |

**36 features total.** After B27 the rotation wraps to A1.

**Pass 2 (fresh, opened 2026-08-06).** Tier B reset to ⬜ at the owner's
direction after the first full rotation completed. Tier A (A1–A9) stays ✅ —
those were front-loaded, never-reviewed surfaces; a fresh pass re-runs the
27-feature Tier B lens (duplication, dead code, doc accuracy, correctness,
future-dev), starting from the fixes the first pass already landed.

---

## Baseline health (2026-08-05)

Established before the first iteration, so any later failure is attributable:

| Check | Result |
|-------|--------|
| `frontend && npx tsc --noEmit` | ✅ 0 errors |
| `backend && flake8 app/ tests/` | ✅ 0 violations |
| `backend && black --check app/ tests/` | ✅ 501 files unchanged |
| `frontend && npx eslint .` | ✅ 0 errors |
| `isort --check-only` | ⚠️ isort not installed in the review sandbox |
| DB-backed `pytest` | ⚠️ cannot run — no MySQL, no Docker daemon. Non-DB tests do run. See CHECKLIST.md → *Known sandbox limitations* |
| Full backend suite | ✅ 2498 passed, 0 failed (648 DB-fixture errors) — was 2494 passed / **4 failed** before the Alembic duplicate-revision fix |
| Full frontend suite | ✅ 2207 passed (159 files) |

---

## Log

- **(init, 2026-08-05)** Tracker created. 36 features: 9 never-reviewed (Tier A)
  front-loaded ahead of a 27-feature second pass (Tier B). Coverage gap
  identified by diffing the endpoint/service file list against
  `docs/module-audit/PROGRESS.md` — `storefront`, `course_cohorts`,
  `course_syllabus`, `email_templates`, `dashboard`, `locations`, and
  `scheduled` (with `scheduled_tasks.py`, 4570 L) had never appeared in any
  rotation. Baseline health recorded above.
- **A1 storefront & payments ✅** — the largest never-reviewed feature (~11k L)
  and the only payment-handling surface. **It is in better shape than most
  modules the original security audit covered**, and several recurring defect
  classes are provably absent here: money is `Decimal` end-to-end (zero `float(`
  calls — contrast FIN-7/GF-9), the CSV export already uses `SafeCsvWriter`
  (contrast CI-1/CS-4), the order-number allocator has the unique constraint
  FIN-7 wanted, and the frontend uses the shared `createApiClient` so Pitfall #7
  doesn't apply. Verified: 47/47 endpoints permission-gated; member `/orders/mine/*`
  paths self-scoped (no IDOR); XC-3 clean; `_price_lines` re-prices every line
  server-side and validates product/variant/window org-scoped, so XC-1 is clean
  on the order path; refund guarded against exceeding paid; schema bounds reject
  negative quantities and refunds. PayPal webhook verification fails closed on
  every path, and its docstring's security claims were checked against the code
  and **hold** — including a real `UniqueConstraint(org, provider, external_id)`
  present in both model and migration, not merely asserted in a comment.
  **2 fixes applied:** SF-1 (LOW, latent: `/store/` was missing from
  `UNCACHEABLE_PREFIXES` although orders carry member email/phone/shipping
  address — not live, since the module's `createApiClient` has no cache
  interceptor, but the list exists to survive exactly that refactor), SF-2 (LOW:
  the unauthenticated PayPal webhook returned raw `str(exc)` instead of
  `safe_error_detail()`). 1 NIT open: SF-3 check-then-insert dedup, backstopped
  by the DB constraint so it degrades to a 500 + provider retry, never a double
  payment. 6 future-development items recorded, incl. no reconciliation backfill
  if PayPal's verify API is down, and payments SoD (same shape as FIN-4/AH-4).
  See storefront.md. Next: A2 auth & session lifecycle.
- **A2 auth & session lifecycle ✅** — the security surface here was already
  covered by the [July red-team review](../security/RED_TEAM_REVIEW_2026-07.md),
  so this pass re-verified a sample of its fixes rather than re-deriving them
  (M1 forced-Secure cookies, M2 refresh grace window, M3 dummy-verify on all
  three enumeration branches incl. the subtle locked-account one, H3 TOTP replay
  + lockout, H5 `get_client_ip`) — **all intact and matching their claims** —
  and applied the broader lens. Verified: 25/25 endpoints correctly gated (the
  10 public ones are public by necessity), every credential-guessing path rate
  limited, reset tokens SHA-256 hashed at rest, no dead endpoints, no TODOs.
  **2 fixes applied:** AUTH-1 (MED: six sites recorded `request.client.host` —
  the *proxy's* IP behind the production nginx — into session rows and
  login/password-reset audit events, so the session list and reset forensics
  carried one identical internal IP for every user; the tell was that
  `mfa_login` already used `get_client_ip` for the same parameter while `login`
  computed it for rate limiting and then didn't use it), AUTH-3 (LOW: the
  `log_audit_event` docstring example taught the same wrong pattern — the likely
  origin of the class). **1 flagged:** AUTH-2 (MED: `ConsentService.has_consent`
  has **zero callers** — members can refuse photo use, public-roster listing and
  SMS, the choice is stored and audit-logged, and nothing checks it; the
  `SMS_NOTIFICATIONS` case cites TCPA, which carries statutory damages per
  message. Not auto-fixed: "never asked" counts as refused, so wiring it in as
  documented would immediately stop SMS to every existing member — needs a
  backfill decision).
  **New cross-cutting pattern AXC-1** with 28 sites still open across 7 files —
  see [CROSS-CUTTING.md](./CROSS-CUTTING.md). The elections instance is **HIGH**:
  per-vote IPs feed the ballot fraud detection documented in
  `BALLOT_FORENSICS_GUIDE.md`, so behind the proxy `unique_ip_count` collapses to
  1 and every election permanently trips the suspicious-IP threshold.
  See auth-session.md. Next: A3 scheduled tasks & cron.
- **Owner-directed follow-up (2026-08-05)** — two decisions taken on the A2
  findings, both implemented:
  - **AXC-1 swept.** The remaining **33** sites (the earlier "28" was an
    undercount) across 7 files now use `get_client_ip`. Verified behavior-neutral:
    the affected test selection returns an identical 151 passed / 145
    fixture-errors before and after. The sweep found one thing the survey had
    missed — `public_portal_security.py:469` keyed the **public-portal rate
    limiter** on the peer IP, so every anonymous visitor shared one bucket and a
    single caller could lock out the whole portal (the H5 global-lockout shape,
    still live on the public surface). Remaining decision: historical rows still
    hold proxy IPs; recommend noting the cutover in `BALLOT_FORENSICS_GUIDE.md`
    rather than rewriting hash-chained audit history.
  - **AUTH-2 resolved.** The owner's rule — *messages always go to the member's
    email* — removed the backfill blocker, since consent can now suppress a text
    without suppressing the notice. SMS is gated on consent in both send paths
    (the second, an inventory low-stock alert in `scheduled_tasks.py`, was found
    by grepping every `SMSService` caller); email is unconditional and no longer
    honors the `email_notifications` preference. Three existing tests encoded the
    old contract and were **updated, not deleted**; three added, including
    `test_member_without_sms_consent_is_still_emailed` — the invariant the whole
    change rests on. `PHOTO_USE`/`PUBLIC_ROSTER_LISTING` still have no consumer
    to gate; the app has no public roster or photo publishing.
- **Pre-existing blocker found and fixed (2026-08-05)** — the full backend suite
  had **4 failing tests** that pre-dated this work: two branches merged the same
  day both claimed Alembic revision `20260805_0010`, leaving a duplicate id and
  two heads. `alembic upgrade head` — i.e. `npm run db:migrate` — **could not
  run at all**. `reconcile_index_set` renumbered to `20260805_0011` and
  sequenced after the drop (disjoint tables, so only the label moved).
  Backend suite now **2498 passed, 0 failed**; frontend **2207 passed**.
- **A3 scheduled tasks & cron ✅** — 38 task runners, 4570 L, never reviewed.
  Verified good: both endpoints correctly gated (`/run-task` behind the wildcard
  System Owner, with the reasoning documented — each task touches every org);
  `SCHEDULE`/`TASK_RUNNERS` exactly in sync 38/38; reminder dedup real and
  **avoiding Pitfall #12** (assigns a new dict rather than shallow-copy-and-
  mutate, so the "sent" flag actually persists — the alternative would have
  re-sent every reminder on every run); day-level reminders resolve the org's
  IANA timezone properly instead of approximating in UTC.
  **3 fixes applied:** CRON-1 (MED: `_for_each_org` rolls back a failed org's
  work and says why — but **8 runners re-implement that loop inline and none
  rolled back**, so after a failed flush the shared session was poisoned and
  every *later* org in the run failed too; self-concealing, because it reports
  as "many orgs broken" rather than "one org poisoned the session"), CRON-2
  (LOW/latent: all 9 org queries ignored `Organization.active`; nothing sets it
  False today so the filter is a provable no-op now and correct once an
  org-deactivation flow exists), CRON-3 (LOW: the `/run-task` docstring listed
  5 of 38 tasks — replaced with a pointer to the generated `/tasks` endpoint so
  it cannot drift again). 1 open: CRON-4 (raw `str(e)` returned to the System
  Owner — deliberately left, since sanitizing would destroy the operator's only
  debugging signal; wants a correlation id instead).
  **3 structural tests added**, each verified to actually fail when its
  invariant is broken. Both CRON-1 and CRON-2 existed *only* in the inline
  copies — the shared helper was correct — so the root cause is the
  duplication; consolidating the 8 copies is recorded as future work.
  Backend **2501 passed, 0 failed**. See scheduled-tasks.md. Next: A4 email
  templates & delivery.
- **A4 email templates & delivery ✅** — verified good: all 11 endpoints gated
  uniformly; the escaping design is right and **every member of the
  `_RAW_HTML_VARIABLES` allowlist was traced to its producer and escapes at
  construction** (this is the class that produced MSG-1/EV-2/CS-6/CI-7
  elsewhere); SMTP header injection defended by `_sanitize_header`;
  `run_scheduled_emails` holds a Redis lock, the overlap guard A3 found
  generally missing. Also **closed the duplication question A1 raised**:
  `email_templates_storefront.py` is a data module the main service imports and
  merges, not a duplicate — no action.
  **2 fixes applied:** MAIL-1 (MED, user-visible: subject lines and plain-text
  bodies were run through the HTML escaper, so `Falls Church Fire & Rescue`
  mailed as `Falls Church Fire &amp; Rescue` and `O'Brien` as `O&#x27;Brien` —
  in the subject line and throughout text/plain; the subject also reached the
  wrapper pre-escaped and was escaped a *second* time into `<title>`. Fixed with
  an `escape_html` flag applied only to the two non-markup destinations; the
  HTML path and its XSS boundary are untouched, verified against an
  `onerror=` payload, and the subject is safe unescaped because `_sanitize_header`
  strips CR/LF at the send layer), MAIL-2 (MED cross-tenant: `POST /schedule`
  stored a client `template_id` unvalidated **and** the cron processor loaded it
  with no org filter while eager-loading its attachments — an org-A admin could
  render org-B's template body and uploaded files and mail them to an address of
  their choosing. The MM-1 shape, in a module the module-audit never covered.
  Fixed in both layers via `assert_in_org` + an org-scoped processor lookup).
  2 open: MAIL-3 (extension-only attachment validation — magic-byte checking
  needs an office-format policy decision), MAIL-4 (arbitrary recipients — the
  same policy call already recorded as CS-9, cross-referenced not re-derived).
  **7 tests added**, 3 verified to fail against the pre-fix renderer. Backend
  **2508 passed, 0 failed**. See email-templates.md. Next: A5 course cohorts &
  syllabus.
- **A5 course cohorts & syllabus ✅** — the newest code in the codebase (merged
  the day of review) and **the cleanest module reviewed so far**. It reads as
  though written against the module-audit findings: XC-3 clean (verified
  mechanically — all 16 public service methods take and use `organization_id`,
  and sub-resource ops resolve through `_get_cohort_class(id, org)` rather than
  a bare id); XC-1 clean (`create_cohort` uses the shared `assert_in_org` helper
  that CROSS-CUTTING recommended and most modules still don't, and `_add_members`
  filters users by org, warning on out-of-org ids); generation bounded by
  `MAX_GENERATED_CLASSES = 200` at four points (the SCH-3 lesson); the
  cross-module `cancel_event` call carries the org (the EC-1 failure mode);
  **DST handled correctly** — the date is resolved first, then wall-clock time
  attached in the org's zone and converted to UTC, so a 19:00 class stays 19:00
  across a transition; frontend avoids Pitfall #1 and the banned date APIs; 96
  tests, all passing without a DB; documented before review.
  **1 fix applied:** CC-1 (LOW defence-in-depth: the catalog-course outer join
  had no org predicate — the MM-1 shape, and it *does* project into the response
  as `class_course_name`. Predicate moved onto the JOIN so an out-of-org row
  yields NULL rather than another department's catalog entry). **1 flagged:**
  CC-2 (MED: `location_id` is a fully-built, validated, double-booking-checked
  backend capability with **no UI that sets it** — so the room-clash warning the
  service docstring advertises can never fire. Same shape as the finance-dues-UI
  entry; a frontend build-out plus a per-cohort/per-class product call, not a
  correction). 1 NIT open (CC-3, spring-forward gap resolves via fold=0).
  See course-cohorts.md. Next: A6 member lifecycle & offboarding.
- **A6 member lifecycle & offboarding ✅** — the irreversible operations
  (anonymization, unattended retention deletion, archival) were the priority and
  are in good shape. Verified: anonymization org-scoped with an explicit
  "never resolve a target across tenants" fetch, self-anonymization blocked,
  departed-only precondition, idempotent; **its documented contract matches the
  code** (the ELEC-5/CI-5 claim-vs-code check — every claimed scrub verified
  present, and the deliberate retentions are audit logs, votes and operational
  history, all correctly justified); **applicant ID photos and background checks
  are removed from disk before the rows** — DOC-1's orphaned-file lesson applied
  exactly where it would have hurt most; PII coverage checked **mechanically**
  (58 User columns vs 31 cleared — the remainder are operational flags, no PII
  missed); retention is conservative by design (documents/minutes excluded from
  auto-deletion with sound reasoning, floors enforced twice, batched deletes,
  Pitfall #12 deepcopy cited); auto-archive checks all four outstanding-property
  categories; the two cron-trigger endpoints pass the caller's org — **the AH-2
  lesson applied**; org scoping verified mechanically across all six services.
  Also confirmed **ORU-9's deferred `member_status` state machine now exists**.
  **1 fix applied:** LIFE-1 (LOW: the clearance total — a member's chargeable
  liability for unreturned gear — was accumulated through `float` while the same
  file already summed correctly with `Decimal` 350 lines later; aligned to the
  file's own pattern). **1 flagged:** LIFE-2 (the per-unit float *division* is
  bounded to ±1 cent by rounding, but converting it would shift figures members
  may already have been charged — belongs with the FIN-7 float→Decimal refactor,
  not a drive-by). 1 NIT (LIFE-3, null timestamps never retention-eligible —
  arguably the safe default). **Doc fix:** `KNOWN_LIMITATIONS.md` still listed
  the ORU-9 state machine as deferred four days after it shipped — corrected;
  this is what the "re-verify open findings" step is for.
  See member-lifecycle.md. Next: A7 dashboard & action items.
- **A7 dashboard & action items ✅** — a dashboard is a cross-module aggregator,
  so two failure modes matter here: an aggregate that forgets its org filter
  (RPT-1) and one that re-exposes what a sibling module restricted (XC-2). The
  first is **clean** — minutes action items have no `organization_id` column, and
  both places that touch them correctly join `MeetingMinutes` for the org scope,
  with a comment saying so. The second was not.
  **1 fix applied:** DASH-1 (MED XC-2: `GET /dashboard/action-items` merges the
  Meetings and Minutes feeds and requires **no permission at all**, but the
  minutes half filtered on `organization_id` only — so any authenticated member
  could read the description, assignee and due date of action items belonging to
  **unapproved drafts and closed executive-session minutes**, which is where
  discipline, terminations and legal matters live. MM-3 closed exactly this on
  the minutes module's own four read paths; this was a side door into the same
  rows. Fixed by extracting `minutes_visibility_filter` mirroring
  `MinuteService`'s `restricted` branch, keyed on the same existing permission —
  no new permission, no frontend change. **One judgment call for the owner:** it
  carves out items *assigned to the caller* so `assigned_to_me` still shows a
  member their own tasks; drop that branch if executive items should be
  invisible even to their assignee — it is one line and one test.)
  **1 flagged:** DASH-2 (LOW: `GET /dashboard/stats` returns three hardcoded
  fields and has **zero frontend callers**. Harmless today, but
  `setup_percentage=100` asserts setup is complete rather than reporting
  unknown, and a real source already exists — whoever wires this up later gets a
  confident wrong answer. Delete-or-implement is a decision, not a correction.)
  **4 tests added**, asserting the authorization predicate against compiled SQL
  so it needs no MySQL. General lesson recorded: a restriction applied in the
  owning module must be applied at **every cross-module read of the same rows**.
  Backend **2512 passed, 0 failed**. See dashboard.md. Next: A8 locations &
  kiosk.
- **A8 locations & kiosk ✅** — the kiosk turned out not to use the locations
  module's own display endpoint at all, and both findings follow from that.
  Verified: 6/6 endpoints gated and org-scoped; **PP-3's ASCII display-code
  regex intact**; **no PP-1 recurrence** — `scalar_one_or_none()` on
  `display_code` is safe because the column is globally `unique=True` and the
  generator checks globally, so the constraint actually backs the assumption
  that broke public-portal auth in PP-1.
  **2 fixes applied:** LOC-1 (MED: the authenticated `/locations/{id}/display`
  computed the check-in window as a hardcoded `start - 1 hour`, but the
  canonical window is per-event configurable — FLEXIBLE defaults to **30**
  minutes and STRICT opens at `actual_start_time` — so it opened twice as early
  as the default and ignored STRICT entirely. The clean part: **the sibling
  public endpoint was already fixed**, its test docstring explicitly saying "not
  a hardcoded 1-hour guess" — the correction was applied to one copy of a
  duplicated capability and missed on the other. Now calls
  `EventService._get_check_in_window`.) LOC-2 (MED: `LocationKioskPage` is routed
  **publicly**, so `useTimezone()` had no user and **always** fell back to the
  tablet's own zone — a wall display left on its factory default, commonly UTC,
  showed every event time and check-in window shifted by hours, and the
  department's configured timezone was the one value never consulted, against
  the project's own date/time rule. Added an optional `timezone` to
  `LocationDisplayInfo`, populated from the org; the kiosk prefers it.)
  **1 flagged:** LOC-3 (the authenticated display endpoint has **zero callers** —
  a second implementation of the same capability that had already drifted, which
  is how LOC-1 happened. Delete-or-wire-up is an API-surface decision; it is now
  *correct* dead code rather than wrong dead code. Second instance of this shape
  in two iterations, after DASH-2.)
  **2 tests added.** LOC-2's extra query broke three existing display tests whose
  `db` stub was a bare `MagicMock`; the stub was **extended**, not loosened, and
  no assertion weakened. Backend **2514 passed, 0 failed**; frontend **2207
  passed**. See locations-kiosk.md. Next: A9 platform ops & data lifecycle
  (last of Tier A).
- **A9 platform ops & data lifecycle ✅ — Tier A complete.** These four services
  are the *implementations* of controls the module-audit deferred (FIN-4, AH-4,
  CS-8, TR-5, ORU-7), so the job was to verify they're correctly and completely
  wired and reconcile the tracking docs with the code. **Verified good:** the
  shared `assert_different_person` guard is well-built (no-ops on missing ids,
  approve-only, ValueError→400) and correctly wired into all four paths;
  admin-continuity (ORU-7) is comprehensively wired across all five documented
  paths, with the role-edit guard correctly at the **service** layer
  (`role_service.py`) so it covers every caller; data-export is self-scoped by
  construction (every section filters `model.user_id == user.id`, no arbitrary-id
  path), rate-limited, audited; audit-shipping POSTs to an **env-configured**
  URL (no SSRF), HMAC-signed, watermark advances only on 2xx.
  **No code changed** — the controls are sound. **5 doc-accuracy corrections**,
  each verified against code: OPS-1 (AH-4 is fixed unconditionally, docs said
  flagged — noted the single-officer consequence), OPS-2 (CS-8 skills-half fixed
  / attestation-half open, docs said fully open), OPS-3 (FIN-4 approval-chain
  self-approval closed / disbursement still open, docs framed only the open
  half), OPS-4 (**TR-5 looked fixed but is not** — the shared guard is on the
  manual path; the auto-approve branch the finding is actually about spawns a
  credited record with no reviewer, so it stands — clarified rather than
  ticked off), OPS-5 (storefront SoD stays flagged, but recorded two
  non-equivalent fix options). The near-miss on TR-5 is the case for verifying
  over pattern-matching. Corrected `admin-hours.md`, `compliance-skills.md`,
  `training.md`, and two `KNOWN_LIMITATIONS.md` rows. Gate clean (no code
  change); `test_separation_of_duties.py` 8/8 pass. See platform-ops.md.
  **Next: Tier B — B1 medical-screening (second, broader pass over the audited
  27).**
- **B1 medical-screening ✅ (Tier B begins).** Worked the module-audit's three
  open findings plus the broader lens; re-verified (not re-derived) the security
  pass's tenant-isolation/gating/audit/cache conclusions still hold.
  **2 fixes applied:** MS-3 (the create path stored client-supplied
  `user_id`/`prospect_id`/`requirement_id` unvalidated — worse than a generic
  XC-1 because the record holds **PHI**, so a foreign id mis-attributes a medical
  result to the wrong person; now validated via the shared `assert_in_org`, and
  the endpoint gained the missing `ValueError→400` conversion), MS-2 (was filed
  as "incomplete feature" but is a **live UI defect** — the dashboard renders
  `user_name ?? prospect_name ?? 'Unknown'`, so every expiring-screening row
  showed "Unknown"; added a batch `_resolve_names` helper, one org-scoped query
  per entity type, no N+1, org-scoping tested so a name can't cross tenants).
  **1 flagged (unchanged):** MS-1 (four PHI columns still plaintext vs CLAUDE.md's
  encryption claim — migration-shaped, verified no filter relies on plaintext
  matching so the conversion is safe when scheduled). **3 tests added**
  (`TestResolveNames`); pre-existing compliance/expiring tests refocused with an
  autouse stub. Backend **2517 passed, 0 failed**. See medical-screening.md.
  Next: B2 apparatus.
- **B2 apparatus ✅.** Worked the one open finding (AP-1) plus re-verified the
  security pass's 83/83 auth and tenant-isolation conclusions. AP-1 turned out
  partly closed already: `create_maintenance_record` validates its parent,
  `create_operator` was fixed in the zero-trust pass, `create_maintenance_type`
  has no apparatus FK — but **`create_photo` and `create_document` still stored
  the path `apparatus_id` unvalidated**, so a POST to another org's
  `/{apparatus_id}/photos|documents` filed a row against a foreign apparatus.
  **Fixed** both via the shared `assert_in_org` (mirroring `create_operator`) +
  the missing `ValueError→400` on both endpoints — **AP-1 now closed across every
  create path**, and one of the two modules that seeded the XC-1 cross-cutting
  pattern is fully resolved. Also fixed AP-2 (a `== True # noqa` → `.is_(True)`).
  Coverage rests on `test_org_scoping.py` (7/7). Backend **2517 passed, 0
  failed**. See apparatus.md. Next: B3 inventory.
- **B9 membership pipeline ✅.** A sensitive-PII module (DOB, home address,
  background checks, IDs); the security pass had already confirmed tenant
  isolation is solid and XC-3 doesn't occur here, so this pass worked the three
  open findings, weighting the two PII-shaped ones. **3 fixes applied:** MP-5
  (LOW XC-1 integrity: `complete_step`/`create_election_package`/`create_interview`
  stored a client `step_id`/`pipeline_id` unvalidated — `complete_step` would even
  write a `ProspectStepProgress` for a step not in the prospect's pipeline. Steps
  carry no `organization_id`, so each id is now validated against the prospect's
  own org-scoped pipeline steps — a foreign election-package `pipeline_id` via the
  org-scoped `get_pipeline` — rejecting with `ValueError → 400`; no cross-org
  disclosure existed, this is dangling-FK hardening), MP-6 (LOW data-min:
  `update_prospect` wrote plaintext old→new **DOB and home-address** values into
  `ProspectActivityLog.details`, which `GET /activity` returns to any
  `prospective_members.view` user — a sensitive allowlist now logs
  `{"changed": True}`, keeping who/when/what-field without the PII value; the
  non-sensitive fields keep full old→new), MP-7 (LOW disclosure/UX: `POST
  /prospects` returned the archived match's `name`/`email`/**`user_id`** +
  `reactivate_url` in the 409 body while the sibling `/check-existing`
  deliberately strips to `status`+`match_type`. The kicker: the frontend never
  read the structured fields **and** the dict `detail` mis-rendered as
  `[object Object]` — so returning a plain-string message dropped the `user_id`
  leak *and* fixed the broken toast in one change). **1 flagged:** whether the
  409 message should name the archived member at all (same disclosure
  `/check-existing` avoids — a product call), recorded in `KNOWN_LIMITATIONS.md`.
  Gate: flake8/black clean on both files; `test_membership_pipeline_flow` +
  `test_integrations_webhook_advance` 5 passed / 12 DB-fixture errors (no MySQL),
  no logic failures; all existing `complete_step` tests pass valid in-pipeline
  steps so the MP-5 guards don't affect them. See membership-pipeline.md. Next:
  B10 messaging & communications.
- **B10 messaging & communications ✅.** The security pass had already proven the
  module's crux — audience targeting can't cross org boundaries, because the
  single delivery/stats choke point `_targeted_users` loads candidates
  `WHERE organization_id == message.org`, so a foreign member id/role matches
  nobody. Re-verified against `_is_targeted` and the read/ack gate
  `_visible_message_or_none`; still holds. **1 fix applied:** MSG-2 (LOW XC-1
  defense-in-depth: `create_message`/`update_message` stored client
  `target_member_ids`/`target_roles` verbatim — not exploitable for delivery, but
  it persisted garbage/foreign ids. New `_validate_targeting` rejects any member
  id not in the org and any role entry that isn't a role id/name in the org —
  rename-safe, matching `_is_targeted`; `Role.organization_id` is NOT NULL so no
  cross-org system roles to special-case. Only request-supplied values are
  checked, so a legacy stored role name is never re-validated on an unrelated
  edit. The compose form's pickers only ever send the org's own role/member ids,
  so no legitimate-flow impact). **1 noted (by design):** MSG-3 (test-email to a
  client-supplied address — re-verified `settings.manage`-gated and sender-logged;
  a rate-limit is future-dev). **Cleanup:** removed three `== True  # noqa: E712`
  suppressions in favor of `.is_(True)` (the AP-2 fix, honoring Pitfall #10).
  **5 tests added** (`TestValidateTargeting`): in-org pass, foreign-member reject,
  role id+rename pass, foreign-role reject, empty-lists-no-query;
  `test_messaging_service.py` **36 passed** (was 31), no DB needed. flake8/black
  clean. See messaging.md. Next: B11 notifications.
- **B11 notifications ✅.** The prior audit had **no open findings** and rated the
  IDOR/user-scoping "exemplary," so this pass re-verified a sample (the `/my/*`
  recipient-scoping, the documented optional-`user_id` split in `mark_as_read`,
  and that `create_rule`/`update_rule` mass-assignment isn't reachable — the
  create/update schemas expose no `id`/`organization_id`/`created_by`) and applied
  the broader lens. **1 new fix:** NOTIF-2 (LOW info-disclosure: all six mutating
  service methods returned raw `str(e)` on failure, which the endpoints
  interpolated into the response detail — so a DB `IntegrityError`/
  `OperationalError` leaked SQL/column names to the client, and the real
  exception was swallowed with no ERROR log. Switched all six to
  `safe_error_detail(e)` — generic client message + server-side logging — the
  project standard, same class as SF-2). **Cleanup:** removed five
  `== True`/`== False  # noqa: E712` suppressions in favor of
  `.is_(True)`/`.is_(False)` (AP-2 pattern). **2 tests added**
  (`TestErrorSanitization`), 17 passed across the non-DB notification test files.
  NOTIF-1 re-verified fixed. flake8/black clean. See notifications.md. Next: B12
  integrations.
- **B12 integrations ✅.** The security pass had already hardened the external
  surfaces (send-time SSRF re-validation, OAuth state, inbound-webhook HMAC
  fail-closed, no secret exposure) — re-confirmed, not re-derived. **1 fix
  applied:** INT-4 (MED data-integrity: `_validate_config` returned
  `schema_cls(**config).model_dump()`, re-emitting every field at its default,
  which connect/update then merged over the stored config — so a partial PATCH
  silently reset omitted fields to defaults. A Salesforce `match_strategy`
  reverting from `email_lastname` to `email` — which *adopts* pre-existing
  Contacts — is a real regression; and empty secret-named defaults leaked into
  public config. Fixed with `model_dump(exclude_unset=True)`: only supplied keys
  emitted, omitted keys keep their stored value via the merge; verified safe
  because every service reads config via `.get(key, default)` with matching
  defaults and construction still enforces required fields). **2 flagged
  (unchanged):** INT-3 (list/get reads on bare `get_current_user` — needs a
  dedicated `integrations.view` permission because the list is consumed
  cross-module under other permissions; recorded in KNOWN_LIMITATIONS), INT-5
  (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist + unused `request` params —
  cosmetic/behavior-change, batched for later). **1 regression test added**
  (`test_omitted_fields_not_reemitted`); `test_integrations_security` 50 passed,
  `test_integration_services`+`test_salesforce_sync` 88 passed. flake8/black
  clean. See integrations.md. Next: B13 forms.
- **B13 forms ✅.** The HIGH cross-org integration writes (FORM-1/2) were already
  closed; the public-submission surface (slug regex, rate limits, honeypot,
  stored-XSS escaping) re-confirmed. **2 fixes applied:** FORM-7 (LOW-MED, newly
  found: 14 service methods returned raw `str(e)` which the endpoints surface as
  `HTTPException(detail=error)` — on the **public unauthenticated** submit path
  this leaked SQL/column names to anonymous callers, a worse NOTIF-2/SF-2.
  Swept all 14 client-facing tuple returns to `safe_error_detail(e)`; the 5
  remaining `str(e)` are internal processor dicts `_process_integrations` never
  returns to the client), FORM-6 (required-field check was presence-only — a key
  holding `""`/whitespace/`[]` satisfied "required"; new `_is_empty_value` helper
  rejects those while keeping `0`/`False` valid for number/boolean fields, applied
  to both submit paths). **2 flagged:** FORM-5 (require_authentication /
  allow_multiple_submissions not enforced — product decision, KNOWN_LIMITATIONS),
  FORM-4 (definition text unescaped — explicitly NOT fixed by escape-at-storage,
  which would double-escape the text-rendered labels; wants CSP/render-time). **9
  unit tests added** (`TestIsEmptyValue`, DB-free). flake8/black clean. See
  forms.md. Next: B14 grants & fundraising.
- **B14 grants & fundraising ✅.** The CRITICAL/HIGH cross-tenant financial
  corruption (GF-1/2/4 — unvalidated FKs feeding recompute-writes and read-leaks)
  was already closed; re-confirmed. **1 fix applied:** GF-6 (MED XC-1: five write
  paths stored client FKs unvalidated — `create/update_pledge` (campaign_id,
  donor_id), `create/update_fundraising_event` (campaign_id, `event_id` →
  calendar Event), `create/update_application` (linked_campaign_id, assigned_to,
  approved_by). Stored-only/dangling, no recompute-write or read-leak, but the
  standard XC-1 shape. Pledge/event FKs validated via the module's local
  `_entity_in_org`; application FKs via the **shared** `assert_in_org`
  (`allow_none=True`) — the CROSS-CUTTING-recommended path. All raise ValueError →
  400, no cross-tenant existence oracle). **3 flagged (unchanged, product
  decisions):** GF-7 (no grant state machine / overspend guard — `amount_remaining`
  can go negative, awarded→active→awarded regenerates duplicate compliance tasks),
  GF-8 (`is_anonymous` never enforced in responses), GF-9 (float money math /
  unbounded amounts / donor-PII gate breadth) — GF-7/8 mirrored to
  KNOWN_LIMITATIONS. **8 unit tests added** across both services; 40 passed.
  flake8/black clean. See grants-fundraising.md. Next: B15 admin-hours.
- **B15 admin-hours ✅.** A clean module — AH-1 (self-credit), AH-2 (cross-tenant
  stale-session mutation), AH-3, AH-4 (SoD via the shared `assert_different_person`)
  already fixed and re-confirmed, along with the time-integrity guarantees
  (server-computed duration, no member edit/delete, no impersonation). **1 fix
  applied:** AH-5 (LOW DiD: three internal queries filtered a narrower key than
  `organization_id` — `_get_active_session`/`get_active_session` (+ its category
  read), `_check_overlap`, and `delete_category`'s active-session count. None
  exploitable (each constrained by an org-verified parent or one-org-per-user),
  but not uniform with the org-scope-everything standard. Threaded
  `organization_id` through all three; endpoint passes
  `current_user.organization_id`). **2 compiled-SQL regression tests added**
  (`TestOrgScopedQueries`); 19 passed. flake8/black clean. See admin-hours.md.
  Next: B16 reports & analytics.
- **B16 reports & analytics ✅.** The #1 reporting risk — cross-org aggregate
  leakage — was already closed (RPT-1) and re-confirmed, along with "platform
  analytics is actually per-org" and the no-injection posture. **3 fixes
  applied:** RPT-4 (LOW: `_generate_annual_training` compared `organization_id`
  as a raw UUID vs `str()` everywhere else — dialect-fragile; normalized both),
  RPT-5a (LOW correctness: `completion_rate = completed/len(records)` but the
  numerator only counts tracked (active, non-exempt) members' records while the
  denominator included departed/exempt members' records — skewed low; now divides
  by `counted_records`), RPT-5b (LOW correctness: `department_overview.total_checkins`
  counted all-time while every sibling metric is period-bounded; now joins Event
  and filters the period). **2 flagged:** RPT-3 (member/applicant PII at
  `reports.view` — permission-granularity policy, KNOWN_LIMITATIONS), RPT-5c
  (inventory `float()` → FIN-7; apparatus `last_inspection_date` hardcoded None —
  incomplete feature). **Cleanup:** swept all 14 `== True/False # noqa: E712`
  suppressions (incl. one in a `case()`) to `.is_(...)`. **1 regression test
  added** (`TestTrainingSummaryCompletionRate`); 11 passed. flake8/black clean.
  See reports-analytics.md. Next: B17 events.
- **B17 events ✅.** The heavy surfaces (public event-request intake, attachment
  upload/download, RSVP integrity, tenant isolation) were solid; re-confirmed
  EV-1–4. **2 fixes applied:** EV-6 (LOW: `create_or_update_rsvp` blocked
  cancelled + deadline but not draft or ended events — a member who knew a draft's
  id could RSVP pre-publication, and an ended event with no deadline still
  accepted RSVPs. Now rejects `is_draft` and past `end_datetime`; `end_datetime`
  is non-null so it's the unambiguous "over" gate, leaving ongoing events to
  check-in), EV-7 (LOW crash: `send_template_email` did `str.replace`/`html.escape`
  on raw context values — a `None` base value like a missing `contact_name` raised
  TypeError → 500 on an `events.manage` action; now str-coerces each value). **1
  flagged:** EV-5 (public intake has no per-org opt-in + weaker anti-spam than
  forms — feature+config, KNOWN_LIMITATIONS). **Cleanup:** swept all 8 E712
  suppressions in `event_service.py`. **2 regression tests added** (draft + ended
  rejection); `_event` mock factory extended (not weakened) with
  `is_draft`/`end_datetime`; 15 passed. flake8/black clean. Also noted (not fixed):
  `send_template_email` escapes the logo img so `{{organization_logo_img}}`
  wouldn't render — a template-rendering behavior change left for future. See
  events.md. Next: B18 training.
- **B18 training ✅.** The largest module (154 endpoints, ~13 services); TR-1–3
  (PHI/record/user-mapping leaks) already fixed and re-confirmed. Focused on the
  TR-6 external-training FKs and found the audit had **under-rated** one: **1 live
  cross-org leak fixed** — `update_category_mapping` stored a client
  `internal_category_id` unchecked and the list/update enrichment lookups read
  `TrainingCategory.name` by that id with **no org filter**, so a `training.manage`
  user could map to a foreign org's category and read its name back (the TR-3
  shape, for categories — a real read leak, not just a dangling FK). Fixed:
  validate in-org on write + org-scope both enrichment reads. Also validated
  `provider.default_category_id` in-org on create/update (attributes imports at
  sync time). **Spot-check resolved:** `training_enhancement_service` by-id methods
  all filter `organization_id` — confirmed. **2 flagged (product/config):** TR-5
  (auto-approve submission branch spawns a COMPLETED self-credit record with no
  reviewer — the manual path's SoD guard doesn't apply; KNOWN_LIMITATIONS), TR-4
  (`year` default semantics). TR-6 residual (backstopped source_provider_id /
  bulk_enroll / sync re-fetch; `_decrypt_field` fail-closed after CI-5) stays
  flagged. **Cleanup:** swept 5 E712 in `external_training.py`. **2 endpoint-level
  regression tests added**; `test_training` 84 + new 2 passed. flake8/black clean.
  See training.md. Next: B19 scheduling.
- **B19 scheduling ✅.** SCH-1–4 (self-escalation, self-signup guards, generation
  DoS, `shift_officer_id`/hours-report) already fixed and re-confirmed. **1 fix
  applied:** SCH-6 — the real gap was `finalize_shift` creating a `ShiftAttendance`
  row from a client-supplied `manual_hours[].user_id` with no in-org check (a
  foreign user credited hours on this org's shift); now validated via
  `_user_in_org`. Also validated `apparatus_id` in-org on create/update shift
  (DiD — was backstopped). **Two phantom findings ruled out by verification:** the
  manual `hours` value is *already* bounded at the schema (`Field(gt=0, le=48)`),
  and the service's ~15 `str(e)` returns are *not* a live leak because every
  endpoint wraps them in `_safe_detail → safe_error_detail` (contrast
  NOTIF-2/FORM-7 where the raw string reached the client). `station_id` is an
  unwired placeholder; `template_id` isn't a Shift field. **1 flagged:** SCH-5
  (swap accept-path re-validation + approver-identity — a workflow design change,
  KNOWN_LIMITATIONS). **2 regression tests added** (foreign apparatus, foreign
  manual-hours user); DB suite unchanged (no-MySQL). flake8/black clean. See
  scheduling.md. Next: B20 finance.
- **B20 finance ✅ (clean-module verification).** One of the best-hardened modules
  — the money-corruption/PII paths (FIN-1 CRITICAL budget corruption, FIN-2, FIN-3
  dues, FIN-6 dues idempotency) are closed; re-confirmed `_validate_finance_fks`
  wired into all 7 create/update paths, the org-scoped budget write-helpers, the
  `dues_payments` ledger, and `approve_step`'s `assert_different_person` guard. **No
  new code-level security finding.** The one noted DiD gap — `get_approval_records`/
  `get_current_pending_step` querying `ApprovalStepRecord` without an org filter —
  re-verified **not live** (all 7 call sites pass an already-org-resolved
  entity_id) and **deliberately not threaded**: adding `org_id` through 4 methods +
  7 call sites on the critical money-approval path is regression risk for zero live
  benefit. **Flagged (unchanged, product/behavior):** FIN-4 (`finance.disburse`
  SoD), FIN-5 (view scoping), FIN-7 residual (float→Decimal, bounded export,
  overspend guard) — all already in KNOWN_LIMITATIONS. **Cleanup:** swept 2 E712 in
  `finance_service.py`. Tests: 19 pure unit tests pass (30 DB-fixture errors, no
  MySQL). flake8/black clean. See finance.md. Next: B21 orgs, roles & users.
- **B21 orgs, roles & users ✅.** The privilege-management surface; ORU-1–6, ORU-8,
  ORU-9 already fixed and re-confirmed. **1 fix applied:** ORU-7a (MED privilege
  sabotage: `_enforce_permission_grant_ceiling` on `update_role` only validated
  the *new* permission list and early-returns on `[]`, so a privileged-but-not-`*`
  caller — e.g. a Fire Chief — could set the `*` System Owner role's permissions to
  `[]` or downgrade it to their subset, gutting the tenant's wildcard admin. New
  `_enforce_role_edit_ceiling` requires the caller's ceiling to cover the role's
  **current** permissions when changing them — you can't edit a role more
  privileged than you could create; the attempt is reported to security
  monitoring). **1 doc-drift correction:** ORU-7b (last-admin lockout) is **already
  fixed** — `assert_role_change_retains_administrator` recounts the org and blocks
  removing the last `members.manage` holder, wired into update/delete role. **1
  flagged:** ORU-7c (org-wide `member` role mass-escalation — intended-but-sharp,
  KNOWN_LIMITATIONS). **3 unit tests added** (`TestRoleEditCeiling`); role tests
  28 passed. flake8/black clean. See orgs-roles-users.md. Next: B22 compliance &
  skills.
- **B22 compliance & skills ✅.** The PHI-adjacent surface; CS-1–7 and the CS-8
  skills self-cert (`assert_different_person`) already fixed and re-confirmed. **1
  fix applied:** CS-9 officer #6 (LOW latent: `get_iso_readiness` compared
  `record.user_id` against a set of `str(id)` and keyed `member_hours` by those
  strings — works today because `TrainingRecord.user_id` is `String(36)`, but a
  UUID-typed value would silently drop that member's hours from the whole
  ISO/FSRS readiness computation. Normalized `str(record.user_id)` at both sites —
  the ORU-6/RPT-4 pattern; behavior-neutral today, robust to type drift). **Verified
  (phantom concern ruled out):** CS-8 attestation `compliance_percentage` is
  **already** schema-bounded (`Field(ge=0, le=100)`), so only the server-side
  recompute / dual-control half remains (behavior change, deferred). **Flagged
  (unchanged):** CS-8 attestation SoD, CS-9 monthly windowing (feature) + recipient
  allow-list (policy) — all already in KNOWN_LIMITATIONS/module-audit. **Cleanup:**
  swept 4 E712 in `compliance_officer_service.py`. **1 regression test added**
  (`test_iso_readiness_user_scoping`); 96 passed. flake8/black clean. See
  compliance-skills.md. Next: B23 security, audit & IP.
- **B23 security, audit & IP ✅.** An exhaustively-hardened surface (red-team +
  iteration-23 closed SEC-1–9). **1 fix applied:** SEC-2 residual (MED: audit-chain
  **tail-truncation** was undetectable — the genesis anchor catches deleting the
  oldest rows, but deleting the newest rows leaves a chain still consistent and
  anchored to genesis, so `verify_integrity` returned `verified: True` for a
  truncated tail. Now, on a full-chain verify, it cross-checks the chain's last id
  against the newest non-archival `AuditLogCheckpoint` — a checkpoint attests
  entries existed up to its `last_log_id`, so a chain ending before that is
  reported `"Chain tail truncated"`. Archival checkpoints excluded (they purge the
  old head, not the tail) → no false positive on retention or on an append-only
  chain. To truncate undetectably an attacker must now also rewrite the checkpoint,
  which can be attested out of band). **2 regression tests added**
  (`test_audit_hash_chain` 10 passed). All SEC-1–9 re-confirmed. flake8/black clean.
  See security-audit-ip.md. Next: B24 core infra.
- **B24 core infra ✅.** The crypto/auth/config foundation is strong (CI-1–8 fixed,
  re-confirmed). **1 fix applied:** CI-10 cache `clear_pattern` — an unused
  wildcard-delete footgun (no callers in source or tests) that let a future caller
  wipe swaths of Redis keys; removed (with a pointer to a namespaced replacement).
  **2 doc-drift corrections (both already fixed since the audit):** CI-5 — field
  encryption is now **AES-256-GCM** (`$gcm2$`, AEAD) with `reencrypt_to_aesgcm.py`
  backfilling legacy Fernet, so the "switching needs re-encryption — flagged" note
  no longer stands; CI-10 crypto#3 — the KDF is now **600k PBKDF2** iterations
  (`$gcm2$`), the 100k `$gcm1$` path read-only. Corrected core-infra.md +
  KNOWN_LIMITATIONS. **Flagged (unchanged, ops/behavior/migration):** CI-9 (TLS
  CRITICAL, `optimize_image` fail-open, Redis `CERT_NONE`), CI-10 residual (cache
  namespacing, MFA recovery-code entropy, CI-4 full fail-closed decrypt). cache
  tests 8 passed. flake8/black clean. See core-infra.md. Next: B25 onboarding.
- **B25 onboarding ✅.** The two catastrophic scenarios (post-completion reset,
  second owner) are blocked; ONB-1–6 re-confirmed. **1 fix applied:** ONB-8
  `/status` disclosure (LOW: the unauthenticated `GET /onboarding/status` returned
  the org name + setup progress even post-completion, leaking the department name
  off a provisioned instance to any anonymous caller. The only consumer,
  `LoginPage`, reads just `needs_onboarding` — so once `is_completed`, `/status`
  now returns the minimal response with `organization_name=None` and empty
  progress; the in-progress branch the wizard resumes from is unchanged). **Flagged
  (unchanged, product/robustness):** ONB-7 (role editor accepts client
  permissions/priority/system-flag — product decision, KNOWN_LIMITATIONS), ONB-8
  residual (reset re-auth, `reset_initiated` audit durability, template
  mass-assignment guard). **2 tests added** (`test_onboarding_status_disclosure`);
  8 onboarding non-DB tests pass. flake8/black clean. See onboarding.md. Next: B26
  public-portal.
- **B26 public-portal ✅ (clean-module verification).** The unauthenticated surface
  is well-hardened — PP-1–5 fixed, PP-7 mostly; re-confirmed auth/tenant-isolation/
  data-minimization/rate-limit-fail-closed. **No new code-level finding.** Added
  nuance to PP-6's deferred app-status-token-hashing: the token is *re-read* to
  rebuild the status-check URL (emails + the status response), so it can't be
  hash-only — hashing at rest needs a two-column design (`status_token_hash` for
  lookup + the token encrypted for re-display) + backfill. Confirms the
  schema-change deferral; the naive "hash it" would break every status link.
  **Flagged (unchanged):** PP-6 (Redis limiter + token-at-rest — infra/schema,
  now in KNOWN_LIMITATIONS), PP-7 residual (nested-address whitelist, display-code
  lockout — accepted design limits). **Cleanup:** swept 4 E712 in `portal.py`.
  `test_public_portal_security` + `test_public_display` 21 passed. flake8/black
  clean. See public-portal.md. Next: B27 frontend shared (final Tier B item).
- **B27 frontend shared ✅ — Tier B complete.** The shared frontend layer had **no
  prior audit** (deferred here), so this was a security-first survey plus the
  correctness lens. **Verified good:** no stored-XSS in the shared render helpers
  (`simpleMarkdown` uses `React.createElement` + scheme-allowlisted links;
  `LinkifiedText` emits text nodes + `https?://`-only hrefs — the two
  `dangerouslySetInnerHTML` grep hits are comments saying they *don't* use it); the
  HIPAA `UNCACHEABLE_PREFIXES` list (57 entries) is thorough and rationale-commented;
  auth plumbing matches the documented model (`withCredentials` + CSRF double-submit
  + shared-`refreshPromise` refresh; only `has_session` in localStorage). **1 fix
  applied:** FE-1 (LOW/MED: `toAppError` — used by every store/async handler —
  rendered a structured **object** `detail` as `[object Object]` in toasts because it
  only handled string + 422-array details; added an object-detail branch extracting
  `detail.message`. Generalizes the one-off MP-7 repair to the whole class). **2
  frontend regression tests added**; `errorHandling.test.ts` 34 passed; tsc + eslint
  clean. See frontend-shared.md.

---

## 🏁 Pass 1 complete (2026-08-06)

All 36 features reviewed in pass 1: **Tier A (A1–A9)** + **Tier B (B1–B27)**.
Every iteration applied only verified/safe fixes, flagged product/behavior/schema
decisions in `KNOWN_LIMITATIONS.md`, added regression tests, and passed the
completion gate (flake8/black/tsc/eslint; DB-backed tests are the known no-MySQL
sandbox limit).

## 🔄 Pass 2 opened (2026-08-06)

At the owner's direction ("continue with the next review items"), Tier B was reset
to ⬜ for a second full pass. The next iteration takes **B1 medical-screening**.
Pass 2 starts from pass-1's landed fixes: re-verify they still hold, and widen the
lens for anything the first pass flagged-not-fixed or didn't reach. Tier A remains
✅ (never-reviewed surfaces already covered once; not re-run unless directed).
</content>
