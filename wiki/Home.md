# Welcome to The Logbook Wiki

![The Logbook](https://img.shields.io/badge/Version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Python](https://img.shields.io/badge/Python-3.13-blue.svg)
![React](https://img.shields.io/badge/React-19-blue.svg)

An open-source, highly flexible, secure, and modular intranet platform designed for fire departments, emergency services, healthcare organizations, and other institutions requiring secure internal communication and management systems. Built with HIPAA requirements in mind.

---

## 🚀 Quick Start

### Unraid (Recommended - One Command!)

```bash
curl -sSL https://raw.githubusercontent.com/thegspiro/the-logbook/main/unraid/unraid-setup.sh | bash
```

Then access: `http://YOUR-UNRAID-IP:7880`

**[→ Full Unraid Quick Start Guide](Unraid-Quick-Start)**

### Docker Compose

```bash
git clone https://github.com/thegspiro/the-logbook.git
cd the-logbook
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

**[→ Complete Installation Guide](Installation)**

---

## 📚 Documentation Sections

### 🎯 Getting Started

- **[Installation Guide](Installation)** - Complete setup instructions
- **[Unraid Quick Start](Unraid-Quick-Start)** - One-command Unraid deployment
- **[Onboarding Guide](Onboarding)** - First-time setup wizard
- **[Quick Reference](Quick-Reference)** - Common commands and tasks

### 🚢 Deployment

- **[Unraid Deployment](Deployment-Unraid)** - Complete Unraid guide
- **[Docker Deployment](Deployment-Docker)** - Docker Compose deployment
- **[Production Deployment](Deployment-Production)** - Production best practices

### 🔧 Configuration

- **[Environment Variables](Configuration-Environment)** - All .env settings explained
- **[Module Configuration](Configuration-Modules)** - Enable/disable modules
- **[Security Configuration](Configuration-Security)** - Security settings

### 💻 Development

- **[Backend Development](Development-Backend)** - Python/FastAPI development
- **[Frontend Development](Development-Frontend)** - React/TypeScript development
- **[Contributing Guide](Contributing)** - How to contribute

### 📦 Modules

- **[Training Programs](Module-Training)** - Training & certification tracking
- **[Elections & Voting](Module-Elections)** - Election management system
- **[Event Management](Module-Events)** - QR code check-in system
- **[Communications](Module-Communications)** - Department messages with acknowledgment tracking, email/SMS escalation, and scheduled send
- **[Scheduling](Module-Scheduling)** - Shift scheduling, signup, swaps, templates, pattern presets & reports
- **[Admin Hours](Module-Admin-Hours)** - Administrative hours tracking with QR code clock-in/clock-out, bulk approve, CSV export
- **[Member ID Card](../docs/TROUBLESHOOTING.md#member-id-card-issues)** - Digital member identification with QR code, barcode, and print support
- **[Apparatus](Module-Apparatus)** - Vehicle management (full module or lightweight basic)
- **[Inventory](Module-Inventory)** - Equipment tracking, assignments, pool items, thermal labels
- **[Compliance](Module-Compliance)** - Compliance tracking
- **[Salesforce Integration](Integration-Salesforce)** - Bidirectional CRM sync _(2026-04-11)_

### 🔐 Security

- **[Security Overview](Security-Overview)** - Security policy and compliance
- **[Authentication](Security-Authentication)** - Local, OAuth/OIDC, MFA
- **[Encryption](Security-Encryption)** - AES-256-GCM encryption
- **[Audit Logging](Security-Audit-Logging)** - Tamper-proof audit trails
- **[Privacy & Data Rights](Security-Privacy)** - Data export, anonymization, consent, retention
- **[Compliance Hub](../docs/COMPLIANCE.md)** - Framework alignment and control inventory
- **[HIPAA Security Features](Security-HIPAA)** - Security features aligned with HIPAA requirements

### 🛠️ Troubleshooting

- **[Common Issues](Troubleshooting)** - Solutions to common problems
- **[Container Diagnostics](Troubleshooting#container--docker-diagnostics)** - Docker container issues
- **[Frontend Diagnostics](Troubleshooting#frontend--browser-diagnostics)** - Frontend not loading
- **[Backend Diagnostics](Troubleshooting#backend-service-diagnostics)** - API errors
- **[Database Diagnostics](Troubleshooting#database-diagnostics)** - Database connection problems

### 📖 Reference

- **[API Documentation](API-Reference)** - Complete API reference
- **[Database Schema](Database-Schema)** - Database structure
- **[Role System](Role-System)** - RBAC documentation
- **[Technology Stack](Technology-Stack)** - Tech stack details

---

## 🌟 Key Features

- ✅ **Modular Architecture** - Enable only what you need
- ✅ **HIPAA-Oriented Security** - Built with healthcare privacy and security standards in mind
- ✅ **Tamper-Proof Logging** - Blockchain-inspired audit trails
- ✅ **Multi-Tenancy** - Host multiple organizations
- ✅ **Role-Based Access Control** - Granular permissions
- ✅ **Progressive Web App** - Installable on iOS and Android, with a phone bottom tab bar and **Web Push to the lock screen** _(2026-08-07, opt-in via `PUSH_ENABLED`)_
- ✅ **Integration Ready** - Microsoft 365, Google Workspace, Salesforce
- ✅ **Zero Configuration** - One-command installation for Unraid

---

## 🛠️ Technology Stack

| Component          | Technology                                     |
| ------------------ | ---------------------------------------------- |
| **Backend**        | Python 3.13, FastAPI, SQLAlchemy               |
| **Frontend**       | React 19, TypeScript 5.9, Vite 7.3             |
| **Database**       | MySQL 8.0+ (MariaDB 10.11+ for ARM)            |
| **Cache**          | Redis 7+                                       |
| **Authentication** | OAuth 2.0 / OIDC (Google, Microsoft), TOTP MFA |
| **Encryption**     | AES-256-GCM, Argon2id                          |
| **Container**      | Docker, Docker Compose                         |

---

## 📊 Latest Updates

### August 2026 — Skills Testing: Anyone Can Examine, an Officer Signs It Off

- **Any member can now run an official skills test.** Every skills-testing
  screen used to require officer permission, which does not describe how
  departments actually work — the person holding the clipboard is very often a
  senior member rather than an officer.
- **The officer's authority moved to a second step: validation.** Until a
  training officer validates it, a member-run result is a **submission, not a
  record** — it credits no training requirement, spends none of the candidate's
  attempts, stays out of the department's pass rate and average score, and the
  candidate sees it as _awaiting validation_ with the outcome withheld. An
  officer's own completion validates in the same step, so nothing changes about
  the existing officer workflow. Rejection is the existing **void** path, which
  keeps the evaluation and the reason it was refused.
- **Separation of duties holds at both ends.** A member cannot examine
  themselves, and an officer cannot validate a test they are the candidate in.
- **Templates can now carry their own disclosure rule**, and a single test can
  name one person — a preceptor, an FTO — who may read its result.

### August 2026 — Skills Testing: Results the Member Can See, Scorecards That Can't Drift

- **A member can finally see their own skills-test results.** They used to live
  on the examiner's device — every skills-testing screen required officer
  permission, so a candidate read their result over somebody's shoulder. There is
  now a **Skills Tests** section on My Training.
- **Your department decides how much of a result the candidate sees, and when.**
  Full scorecard, scores without the written notes, or nothing — and either as
  soon as the test is submitted, or only once an officer releases it, so a chief
  can review it or deliver a failure in person first. Defaults match the old
  behaviour, so nobody loses sight of a result they can read today.
- **Editing a published skill sheet can no longer change an old scorecard.**
  Because criteria were identified by their position on the sheet, inserting one
  used to shift recorded marks onto their neighbours and raising the passing
  percentage could turn a recorded pass into a fail. Every test now freezes the
  sheet it was scored against.
- **The examiner's stopwatch is what gets recorded.** Elapsed time used to be
  overwritten with "finished minus started" — and the start is stamped once, so a
  test begun at 09:00 and submitted after lunch recorded seven hours. Time limits
  are pass/fail criteria on most sheets.
- **Scoring saves itself**, on a screen used one-handed outdoors, and two people
  editing one test no longer silently overwrite each other.
- **Void, cancel and delete are three different things.** A scored official
  result is withdrawn with a reason (releasing any requirement the pass had
  completed), not erased; an abandoned unscored evaluation is cancelled; a
  practice attempt is deleted.

### August 2026 — Push Notifications, and an App That Feels Installed

- **Notifications now reach your lock screen** when the app is closed — event
  reminders, training expiry, schedule changes, maintenance due, election
  notices. Every existing alert is covered. On iPhone the app must be installed to
  the home screen first; departments turn push on per deployment.
- **A bottom tab bar on phones.** Four destinations plus More, within thumb
  reach, instead of two taps from the top-left corner across 59 menu entries.
- **The app launches at your dashboard**, not at an onboarding splash it then
  redirected away from — and it no longer flashes blank white on iPhone.
- **Installing is 1.8 MB instead of 6.1 MB.** It used to download every screen up
  front, including finance, grants and elections that most members never open,
  over whatever rural cellular connection the install happened on.
- **A long list of phone-specific fixes:** Save buttons hidden behind the iOS
  keyboard, a scanner that never released the camera when you switched apps,
  pull-to-refresh hijacking scrolls inside dialogs, iOS autocorrect rewriting
  usernames and serial numbers, headers under the notch, and icon buttons too
  small to hit.

### August 2026 — Importing a Roster Tells You What's Wrong First

- **Every row is checked before a single member is created.** Validation used to
  run inside the import and stop at the first problem in a row, so row 21's error
  surfaced only after rows 1–20 had already been created. Each rejected row now
  reports _all_ of its problems at once, naming the column and the value.
- **Rejected rows download as a CSV** — your original rows, unchanged, with the
  reasons in a leading column. Fix and re-upload; it holds only the failures, so
  it cannot collide with what already imported.
- **Welcome emails are off by default for imports.** Loading a roster used to put
  an unrecallable password-setup link in front of every address on it.
- **Progress, and a Stop button.** Rows not reached are listed as stopped, so the
  error report is exactly the work left.
- **Collisions with your existing roster are caught up front**, naming who owns
  the email, username or membership number.

### August 2026 — Applicant Files Stay Confidential After Election

- **A member can no longer read their own prospective-membership record.** It
  carries interview notes, references and election-package commentary written in
  confidence — and it stayed readable once the applicant was elected and given
  coordinator permissions in their own right.
- The record is hidden from the list, the board, the statistics and the labels,
  and opening it directly reads as "not found" rather than "forbidden", which
  would confirm there is something in it about them.
- **Prospect search now matches a full name.** "John Smith" used to return
  nothing.

### August 2026 — The Platform Reports Its Own Failures

- **Error Monitoring now receives client and server failures automatically.**
  Before this it received almost nothing — a server error became a toast on one
  member's screen, so investigating "the site is broken for Dave" meant asking
  Dave.
- Reports are queued and retried, flushed when a tab closes, and held and
  delivered on next login when raised before sign-in. Repeats are counted rather
  than collapsed into silence, and anything the rate cap discards is itself
  reported.
- **Personal identifiers are scrubbed from error text in the browser** before it
  is sent, and rows are retained 180 days.

### August 2026 — Schedule a Whole Multi-Class Course at Once

- **A course can now describe its own classes.** A recruit school is one course
  made of fifteen subjects, so you write that outline once: each class in order,
  with how many days after the start it happens and what time it runs. "Class B
  is the day after A, class C two days later" is exactly how you enter it.
- **Starting a new intake generates the whole schedule.** Pick the course and a
  start date, and every class becomes a real training event on the department
  calendar — students see the dates, sign in and out with the QR code, and the
  hours count toward their program automatically.
- **You see the dates before anything is created.** The preview lists every
  computed date, flags anything that landed on a weekend or a holiday, warns if
  a room is already booked, and lets you move or skip any single class first.
- **Plans change, and the schedule keeps up.** Reschedule one class, cancel one
  (everyone signed up sees the cancellation), add a make-up session, or push
  everything still to come back a week — without touching fifteen events by hand.

### August 2026 — Date of Birth & Emergency Contacts Are Leadership-Only

- **Only leadership can see a member's date of birth and emergency contacts** —
  chiefs, captains, the president and vice-president, secretaries, the
  membership coordinator and the IT manager (anyone holding `members.manage`),
  plus the member themselves. Everyone else sees nothing, and the member
  profile hides the emergency-contacts section entirely rather than showing an
  empty one
- **No setting can publish them.** The contact-visibility toggles cover email,
  phone and mobile; there is deliberately no toggle for these two. Emergency
  contacts name people outside the department — a spouse, a parent, a neighbor —
  who never joined and hold no account to remove themselves
- **Viewing them is recorded.** Opening another member's profile as leadership
  writes `restricted_pii_disclosed` on the audit event, so "who looked at my
  family's phone number?" is a question with an answer
- **A member's own contact details are no longer readable around the roster
  setting** — the individual profile endpoint redacts on the same terms as the
  roster (it previously returned the full record, including home address and
  personal email, to anyone who could view members)
- **Organization settings no longer expose the IT team block** — names, direct
  emails, phones and break-glass notes are now limited to `settings.manage`

### August 2026 — Dues Payments Are a Ledger

- **Every payment is kept, not just the latest** — a member's dues record now
  has a full payment history (amount, method, reference, notes, when, and which
  officer entered it). Entering a second installment no longer erases the first
  one's method or notes
- **Recording the same payment twice no longer charges twice.** If the payment
  carries a transaction reference (check or receipt number) and that reference
  is already on the record, the resubmission is ignored — a double-clicked Save
  is safe. Cash with no reference is never treated as a duplicate, because two
  identical cash amounts are two payments
- **Payments against waived dues are refused** instead of silently cancelling
  the waiver and moving the waived amount into your collection figures
- **Waivers can now be reversed** — waived by mistake, or waived and then paid
  anyway? Reverse the waiver (a reason is required, and it's audit-logged), and
  the record returns to whatever the payment history says

### August 2026 — Member CSV Import Fixes

- **The member import template is importable again** — the generated template
  shipped a `membershipNumber` column while the uploader required
  `departmentId`, so the downloaded template was rejected on upload with
  "Missing required columns: departmentid". Both now come from one list;
  `departmentId` still works for rosters built from an older download
- **Only `firstName`, `lastName` and `email` are required** — the uploader
  previously demanded 13 columns the API treats as optional, so a roster
  without addresses or emergency contacts could not be imported at all. A
  blank `membershipNumber` is auto-assigned
- **Addresses containing commas import correctly** — quoted CSV fields are
  parsed properly instead of shifting every column after them, which had
  surfaced as missing-required-field errors on well-formed rows
- **The `role` column is applied**, resolved by role name; an unrecognized
  name is reported against its row rather than dropped silently
- **New `username` column** (optional; defaults to the part of the email
  before `@`) to resolve collisions between members sharing an email
  local-part across domains
- **Removed the `status` column** — imported members are always Active; the
  column had no effect

### July 2026 — ISO Compliance: Privacy, Retention & Operations

- **Member privacy rights** — self-service personal-data export, consent
  tracking (photo use, roster listing, SMS), and an anonymization workflow that
  scrubs a departed member's PII while retaining operational history
- **Public privacy notice and terms** at `/privacy` and `/terms`, with
  department-configurable wording
- **Records retention schedules** per department, with safety floors and daily
  enforcement; documents and minutes are never auto-deleted
- **Audit retention enforced** — expired entries are exported to signed
  archives before purge, with an attested chain hand-off; optional off-host
  shipping to a SIEM
- **Encryption key rotation** with no downtime via a legacy-key ring
- **Backup sidecar** with automated restore-verification drills
- **Supply-chain scanning** — Dependabot, blocking dependency audits, secret
  scanning, SPDX SBOM; RFC 9116 `security.txt`
- **Corrected**: SAML and LDAP were documented but never implemented; those
  pages now say so plainly

### July 2026 — Security Audit Remediation & Encryption Upgrade

- **Field encryption upgraded to AES-256-GCM**: at-rest encryption of sensitive fields (PHI, MFA secrets, integration/SSO credentials) now uses AES-256-GCM authenticated encryption — a tampered value fails to decrypt. Legacy Fernet (AES-128-CBC) values remain readable; `backend/scripts/reencrypt_to_aesgcm.py` backfills them (see the [backfill runbook](../docs/AES256_GCM_BACKFILL_RUNBOOK.md))
- **Audit hash chain is keyed (HMAC-SHA256)** and the rehash recovery op is now break-glass: disabled unless the operator sets `AUDIT_ALLOW_CHAIN_REHASH`, repairs only legacy rows, and fails closed (409) on a keyed-row mismatch. Audit-log **export redacts `session_id`** to a non-reversible fingerprint
- **Security alerts are per-department**: the `security_alerts` table is now org-scoped, so an org admin only sees/acknowledges/resolves their own department's alerts
- **Geo-blocking is configurable and platform-scoped**: new `GEOIP_FAIL_CLOSED` blocks IPs with an unresolvable country (incl. a missing MaxMind DB); runtime country block/unblock via the API is gated by `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` (off by default — the blocklist is set at deploy via `BLOCKED_COUNTRIES`)
- **Public-portal API keys**: IP rate limiting now runs before the (slow) bcrypt verification to remove a CPU-exhaustion vector, and keys carry a selective lookup prefix so a lookup checks a single candidate
- A rotating, module-by-module tenant-isolation audit closed cross-tenant read/write gaps across modules — see [`docs/module-audit/`](../docs/module-audit/PROGRESS.md) and [`CHANGELOG.md`](../CHANGELOG.md)

### May 2026 (May 1-28) — OAuth Sign-In, IP/GeoIP Hardening, Compliance Evaluation Period, Shift Follow-Up, Audit Log Admin & Training Exports

- **OAuth sign-in**: "Sign in with Google" and "Sign in with Microsoft" (Azure AD, single-tenant) via OpenID Connect. **Link-existing-only** (never auto-creates accounts) and optionally domain-restricted. ID tokens cryptographically verified (Google issuer check; Microsoft RS256 + tenant `tid` lock). CSRF state in an httpOnly `oauth_state` cookie; each sign-in logs an `oauth_login` audit event. New `users.oauth_provider` / `users.oauth_subject` columns; SPA landing at `/auth/callback`
- **IP security & GeoIP hardening**: `get_client_ip()` rewritten to trust forwarded headers only from `TRUSTED_PROXY_IPS` and read the right-most non-proxy hop (was left-most/spoofable). DB `CountryBlockRule` rows are now the source of truth for blocked countries, synced into the running GeoIP service at startup and on change (multi-worker via Redis `geoip:invalidate`). Unknown country = fail-open
- **Compliance evaluation period**: org-wide `compliance_configs.include_current_month` plus per-requirement `training_requirements.include_current_month` override control whether the in-progress month counts, so members aren't flagged mid-month. Cert "expiring soon" lookahead still uses real today
- **Scheduling follow-up tasks**: new `end_of_shift_summary` (per-member hours/calls summary email + in-app) and `trainee_report_escalation` (reminds trainees of unacknowledged reports; low-rating officer alerts). Richer shift reminders (crew roster, checklists, "Mark Arrival"), email on by default, and fixed check-in/report deep links
- **Audit log admin API & page**: read API `GET /api/v1/audit-logs` (+ `/stats`, `/{log_id}`) gated by `audit.view`, org-scoped through users; admin page at `/admin/audit-log`. New `event_attendee_overwritten` audit event when a manager overwrites an RSVP
- **Training exports & attachments**: member self-export of own records (CSV/PDF, gated by `allow_member_report_export`); officer `member_records`/`hours_summary`/`certification` export types (unknown type → 400); real training-record attachment upload/download (≤25MB, magic-byte MIME). `require_completion_confirmation` now gates finalize sign-off; dead `TrainingSession.approval_required` column dropped
- **Prospective members**: prospect documents are now actually stored (multipart upload ≤50MB, magic-byte MIME) under org-scoped paths, with a download endpoint. System role "Membership Committee Chair" renamed to "Membership Coordinator" (in-place, assignments preserved)
- **Dashboard & offline**: "Upcoming Events" count limited to the next 30 days; offline RSVP/training-submission queuing via IndexedDB. Hardened inventory notification retries (`attempt_count`/`last_attempt_at`); locked in training-config boolean server defaults

### March 2026 (Mar 28-31) — Shift Completion Pipeline, Analytics Dashboards, Elections Fixes, Code Quality & Frontend Consolidation

- **Shift completion pipeline**: End-to-end shift finalization workflow with `POST /scheduling/shifts/{id}/finalize`. Snapshots call_count and total_hours, computes per-member call_count, auto-creates draft ShiftCompletionReports for enrolled trainees. Pre-finalization checklist validates equipment checks. Finalized shifts and shifts with reports protected from deletion. Auto-populate report data from shift records (hours, calls, call types) with audit trail in `data_sources` JSON
- **Shift report analytics**: Officer analytics dashboard with org-wide totals, per-trainee breakdown, status counts, and monthly trends. Trainee stats dashboard with personal totals and monthly breakdown. 5 new API endpoints. ShiftReportsTab expanded to 5 view modes (my-reports, filed-by-me, pending-review, drafts, create)
- **Shift report review workflow**: Officers review reports (approve/flag) with optional field redaction. Trainees acknowledge reports with comments. Configurable visibility controls. Draft → approved transition triggers deferred pipeline progress. Encrypted evaluation fields (AES-256)
- **Elections module fixes**: N+1 query fixes in `_sync_package_statuses()` and `get_eligibility_roster()`. Typed `ForensicsResponse` schema replacing untyped Dict. New `/send-report` and `/verify-receipt` endpoints. Frontend type corrections for bulk cast votes
- **HIPAA audit logging**: Added `log_audit_event()` calls to medical screening, documents, membership pipeline, and messages endpoints
- **Pagination standardization**: Added PaginationParams to 16 previously unbounded list endpoints across finance, grants, medical screening, member_leaves, training_waivers, operational_ranks, and training_sessions
- **XSS prevention**: Replaced `dangerouslySetInnerHTML` in EventDetailPage with React-based SimpleMarkdown component (safe URL validation, token-based parsing)
- **Frontend consolidation**: New `useEmailListInput` shared hook. APIKeysTab migrated to shared Modal. PipelineTable uses shared SortableHeader. ~92 lines removed across 6 files
- **Security fix**: Analytics endpoint user_id spoofing patched — always uses `current_user.id` instead of client-supplied value
- **Form value coercion**: Fixed ~15 instances of `??` → `||` to prevent 422 errors from empty string submission
- **Database performance**: Added composite index on `users(organization_id, status, deleted_at)` plus indexes on `created_at` and `last_login_at`

### March 2026 (Mar 24) — Scheduling Bulk Actions, Elections Secretary Workflow, Inventory Storage Areas, Notifications Badges, WCAG Accessibility

- **Scheduling bulk actions**: Bulk confirm/decline on My Shifts tab with optimistic UI. Inline approve/deny on Requests tab. Position-first assignment flow with "Fill All Open". Staffing status visualization (green/amber tints, ratio display). Unavailable member filtering. Required/optional position toggle on templates. Shift assignment notifications and start-of-shift reminders with equipment checklists. WCAG AA shift card contrast. 10 bug fixes (overlap detection, UTC in notifications, color parsing, member hours report, dark mode)
- **Elections secretary workflow**: Tabbed election detail with WAI-ARIA pattern. Eligibility roster with search/filter/expandable rows. Publish results panel with one-click toggle. Runoff chain timeline visualization. Election summary dashboard cards. 5 new enums (`VotingMethod`, `VictoryCondition`, `BallotChoice`, `RunoffType`, `QuorumType`) extracted to constants. Event type filter removed (elections link to any event). Department email generation at member election
- **Inventory storage areas**: Storage areas display actual items with expandable panels. Barcode/asset tag always visible on item detail. Lazy barcode backfill for pre-existing items. WebSocket double-accept fix. Equipment check template builder crash fix. Camera error handling improvements
- **Notifications overhaul**: Batch mark-all-read endpoint. Unread badges on bell icon and side nav. Smart polling with Page Visibility API. Pagination (20/page). Read/unread filter. Dashboard clear-all fix. Clickable notifications with action URLs. View All link fix
- **Membership improvements**: Department email generation (4 format patterns, collision handling). Username collision prevention. Default member role on all creation paths. `password_changed_at` set from day one. Membership ID auto-generation with number reuse safety
- **WCAG accessibility**: Color contrast fixes across 75 components. New `colorContrast.ts` utility. Form accessibility (htmlFor/id, aria-required, fieldset/legend). Live regions (aria-live on 52 elements). Camera error handling improvements

### March 2026 (Mar 15) — Recurring Training Sessions, Scheduling Timezone Fixes, Inventory Auto-Variants, UTC Root Cause Fix & Pipeline Reports

- **Recurring training sessions**: Training sessions can now recur using the same infrastructure as events (daily, weekly, monthly, etc.). Selecting a course auto-populates form fields. New quarter-hour time picker and quick duration buttons
- **Scheduling timezone fixes**: Template positions (`positions` JSON, `min_staffing` Integer) now carry to created shifts. Fixed ShiftReportsTab/ShiftDetailPanel timezone display using `Intl.DateTimeFormat` instead of UTC string splitting
- **Inventory size/style auto-generation**: New "Generate Sizes & Styles" toggle creates `size × color × style` item variants with auto-grouping under `ItemVariantGroup`
- **UTC datetime root cause fix**: SQLAlchemy `load` event listener stamps all naive `DateTime(timezone=True)` columns with UTC tzinfo after ORM hydration, fixing frontend time shifts. New ESLint rules ban raw `.toLocaleString()` calls — 34 files updated
- **Pipeline overview report**: New report renderer with configurable stage grouping, drag-and-drop email section reordering, email preview panel, and server-side days-in-stage calculation
- **Prospective members pipeline**: Auto-advance extended to all applicable stage types. 4 automated email trigger fixes. Email diagnostics show why members didn't receive ballot emails
- **Events enhancements**: Series end email reminders, recurring event creation crash fix, check-in modal eligible-members endpoint, EventForm timezone-aware conflict detection
- **Non-dismissable modal fix**: Fixed backdrop-click and z-index issues on modals across EventDetailPage (7 modals), inventory, scheduling, and prospective members
- **Code quality**: Backend error handling utilities (`ensure_found`, `handle_service_errors`), shared `PaginationParams`, `formatCurrency` consolidation, naive/aware datetime fix in prospective members

### March 2026 (Mar 7) — Security Audit, Inventory Variant Groups/Kits/Reorder, Facilities Rewrite, Test Infrastructure & Visual Polish

- **Comprehensive security audit**: 25-issue audit with critical/high/medium/low remediation — DB SSL enforcement, Redis TLS, JWT algorithm restriction, file upload magic byte validation, Jinja2 sandboxing, CORS exact-match, parameterized LIKE queries, rate limiter thread safety, health endpoint minimization
- **Inventory variant groups & equipment kits**: Variant groups link size/style variants of items; equipment kits bundle items for single-operation issuance with per-component tracking
- **Member size preferences**: Record coat, pants, glove, boot, helmet sizes for auto-selection during kit issuance
- **Reorder request workflow**: Full lifecycle (pending → approved → ordered → received) with vendor/PO tracking, audit logging, and low-stock SMS alerts via Twilio
- **Inventory module rewrite**: Individual focused pages replace monolithic admin hub (items, pool, categories, maintenance, members, charges, returns, requests, write-offs, reorder). Item detail page with two-column barcode sidebar layout
- **Facilities module rewrite**: Dashboard with summary stats and activity feed; full-page facility detail with sidebar navigation; FacilityRoomPicker for cross-module room selection; Zustand store
- **Test suite improvements**: vitest-axe for WCAG accessibility testing, hypothesis for property-based schema testing, schemathesis for API contract fuzzing, pytest-timeout (30s default), coverage ratcheting
- **Visual design improvements**: 50 CSS and component enhancements — consistent spacing, theme-aware gradients, card standardization, mobile responsive touch targets
- **PDF/print fixes**: Barcode race condition fixed with requestAnimationFrame; XSS in print export; training report PDF generation
- **Auth fixes**: Concurrent token refresh replay detection; useIdleTimer polling storm; WebSocket 403 rejections
- **TypeScript quality**: Enum constants replace string literals across 17+ files; getErrorMessage() replaces instanceof Error; specific enum types replace generic strings
- **Apparatus fixes**: min_staffing field in list endpoint; setup checklist count query
- **Migration fixes**: Broken Alembic revision chain; misleading migration logs in multi-worker mode

### March 2026 (Mar 3) — React 19, ESLint 9, Tailwind v4, Vitest 4, Forms Overhaul, Pipeline Enhancements & Inventory Import

- **Major toolchain upgrades**: React 18 → 19, Vitest 3 → 4, Zod 3 → 4, ESLint v8 → v9 (flat config), Tailwind CSS v3.4 → v4.2; 200+ component files updated
- **Forms module enhancements**: Integration health dashboard with reprocess support; survey results panel with per-field aggregation; industry-standard form builder with drag-and-drop (@dnd-kit), field duplication, conditional visibility, calculated fields; improved novice UX; fixed public forms 404 and permission visibility
- **Prospective members pipeline**: Automated email stage type; form dropdown stage; meeting stage; event linking; status page toggle; bulk pipeline management; fixed 500/422 reorder errors
- **Inventory CSV import**: Bulk import with downloadable sample template, backend validation, and frontend test coverage
- **Email template redesign**: 2-column tabbed layout replacing 3-column design for better usability
- **Events settings fix**: Fixed 422 validation errors preventing events settings page from loading
- **Bug fixes**: Circular chunk dependency fix (useLayoutEffect error); stale lockfile fix for @dnd-kit dependencies
- **Testing checklist**: Comprehensive coverage audit for all modules with 35 recommendation status review

### March 2026 (Mar 2) — Mobile ID Scanner, 610 Tests, Architecture Overhaul, Security Hardening & Backend Modernization

- **Mobile member ID scanner**: Camera-based member ID scanning for inventory checkout workflow; fixed mobile toolbar layout for button accessibility
- **610 new frontend tests**: Comprehensive test suites added for 8 services, 3 stores, and 8 utilities covering auth, communications, documents, elections, events, forms, users, admin hours, apparatus, membership, error tracking, API cache, date formatting, and more
- **ARIA accessibility**: Added ARIA attributes across modals, forms, buttons, badges, and interactive elements throughout the UI
- **Frontend architecture overhaul**: Split monolithic `services/api.ts` (5,330 lines) into 13 domain files; extracted all inline routes from `App.tsx` into 15+ module `routes.tsx` files; enabled `exactOptionalPropertyTypes`; decomposed 3 large page components into 18 focused sub-components
- **Backend modernization**: Modernized Python typing across 56 files (`pyupgrade --py313-plus`); fixed IP spoofing vulnerability in security middleware; replaced deprecated startup handlers with lifespan context manager
- **Module improvements**: Unified error handling across all module stores; type safety for scheduling and prospective-members APIs; expanded module registry with metadata for 20+ modules
- **MissingGreenlet fixes**: Fixed across all remaining backend services and email template endpoints
- **Email template enhancements**: Default templates for ballot/event/training; org logo in all templates; email scheduling; live org data in preview; member dropdown for test emails
- **PWA & mobile**: Added PWA shortcuts; corrected push notification claims; repaired `usePullToRefresh` hook; wired pull-to-refresh into Dashboard
- **Security**: Updated backend security dependencies; hardened X-Forwarded-For parsing to prevent IP spoofing

### March 2026 (Mar 1) — Email Templates, Admin Hours Editing, Shift Enhancements, Training Registries & CSS Overhaul

- **Email notification templates management**: Full admin page for creating, editing, previewing, and deleting email templates; 10 new template types with per-type sample context for realistic previews; MySQL ENUM migration for sync
- **Admin hours enhancements**: Edit pending entries before approval; active sessions management with stale session fix; naive vs aware datetime crash fix; MissingGreenlet eager-loading fix
- **Shift & scheduling improvements**: Expanded shift editing (times, apparatus, color, notes, custom creation times); inline position change UI for assignments
- **Training registry & imports**: Standalone registry generator tool with `--list` flag; source field, source_url citations, and last_updated dates on imports
- **Member ID Card improvements**: Rank display name instead of slug; preserved rank casing; generated date in card footer
- **CSS design system overhaul**: 873 inline styles migrated to shared CSS classes; focus ring colors standardized via CSS theme variable across 39 files; semantic color damage from PR #491 restored
- **Session & login resilience**: Fixed MySQL timezone mismatch blocking all logins; login endpoint handles transient DB failures gracefully; improved MySQL outage resilience with pool pre-ping
- **Bug fixes**: PlatformAnalyticsPage crash on undefined recordCount; missing modules now default to enabled with Settings UI redesign; OrganizationSettings.redacted() AttributeError and auth secret leak closed; elections module type/CSS fixes
- **Infrastructure**: Removed deprecated `mysql_native_password` auth plugin; Black formatting on 9 additional backend files

### February 2026 (Feb 28) — Scheduling Refactor, Security Hardening, Mobile, Accessibility & Code Quality

- **Scheduling module refactor**: Extracted from monolithic page into proper module architecture with dedicated Zustand store, API service, settings panel, notifications panel, and tests
- **Shared API client factory**: `createApiClient()` eliminates ~300 lines of duplicated axios setup across module services
- **Brute-force protection**: Progressive rate limiting on login (IP-based + per-user lockout), frontend rate limiting on login/forgot-password pages
- **IDOR & open redirect fixes**: Organization-scoped validation on documents/training endpoints; redirect URL validation in API interceptor
- **Security alert persistence**: Alerts stored in database with acknowledge/resolve workflow; audit log export, archival, and deletion logging; `rehash_chain` endpoint
- **Mobile responsiveness**: Improved across 17+ pages (Dashboard, Settings, Apparatus, Members, Inventory, Scheduling, Pipeline, Pagination)
- **Frontend cache refresh detection**: `useAppUpdate` hook + `UpdateNotification` component for proactive version detection after deployments
- **Design accessibility audit**: Color contrast fixes across light/dark/high-contrast themes; new `useMediaQuery` hook; improved ARIA on modals, forms, and navigation
- **Navigation module enablement**: SideNavigation and TopNavigation dynamically respect module enablement settings; synced page lists
- **132 test failures → 0**: Fixed all pre-existing test failures across 14 test files
- **Data integrity**: Enum synchronization, election schemas, scheduling schemas, training model relationships
- **Backend formatting**: Black formatting across 35 files; missing imports fixed
- **Digital Member ID Card**: QR code, Code128 barcode, print-optimized wallet card, barcode scanner, rank/member-since display, org logo fix
- **Skills Testing enhancements**: Statement criteria, practice mode, test visibility, point-based scoring, post-completion review, test deletion
- **Fire department shift pattern presets**: 24/48, 48/96, Kelly Schedule, California 3-Platoon, ABCAB plus custom builder
- **Admin hours improvements**: Clock-out card, pagination, filters, bulk approve, CSV export, Dashboard/Reports/Profile integration
- **Security hardening**: AES-256 encryption at rest, Docker hardening, CSP tightening, Redis ACL, XSS fix
- **Dynamic import fix**: `lazyWithRetry()` for chunk load failures after deployments

### February 2026 (Feb 27) - Admin Hours, Elections Enhancements, Scheduling Hardening & Code Quality

- **Admin Hours Logging Module**: New module for tracking administrative work hours via QR code scanning or manual entry, with configurable approval workflows, category management, and summary dashboards
- **Member categories for training requirements**: Requirements can now target specific membership types (Active, Administrative, Probationary, Life, Retired, Honorary); permanent delete replaces soft-delete
- **Elections enhancements**: Meeting link support, voter override management, proxy voting authorization, fix for ballot-item-only elections
- **Organization settings expansion**: Email, file storage, and authentication settings now editable post-onboarding in Administration > Organization Settings
- **Scheduling production hardening**: Shift conflict detection, officer assignment, understaffing badges, template colors on calendar, weekday convention fix for patterns, route ordering fix, comprehensive data enrichment
- **Centralized backend logging**: Loguru + Sentry integration with request correlation IDs, duration tracking, and structured JSON output
- **QR code improvements**: Fixed display on Locations & Rooms, clipboard copy fallback, "Analytics" relabeled to "QR Code Analytics"
- **Code quality**: 565 floating promise ESLint warnings fixed, 94 axios calls typed, non-null assertions replaced, 0 ESLint errors/warnings across entire frontend
- **Security fixes**: CSRF tokens added to module API clients, permission gates on apparatus/forms routes, token refresh race condition fix, memory leak fix in PWA install hook

### February 2026 (Feb 23) - Training Compliance, Waiver Management & Membership Enhancements

- **LOA–Training Waiver auto-linking**: Leaves of absence automatically create linked training waivers; date changes sync; deactivation cascades; opt-out with `exempt_from_training_waiver`
- **Waiver Management Page** (`/members/admin/waivers`): Unified page for managing training, meeting, and shift waivers with Active/Create/History tabs
- **Training Waivers officer tab**: New tab in Training Admin Dashboard with summary cards, status filtering, and source tracking
- **Compliance summary card**: Member profiles show green/yellow/red compliance indicator
- **Bulk training record creation**: Up to 500 records per request with duplicate detection
- **Certification expiration alerts**: Tiered in-app + email notifications at 90/60/30/7 days with expired cert escalation
- **Rank & station snapshot**: Training records capture `rank_at_completion` and `station_at_completion`
- **Member Admin Edit, audit history, delete modal, photo upload**: Full admin member management
- **Rank validation**: Surfaces active members with unrecognized ranks
- **Compliance calculations document**: `docs/training-compliance-calculations.md`
- **15-minute time increments**: All date/time pickers enforce 15-minute steps

### February 2026 (Week of Feb 22) - Inventory Overhaul, Event Reminders & Security Hardening

- **Inventory module overhaul**: Pool/quantity-tracked items, item issuances, batch checkout/return, departure clearance lifecycle, notification netting, thermal label printing (Dymo/Rollo), barcode label generation
- **Inventory security hardening**: Row-level locking on all mutation operations, IDOR fix on clearance line items, org-scoped unique constraints, LIKE injection prevention, kwargs whitelist
- **Event reminders**: Configurable reminder schedules, multiple reminders per event, post-event/shift validation notifications
- **Notification enhancements**: Time-of-day preferences, notification expiry, in-app notification inbox
- **UI improvements**: Past events hidden by default (Past Events tab for managers), attendee management on event detail, dark mode modal fixes
- **Training Admin reorganization**: 3 sub-pages with inner tabs for better navigation
- **Badge consolidation**: `badge_number` merged into `membership_number` with migration
- **Training waivers**: Consistent adjustment formula across all compliance views
- **DateTime consistency**: All deprecated `datetime.utcnow()` replaced across backend
- **40 new inventory tests**, CI pipeline with GitHub Actions

### February 2026 (Earlier) - Scheduling Module, Events Module, TypeScript Quality & Backend Fixes

- **Scheduling Module enhanced**: 6-tab hub (Schedule, My Shifts, Open Shifts, Requests, Templates, Reports)
- Member self-service shift signup with position selection (officer, driver, firefighter, EMS, etc.)
- My Shifts tab with confirm/decline assignments, swap requests, and time-off requests
- Open Shifts tab for browsing and signing up for upcoming shifts
- Requests management with combined swap and time-off views, admin approve/deny workflow
- Shift detail slide-out panel showing crew roster, open positions, and calls/incidents
- Apparatus connection: shifts can now be linked to vehicles from the apparatus dropdown
- Lightweight Apparatus Basic page for departments without the full Apparatus module (mirrors Locations vs Facilities pattern)
- Basic Apparatus CRUD with crew positions per vehicle type (engine, ladder, rescue, ambulance, etc.)
- New backend endpoints: shift signup/withdraw, open shifts, basic apparatus CRUD
- New database migration for `basic_apparatus` table
- Side navigation updated with apparatus module toggle (full vs lightweight)
- Events module enhanced: recurring events, templates, duplication, attachments, booking prevention, RSVP overrides
- Dedicated EventCreatePage and EventEditPage with reusable EventForm component
- All TypeScript build errors resolved across entire frontend codebase
- 17 unsafe `as any` type assertions replaced with proper typing
- Backend quality fixes: dependency injection, duplicate models, missing permissions (29 files)
- Mutable default arguments fixed across 9 backend models
- Startup fixes: polling loop, type safety, API client signatures
- Comprehensive event test coverage (5 files, 1,865+ lines)
- Meeting Minutes and Documents module with 8 meeting types, template system, publish workflow
- Custom Forms module with public forms, QR codes, cross-module integrations
- Prospective Members pipeline with inactivity timeouts and election package integration
- Elections module with ranked-choice voting, audit logging, ballot forensics
- 16 system roles with unified role initialization
- Security hardening: session timeouts, DOMPurify sanitization, password requirements

### January 2026 - Package Updates

- ✅ Updated to Vite 6.0.5 (fixed from invalid 7.3.1)
- ✅ React 18.3.1 with security updates
- ✅ axios 1.7.9 security updates
- ✅ lucide-react 0.468.0 (was 150+ versions behind)
- ✅ TypeScript 5.7.3
- ✅ 25+ package updates total

### January 2026 - Unraid Automation

- ✅ One-command installation script
- ✅ Automatic container cleanup
- ✅ Auto-generated secure passwords
- ✅ Zero-configuration deployment

---

## 🤝 Contributing

We welcome contributions! Please see our **[Contributing Guide](Contributing)** for details.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](https://github.com/thegspiro/the-logbook/blob/main/LICENSE) file for details.

---

## 🔗 Quick Links

- **[GitHub Repository](https://github.com/thegspiro/the-logbook)**
- **[Report an Issue](https://github.com/thegspiro/the-logbook/issues)**
- **[Request a Feature](https://github.com/thegspiro/the-logbook/issues/new)**
- **[Discussions](https://github.com/thegspiro/the-logbook/discussions)**

---

## 💬 Getting Help

1. **Check the [Troubleshooting Guide](Troubleshooting)** first
2. **Search [existing issues](https://github.com/thegspiro/the-logbook/issues)**
3. **Ask in [Discussions](https://github.com/thegspiro/the-logbook/discussions)**
4. **Create a [new issue](https://github.com/thegspiro/the-logbook/issues/new)** with details

---

**Ready to get started?** → **[Installation Guide](Installation)** or **[Unraid Quick Start](Unraid-Quick-Start)**
