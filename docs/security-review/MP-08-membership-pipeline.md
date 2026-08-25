# Security Review — Membership Pipeline

**Prefix:** `MP` · **Iteration:** 8 · **Reviewed:** 2026-08-25 · **PR:** (this PR)

**Backend:** `endpoints/membership_pipeline.py` (2,255 L, 51 routes), `services/membership_pipeline_service.py` (5,690 L), `models/membership_pipeline.py`, `schemas/membership_pipeline.py`, `api/prospect_privacy.py`
**Frontend:** `modules/prospective-members/` (not re-read in full this pass — see Scope)
**Migrations:** none touching this feature since the last audit

---

## Scope

This is a re-verification pass, not a first read. `docs/module-audit/membership-pipeline.md`
(MP-1 through MP-7, all ✅ FIXED) and `docs/app-review/membership-pipeline.md`
(MP2-1 through MP2-5, all ✅ FIXED) cover the module's history through
2026-08-09; neither doc has an open finding, so this pass did not re-derive
either.

The module grew substantially since that baseline (1,763 L / 44 routes →
2,255 L / 51 routes in the endpoint file; the service file from 4,236 L to
5,690 L) entirely from ordinary feature work — none of it run through the
security-review process. This pass focused on that unreviewed surface:

- **Read in full:** every commit touching `membership_pipeline.py` or
  `membership_pipeline_service.py` since 2026-08-09 (`git log --since
2026-08-09 --until 2026-08-25`), and the current source for every function
  those commits touched — `set_prospect_status`/`_apply_status_change`/
  `_assert_open` (closed-application gating, PR #1811), `record_step_approval`/
  `_authorized_multi_approval_result`/`_accumulate_approvals` (multi-approval
  signer authorization), `complete_current_step_for_integration_event`
  (webhook stage-completion reference matching, 2026-08-17),
  `get_kanban_board`, `list_prospects`/`list_election_packages` (open/closed
  filtering), and `app/api/prospect_privacy.py` in full (self-record access
  guard).
- **Enumerated:** all 51 routes, extracted programmatically (method, path,
  function, permission dependency) — see Route inventory below. This is a
  full listing, not a sample.
- **Verified by grep, not fully re-read line-by-line:** the ~30 endpoint
  functions untouched since the 2026-08-09 baseline (pipeline/step CRUD,
  document upload/download, interviews, event links). These were in scope for
  the prior module-audit and app-review passes and are unchanged since.
- **Not read this pass:** the frontend module
  (`frontend/src/modules/prospective-members/`). PR #1811's own Codex review
  already covered the frontend changes in that PR (findings 2–4, all fixed in
  `f5b1ae6a`); no frontend-only commits landed in this feature since then that
  weren't part of that PR.
- **Explicitly out of scope:** `app/api/public/integrations_webhook.py`. It
  calls into `complete_current_step_for_integration_event` but the webhook
  endpoint itself (auth, secret verification, provider parsing) belongs to
  feature 03 (Public surface & webhooks), already reviewed under
  `PUB-03-public-surface-webhooks.md` / PR #1806. This pass only verified the
  membership-pipeline-side half of that boundary: the service method the
  webhook calls into stays org-scoped and now requires the stage's configured
  reference to match the event (see Verified good).

## Route inventory

| Method | Path                                                      | Permission                                            | Org-scoped |
| ------ | --------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| GET    | /widget-summary                                           | prospective_members.view / .manage                    | yes        |
| GET    | /pipelines                                                | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines                                                | members.manage / prospective_members.manage           | yes        |
| GET    | /pipelines/{pipeline_id}                                  | prospective_members.view / .manage                    | yes        |
| PUT    | /pipelines/{pipeline_id}                                  | members.manage / prospective_members.manage           | yes        |
| PATCH  | /pipelines/{pipeline_id}/report-settings                  | members.manage / prospective_members.manage           | yes        |
| DELETE | /pipelines/{pipeline_id}                                  | members.manage / prospective_members.manage           | yes        |
| POST   | /pipelines/{pipeline_id}/duplicate                        | members.manage / prospective_members.manage           | yes        |
| POST   | /pipelines/{pipeline_id}/seed-templates                   | members.manage / prospective_members.manage           | yes        |
| GET    | /validate-form/{form_id}                                  | prospective_members.manage                            | yes        |
| GET    | /pipelines/{pipeline_id}/steps                            | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines/{pipeline_id}/steps                            | members.manage / prospective_members.manage           | yes        |
| PUT    | /pipelines/{pipeline_id}/steps/reorder                    | members.manage / prospective_members.manage           | yes        |
| PUT    | /pipelines/{pipeline_id}/steps/{step_id}                  | members.manage / prospective_members.manage           | yes        |
| DELETE | /pipelines/{pipeline_id}/steps/{step_id}                  | members.manage / prospective_members.manage           | yes        |
| GET    | /pipelines/{pipeline_id}/kanban                           | prospective_members.view / .manage                    | yes        |
| GET    | /pipelines/{pipeline_id}/stats                            | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines/{pipeline_id}/purge-inactive                   | members.manage / prospective_members.manage           | yes        |
| GET    | /source-events                                            | prospective_members.view / .manage                    | yes        |
| GET    | /prospects                                                | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/check-existing                                 | members.create / prospective_members.manage           | yes        |
| POST   | /prospects                                                | members.create / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}                                  | prospective_members.view / .manage                    | yes        |
| PUT    | /prospects/{prospect_id}                                  | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/complete-step                    | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/approve-step                     | _(auth only — see note)_                              | yes        |
| POST   | /prospects/{prospect_id}/skip-step                        | prospective_members.manage                            | yes        |
| POST   | /prospects/{prospect_id}/advance                          | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/bulk-advance                                   | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/status                           | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/bulk-status                                    | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/regress                          | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/transfer                         | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/activity                         | prospective_members.view / .manage                    | yes        |
| GET    | /prospects/{prospect_id}/documents                        | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/{prospect_id}/documents                        | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/documents/{document_id}/download | prospective_members.view / .manage                    | yes        |
| DELETE | /prospects/{prospect_id}/documents/{document_id}          | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/election-package                 | prospective_members.view / .manage / elections.manage | yes        |
| POST   | /prospects/{prospect_id}/election-package                 | members.manage / prospective_members.manage           | yes        |
| PUT    | /prospects/{prospect_id}/election-package                 | members.manage / prospective_members.manage           | yes        |
| GET    | /election-packages                                        | prospective_members.view / .manage / elections.manage | yes        |
| POST   | /prospects/{prospect_id}/election-package/assign          | elections.manage / prospective_members.manage         | yes        |
| POST   | /prospects/process-inactivity                             | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/interviews                       | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/{prospect_id}/interviews                       | prospective_members.manage                            | yes        |
| PUT    | /interviews/{interview_id}                                | prospective_members.manage                            | yes        |
| DELETE | /interviews/{interview_id}                                | prospective_members.manage                            | yes        |
| GET    | /prospects/{prospect_id}/events                           | prospective_members.view                              | yes        |
| POST   | /prospects/{prospect_id}/events                           | prospective_members.manage                            | yes        |
| DELETE | /prospects/{prospect_id}/events/{link_id}                 | prospective_members.manage                            | yes        |

