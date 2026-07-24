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
| 8 | documents | endpoints/documents.py, services/document_service.py, documents_service.py | (in-app) | 🔄 next |
| 9 | membership pipeline | endpoints/membership_pipeline.py, member_status.py, member_leaves.py, services/membership_pipeline_service.py | modules/prospective-members | ⬜ |
| 10 | messaging/comms | endpoints/messages.py, message_history.py, services/messaging_service.py, message_delivery_service.py | modules/communications | ⬜ |
| 11 | notifications | endpoints/notifications.py, services/notifications_service.py | (in-app) | ⬜ |
| 12 | integrations | endpoints/integrations.py, calcom_sync.py, salesforce_sync.py, services/integration_services/* | (in-app) | ⬜ |
| 13 | forms | endpoints/forms.py, public/forms.py, services/forms_service.py | modules/forms | ⬜ |
| 14 | grants/fundraising | endpoints/grants.py, services/grant_service.py, fundraising_service.py | modules/grants-fundraising | ⬜ |
| 15 | admin-hours | endpoints/admin_hours.py, services/admin_hours_service.py | modules/admin-hours | ⬜ |
| 16 | reports/analytics | endpoints/reports.py, analytics.py, platform_analytics.py, services/reports_service.py | modules/reports | ⬜ |
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
  gaps). See meetings-minutes.md.
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
  Next: documents.
