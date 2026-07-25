# Module Audit — Membership Pipeline (Prospective Members)

**Files:** `app/api/v1/endpoints/membership_pipeline.py` (1,763 L, 44 endpoints),
`app/api/v1/endpoints/member_status.py` (911 L, 12 endpoints),
`app/api/v1/endpoints/member_leaves.py` (251 L, 6 endpoints),
`app/services/membership_pipeline_service.py` (4,236 L),
`app/services/member_leave_service.py`, models. Frontend
`modules/prospective-members`. Handles **sensitive applicant PII** (DOB,
address, background checks, IDs).
**Audited:** iteration 9.

## Verified good ✅
- **Auth coverage:** all 62 endpoints authenticated.
- **Tenant isolation is solid.** Every by-id read/write (prospect, pipeline,
  step, document, note/activity, interview, reference, election package, event
  link, leave, status change) is org-scoped or resolved through an org-scoped
  parent. `member_status.py` re-loads each target `User` with
  `organization_id == current_user.organization_id`. **XC-3 does NOT occur here.**
- **File handling is a model implementation:** upload uses magic-byte MIME
  validation + MIME-derived extension + UUID filename (no traversal / no
  double-extension); download is org-scoped (`get_prospect_documents`) and has a
  correct `realpath` + `startswith(base + os.sep)` traversal guard + existence
  check.
- **prospect→member conversion** (`_do_transfer`) copies within
  `prospect.organization_id`, validates role_ids/`member` role against the org,
  org-scopes username/email/membership-id generation — no cross-org leakage.
- **Search LIKE escaped; no raw SQL; flake8 clean; no TODO/FIXME.**

## Findings

### MP-1 — HIGH — Applicant PII / background-check downloads reachable with generic `members.view` — ✅ FIXED
All 13 prospect **read** routes (list, detail, documents list, **document
download**, interviews list, activity, election-package) gated on
`require_permission("members.view", "prospective_members.view",
"prospective_members.manage")` — OR logic, so `members.view` (the generic "View
member list" permission typically granted to rank-and-file members) alone
sufficed. Effect: any member with roster-view could **download applicants'
background checks and IDs** and read DOB/home address by calling the API
directly.
**Investigation before fixing:** the frontend already gates the entire
prospective-members module on `prospective_members.view`/`.manage`
(`modules/prospective-members/routes.tsx`), so no legitimate UI flow reached
these endpoints with only `members.view` — the grant was dead over-permission
that only widened the raw API. The one cross-module consumer is the
ElectionDetailPage (gated on `elections.*`), which reads pending **election
packages** via `list_election_packages`.
**Fix:**
- The 11 applicant-PII and pipeline routes (prospects list/detail, documents
  list, **document download**, activity, interviews, kanban, and the
  pipeline/steps/stats reads) now require `prospective_members.view`/`.manage`;
  `members.view` removed.
- The 2 election-package routes (`get_election_package`,
  `list_election_packages`) now require `prospective_members.view`/`.manage`
  **or** `elections.view`/`.manage`, preserving the election-officer workflow
  while dropping the generic `members.view`.
- Stale `Requires permission: members.view` docstrings corrected.
No frontend change needed (it already required `prospective_members.view`).

### MP-2 — MEDIUM — `create_prospect` stored an unvalidated `pipeline_id` (cross-org config leak) — ✅ FIXED
A client-supplied `pipeline_id` was used to seed `current_step_id` and
`step_progress` from that pipeline's steps and stored on the prospect, with no
org check. Because `get_prospect` eager-loads `current_step`/`step_progress` and
the response serializes step name/description/**config**, passing a foreign
pipeline UUID leaked another org's step config back to the caller (and corrupted
the prospect with cross-org step refs). Exploit needs a valid foreign UUID
(unguessable), capping severity.
**Fix:** validate a client-supplied `pipeline_id` via the org-scoped
`get_pipeline`; reject with `ValueError` (→ 400) when it isn't in the org.

### MP-3 — LOW/MED — `create_leave` didn't validate `user_id` is in-org — ✅ FIXED
`create_leave` wrote a `MemberLeaveOfAbsence` (and an auto-created
`TrainingWaiver`) using a client-supplied `user_id` with only `organization_id`
from `current_user`, so a `members.manage` user could create leave/waiver rows
referencing a foreign `user_id`. (All reads are org+user scoped, so the other
org was unaffected — junk cross-org FK in the caller's own tenant.)
**Fix:** validate the target user belongs to the caller's org before insert
(reject with `ValueError` → 400).

### MP-4 — LOW — `PATCH /leaves-of-absence/{id}` skipped start/end date-order validation — ✅ FIXED
The create path enforced `end_date >= start_date`; the update path did not, so an
inverted range could be persisted.
**Fix:** validate date order on the resulting record in `update_leave` (and
surfaced both leave `ValueError`s as clean 400s in the endpoints, which
previously didn't catch them).

### MP-5 — LOW — Other create paths store client ids without org validation (XC-1, integrity only)
`create_election_package` (`pipeline_id`/`step_id`), `create_interview`
(`step_id`), and `complete_step` (writes a `ProspectStepProgress` even when the
`step_id` isn't in the prospect's pipeline) store client ids unvalidated. All
resolve the prospect org-scoped first, so no cross-org disclosure — dangling-FK /
integrity risk only. **Status:** flagged (XC-1).

### MP-6 — LOW — Sensitive PII persisted in the activity log / audit trail
`update_prospect` records old→new values of every changed field (incl.
`date_of_birth`, `address_*`) into `ProspectActivityLog.details`, which
`GET /prospects/{id}/activity` returns (compounds MP-1). `create_prospect` also
logs the applicant email into the audit event. Same-org, but sensitive fields
land in logs. **Status:** flagged.

### MP-7 — LOW — Inconsistent PII disclosure on the two "existing member" paths
`POST /prospects/check-existing` deliberately strips name/email/user_id (returns
only `status`+`match_type`), but `POST /prospects` returns the full archived
member match — name, email, `user_id` — in the 409 body. Contradicts the
sibling endpoint's stated intent. **Status:** flagged.

## Notes
- Status-token public flow (`get_prospect_by_token`) gates on
  `public_status_enabled`, enforces a 30-day TTL, and returns only public-safe
  fields — but lives in `app/api/public/portal.py` (iteration #26).
- No attribute/column mismatches; leave overlap + `count_leave_months` math
  (incl. permanent-leave `end_date IS NULL`) verified correct.
