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
| 4 | facilities | endpoints/facilities.py, services/facilities_service.py | modules/facilities | 🔄 next |
| 5 | elections | endpoints/elections.py, services/election_service.py, quorum_service.py | modules/elections | ⬜ |
| 6 | meetings/minutes | endpoints/meetings.py, minutes.py, services/meetings_service.py, minute_service.py | modules/minutes | ⬜ |
| 7 | equipment-check | endpoints/equipment_check.py, shift_completion.py, services/equipment_check_service.py | (in-app) | ⬜ |
| 8 | documents | endpoints/documents.py, services/document_service.py, documents_service.py | (in-app) | ⬜ |
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
  Next: facilities.