**Note on `/prospects/{prospect_id}/approve-step`:** the only route with no
`require_permission` gate (`membership_pipeline.py:1155`, `Depends(get_current_user)`
only). This is intentional, not an oversight — see Verified good below.

Every route also sits behind the router-level `block_self_prospect_access`
dependency (`membership_pipeline.py:95`), so a `{prospect_id}` route is
additionally checked against the caller's own record regardless of permission.

## Verified good ✅

- **`approve-step`'s missing permission gate is closed by a server-side role
  check, not client input.** `record_step_approval`
  (`membership_pipeline_service.py:1538`) accepts a client-supplied `role`,
  but the string only decides _which_ configured approver role is being
  claimed — it never authorizes anything by itself. `complete_step` routes
  every multi-approval submission through
  `_authorized_multi_approval_result` (`membership_pipeline_service.py:1396`),
  which re-queries the authenticated signer's own `User.positions` (in-org,
  active, not soft-deleted) and rejects any submitted role the signer does not
  actually hold (`"You may only approve for a role you currently hold"`,
  line 1451). A caller cannot claim a role they lack, and cannot claim to be
  someone else — `completed_by`/`signer_id` come from `current_user.id`, never
  from the request body.
- **Closed-application gating (PR #1811) is applied everywhere a closed
  applicant could otherwise re-enter workflow.** `_assert_open`
  (`membership_pipeline_service.py:133`) is called from
  `create_election_package` (line 4460), `assign_package_to_election`
  (line 4677), and `create_interview` (line 5209) — the three actions the
  commit identifies as consequential (a ballot package, assigning it to an
  election, and a fresh interview against a closed file). `_apply_status_change`
  (line 2130) is the single write path both the single-record and bulk status
  endpoints go through, and it explicitly refuses to set or clear
  `TRANSFERRED` (lines 2154–2163) — closing the P1 Codex found on the PR
  itself (setting `transferred` via status-change bypassed
  `transfer_prospect`'s User-creation side effects; clearing it would return
  an existing member to the applicant board under the active-email unique
  index).
- **The webhook stage-auto-completion path
  (`complete_current_step_for_integration_event`,
  `membership_pipeline_service.py:1835`) is org-scoped and reference-matched.**
  The prospect query filters `organization_id == organization_id` and
  `status == ACTIVE` (lines 1871–1872) before any email match is attempted, so
  a webhook cannot complete a stage for a prospect in a different
  organization even given a colliding email. The 2026-08-17 fix
  (`e1f6ea46`) added the `event_reference`/`reference_config_key` match
  (lines 1898–1905): the step's own configured booking URL / template id must
  match the inbound webhook event, closing the earlier gap where any webhook
  event for a matching email + step type + provider could complete an
  unrelated stage (e.g. a different Cal.com booking for the same applicant).
- **Self-record access is blocked router-wide, not per-endpoint.**
  `app/api/prospect_privacy.py`'s `block_self_prospect_access` is installed as
  a router-level dependency (`membership_pipeline.py:95`,
  `APIRouter(dependencies=[Depends(block_self_prospect_access)])`), so a new
  `{prospect_id}` route added later inherits the guard without needing to
  remember it. It answers 404 (not 403) on a match, deliberately, so a 403
  doesn't confirm existence. `get_hidden_prospect_ids` (the list-filtering
  counterpart) is applied at all 8 endpoints that return multiple prospects
  or packages at once: `widget-summary`, `pipelines/{id}/kanban`,
  `pipelines/{id}/stats`, `source-events`, `prospects`, `prospects/bulk-advance`,
  `prospects/bulk-status`, and `election-packages` — confirmed by grep for
  `hidden_prospect_ids` across the endpoint file. The per-prospect
  `{prospect_id}/events` list route does not need it (and doesn't have it):
  it is already covered by the router-level `block_self_prospect_access`
  guard on its own `{prospect_id}` path parameter, same as every other
  by-id route.
- **LIKE search is escaped correctly.** The two `.ilike()` call sites in this
  service (`membership_pipeline_service.py:750-754`, name/email search, and
  `:2682`, a system-generated `"%probationary%"` lookup) both pass
  `escape=LIKE_ESCAPE_CHAR` from `app/utils/sql_search.py`, per Pitfall #25.
- **Prospect-id normalization in the self-access guard resists the
  case/format bypass.** `normalize_prospect_id`
  (`app/api/prospect_privacy.py:82`) routes both the stored id and the
  path-supplied id through `uuid.UUID()` before comparison, so re-casing or
  unhyphenating a caller's own id (MySQL's default collation is
  case-insensitive) cannot walk past the guard.

