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
| 16 | reports/analytics | endpoints/reports.py, analytics.py, platform_analytics.py, services/reports_service.py | modules/reports | 🔄 next |
| 17 | events | endpoints/events.py, event_requests.py, services/event_service.py | modules/events | ⬜ |
| 18 | training | endpoints/training*.py, external_training.py, services/training*.py | modules/training | ⬜ |
| 19 | scheduling | endpoints/scheduling.py, shift_*.py, services/scheduling_service.py, shift_*_service.py | modules/scheduling | ⬜ |
| 20 | finance | endpoints/finance.py, services/finance_service.py | modules/finance | ⬜ |
| 21 | orgs/roles/users | endpoints/organizations.py, roles.py, users.py, operational_ranks.py, member_status.py | (in-app) | ⬜ |
| 22 | compliance/skills | endpoints/compliance_*.py, skills_testing.py, services/compliance_*_service.py, skills_testing_service.py | (in-app) | ⬜ |
| 23 | security/audit/ip | endpoints/security_monitoring.py, ip_security.py, audit_logs.py, error_logs.py, core/audit.py | modules/ip-security | ⬜ |
| 24 | core infra | core/config, database, cache, security_middleware, geoip, websocket_manager | services/, utils/, hooks/ | ⬜ |
| 25 | onboarding | services/onboarding.py, org_template_service.py | modules/onboarding | ⬜ |
| 26 | public-portal | public/portal.py, display.py, calendar.py, core/public_portal_security.py | modules/public-portal | ⬜ |
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
  scoping omissions (not exploitable). See admin-hours.md. Next: reports/analytics.
