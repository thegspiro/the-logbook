# Scoping: a static sweep for CLAUDE.md pitfall #14

**Date:** 2026-09-06
**Question:** can org-scoping of by-id queries be enforced by a test, the way
`test_like_escaping.py` and `test_csv_writer_sweep.py` enforce their rules?
**Answer:** no — not as a hand-rolled AST test, and not with Semgrep taint
mode either, which was tried and is recorded in §4. As a **baseline ratchet**,
yes, and that is what is recommended.

Pitfall #14 is the dominant finding class in the 2026-07 module audit and the
only rule in the backend with both the highest severity and no machine check.
Everything below was measured against the working tree, not estimated.

---

## 1. What the rule actually requires

Two shapes are legal, and any detector has to accept both:

1. **The model carries `organization_id`** → the query filters it.
2. **The model does not** → the row is resolved through a parent that was
   already org-scoped, and constrained by its parent FK.

215 of the 263 mapped models carry `organization_id`. **48 do not** —
`Candidate`, `FormField`, `ApprovalChainStep`, `GrantExpenditure`, `Motion`,
`CheckTemplateItem` and others — and for those, shape 1 is not merely
discouraged, it is impossible: the column does not exist. A sweep that demands
an org filter would be demanding code that raises `AttributeError`.

`Organization` itself is a third case: it is the tenant root, so
`Organization.id == org_id` is correct with no further filter. It accounts for
9 of the unfiltered hits below.

---

## 2. Measurement

Over `backend/app/`, counting statements containing a `select(...)` and a
`Model.id == …` comparison:

Produced twice, by two implementations that extract statement source differently
(`ast.get_source_segment` and line slicing). They agree on every figure below,
so these are not one script's artefact.

|                                                      |   Count |   Share |
| ---------------------------------------------------- | ------: | ------: |
| **By-id select statements**                          | **975** |    100% |
| …that filter `organization_id` in the same statement |     757 | **78%** |
| …that do not                                         |     218 |     22% |

Splitting the 218:

| Group                       | Count | Meaning                                       |
| --------------------------- | ----: | --------------------------------------------- |
| Model has `organization_id` |   171 | The candidate findings                        |
| Model has no such column    |    39 | Must use shape 2; 9 are `Organization` itself |
| Name is not a mapped model  |     8 | Detector noise                                |

And splitting the 171 by where the compared id comes from:

| Right-hand side                                           | Count | Share |
| --------------------------------------------------------- | ----: | ----: |
| Read off another object (`rsvp.user_id`, `entry.user_id`) |   117 |   68% |
| A parameter of the enclosing function                     |    43 |   25% |
| A local variable                                          |    11 |    6% |

The 43 break down as 33 in `app/services/`, 7 in `app/api/v1/`, and 3 in
`app/api/public/` (webhooks, which have no caller org by construction).

---

## 3. Why a precise detector is not tractable

Every sampled hit read in full turned out to be a false positive, and they
fail for **four different reasons**. That variety is the finding: there is no
single refinement that removes them.

| #   | Class                                  | Example                                                                         | Why it is fine                                                                                                          |
| --- | -------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | Re-fetch of an already-resolved row    | `api/v1/endpoints/auth.py:158` — `User.id == user.id`                           | `user` is the authenticated principal. The id is not client-supplied at all.                                            |
| 2   | Id derived from an org-scoped result   | `api/v1/endpoints/events.py:1894` — `User.id == rsvp.user_id`                   | `rsvp` came back from `check_in_attendee(..., organization_id=...)` three lines above.                                  |
| 3   | Id read off an already-resolved parent | `api/v1/endpoints/event_requests.py:418` — `Event.id == event_request.event_id` | `event_request` was fetched in-org earlier in the handler.                                                              |
| 4   | Re-fetch after an org-scoped mutation  | `api/v1/endpoints/inventory.py:5764`, `api/v1/endpoints/users.py:1021`          | The write validated the org; this is the re-read **CLAUDE.md pitfall #11 requires**, serialising what was just written. |

