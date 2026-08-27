# Security Review — Membership Pipeline

**Prefix:** `MP` · **Iteration:** 8 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2) · **PR:** [#1815](https://github.com/thegspiro/the-logbook/pull/1815) (pass 1), (this PR) (pass 2)

---

## Pass 2 (2026-08-27)

Scoped to the **full domain** since pass 1's merge commit (`aad49be4`,
PR #1815): `endpoints/membership_pipeline.py`, `services/membership_pipeline_service.py`,
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, every migration since (checked by content, not
filename, for anything touching prospect/pipeline/stage tables), and —
learning from ELEC-06/USR-07 pass 2's own correction — a `git diff --stat`
against `frontend/src/` broadly rather than only `modules/prospective-members/`,
which also caught `frontend/src/modules/membership/routes.tsx` and the new
`frontend/src/utils/membership.ts`, both outside that directory.

**Backend (2 files changed, both already reviewed):** `endpoints/membership_pipeline.py`
(+42/-1) and `services/membership_pipeline_service.py` (+37) both changed
only for the privilege-ceiling fix already made and Codex-reviewed earlier
in this same rotation, on PR #1931 (feature 02, permissions & roles pass 2)
— `transfer_prospect` resolves and validates the prospect before checking
the administrative-rank ceiling (avoiding a false CRITICAL on an invalid
prospect id), and `_do_transfer` refuses an administrative class paired with
a rank via `is_administrative(...)`, matching
`TestEveryWriterIsCovered.test_the_prospect_transfer_path_refuses_the_pair`
(verified during USR-07 pass 2). This is an INSERT path (a new `User` row
via prospect conversion) rather than an update-in-place, and the
`ProspectStatus.TRANSFERRED` guard already prevents a double-transfer race,
so it does not need the `populate_existing`/row-lock treatment the update
writers required — no finding.

**Migrations:** content-grepped (`prospect|membership_pipeline|pipeline_stage`,
case-insensitive) across every migration added since pass 1; the 3 hits are
all false positives — permission-string substring matches in unrelated,
already-reviewed storefront-grant-backfill migrations, not schema changes to
any membership-pipeline table.

**Frontend:** reviewed via a dedicated pass over the diff for `PipelineSettingsPage.tsx`
(527 L changed), `ProspectiveMembersPage.tsx` (237 L changed),
`ApplicantDetailDrawer.tsx`, `ConversionModal.tsx`, `StageConfigModal.tsx`,
`prospective-members/routes.tsx`, `services/api.ts`, `types/index.ts`, the
new `PipelineBuilder.test.tsx`, and the new `frontend/src/utils/membership.ts`
(the frontend counterpart to `backend/app/utils/membership.py`'s class/status
split, diffed line-by-line against it). Findings:

- Most of the diff is `DialogPortal` adoption on every fixed-position dialog
  shell — the established fix for the fixed-dialog-in-a-`backdrop-blur`
  defect (Pitfall #21 family) — structural only, no behavior change.
- `mapStageUpdateToBackend` used `?? undefined` on `inactivity_timeout_days`,
  collapsing an explicit `null` (clear a per-stage override) into an omitted
  key, which the backend's `exclude_unset=True` update path reads as "leave
  alone" — unticking a custom timeout silently failed to persist. Already
  fixed in this diff (forwards `null` verbatim) and covered by new tests in
  `stageMapping.test.ts`/`PipelineBuilder.test.tsx`; the create path
  correctly keeps `null → undefined` since no "leave alone" meaning exists
  on create. No further action.
- `DEFAULT_STAGE_CONFIGS` previously covered only 7 of 12 stage types,
  crashing the editor on a stored `checklist`/`reference_check`/
  `multi_approval`/`medical_screening`/`interview_requirement` stage.
  Already fixed in this diff (one canonical table shared by the editor and
  the read boundary) and covered by new tests. No further action.
- `frontend/src/utils/membership.ts` matches `app/utils/membership.py`'s
  `_SPLIT`/`is_administrative` exactly, including the no-guessing behavior
  for unknown/custom tiers; no label or comment misrepresents backend
  enforcement (the exact bug class `BallotBuilder.tsx` had in ELEC-06 pass 2
  — not repeated here).
- `ConversionModal` disables/clears the Rank input when "Administrative" is
  picked — client-side only, but confirmed backed by the same server-side
  refusal reviewed above (`_do_transfer`'s `is_administrative(...)` check),
  so this is defense-in-depth, not the actual gate.
- Module gating (`requiredModule`/`moduleLabel`) added to
  `prospective-members/routes.tsx` and a training-history route in
  `membership/routes.tsx`. Confirmed in `ProtectedRoute.tsx` that the module
  check runs strictly after the existing `requiredPermission`/`requiredRole`
  checks and is documented as a usability gate, not access control —
  additive, not a weakening.
- No stale-response race: neither page's diff added new fetch/`useEffect`
  logic (both are pure reindentation from the `DialogPortal` change).

No confirmed security findings. Completion gate: no code changes required
(the 2 backend files matched already-merged, already-reviewed work; the
frontend diff's actual bugs were already fixed and tested within the diff
itself), so no fresh test run was needed beyond what pass 1 and the earlier
PR #1931 review already covered. Rotation row 08 -> done.

---

## Pass 1 (2026-08-25)

**Backend:** `endpoints/membership_pipeline.py` (2,255 L, 51 routes), `services/membership_pipeline_service.py` (5,690 L), `models/membership_pipeline.py`, `schemas/membership_pipeline.py`, `api/prospect_privacy.py`
**Frontend:** `modules/prospective-members/` (not re-read in full this pass — see Scope)
**Migrations:** `20260812_0003_restore_active_prospect_uniqueness.py`, `20260814_0003_reconcile_active_prospect_emails.py` — reviewed this iteration, see Schema & migration notes

> **Revision note:** the pass as first drafted (below, unedited) concluded "no
> new findings." Codex's review of that draft found five real issues the
> conclusion had missed, and a sixth (a second, unguarded path to the same
> defect Codex's fourth finding covered) turned up while fixing the fourth.
> All six are recorded under Findings with what was actually done. The
> original draft's Scope, Route inventory and Verified good sections are left
> intact below except where a finding required a correction — the point of
> this note is that the "no defect" conclusion they supported was wrong, not
> that the legwork in them was.

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
- **Migrations correction:** the first draft of this pass claimed "no
  migrations touch this feature's tables since the last audit." False —
  `20260812_0003_restore_active_prospect_uniqueness.py` and
  `20260814_0003_reconcile_active_prospect_emails.py` both post-date the
  2026-08-09 baseline and alter `prospective_members` (email normalization,
  reconciling duplicate active rows to `inactive`, and installing the
  `uq_prospect_org_active_email` unique index). Both are now read in full —
  see Schema & migration notes.

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
only). This is intentional — see Verified good below — but its response shape
was not (MP-11, FIXED).

Every route also sits behind the router-level `block_self_prospect_access`
dependency (`membership_pipeline.py:95`), so a `{prospect_id}` route is
additionally checked against the caller's own record regardless of permission.
**Correction:** `PUT`/`DELETE /interviews/{interview_id}` carry no
`{prospect_id}` path parameter and were not actually covered by this — see
MP-12.

## Verified good ✅

- **`approve-step`'s missing permission gate is closed by a server-side role
  check, not client input.** `record_step_approval`
  (`membership_pipeline_service.py:1564`) accepts a client-supplied `role`,
  but the string only decides _which_ configured approver role is being
  claimed — it never authorizes anything by itself. `complete_step` routes
  every multi-approval submission through
  `_authorized_multi_approval_result` (`membership_pipeline_service.py:1422`),
  which re-queries the authenticated signer's own `User.positions` (in-org,
  active, not soft-deleted) and rejects any submitted role the signer does not
  actually hold (`"You may only approve for a role you currently hold"`,
  line 1477). A caller cannot claim a role they lack, and cannot claim to be
  someone else — `completed_by`/`signer_id` come from `current_user.id`, never
  from the request body. This claim was correct as far as it went — it is
  about _who may sign_, not about _what the caller gets back_ for signing,
  which is a separate question the first draft conflated with this one and
  answered wrong. See MP-11.
- **Closed-application gating (PR #1811) is applied everywhere a closed
  applicant could otherwise re-enter workflow.** `_assert_open`
  (`membership_pipeline_service.py:133`) is called from
  `create_election_package` (line 4486), `assign_package_to_election`
  (line 4703), and `create_interview` (line 5235) — the three actions the
  commit identifies as consequential (a ballot package, assigning it to an
  election, and a fresh interview against a closed file). `_apply_status_change`
  (line 2156) is the single write path both the single-record and bulk status
  endpoints go through, and it explicitly refuses to set or clear
  `TRANSFERRED` (lines 2180–2188) — closing the P1 Codex found on the PR
  itself (setting `transferred` via status-change bypassed
  `transfer_prospect`'s User-creation side effects; clearing it would return
  an existing member to the applicant board under the active-email unique
  index).
- **The webhook stage-auto-completion path
  (`complete_current_step_for_integration_event`,
  `membership_pipeline_service.py:1861`) is org-scoped and reference-matched.**
  The prospect query filters `organization_id == organization_id` and
  `status == ACTIVE` (lines 1897–1898) before any email match is attempted, so
  a webhook cannot complete a stage for a prospect in a different
  organization even given a colliding email. The 2026-08-17 fix
  (`e1f6ea46`) added the `event_reference`/`reference_config_key` match
  (lines 1924–1931): the step's own configured booking URL / template id must
  match the inbound webhook event, closing the earlier gap where any webhook
  event for a matching email + step type + provider could complete an
  unrelated stage (e.g. a different Cal.com booking for the same applicant).
- **Self-record access is blocked router-wide for every route that carries a
  `{prospect_id}` path parameter — but that claim, as first drafted, silently
  assumed every by-id route in this router carries one.** It doesn't: see
  MP-12. `app/api/prospect_privacy.py`'s `block_self_prospect_access` is
  installed as a router-level dependency (`membership_pipeline.py:95`,
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
  `:2708`, a system-generated `"%probationary%"` lookup) both pass
  `escape=LIKE_ESCAPE_CHAR` from `app/utils/sql_search.py`, per Pitfall #25.
- **Prospect-id normalization in the self-access guard resists the
  case/format bypass.** `normalize_prospect_id`
  (`app/api/prospect_privacy.py:82`) routes both the stored id and the
  path-supplied id through `uuid.UUID()` before comparison, so re-casing or
  unhyphenating a caller's own id (MySQL's default collation is
  case-insensitive) cannot walk past the guard.

## Findings

Six, all from the code this pass's own draft had just called sound. Five were
caught by Codex's review of that draft; the sixth turned up while fixing the
fourth. All are fixed except the one flagged.

### MP-8 — MED — `update_prospect` silently dropped explicit nulls — ✅ FIXED

**What:** the generic setattr loop used `if value is not None and
hasattr(prospect, key):` to decide whether to write a field. The endpoint
builds `data` via `ProspectUpdate.model_dump(exclude_unset=True)`, so a key
present in `data` was explicitly sent by the caller — an explicit `null`
means "clear this field," per CLAUDE.md Pitfall #1. The old guard treated it
identically to an omitted key and silently kept the old value.
**Where:** `membership_pipeline_service.py:1165` (`update_prospect`).
**Failure scenario:** `PUT /prospects/{id}` with `{"referred_by": null}` (or
`phone`, `date_of_birth`, `address_street`, ...) returns 200. The coordinator
believes the referral was cleared; the stale `referred_by` — a client-supplied
FK — survives, including into a later `transfer_prospect` copy onto the new
User row.
**Impact:** silent data-integrity loss on every nullable field this update
endpoint owns; low severity per-field, but it is the exact class of bug
CLAUDE.md calls the project's most common.
**Fix:** rewrote `update_prospect` to use the repository's `apply_updates`
helper (`app/utils/model_updates.py`), already the pattern for pipeline and
step updates in this same service. It writes an explicit null as a clear, and
raises `ValueError` → 400 (instead of a silent no-op) when the null targets a
`NOT NULL` column (e.g. `email`, `status`) rather than accepting an update
that didn't do what it said. Old values are captured before the write so the
existing `prospect_updated` activity-log diff (including the MP-6
sensitive-field masking for DOB/address) is unchanged.

### MP-9 — HIGH — a second, unguarded path to set or clear `TRANSFERRED` — ✅ FIXED

**What:** discovered while fixing MP-8. `ProspectUpdate` includes `status`,
and the old `update_prospect` loop wrote it with the same bare `setattr` as
every other field — it never routed through `_apply_status_change`, so it
carried none of that function's guards, including the one PR #1811's own
Codex review added (P1: `TRANSFERRED` is derived by `transfer_prospect` and
must not be set or cleared through a status change). The dedicated status
endpoints (`/prospects/{id}/status`, `/prospects/bulk-status`) were fixed;
the older, still-live `PUT /prospects/{id}` was not.
**Where:** `membership_pipeline_service.py:1165` (`update_prospect`); the
frontend still sends `status` through this endpoint's payload for some edit
paths (`modules/prospective-members/services/api.ts:744,1098`).
**Failure scenario:** `PUT /prospects/{id}` with `{"status": "transferred"}`
marks an applicant a member with no `transfer_prospect` run — no User row, no
`transferred_user_id`/`transferred_at` stamped — while counting as a
conversion in the stats. The mirror case is worse: `PUT` with
`{"status": "active"}` against a prospect already `TRANSFERRED` returns an
existing member to the applicant board, racing the
`uq_prospect_org_active_email` unique index against their own active-email
prospect record from before they transferred.
**Impact:** the exact state-corruption / membership-integrity issue Codex's
P1 on #1811 was written to close, reachable through a route that predates
that fix and was never touched by it.
**Fix:** `update_prospect` now parses a submitted `status` and refuses it,
with the same message as `_apply_status_change`, when either the target or
the prospect's current status is `TRANSFERRED`. An ordinary status edit
(e.g. `active` → `on_hold`) through this endpoint is unaffected.

### MP-10 — MED — unbounded election-package list and creation — 🚩 FLAGGED

**What:** `list_election_packages` (`membership_pipeline_service.py:4638`)
runs `result.scalars().all()` with no `limit`/pagination, and
`create_election_package` (`:4468`) has no per-prospect or per-organization
cap — no unique constraint on `ProspectElectionPackage.prospect_id`, and no
"already has a ready package" check. Every `POST
/prospects/{id}/election-package` call inserts a new row; the doc snapshot
each carries (documents, coordinator notes, config) persists indefinitely.
**Where:** `membership_pipeline_service.py:4638` (list),
`membership_pipeline_service.py:4468` (create).
**Failure scenario:** repeated legitimate package regeneration (e.g. after
editing coordinator notes) for even one applicant accumulates rows without
bound; `GET /election-packages` — the list an election officer assembles a
ballot from — grows in lockstep, along with the PII-carrying snapshots each
row holds.
**Impact:** same class already tracked elsewhere in this rotation (FIN-9,
ELEC-12, USR-5) — unbounded accumulation of PII-carrying rows and an
ever-growing scan on a route with no natural ceiling.
**Fix:** not applied. Enforcing one ready package per prospect is a behavior
change (could break an intended "regenerate before the vote" flow); adding
pagination to `GET /election-packages` is a response-envelope/API-contract
change for the frontend, same as the other three unbounded-list items this
rotation has flagged rather than fixed. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### MP-11 — HIGH — `/approve-step` returned full prospect PII to a caller with no view permission — ✅ FIXED

**What:** the endpoint authorizes a caller by the role they hold on a
multi-approval stage (`_authorized_multi_approval_result`, see Verified
good) — deliberately not gated by `prospective_members.view`, since a stage's
approver roles (chief, president, ...) are rarely held by anyone with view
access. It nonetheless returned the full `ProspectResponse` — DOB, full
address, phone, `interest_reason`, `notes` (coordinator commentary),
`step_progress` — as the HTTP response body.
**Where:** `membership_pipeline.py:1152` (`response_model=ProspectResponse`,
`return prospect`).
**Failure scenario:** a member holding only a stage's configured office
(e.g. Fire Chief), with no `prospective_members.*` permission at all, submits
their one authorized sign-off and receives the applicant's full confidential
file in the response — everything the role check was designed to keep out of
their hands, as a side effect of an action the role check correctly let them
take.
**Impact:** PII/PHI-adjacent exposure to a caller class this router
specifically does not extend view access to.
**Fix:** added `StepApprovalResponse` (`schemas/membership_pipeline.py`) — a
minimal `{prospect_id, step_id, step_completed}` result — and changed the
route's `response_model` to it. `step_completed` is derived from the
returned prospect's own `step_progress` row for the submitted step
(`status == COMPLETED`), not re-derived business logic. No frontend consumes
this endpoint (checked — no match for `approve-step` anywhere under
`frontend/src/modules/prospective-members` or elsewhere), so the response
shape change has no caller to break.

### MP-12 — HIGH — `PUT`/`DELETE /interviews/{interview_id}` bypassed the self-access guard — ✅ FIXED

**What:** `block_self_prospect_access` is keyed on
`request.path_params.get("prospect_id")`. The two interview-mutation routes
are registered at `/interviews/{interview_id}` — no `{prospect_id}` in their
path — so the guard's lookup always returns `None` and the dependency no-ops
for them. `delete_interview` (`membership_pipeline_service.py:5368`) resolves
purely by `interview_id` + `organization_id`, with no check against who the
interview is about.
**Where:** `membership_pipeline.py:2139` (`update_interview` decorator),
`membership_pipeline.py:2174` (`delete_interview` decorator).
**Failure scenario:** a caller who holds `prospective_members.manage` — a
coordinator role a former applicant can hold once transferred to membership —
knows or guesses the id of an interview filed against their own past
application, and calls `DELETE /interviews/{id}` (no identity check on the
service side at all) or, if they happen to be the recorded interviewer,
`PUT` to alter it. This is exactly the class of self-access the router-level
guard exists to close everywhere else in this feature.
**Impact:** an applicant-turned-coordinator can destroy or alter the record
of their own vetting.
**Fix:** added `block_self_interview_access`
(`app/api/prospect_privacy.py`) — resolves `interview_id` to its owning
`ProspectiveMember` via a join and applies the same `self_prospect_predicate`
check as the router-level guard, answering 404 (not 403) on a match, for the
same reason. Wired as a per-route `dependencies=[...]` on both interview
mutation routes, since they sit outside the router-level guard's path-param
assumption.

## Schema & migration notes

`20260812_0003_restore_active_prospect_uniqueness.py` and
`20260814_0003_reconcile_active_prospect_emails.py` (both post-dating the
2026-08-09 baseline, per Codex — see Scope) were read in full this pass. Both
are org-scoped throughout (`keeper.organization_id = duplicate.organization_id`
in the dedup `UPDATE`, and the unique index itself is on
`(organization_id, active_email)`, not a bare `email` uniqueness that would
leak across tenants), both guard on `prospective_members` existing before
touching it (Pitfall #26), and both are textually-identical copies of the
same repair by design (`20260812_0003`'s own comment explains why: it runs
_before_ `20260814_0003` in the chain, so a fresh install with legacy
duplicate active emails would fail inside `op.create_index` and never reach
the later revision's cleanup without its own copy). No defect found in
either; this is a scope correction to the first draft, not a new finding.

No other migrations touch this feature's tables since the last audit.

## Guard tests added

- `backend/tests/test_rejected_prospect_dropped.py` —
  `TestGenericUpdateStatusGuard` (MP-9: `update_prospect` refuses to set or
  clear `TRANSFERRED`, and an ordinary status edit through the same endpoint
  still works) and `TestGenericUpdateExplicitNull` (MP-8: an explicit null
  clears `referred_by`/`phone`, and an explicit null against the `NOT NULL`
  `email` column is a 400, not a silent no-op).
- `backend/tests/test_prospect_self_access.py` — `TestInterviewRouteGuard`
  (MP-12: the guard is registered on both interview routes; a caller's own
  interview is 404 on `PUT`/`DELETE` while another applicant's is editable).
- `backend/tests/test_approve_step_response.py` (new file, MP-11): the
  response body from a successful approval contains exactly `{prospect_id,
step_id, step_completed}` — no prospect PII field, checked both by key-set
  and by asserting applicant-identifying strings are absent from the raw
  response body — for both a stage-completing approval and a partial one.

## Completion gate

| Check                                                       | Result                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `flake8` (touched files)                                    | pass                                                |
| `black --check` (touched files)                             | 2 files needed reformatting, applied, re-check pass |
| `isort --check-only` (touched files)                        | pass                                                |
| `python3 scripts/validate_migrations.py --strict`           | pass (357 migrations, single head)                  |
| `pytest` — full membership-pipeline test surface (17 files) | 228 passed                                          |
| `pytest tests/test_pii_exposure.py`                         | 37 passed                                           |
| `npx tsc --noEmit`                                          | pass (no frontend files changed)                    |

Test files run: `test_rejected_prospect_dropped.py`, `test_prospect_self_access.py`,
`test_approve_step_response.py`, `test_membership_pipeline_service.py`,
`test_multi_approval_accumulation.py`, `test_prospect_bulk_actions.py`,
`test_membership_pipeline_flow.py`, `test_membership_pipeline_enum_validation.py`,
`test_active_prospect_uniqueness.py`, `test_pipeline_stage_auto_advance.py`,
`test_pipeline_widget_privacy.py`, `test_prospect_create_privacy.py`,
`test_prospect_duplicate_response.py`, `test_prospect_event_source.py`,
`test_prospect_fields.py`, `test_prospect_pipeline_scaling.py`,
`test_prospect_stage_movement.py` — every file under `backend/tests/` whose
name matches `membership`, `prospect`, or `pipeline`, run in full rather than
filtered by `-k`, per this rotation's standing practice of not trusting a
keyword filter's apparent match.
