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

**Recommended fix (one place, many callers):** a shared async helper, e.g.
`await assert_in_org(db, Model, id, organization_id)` that 404/400s when the
referenced row is missing or out-of-org, used by create/update service methods.
Roll out per-module with tests. Not auto-applied — behavior change.

## XC-2 — (reserved) add further recurring patterns here as they surface.