Class 4 is worth dwelling on: pitfall #11 mandates re-fetching the full record
after a create or update, and that mandated re-fetch is, syntactically, an
unscoped by-id query. Two of this repository's own rules produce the shape a
naive detector flags.

Distinguishing any of these from a real IDOR needs intra-procedural dataflow
plus a notion of "this id has already been validated in-org" that can cross a
service-call boundary. That is an order of magnitude beyond
`test_csv_writer_sweep.py`, and the failure mode is predictable: a noisy
detector gets an allowlist, the allowlist grows, and the guard stops guarding.

**Precision is also not where the value is.** 78% of by-id queries already
scope. The rule is largely obeyed; what is missing is something that stops the
next violation, not something that re-litigates 975 existing sites.

---

## 4. Options

### A. Precise sweep — not recommended

Full dataflow. Highest cost, and the one most likely to end up allowlisted
into uselessness. Rejected on the evidence in §3.

### B. Baseline ratchet — **recommended, and built 2026-09-06**

Enumerate today's unscoped sites into a checked-in baseline. Fail on any site
**not** in it, and fail on a baselined site that no longer flags, so the list
can only shrink.

The repository already does this twice, so it is an idiom here rather than a
new mechanism:

- `test_endpoint_auth_coverage.py` carries `ALLOWLISTED_PUBLIC`, "adding to
  this set is a deliberate security decision".
- The screenshot audit runs against `scripts/screenshots/audit_baseline.txt`:
  39 known findings tolerated, new ones fail, **and a baselined image that no
  longer flags fails too — deliberately, so the list shrinks rather than
  growing into a blanket suppression.**

Applied here that gives, from day one: no new unscoped by-id query can land
without someone writing a line into the baseline with a reason. That is the
protection the rule needs and does not have.

### A′. Semgrep taint mode — **spike run 2026-09-06; it does not work**

_Proposed and then tested. Recorded in full because the negative result is
reusable: it rules out a whole tool class for this rule, for a reason that also
predicts the paid tier will not rescue it._

Semgrep 1.176.1, OSS engine. The rule reached a working state — sources are
route-handler parameters without a `Depends(...)` default, the sink is
`$DB.execute($CHAIN)` where the chain compares `$M.id` and carries no
`organization_id`. On `app/api/v1/endpoints/elections.py` it cut 15 raw matches
to 2. Then it was run over the whole API surface.

**All three acceptance criteria failed.**

| Test                                                           | Result                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. The four §3 false-positive classes go quiet                 | **Fail.** 51 of 64 findings are exactly those classes.                                                                 |
| 2. The `Candidate` parent-resolved shape is recognised as safe | **Fail.** `elections.py:2074` and `:2138` — the two correctly-written sites — are flagged.                             |
| 3. Interprocedural reach into a service method                 | **Fail.** Zero findings in `app/services/`. Sources are declared in endpoint files and OSS taint does not cross files. |

#### Why test 1 failed — the part worth keeping

The hypothesis was that the four classes are "ids that never touch a source".
That is wrong, and the reason is structural:

```python
rsvp = await service.check_in_attendee(
    event_id=event_id, user_id=body.user_id,
    organization_id=current_user.organization_id,   # <- this is the safety
)
r = await db.execute(select(User).where(User.id == rsvp.user_id))
```

`body.user_id` is a source. Taint mode propagates taint from a call's
arguments to its **return value**, so `rsvp` is tainted, so `rsvp.user_id` is
tainted, and the query is reported. **The org-scoping call — the very thing
that makes the code safe — is modelled as a propagator, not a sanitizer.**

Declaring it as one does not help. `pattern-sanitizers` was added for
`$S.$M(..., organization_id=..., ...)` and for the `await`-wrapped form, and
for `assert_in_org` / `assert_all_in_org`. Findings went 64 → 64, unchanged, on
both the full run and an isolated probe: sanitizing the call expression does
not break a taint path that arrives through the arguments.

**This also predicts that Semgrep Pro would make it worse, not better.** Pro
buys cross-file taint, which is test 3 — but more reach means the same
propagation through _more_ service calls, so class B grows. The defect is in
how the rule must model org-scoping, not in how far the engine can see. Paying
for the engine does not buy a different model.

