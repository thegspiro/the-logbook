# Module Audit — Progress Tracker

A rotating deep-dive audit. Each iteration (every 15 min) takes the **next
pending module**, reviews it for issues (correctness, security/tenant-isolation,
dead/duplicated code, doc accuracy, error handling, missing tests, TODOs),
records findings in `docs/module-audit/<module>.md`, applies only safe/verified
fixes, and flags anything risky rather than changing it.

**Legend:** ⬜ pending · 🔄 in progress · ✅ done

Untouched, higher-risk domains are front-loaded (the auth/security surface was
already covered by the red-team review on this branch).

| # | Module / domain | Backend | Frontend | Status |
|---|-----------------|---------|----------|--------|
| 1 | medical-screening | endpoints/medical_screening.py, services/medical_screening_service.py | modules/medical-screening | ✅ |
| 2 | apparatus | endpoints/apparatus.py, services/apparatus_service.py, evoc_level_service.py | modules/apparatus | ✅ |
| 3 | inventory | endpoints/inventory.py, labels.py, services/inventory_service.py, label_service.py | (in-app) | ✅ |
| 4 | facilities | endpoints/facilities.py, services/facilities_service.py | modules/facilities | ✅ |
| 5 | elections | endpoints/elections.py, services/election_service.py, quorum_service.py | modules/elections | ✅ |
| 6 | meetings/minutes | endpoints/meetings.py, minutes.py, services/meetings_service.py, minute_service.py | modules/minutes | ✅ |
| 7 | equipment-check | endpoints/equipment_check.py, shift_completion.py, services/equipment_check_service.py | (in-app) | ✅ |
| 8 | documents | endpoints/documents.py, services/document_service.py, documents_service.py | (in-app) | ✅ |
| 9 | membership pipeline | endpoints/membership_pipeline.py, member_status.py, member_leaves.py, services/membership_pipeline_service.py | modules/prospective-members | ✅ |
| 10 | messaging/comms | endpoints/messages.py, message_history.py, services/messaging_service.py, message_delivery_service.py | modules/communications | ✅ |
| 11 | notifications | endpoints/notifications.py, services/notifications_service.py | (in-app) | ✅ |
| 12 | integrations | endpoints/integrations.py, calcom_sync.py, salesforce_sync.py, services/integration_services/* | (in-app) | ✅ |
| 13 | forms | endpoints/forms.py, public/forms.py, services/forms_service.py | modules/forms | ✅ |
| 14 | grants/fundraising | endpoints/grants.py, services/grant_service.py, fundraising_service.py | modules/grants-fundraising | ✅ |
| 15 | admin-hours | endpoints/admin_hours.py, services/admin_hours_service.py | modules/admin-hours | ✅ |
| 16 | reports/analytics | endpoints/reports.py, analytics.py, platform_analytics.py, services/reports_service.py | modules/reports | ✅ |
| 17 | events | endpoints/events.py, event_requests.py, services/event_service.py | modules/events | ✅ |
| 18 | training | endpoints/training*.py, external_training.py, services/training*.py | modules/training | ✅ |
| 19 | scheduling | endpoints/scheduling.py, shift_*.py, services/scheduling_service.py, shift_*_service.py | modules/scheduling | ✅ |
| 20 | finance | endpoints/finance.py, services/finance_service.py | modules/finance | ✅ |
| 21 | orgs/roles/users | endpoints/organizations.py, roles.py, users.py, operational_ranks.py, member_status.py | (in-app) | ✅ |
| 22 | compliance/skills | endpoints/compliance_*.py, skills_testing.py, services/compliance_*_service.py, skills_testing_service.py | (in-app) | ✅ |
| 23 | security/audit/ip | endpoints/security_monitoring.py, ip_security.py, audit_logs.py, error_logs.py, core/audit.py | modules/ip-security | ✅ |
| 24 | core infra | core/config, database, cache, security_middleware, geoip, websocket_manager | services/, utils/, hooks/ | ✅ |
| 25 | onboarding | services/onboarding.py, org_template_service.py | modules/onboarding | ✅ |
| 26 | public-portal | public/portal.py, display.py, calendar.py, core/public_portal_security.py | modules/public-portal | 🔄 next |
| 27 | frontend shared | — | components/, components/ux/, hooks/, utils/, stores/ | ⬜ |

## Log

- (init) Tracker created. Rotation defined, 27 modules. Auth/security surface
  already covered by the red-team review (`docs/security/RED_TEAM_REVIEW_2026-07.md`).
- #1 medical-screening ✅ — tenant isolation/access-control/audit all solid.
  3 findings flagged (no safe auto-fix): MS-1 PHI plaintext at rest (MED, needs
  migration), MS-2 names never resolved in compliance/expiring (LOW), MS-3 no
  cross-org validation of referenced IDs on create (LOW). See medical-screening.md.
- #2 apparatus ✅ — 83 endpoints all authed; tenant isolation solid incl.
  sub-resources; no SQL injection; flake8 clean. 1 finding: AP-1 create paths
  don't validate parent apparatus is in-org (LOW). Elevated the recurring
  create-FK-not-org-validated pattern to CROSS-CUTTING.md (XC-1). See apparatus.md.
- #3 inventory ✅ — 116 endpoints all authed (WS authenticates manually);
  service-layer tenant isolation solid on all by-id reads/updates/deletes; label
  service org-scoped; no raw SQL; flake8 clean. **2 fixes applied:** INV-1 (real
  AttributeError bug in `get_item_history` — `i.quantity`/`i.reason` →
  `quantity_issued`/`issue_reason`), INV-2 (MEDIUM: `create_equipment_request`
  looked up the item without an org filter → cross-tenant read + foreign FK
  stored; now org-scoped + 404). 4 flagged: INV-3 maintenance-record item not
  org-validated + silent no-op (LOW), INV-4 broad create/update FK-validation
  gaps (XC-1 cluster), INV-5 reorder search LIKE not wildcard-escaped (LOW),
  INV-6 kit `optional` flag read but never persisted (LOW). See inventory.md.
- #4 facilities ✅ — 95 endpoints all `require_permission`-gated; tenant
  isolation solid on every by-id op; the one search is properly LIKE-escaped; no
  raw SQL. **2 fixes applied:** FAC-1 (removed 8 dead no-op "attachment
  conversion" blocks + misleading comments), FAC-2 (LOW: `maintenance_type_id`
  is NOT NULL but schema-optional → added a guard so a missing value returns a
  clean 400 instead of a DB 500). 2 flagged: FAC-3 create/update FK-validation
  gaps (XC-1), FAC-4 `list_facilities` search implemented but not exposed by the
  endpoint. See facilities.md. XC-1 now confirmed in every module audited.
- #5 elections ✅ — security-critical; token voting path is largely sound
  (512-bit tokens, single-use, org derived from token, window enforced,
  concurrency-locked). **2 HIGH fixes applied:** ELEC-1 (`cast_vote` never
  checked `eligibility.is_eligible` → any member could vote in a draft/closed
  election, out of window, or off the eligible list; added the gate mirroring
  `cast_proxy_vote`), ELEC-2 (cross-tenant IDOR: `update_candidate`/
  `delete_candidate` fetched the target with no org filter → org-A admin could
  edit/delete org-B candidates; added `get_election(id, org)` ownership gate).
  4 MED flagged (design/behavior-change, not auto-fixed): ELEC-3 dedup hash
  excludes candidate_id so approval/multi-vote is broken, ELEC-4
  rollback_election salt-loss enables double-voting, ELEC-5 tokens stored
  plaintext despite "hashed" docs, ELEC-6 anonymous ballots de-anonymizable via
  DB read until close. 3 LOW: ELEC-7 (XC-1 candidate user_id), ELEC-8 receipt
  never returned, ELEC-9 dead branch. New cross-cutting pattern XC-3 (admin
  by-id writes scoped only by permission, not org). See elections.md.
- #6 meetings/minutes ✅ — 42 endpoints all authed; direct-object tenant
  isolation solid and **XC-3 clean** (every admin write org-scoped — the ELEC-2
  flaw does not recur). **2 fixes applied:** MM-1 (MEDIUM: cross-org template
  leak — a foreign `template_id` sent alongside `sections` was persisted and
  eager-loaded with no org filter, leaking another org's header/footer into the
  response + published doc; now validated in-org on create), MM-2 (LOW: 10
  `.ilike()` calls missing `escape="\\"` so LIKE-escaping was a no-op). 2
  flagged: MM-3 (MEDIUM: draft/executive minutes readable by any `minutes.view`
  holder — needs a product decision + permission tier), MM-4 (XC-1 FK-validation
  gaps). See meetings-minutes.md. **MM-3 now FIXED (2026-07-25):** the four read
  paths (list/get/search/stats) take a `restricted` flag; callers without
  `minutes.manage` see only approved, non-executive minutes (by-id 404s on
  restricted records), keyed on the same permission that already gates the 19
  minutes write endpoints — no new permission or frontend change. Follow-up
  flagged: a `minutes.view_executive` tier if board members need executive
  minutes without full manage.
- #7 equipment-check ✅ — heaviest iteration; check-submission path had real
  cross-tenant writes. **5 fixes applied:** EC-1 (HIGH — client `apparatus_id`
  on a standalone check mutated another org's `has_deficiency` safety flag;
  org-scoped `_update_apparatus_deficiency` + validate apparatus_id in-org),
  EC-2 (MED — `submit_check` wrote serial/lot back onto foreign template items;
  org-scoped `_load_template_items_map` via compartment→template join), EC-3
  (MED — `swap_item_lot` inventory write required no permission; added
  `equipment_check.manage`/`inventory.manage`), EC-4 (MED — `clone_template`
  attached clone to unvalidated apparatus; org-scoped lookup; XC-3), EC-5 (LOW —
  unescaped LIKE; prior commit). 6 flagged: EC-6 create_report trainee_id (XC-1),
  EC-7 read endpoints bypass equipment_check.view, EC-8 unscoped changelog reads,
  EC-9 get_report fragile no-org getter, EC-10 complete_incomplete_check skips
  auto-fail rule, EC-11 compliance metrics stubbed. See equipment-check.md.
- #8 documents ✅ — upload well-hardened (UUID filenames, magic-byte MIME, no
  traversal); tenant isolation solid; folder ACL **not** bypassable on direct
  read; no file_path leak (that field is on the minutes PublishedDocumentResponse,
  not this module). **3 fixes applied:** DOC-1 (MED data-retention:
  delete_document orphaned the on-disk file — now removes it), DOC-2 (LOW
  fail-open ACL: can_access_document returned True on a missing folder — now
  fails closed), DOC-3 (LOW fail-open: upload_document silently accepted an
  invalid/foreign folder_id — now 404s). 3 flagged: DOC-4 get_summary aggregates
  ignore folder ACL, DOC-5 folder ACL is per-folder not hierarchical (confirm
  intent), DOC-6 write-path FK/enum validation gaps (leadership-gated, XC-1).
  delete_folder still orphans subtree files (flagged). See documents.md.
- #9 membership pipeline ✅ — sensitive applicant PII module; tenant isolation
  solid (XC-3 absent), file upload/download is a model implementation (magic-byte
  MIME, UUID names, realpath download guard). **3 fixes applied:** MP-2 (MED:
  create_prospect stored an unvalidated pipeline_id → leaked a foreign org's step
  config in the response; now org-validated), MP-3 (create_leave didn't validate
  user_id in-org; now validated), MP-4 (PATCH leave skipped date-order check; now
  validated + both leave endpoints convert ValueError→400). **MP-1 (HIGH) now
  FIXED (2026-07-25):** applicant background-check/ID downloads + PII were
  reachable with the generic `members.view` roster permission across all 13
  prospect-read routes. Investigation showed the frontend already gates the
  module on `prospective_members.view`, so `members.view` was dead
  over-permission on the API; removed it (applicant/pipeline routes now require
  `prospective_members.view/.manage`; the 2 election-package routes require those
  or `elections.view/.manage`, preserving the election-officer flow). 3 LOW
  flagged:
  MP-5 (more XC-1 create paths), MP-6 (PII in activity/audit log), MP-7
  (inconsistent existing-member PII disclosure). New cross-cutting pattern XC-2
  (sensitive reads gated broader than intended). See membership-pipeline.md.
- #10 messaging/comms ✅ — very clean module. Tenant isolation SOLID; **audience
  targeting provably cannot cross org boundaries** (single org-scoped choke point
  `_targeted_users`); XC-3 clean; not usable as a spam/phishing relay
  (destinations are org-scoped user records); a member can't read messages not
  addressed to them. **1 fix applied:** MSG-1 (LOW: unescaped org name in the
  test-email HTML — the one gap in the module's otherwise-correct escaping; now
  html.escaped). 2 LOW flagged: MSG-2 (targeting lists not org-validated on
  write, XC-1, not exploitable), MSG-3 (admin test-email to arbitrary address, by
  design). See messaging.md.
- #11 notifications ✅ — very clean module; user-scoping / IDOR prevention is
  exemplary (`/my/*` inbox paths filter recipient_id; `mark_as_read` documents +
  enforces the guard). **1 fix applied:** NOTIF-1 (LOW: `/logs/{id}/read` marked
  any org notification read org-wide but required only `notifications.view` while
  `/logs/read-all` requires `.manage`; raised to `.manage` — no frontend caller,
  safe). Tenant isolation solid, no SQL injection, flake8 clean. See
  notifications.md.
- #12 integrations ✅ — external-service surfaces. Verified good: **no secret
  exposure** (write-only + redacted), **OAuth callback state validation robust**
  (signed JWT + nonce cookie + org-bound load), inbound webhook receiver
  constant-time verify + fail-closed + replay protection, tenant isolation solid,
  Salesforce URLs fixed/regex-locked, base client hardened. **2 fixes applied:**
  INT-1 (MED-HIGH SSRF: chat senders slack/discord/teams + Cal.com client POSTed
  the stored URL without send-time re-validation → DNS-rebinding TOCTOU; added
  `assert_outbound_url_safe` fail-closed guard to all four), INT-2 (LOW: unencoded
  `error` param reflected into the OAuth redirect; now `quote`-encoded). 3
  flagged: INT-3 (list/get reads not manage-gated — but consumed cross-module, so
  needs an `integrations.view` tier not a simple gate), INT-4 (PATCH update resets
  omitted config fields to schema defaults — data-integrity bug), INT-5 (dead
  KNOWN_WEBHOOK_DOMAINS allowlist / nits). See integrations.md.
- #13 forms ✅ — public-submission surface is a model implementation (slug
  validation, layered rate-limit + daily cap, honeypot, org-from-form,
  member_lookup stripped). Stored-XSS mitigated (escape-at-storage + React
  auto-escapes form-def text). Pipeline integration org-safe. **3 fixes applied:**
  FORM-1 (HIGH: equipment-assignment integration assigned an in-org item to a
  submitter-supplied cross-org user_id; now validates member+item in-org via a
  new `_entity_in_org` helper), FORM-2 (HIGH: event-registration integration
  created an RSVP against a submitter-supplied cross-org event_id; now validates
  event in-org + org-scopes the dedup query), FORM-3 (LOW: MULTISELECT options
  not validated). 3 flagged: FORM-4 (form-def text unescaped but React
  auto-escapes → not exploitable now), FORM-5 (require_authentication /
  allow_multiple_submissions not enforced on public submit), FORM-6 (required
  check presence-only). FORM-1/2 are XC-1 with real cross-tenant write impact.
  See forms.md.
- #14 grants/fundraising ✅ — money-handling module; direct-object tenant
  isolation solid but the recompute helpers were the write vector. **5 fixes
  applied:** GF-1 (**CRITICAL**: create/update_donation accepted cross-org
  campaign_id/donor_id that fed org-blind recompute helpers overwriting another
  org's campaign/donor totals; now validated in-org + helpers org-scoped), GF-2
  (HIGH: expenditure budget_item_id corrupted another org's budget line; now
  validated against the org-verified application), GF-3 (HIGH correctness:
  donations with omitted payment_status were dropped from running totals due to
  exclude_unset + server_default; now normalized), GF-4 (MED: application
  opportunity_id leaked another org's opportunity fields + drove task-gen; now
  validated in-org), GF-5 (LOW: donor/opportunity search LIKE not escaped). 4
  flagged: GF-6 remaining stored-only cross-org FKs (XC-1), GF-7 no overspend/
  status-transition guards + re-award duplicates tasks, GF-8 is_anonymous flag
  never enforced, GF-9 float money math / zero amounts / donor-PII gate. See
  grants-fundraising.md.
- #15 admin-hours ✅ — time-clock; self-service ownership + clock integrity
  solid, approvals org-scoped (XC-3 clean), no impersonation. **3 fixes
  applied:** AH-1 (HIGH time-fraud: create_manual_entry auto-approved
  client-supplied times → self-credited compliance hours; now manual entries
  always PENDING + future-clock-out check + 24h max-duration cap), AH-2 (MED
  cross-tenant: auto_close_stale_sessions mutated ALL orgs' active sessions;
  added optional org scope — endpoint scoped, cron stays global), AH-3 (LOW:
  auto-approved clock-outs now stamp approved_at). Mock-based service tests run +
  pass (updated the one asserting old auto-approve). 2 flagged: AH-4 officers can
  self-approve (SoD — but small-dept concern, needs a toggle), AH-5 minor
  scoping omissions (not exploitable). See admin-hours.md.
- #16 reports/analytics ✅ — cross-org-leakage focus. platform_analytics fully
  org-scoped (16/16 queries); reports org-scoped almost everywhere; no
  client-supplied group-by/column injection. **2 fixes applied:** RPT-1 (HIGH
  cross-org leak: department_overview counted minutes action items across ALL
  orgs — no org filter, and that model has no organization_id so it needs a
  MeetingMinutes join; now org-scoped), RPT-2 (LOW/MED: unvalidated year /
  expiring_soon_days report filters could 500; added _safe_int coercion). 3
  flagged: RPT-3 member/applicant PII at reports.view (permission granularity),
  RPT-4 org-id typing inconsistency, RPT-5 aggregate correctness/polish. See
  reports-analytics.md.
- #17 events ✅ — public event-request flow solid (org-validated, server-stamped,
  256-bit token, no body injection, replay-guarded); tenant isolation strong
  (XC-3 clean, RSVP self-scoped, attachments hardened). **4 fixes applied:** EV-1
  (MED: cross-org location_id on event create/update → disclosed another org's
  location + defeated its room double-booking; now validated via org-scoped
  get_location), EV-2 (LOW/MED: public contact_name unescaped in notification
  email HTML; now escaped like the sibling assignee branch), EV-3 (LOW: rsvp-series
  anchor fetch not org-scoped — existence oracle; now scoped), EV-4 (dead
  EventService instantiation removed). 3 flagged: EV-5 (public intake has no
  per-org opt-in + weaker anti-spam than forms — feature+config), EV-6 (members
  can RSVP to draft/past events), EV-7 (status-check not rate-limited [token is
  256-bit] + template-email TypeError). See events.md.
- #18 training ✅ — largest module (154 endpoints, ~17k L); audited with two
  parallel readers (member/compliance + programs/external). Verified good:
  per-member PHI endpoints self-or-officer gated, programs-service tenant
  isolation solid (XC-3 clean), external-provider SSRF + credentials solid
  (URL validated write+every-call, creds encrypted write-only). **4 fixes
  applied:** TR-1 (HIGH cross-member PHI leak: /certifications/expiring returned
  every member's certs to any member; now self-confined), TR-2 (MED XC-1:
  create_record skipped user_id org-validation when rank+station supplied; now
  unconditional + course lookup org-scoped), TR-3 (MED cross-org PII leak:
  external user-mapping enrichment read a foreign user's name/email; now
  org-scoped + internal_user_id validated), TR-4 (dead no-op year statement
  removed). 2 flagged: TR-5 (auto-approved submissions bypass SoD — config), TR-6
  (external/enhancement FK defense-in-depth + _decrypt_field fallback +
  enhancement-service spot-check). training_program_service (4027 L) got
  invariant-focused coverage. See training.md. Next: scheduling.
- #19 scheduling ✅ — shift management + self-service signup/swap +
  pattern generation; two parallel readers (self-service + manager).
  Manager tenant isolation solid (XC-3 clean), no SQL injection, swap manual
  path blocks self-approval. **5 fixes applied:** SCH-1 (HIGH self-escalation:
  self-signup for an officer-position slot on an open_to_all_members shift ran
  the manager auto-promote block and set the member as shift_officer_id → gained
  crew authority; added a self_signup flag that guards the promote block),
  SCH-2 (HIGH: self-signup skipped cancelled/finalized/past-date guards; now
  enforced when self_signup=True), SCH-3 (HIGH DoS: generate_shifts_from_pattern
  had no range bound; added MAX_GENERATION_DAYS=366 + end<start check), SCH-4
  (MED XC-1 + PII leak: create/update_shift stored an unvalidated
  shift_officer_id feeding _sync_officer_assignment, and get_member_hours_report's
  User join lacked an org filter → foreign name/email leak; both now
  org-validated/scoped). 2 flagged: SCH-5 (swap accept-path re-validation +
  self-approval, behavior-change), SCH-6 (finalize manual_hours override +
  apparatus/station/template FK defense-in-depth). scheduling_service (~5k L)
  got invariant-focused coverage. See scheduling.md. Next: finance.
- #20 finance ✅ — money-handling module (41 endpoints, budgets/approvals/dues);
  two parallel readers (service isolation+correctness / endpoint access+SoD).
  Verified good: all endpoints permission-gated, approval-step IDOR closed
  (org-scoped + spoof-proof approver), by-id ops org-scoped (XC-3 clean), status
  guards on all terminal money moves, no SQL injection. **3 fixes applied:**
  FIN-1 (HIGH XC-1 dangerous variant: a client budget_id on a PR/CR/expense fed
  three bare-id budget write-helpers that incremented another org's
  encumbered/spent totals; fixed in two layers — org-filter on the three helpers
  + a new _validate_finance_fks that rejects foreign budget/category/fiscal-year
  FKs at create/update), FIN-2 (MED: create/update_budget stored unvalidated
  fiscal_year_id/category_id — same helper), FIN-3 (HIGH XC-2: GET /dues leaked
  any member's dues balances to any finance.view holder via the user_id param;
  non-managers now confined to their own dues, dues managers keep the
  cross-member view). 4 flagged: FIN-4 (no SoD on terminal money movement —
  needs finance.disburse tier), FIN-5 (reimbursement/payee records readable by
  any finance.view holder), FIN-6 (record_dues_payment no idempotency + waive
  overwrite), FIN-7 (unbounded export/in-memory pagination DoS, request-number
  race, float aggregates, pending-approvals not assignee-filtered). See
  finance.md. Next: orgs/roles/users.
- #21 orgs/roles/users ✅ — the privilege-management surface (5 endpoint files +
  4 services + core/permissions); three parallel readers (users+ranks / roles+
  permissions+member-status / organizations). Verified good: the H2 role-grant
  ceiling is real + wildcard-correct on the paths it covers, tenant isolation
  strong (XC-3 clean, orgs never take a client org_id), self-or-admin gates on
  all user mutations, secrets encrypted/redacted, no SQL injection. **6 fixes
  applied:** ORU-1 (HIGH escalation: create_member bypassed the role-grant
  ceiling → a users.create holder could mint a puppet account with a chosen
  password + wildcard role and take over the tenant; added the ceiling call,
  both readers flagged it), ORU-2 (HIGH: PATCH /settings accepted the narrow
  settings.manage_contact_visibility perm on the full settings body → a
  contact-visibility secretary could rewrite auth/SMTP/S3 secrets; removed that
  perm from the route, dedicated /settings/contact-info keeps their real
  capability), ORU-3 (MED: redacted-placeholder preservation omitted "auth" →
  a full-settings round-trip persisted "••••••••" over the real SSO secret;
  added auth to the loop), ORU-4 (MED cross-tenant: _resolve_module_settings
  read an unscoped OnboardingStatus row → org A seeded from another org's
  modules; org-scoped it), ORU-5 (MED: PATCH /settings/auth echoed secrets
  un-redacted; return .redacted()), ORU-6 (LOW: contact-info email uniqueness
  UUID-vs-str self-exclusion bug + email_verified not reset on change; both
  fixed). Flagged: ORU-7 (role-edit ceiling on current perms / last-admin
  lockout / member-role mass-escalate), ORU-8 (with-roles + GET /settings expose
  PII/infra config broader than the privacy gate), ORU-9 (member_status state
  machine, membership-id row lock/loop cap, audit-history org filter,
  perm-name reconcile, shallow settings merge). See orgs-roles-users.md. Next:
  compliance/skills.
- #22 compliance/skills ✅ — PHI-adjacent compliance + skills-testing (3 endpoint
  files + 4 services); three parallel readers (skills / compliance-officer /
  compliance-config). Verified good: no cross-tenant IDOR anywhere (XC-3 clean),
  the get_current_user-only skills routes org-scoped + discard ownership-checked,
  skills write-path XC-1 already solid, compliance-officer reads officer-gated
  (no client member id), no NULL-org rows, no SQL injection. **7 fixes applied:**
  CS-1 (MED cross-member PHI: GET /tests + /tests/{id} exposed every member's
  scores/evaluator notes to any member — confined non-officers to their own
  tests, using the module's existing _user_has_officer_role split), CS-2 (LOW:
  GET /templates/{id} skipped the visibility filter; applied it), CS-3 (MED XC-1:
  create/update_profile stored unvalidated cross-org requirement/role/category
  FK ids — added _validate_profile_fks), CS-4 (MED: CSV formula injection in the
  annual compliance export — _csv_safe cell sanitizer), CS-5 (MED correctness:
  zero-requirements member mislabeled at_risk + understated org % — treat as
  compliant, matching the sibling service), CS-6 (email HTML injection in skills
  result emails — html.escape), CS-7 (LOW: threshold-ordering validator on
  compliance config). Flagged: CS-8 (SoD — examiner self-certification +
  self-attestation), CS-9 (monthly=annual report, email recipient allowlist +
  HTML escaping, attestation over-fetch, records_with_certification mislabel,
  ISO str typing). See compliance-skills.md. Next: security/audit/ip.
- #23 security/audit/ip ✅ — the security-tooling surface itself (5 endpoint/core
  files + 2 services + the middleware IP path); three parallel readers. Verified
  good: H1/H4/M9 all intact (audit reads org-scoped, HMAC hash chain keyed,
  append-only), IP-exception self-service NOT exploitable (PENDING-on-create,
  APPROVED-only enforcement, permission-gated approve), enforcement fails closed,
  client IP obtained safely, no SQL injection. **5 fixes applied:** SEC-1 (MED
  DoS: _MAX_TRACKING_KEYS cap was dead — added unthrottled _enforce_key_caps +
  wired it into detect_brute_force), SEC-2 (MED: verify_integrity didn't detect
  head-truncation — anchored the first row to the genesis hash when start_id is
  None), SEC-3 (MED DoS: error_logs troubleshooting_steps capped item count but
  not string length — per-item + total caps), SEC-4 (LOW: audit search LIKE
  metacharacters unescaped), SEC-5 (LOW: error_type schema cap 100 > DB column
  50). Tests green (security_monitoring 10/10, audit hash chain 4/4). Flagged
  (schema/behavior-change): SEC-6 (HIGH — security_alerts is a GLOBAL table with
  no org_id → cross-tenant alert read + acknowledge/resolve IDOR-suppress +
  metric leak; needs a migration + backfill), SEC-7 (global audit-chain admin
  ops gated by any org's audit.export + rehash tamper-laundering), SEC-8 (geo
  fail-open + global CountryBlockRule), SEC-9 (audit export session_id/IP
  exposure, error payload XSS, users-join scoping fragility, ops hardening). See
  security-audit-ip.md. Next: core infra.
- #24 core infra ✅ — backend foundational layer (config/database/cache/websocket/
  security/encrypted_types + shared utils); three parallel readers (cache+ws+db /
  crypto / config+uploads). Verified good: crypto foundation strong (Argon2id,
  HS256 pinned, CSPRNG, Fernet authenticated encryption, TOTP replay-protected,
  refresh rotation, secrets fail-closed), config hardening solid (DEBUG/docs prod-
  gated, CORS never wildcard), WS auth binds org to JWT + org-partitioned
  broadcasts, DB session lifecycle correct, image_validator hardened. **8 fixes
  applied:** CI-1 (MED CSV formula injection in 5 exporters — swapped to the
  existing SafeCsvWriter: equipment_check, inventory×2, finance_service,
  admin_hours_service), CI-2 (MED: DB connection errors could log the credentialed
  DSN — scrub DB_PASSWORD + log type), CI-3 (MED DoS: unbounded WS connection
  registry — MAX_CONNECTIONS_PER_ORG cap), CI-4 (MED: ORM/user.py field
  decryption caught bare Exception, masking real key/rotation errors — narrowed
  to InvalidToken), CI-5 (MED doc: "AES-256" claim corrected to Fernet
  AES-128-CBC), CI-6 (LOW: decode_token now requires exp), CI-7 (LOW: security-
  notification email html.escape), CI-8 (LOW: corrected misleading
  insecure-defaults comment). Tests: 80 security/auth/crypto unit tests pass.
  Flagged: CI-9 (DB/Redis TLS only WARNS in prod, optimize_image fails open on
  bombs, Redis TLS no cert verify), CI-10 (Redis no tenant namespacing [latent],
  WS accept-before-auth, PBKDF2 100k / 40-bit recovery codes — migration-shaped).
  See core-infra.md. Next: onboarding.
- #25 onboarding ✅ — tenant-provisioning flow (onboarding endpoint 1961 L +
  service 1319 L + org-template services); three parallel readers (endpoint
  guards / service reset+owner+session / templates). Verified good: the two
  catastrophic scenarios BLOCKED (post-completion reset refused + session
  unobtainable post-org; second system-owner/org blocked by needs_onboarding),
  no secrets in responses, session secrets encrypted, 256-bit session token +
  CSRF, Argon2id owner password, complete is a one-way latch, template export
  org-scoped, no SQL injection. **6 fixes applied:** ONB-1 (HIGH correctness:
  reset deleted users before the HQ Location whose created_by→users is RESTRICT,
  so reset FK-failed and could never complete — delete Location/Facility before
  users + narrowed the user_positions except), ONB-2 (MED: in-progress window let
  a leaked session create multiple orgs/owners — create_organization rejects a
  2nd org, create_system_owner rejects a 2nd owner), ONB-3 (MED: /modules,
  /notifications, /complete, /session/roles, /session/positions lacked the
  needs_onboarding completion guard — added), ONB-4 (MED: /start + /system-owner
  had no rate limit — added), ONB-5 (LOW/MED: /database-check echoed the raw DB
  exception — generic error), ONB-6 (LOW: minutes-template seeding shared mutable
  default sections, pitfall #12 — deepcopy). Also renamed the test_email_*
  endpoint to clear a PT028. Flagged: ONB-7 (onboarding role editor accepts
  client-controlled permissions/priority/is_system), ONB-8 (reset owner-reauth,
  audit durability, /status org-name leak, template mass-assignment). See
  onboarding.md. Next: public-portal.
