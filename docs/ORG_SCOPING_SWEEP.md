# Scoping: a static sweep for CLAUDE.md pitfall #14

**Date:** 2026-09-06
**Question:** can org-scoping of by-id queries be enforced by a test, the way
`test_like_escaping.py` and `test_csv_writer_sweep.py` enforce their rules?
**Answer:** not as a precise rule. As a **baseline ratchet**, yes — and that is
what is recommended.

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

### B. Baseline ratchet — **recommended**

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

### C. Narrow high-signal sweep — recommended as the triage order, not as the gate

The 43 parameter-fed hits are the only group where a client-supplied id can
reach the query without passing through something already resolved. Reviewing
those 43 by hand is a bounded, worthwhile piece of work independent of any
test — and it is the right order to burn down the baseline in.

---

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
