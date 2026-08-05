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
| A3 | Scheduled tasks & cron | `endpoints/scheduled.py` (60 L), `services/scheduled_tasks.py` (4570 L), `cert_alert_service.py`, `property_return_reminder_service.py` | CRON | ⬜ |
| A4 | Email templates & delivery | `endpoints/email_templates.py` (671 L), `services/email_template_service.py` (2739 L), `email_service.py` (1633 L) | MAIL | ⬜ |
| A5 | Course cohorts & syllabus | `endpoints/course_cohorts.py` (697 L), `course_syllabus.py` (273 L), `services/course_cohort_service.py` (1442 L), `course_syllabus_service.py` (353 L); `pages/CourseLibraryPage.tsx` | CC | ⬜ |
| A6 | Member lifecycle & offboarding | `services/departure_clearance_service.py` (572 L), `property_return_service.py` (529 L), `member_archive_service.py` (322 L), `member_anonymization_service.py` (283 L), `membership_tier_service.py` (267 L), `retention_service.py` (224 L) | LIFE | ⬜ |
| A7 | Dashboard & action items | `endpoints/dashboard.py` (456 L), `services/attendance_dashboard_service.py` (329 L); `pages/Dashboard.tsx`, `ActionItemsPage.tsx`, `modules/action-items` | DASH | ⬜ |
| A8 | Locations & kiosk | `endpoints/locations.py` (294 L), `services/location_service.py` (279 L); `pages/LocationKioskPage.tsx` | LOC | ⬜ |
| A9 | Platform ops & data lifecycle | `services/admin_continuity_service.py` (216 L), `audit_ship_service.py` (136 L), `data_export_service.py` (169 L), `separation_of_duties.py` (70 L) | OPS | ⬜ |

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
</content>
