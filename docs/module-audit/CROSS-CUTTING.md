# Module Audit — Cross-Cutting Findings

Patterns that recur across modules, aggregated here so a single fix can address
the whole class rather than one module at a time.

## XC-1 — Create/update paths don't validate referenced FK ids are in-org
**Seen in:** medical-screening (MS-3), apparatus (AP-1), inventory (INV-3,
INV-4 — the largest cluster: ~15 create/update methods across the service and
endpoints), facilities (FAC-3 — create_photo/document facility_id, maintenance
system_id, access-key assigned_to_user_id, plus update-path re-validation gaps),
elections (ELEC-7 — candidate `user_id`), meetings/minutes (MM-4 — `event_id`,
action-item `assignee_id`, bulk-meeting attendee `user_id` / `assigned_to`; and
MM-1, the one instance where the unvalidated FK caused an actual **cross-org
disclosure** — a foreign `template_id` leaked another org's template config, now
fixed in-place). Now confirmed in **every module audited so far** — this is the
dominant cross-cutting pattern.

## XC-3 — Admin by-id writes scoped only by permission, not by org (IDOR)
**Seen in:** elections (ELEC-2 — `update_candidate`/`delete_candidate` fetched
the target by `(id, election_id)` path params with no `organization_id` filter;
`require_permission` only asserts the permission in the caller's *own* org).
Distinct from XC-1: this is a live cross-tenant **write/delete**, not just a
stored dangling FK. Also seen in equipment-check (EC-4 — `clone_template`
looked up the target apparatus by id with no org filter and attached the clone
to it) and, most severely, EC-1 (a client-supplied `apparatus_id` on a
standalone check mutated another org's `has_deficiency` safety flag). Fixed
in-place each time by org-scoping the target lookup. **Action:** when auditing
remaining modules, specifically check that every `manage`-gated update/delete —
and every helper that mutates a row fetched by a client-supplied id — resolves
its target through an org-scoped fetch; permission checks alone do not scope the
object.

Many create endpoints set `organization_id` from `current_user` (correct) but
accept client-supplied foreign-key ids (`user_id`, `prospect_id`,
`requirement_id`, `apparatus_id`, …) without verifying those referenced rows
belong to the caller's organization. Impact is low individually (children are
org-scoped, so it's mis-attribution / orphan rows, not cross-tenant disclosure),
but it's a consistent gap.

**Escalated impact seen in forms (FORM-1/FORM-2):** the forms *integration
processors* trusted submitter-supplied FK ids (`member_id`/`item_id`/`event_id`)
and drove **cross-module writes** — assigning an in-org item to a foreign user,
and creating an RSVP against a foreign org's event. So this pattern is not always
"just a dangling FK": when the unvalidated id feeds a downstream write, it's a
live cross-tenant write. Fixed in-place with a local `_entity_in_org` helper.

**Recommended fix (one place, many callers):** a shared async helper, e.g.
`await assert_in_org(db, Model, id, organization_id)` that 404/400s when the
referenced row is missing or out-of-org, used by create/update service methods.
The forms `_entity_in_org` (forms_service.py) is a working local instance of
exactly this — promote it to a shared util. Roll out per-module with tests.

## XC-2 — Sensitive reads gated by a permission broader than intended
**Seen in:** membership-pipeline (MP-1 — applicant PII / background-check
document downloads reachable with generic `members.view` roster permission —
**✅ FIXED**: the applicant/pipeline routes now require
`prospective_members.view/.manage`, and the election-package routes require
those or `elections.view/.manage`; `members.view` removed), meetings/minutes
(MM-3 — draft/executive minutes readable by any `minutes.view` holder — **✅
FIXED**: reads now return only approved, non-executive minutes to callers without
`minutes.manage`), documents (DOC-4 — summary aggregates ignore the folder ACL —
still open). Pattern: a `.view`-style read is gated by a permission held by
rank-and-file when the data warrants a narrower gate. Two fix shapes seen: (a)
the broad permission is *dead over-permission* because the frontend already gates
tighter, so removing it is safe (MP-1); (b) the read genuinely needs a
status/type gate keyed on the existing `.manage` permission (MM-3). **Action:**
for each module, confirm the intended audience of sensitive reads vs the
permission required; DOC-4 remains an open decision.