#### What the spike is worth keeping

Restricting to sinks whose compared id is a **bare route parameter** — not read
off any object — gives **11 findings across the whole API surface**, of which 2
are the known-good `Candidate` sites and 1 is a JWT `payload["sub"]`. That
leaves roughly 8 worth a human eye, in `equipment_check.py`, `inventory.py` and
`users.py`.

That is option C, automated, and it is a genuinely useful triage tool. It is
**not** a gate: it sees nothing in `app/services/`, where 33 of the 43
parameter-fed sites live.

The rule is not checked in. A rule file with no job running it is a config
switch with no reader (pitfall #19) — write the file when the job is written.

```yaml
rules:
  - id: unscoped-by-id-query
    languages: [python]
    severity: ERROR
    mode: taint
    message: A client-supplied id reaches a by-id query with no organization_id filter.
    pattern-sources:
      - patterns:
          - pattern-inside: |
              @$R.$METHOD(...)
              async def $F(..., $P: $T, ...):
                  ...
          - pattern: $P
          - pattern-not-inside: |
              async def $F(..., $P: $T = Depends(...), ...):
                  ...
    pattern-sinks:
      - patterns:
          - pattern: $DB.execute($CHAIN)
          - metavariable-pattern:
              metavariable: $CHAIN
              pattern: <... $M.id == ... ...>
          # A regex, not pattern-not: inside metavariable-pattern a pattern-not
          # narrows to the id sub-expression and never sees a trailing
          # .where(organization_id ...), so it excludes nothing.
          - metavariable-regex:
              metavariable: $CHAIN
              regex: (?s)^(?!.*organization_id)(?!.*select\(Organization\)).*$
```

**Cost, for the record:** 3m21s for this one rule over `app/api/`, 3m27s over
`app/`. Their CI already has a `backend-security` job, so that is affordable —
but not for a rule that is 80% false positives.

#### One more adoption cost, found the hard way

`pip install semgrep` into the backend environment **downgrades `mcp` from the
pinned 2.1.1 to 1.29.0** — semgrep depends on `mcp`, and the older version has
no `mcp.server.mcpserver`, which `app/mcp/server.py` and `app/mcp/registry.py`
both import. Four tests in `test_module_api_gating.py` start failing with
`ModuleNotFoundError`, and they fail in a way that reads as a pre-existing
repository defect rather than as environment damage.

Anyone adopting Semgrep here must install it somewhere isolated — its own
virtualenv, or the pinned GitHub Action — never alongside `requirements.txt`.

#### Verdict

Option B. The ratchet is what ships.

**Built:** `backend/tests/test_org_scoping_ratchet.py` plus
`backend/tests/org_scoping_baseline.txt` — **47 entries across 27 files** as
built, the bare-name ids on org-bearing models. (46 since `set_user_roles` was
scoped; the list may only shrink, so a count below 47 is the ratchet working
rather than an entry going missing.) It runs in the ordinary backend suite, in
about 6 seconds, needing no CI change.

Verified by mutation in both directions: adding an unscoped query fails
`test_no_new_unscoped_by_id_query` naming the key; adding an org filter to a
baselined query fails `test_baseline_has_no_stale_entries`, so the list can
only shrink. A third check confirms a line shift above a query leaves the
baseline untouched — the key is `path::function::Model::id`, with no line
number, because otherwise an edit anywhere above a query rewrites the baseline
and hides a real change inside the churn.

The baseline says "this existed on 2026-09-06", not "this is safe" — most
entries have never been read, and the file says so at the top. Three files are
annotated with a verified reason (the public webhooks, where no caller org
exists) and one with a partial reading (`users.py`, re-fetch after an
org-scoped write). Everything else is marked _not yet reviewed_, so presence
cannot be mistaken for a judgement.

### C. Narrow high-signal sweep — recommended as the triage order, not as the gate

The 43 parameter-fed hits are the only group where a client-supplied id can
reach the query without passing through something already resolved. Reviewing
those 43 by hand is a bounded, worthwhile piece of work independent of any
test — and it is the right order to burn down the baseline in.

---

## 4a. First burn-down pass — 8 sites read, 0 defects

Read 2026-09-06: the parameter-fed sites the Semgrep spike surfaced, being the
group where a client-supplied id can reach a query without passing through
something already resolved.

| Site                                                                                                                           | Verdict                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `equipment_check.py:633` `add_item`                                                                                            | Safe. `service.add_item(compartment_id, org, …)` runs first and the handler 404s if it returns nothing, so the id is validated. `CheckTemplateCompartment` has no `organization_id`, so parent resolution is the only legal shape and this is it. |
| `equipment_check.py:747` `delete_item`                                                                                         | Safe, and already carries an `EC-8` audit comment saying so: `item_comp_id` is read off an item fetched by the org-scoped `service._get_item`.                                                                                                    |
| `inventory.py:5764` `update_issuance_charge`                                                                                   | Safe. Checked the service, not just its signature: `InventoryService.update_issuance_charge` filters `ItemIssuance.organization_id` and returns "not found" otherwise; the endpoint raises 400 on that.                                           |
| `users.py` ×5 — `assign_user_roles`, `add_role_to_user`, `remove_role_from_user`, `update_contact_info`, `update_user_profile` | Safe, all five. Each fetches the user with an `organization_id` filter and raises 404 before doing anything, then re-reads unscoped for eager-loaded serialization. Read individually this time rather than inferred from one handler.            |

**No defects.** Not a disappointing result: the 78% figure in §2 said the rule is
largely obeyed, and this is what that looks like at close range.

**Every one of the eight is the same shape** — an org-scoped validation followed
by an unscoped re-read for serialization, which is the re-fetch CLAUDE.md
pitfall #11 mandates. Two of this repository's rules meet here, and #11 wins,
correctly.

That suggests a cheap structural fix rather than eight individual ones: **carry
the org filter on the re-read too.** The row is in-org by construction, so the
added clause cannot change behaviour — it is defence in depth, and it would
delete this whole class from every detector permanently, shrinking the baseline
by six. Worth doing as its own change; it is not a defect fix and should not be
filed as one.

**Two of the eight are not in the ratchet's baseline at all** — the
`equipment_check` pair, because `CheckTemplateCompartment` carries no
`organization_id`. That is the blind spot §4b documents, met in the wild on the
first pass.

## 4b. Second burn-down pass — the services layer, 17 sites read, 0 defects

Read 2026-09-06, on branch `claude/org-scoping-services-burndown`. The baseline
holds **43 entries in `app/services/`** — not the 33 quoted in §4a, which
counted parameter-fed sites only; the baseline includes locals.

### The triage that made 43 tractable

Reading 43 service methods one by one is a day's work. Classifying them first
by three cheap AST facts — does the enclosing function take an
`organization_id` at all, is it public or a `_private` helper, and is the
flagged id a parameter or a local — sorts them by how much the code already
knew:

| Signal                                            |  Count | Reading                                                                        |
| ------------------------------------------------- | -----: | ------------------------------------------------------------------------------ |
| Public, has an `organization_id` param, client id | **17** | The org was in scope and was not applied here. Read these first.               |
| Private helper, has an org param                  |     12 | Internal; caller resolved the id.                                              |
| No org context at all                             |     11 | Cannot be scoped in place; the id must arrive validated. Needs caller tracing. |
| Public, org param, id is a local                  |      3 | Local derived from an earlier query — check that query.                        |

Only the first group has both the means and the obligation to scope, so it is
where a real defect would be. That is the burn-down order this section used.

### Result

**All 17 are safe**, by five distinct mechanisms — which is why no single
static rule finds them:

| Mechanism                                                               | Sites                                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| The id is `current_user.id`, never client-supplied                      | `clock_in`, `create_manual_entry`, `link_event`, `reactivate_member`'s `reactivated_by`, `generate_report`'s `performed_by` |
| The endpoint verified the target in-org before calling                  | `check_voter_eligibility` (via `preview_ballot_for_user`), `generate_report`'s `user_id` (via `change_member_status`)       |
| `assert_in_org()` bounds the client FK first                            | `create_return_request` ×3 — textbook #14c                                                                                  |
| The id is a local off an org-filtered query above                       | `edit_pending_entry`, `bulk_approve`, `process_election_lifecycle`, `get_preset`, `resolve_check_templates` ×2              |
| The org filter **is** applied, through a builder the ratchet cannot see | `get_report` — the blind spot this file documents, met in the wild                                                          |

Two are worth singling out. `create_return_request` is the pattern to copy:
`assert_in_org(..., allow_none=True)` on all three optional holding ids before
any ownership lookup, so a foreign id cannot even be probed for existence.
`get_report` is the opposite lesson — it carries an `EC-9` docstring admitting
the unscoped path "is an IDOR waiting for a forgetful caller", keeps it for
legacy callers, and applies the filter conditionally through
`query = query.where(...)`, which is exactly the builder form §4b's own ratchet
cannot see.

### Running total

**25 sites read across two passes, 0 defects.** Consistent with §2's finding
that 78% of by-id queries already scope: the rule is largely obeyed, and the
baseline is a backlog of _unverified_ sites, not of suspected ones.

**26 services entries remain unread** — the private helpers and the eleven
functions with no org context, which need caller tracing rather than local
reading.

## 4c. Third pass — the baseline is fully triaged

Read 2026-09-06 on `claude/org-scoping-services-burndown-2`: the remaining 26
`app/services/` entries, plus the four in `app/api/` that no pass had reached.
**Every one of the 47 baseline entries now carries a recorded verdict.**

These needed a different method from §4b. Almost all are `_private` helpers, so
nothing in the function itself decides safety — the id arrives already
resolved, or it does not. The pass was driven by a caller-tracing script: for
each entry, find every call to the enclosing function across `app/`, bind the
flagged parameter positionally or by keyword, and print the expression the
caller supplies. That turns "read 26 functions and their histories" into "read
26 argument expressions", and only the handful that resolve to a bare
pass-through need a second hop.

**Running total: 51 sites read across three passes, one finding.**

### The finding: `RoleService.set_user_roles` is unreachable and unscoped

`app/services/role_service.py:655`. No caller anywhere in `app/` — only its own
definition and two references in `tests/test_role_service.py`.

It takes **no `organization_id` at all**, and nothing in it is org-scoped:

- `get_user_roles(db, user_id)` — no org
- `select(User).where(User.id == user_id)` — no org filter
- `select(Role).where(Role.id.in_(role_ids))` — **the role ids are not
  org-checked either**
- the `delete` / `insert` on `user_roles` — no org constraint

So it would replace any user's positions with any positions, across tenants,
including administrator-bearing ones. It is not exploitable today because
nothing routes to it. The live path — `users.py::assign_user_roles` — is a
strictly stronger duplicate: it fetches the user org-scoped, fetches the roles
with `Role.organization_id == current_user.organization_id`, and calls both
`_enforce_role_grant_ceiling` and `assert_positions_retain_administrator`.

**This is a loaded gun, not a wound.** The danger is that it reads like a ready
helper: a future endpoint that calls it inherits a cross-tenant privilege
escalation, and the reviewer of _that_ change sees only a one-line service call.
Two defensible fixes, and the choice is a product decision rather than a
security one:

- **Delete it,** with its two tests. It duplicates a live path that is already
  better. `CLAUDE.md`'s app-review rotation lists dead-code removal as a safe
  fix, and deleting an unreachable method changes no behaviour.
- **Scope it** — validate `role_ids` against the target user's organization with
  `assert_all_in_org` before the insert, and org-scope the `User` fetch. This
  needs no signature change (the org is derivable from the user row) and makes
  it safe to wire up.

**Resolved by scoping, not deletion** (2026-09-06, after this pass merged).
The owner chose to keep the method. It now resolves the target user inside
`organization_id`, runs `assert_all_in_org` over `role_ids` before any write,
and org-filters the `select(Role)` behind the administrator-continuity check.
Its baseline entry is gone — `test_baseline_has_no_stale_entries` is what
required that, which is the ratchet doing the job it was built for.

One correction to the option above, recorded because the reasoning was wrong
rather than merely incomplete: it claimed scoping "needs no signature change
(the org is derivable from the user row)". Deriving the org from the row you
are about to trust is circular — it bounds nothing, since a caller passing a
foreign `user_id` gets that user's own org back and every check then passes.
`organization_id` is therefore a **required, keyword-only** parameter. Optional
would have left the unscoped path in place for a caller to forget, which is the
shape pitfall #14b warns about and the one `ShiftCompletionService.get_report`
still carries as EC-9. There were no production callers to migrate.

### Everything else, by mechanism

| Why it is safe                                                                                                                                                                  |                                      Count |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------------: |
| The id is read off a row the caller already resolved (`operator.id`, `leave.linked_training_waiver_id`, `assignment.user_id`, `peeked_folder.id`)                               |                                         11 |
| Notification / display helper reached only from an org-scoped flow                                                                                                              |                                          8 |
| Id-only `SELECT ... FOR UPDATE`: a lock acquisition, not a read                                                                                                                 |                                          4 |
| `assert_in_org` bounds the client-supplied id first                                                                                                                             | 1 (`_lock_destination_folder`, DOC-6/XC-1) |
| Structurally unscopeable: the JWT-subject lookup that _establishes_ the caller, a `TASK_RUNNERS` sweep with no caller org, three public webhooks where the id is the credential |                                          5 |

### Two hardening candidates, not defects

Both hold an `organization_id` and simply do not apply it on the flagged query,
so they are safe only by their caller's history — the same shape as the six
re-reads hardened in #2337:

- `scheduling_service._notify_shift_assignment` — `select(Shift).where(Shift.id == ...)`
- `external_training.perform_sync_task` — the background task re-fetches the
  provider after the endpoint validated it, across a session boundary

## 5. Effort

| Piece                            | Estimate       | Notes                                                                                                                                                                               |
| -------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detector + baseline + self-tests | ~400–600 lines | Simpler than `test_migration_create_all_tables.py` (1,533 lines); the structural exemptions in §1 are most of it. Needs a `TestTheDetectionItself` class per repository convention. |
| Seed the baseline                | ~1 day         | Mechanical: generate, eyeball for obvious junk, commit.                                                                                                                             |
| Triage the 43 parameter-fed hits | ~1–2 days      | Real review. This is where an actual IDOR would be found, if one is there.                                                                                                          |
| Triage the remaining 175         | opportunistic  | Burn down as features are touched; the ratchet stops it growing meanwhile.                                                                                                          |

The detector and the baseline are one change. The triage is separate work that
the baseline makes safe to defer.

---

## 6. A defect found while scoping this

**Pitfall #14's own "CORRECT" example does not run.** It shows:

```python
select(Candidate).where(
    Candidate.id == candidate_id,
    Candidate.organization_id == organization_id,
)
```

`Candidate` (`app/models/election.py:295`) has **no `organization_id` column**.
That code raises `AttributeError`. `Candidate` is in fact a shape-2 model, so
the example demonstrates the one branch that cannot work for it, in the rule
cited more than any other in this repository.

The real pattern, from `app/api/v1/endpoints/elections.py:2074`, resolves the
`Election` in-org and then constrains the candidate by `election_id`. CLAUDE.md
has been corrected to show both shapes.

The prose was always right — "or resolve the row through a parent that was
already org-scoped". Only the code block was wrong, which is why it survived:
nobody executes an example.

---

## 7. What would let #14 move to `docs/rules/`

Under the gate in [CLAUDE_SKILLS_REVIEW.md](./CLAUDE_SKILLS_REVIEW.md#5-the-constraint-that-governs-all-of-part-b),
a rule may be reached on demand once a missed trigger costs a red build. A
baseline ratchet satisfies that for _new_ code, which is the case a skill's
trigger governs — a session writing a new endpoint cannot land an unscoped
query whether or not the skill fired.

It does not satisfy it for the 47 sites already in the baseline, nor for the
wider 218 unscoped statements §2 measured, of which the baseline covers only
the reviewable subset. So the
recommendation is to ship option B, burn the 43 down, and revisit whether #14
moves once the baseline is small enough that it describes exceptions rather
than a backlog. Until then #14 stays in `CLAUDE.md`, in full, always on.