## Findings

No new findings this pass. Every finding from `docs/module-audit/membership-pipeline.md`
(MP-1 through MP-7) and `docs/app-review/membership-pipeline.md` (MP2-1
through MP2-5) is already ✅ FIXED, and the code added since that baseline
(PR #1811's closed-application gating and the earlier webhook
reference-matching fix) was independently reviewed against all seven
checklist dimensions above and found sound — including one issue (the
`TRANSFERRED` status-manipulation gap) that PR #1811 had already caught and
fixed via its own Codex review before this pass began. This finding is
recorded above under Verified good rather than re-reported as a new finding,
per the skill's re-verification rule.

The one still-open, previously-flagged item — MP-7 (a 409 conflict message on
`/prospects/check-existing` names an _archived_ member to the requester) — is
a product decision already mirrored in `docs/KNOWN_LIMITATIONS.md` and is not
re-litigated here.

## Schema & migration notes

No migrations touch this feature's tables since the last audit. `n/a`.

## Guard tests added

None. No code changed this iteration — verification only, against existing
tests (`test_rejected_prospect_dropped.py`, which already covers the
closed-application gating and the `TRANSFERRED` guard end-to-end, per PR
#1811 and its Codex-fix follow-up).

## Completion gate

No backend or frontend source changed this iteration (documentation only), so
the completion gate is not applicable in the sense of "does this change break
anything" — there is no diff to break. For the record, the module's own tests
(`backend/tests/test_rejected_prospect_dropped.py`,
`backend/tests/test_membership_pipeline*.py`) are exercised by CI on every
change to these files and were last green on PR #1811/`f5b1ae6a`.

| Check                       | Result                      |
| --------------------------- | --------------------------- |
| Code changes this iteration | none (findings + docs only) |
