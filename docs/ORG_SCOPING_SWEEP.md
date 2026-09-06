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

#### Verdict

Option B. The ratchet is what ships.

**Built:** `backend/tests/test_org_scoping_ratchet.py` plus
`backend/tests/org_scoping_baseline.txt` — **53 entries across 29 files**, the
bare-name ids on org-bearing models. It runs in the ordinary backend suite, in
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

It does not satisfy it for the 218 sites already in the baseline. So the
recommendation is to ship option B, burn the 43 down, and revisit whether #14
moves once the baseline is small enough that it describes exceptions rather
than a backlog. Until then #14 stays in `CLAUDE.md`, in full, always on.
