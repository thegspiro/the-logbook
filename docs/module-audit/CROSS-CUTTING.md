# Module Audit — Cross-Cutting Findings

Patterns that recur across modules, aggregated here so a single fix can address
the whole class rather than one module at a time.

## XC-1 — Create/update paths don't validate referenced FK ids are in-org
**Seen in:** medical-screening (MS-3), apparatus (AP-1). Expected in more.

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
