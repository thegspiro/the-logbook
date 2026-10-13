# Application Review — Elections (Tier B)

**Prefix:** `ELEC2` · **Iteration:** B5 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-08-21 (pass 5), 2026-10-13 (pass 6)

---

## Pass 6 (2026-10-13) — the write paths, the new ballot contract, and what nothing reads: 1 fixed, 2 flagged

### Scope, stated plainly

Pass 5 saw a module of **46 routes and a 4,616-line service**. It is now **69
routes, a 11,208-line service, 2,040 lines of schemas and ~11,155 frontend lines
across 96 files** — most of that growth is surface no app-review pass has opened.
This pass does not claim to have read it. It also did not redo the backend's
security lens: `docs/security-review/ELEC-06-elections-ballots.md` ran its eighth
pass on these files the same day (PR #3142: real delta read, 0 fixed, 0 flagged),
and a second pass over the same ground would have spent the iteration
re-reading cleared work.

**Read, in the lenses that found real defects on facilities:**

- every **update path**, backend and frontend — `update_election`,
  `update_candidate`, the organization settings save, and all four frontend
  `updateElection` call sites, `updateCandidate`, and the create form;
- the **contract of the four new in-app ballot routes** against the frontend
  types, field by field;
- every use of the **browser clock** in the election screens (pitfall #29);
- **dead code** across all 151 definitions in `election_service.py`;
- the documented route counts and the one wiki claim the settings finding
  turned on.

**Not read, and so not reviewed here:** the service's business logic (tallying,
runoffs, quorum, forensics, the hash chain) — security-review territory, and
cleared by it today; the results, forensics and manual-ballot screens'
rendering; `BallotBuilder`'s internals beyond its save call; accessibility and
mobile layout of the 96 files. A clean result from this pass says nothing about
those.

### ELEC2-7 — LOW correctness — an explicit `null` for a NOT NULL column answers 500, not 4xx — ✅ FIXED

`ElectionUpdate` and `CandidateUpdate` type every field `Optional` so a PATCH may
omit it, and both handlers dump with `exclude_unset`, so a field that _was_ sent —
a `null` included — reaches the write. For a nullable column that is a clear. For
a NOT NULL column it can only be a mistake, and nothing refused it.

Reproduced through the real handlers against the real schema before changing
anything, one field at a time:

| Handler            | Field(s)                                                                                                                                                                                                                                                                         | Outcome on the unmodified code                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `update_election`  | 14 fields: `title`, `election_type`, `anonymous_voting`, `allow_write_ins`, `max_votes_per_position`, `seats_per_position`, `voting_method`, `victory_condition`, `enable_runoffs`, `runoff_type`, `max_runoff_rounds`, `results_visible_immediately`, `auto_open`, `tie_policy` | `IntegrityError` (MySQL 1048) at commit — a 500                                                                |
| `update_election`  | `start_date`, `end_date`                                                                                                                                                                                                                                                         | `TypeError` from `update_data["end_date"] <= update_data["start_date"]` — a 500, and raised _before_ the write |
| `update_election`  | `quorum_type`                                                                                                                                                                                                                                                                    | already refused cleanly (the only one that was)                                                                |
| `update_candidate` | `name`, `display_order`                                                                                                                                                                                                                                                          | `IntegrityError` — a 500                                                                                       |
| `update_candidate` | `accepted`                                                                                                                                                                                                                                                                       | already refused: the handler's own explicit `400`                                                              |

**Severity is LOW because the UI cannot send these.** The frontend
`ElectionUpdate` and `CandidateUpdate` types carry no `| null` on any NOT NULL
field, and every call site sends a real value behind an emptiness check
(`handleExtendElection`, `handleEditDates`, `saveItems`, the candidate edit).
Only a direct API client can trigger it, and what it gets is a 500 and a
server-side stack trace in place of a message naming the field. Nothing is
corrupted: the transaction fails and rolls back.

**Fix — in the schemas, not the handlers.** A null is a _request_ error, and
`ElectionUpdate`/`CandidateUpdate` already carry validators. A
`model_validator(mode="after")` on each now refuses an explicit null for the
listed fields with a 422 that names every offender (`end_date, title cannot be
null; leave the field out to keep its current value`), before any handler logic
runs. Converting the two `setattr` loops to `apply_updates` was the alternative,
and was rejected: it would not have covered the date fields, which fail earlier
in a comparison, and it would have meant wrapping `ValueError` in two long
handlers.

- `accepted` is deliberately **not** in `CANDIDATE_UPDATE_REQUIRED_FIELDS`: the
  handler refuses it with its own message after routing acceptance through the
  service, and an existing test depends on that. Listing it would make that guard
  dead code.
- The required sets are hand-kept, because the schema cannot see the column.
  `test_election_update_required_fields.py` (database-free, `unit`) derives the
  NOT NULL set from the models and fails if either set drifts, and the
  integration test's parametrization is itself derived from the model — a new NOT
  NULL column becomes a new failing case the day it is added.
- **Positive halves**, so a validator that refused every null would not pass:
  a null for a _nullable_ column (`description` on an election, `statement` on a
  candidate) still clears it, through the real handlers.

**Verification:** 22 integration tests + 7 unit tests, reproduced failing first
(16 of 17 election fields and 2 of 3 candidate fields failed on the unmodified
code). Mutation-tested: disabling the election validator brings back exactly the
16 failures, disabling the candidate validator brings back exactly `name` and
`display_order`. Marker routing checked by collection: 7 tests under the unit
job's expression, 22 under `integration` (pitfall #30b).

### ELEC2-8 — LOW — `ElectionService.has_user_voted` has no production caller — 🚩 FLAGGED

An AST scan of every definition in `election_service.py` against every `Name`,
`Attribute` and string-dispatch reference in `app/`, `scripts/` and `main.py`
found **one** unreferenced definition out of 151: `has_user_voted`
(`election_service.py`, ~line 9502). Its only mentions are a docstring that lists
it among the readers of the shared voter-identity filter, and
`test_election_voting_flow.py`. The scan was repeated with real code references
only after a text-match version returned zero — a comment mentioning a name had
been counting as a use.

**Left in place deliberately.** It lives in the file that hash-chains votes, and
its test is also one of the few that exercise the anonymous-voting identity
filter end to end (`test_has_user_voted_before_and_after`). Deleting the method
and its test removes that coverage for no functional gain; if it is removed, the
identity-filter case needs a new home first. A maintainer's call.

### ELEC2-9 — LOW — seven `default_*` election settings are accepted, stored and returned, and nothing reads them — 🚩 FLAGGED

`PATCH /elections/settings` accepts `default_voting_method`,
`default_victory_condition`, `default_victory_percentage`,
`default_anonymous_voting`, `default_allow_write_ins`, `default_quorum_type` and
`default_quorum_value`, stores them under `org.settings["election_defaults"]`, and
`GET` returns them. Nothing else reads that key — not the service, not the create
path, not any frontend code — and the settings screen renders no control for any
of them. `wiki/Module-Elections.md` states the intended behaviour: _"there are no
organization-wide election defaults."_

The harm is to the contract, not a screen: a client that sets
`default_voting_method` gets a 200 and sees the value echoed back, while the next
election still starts as simple majority. CLAUDE.md pitfall #19, API-only form.
Removing the fields, wiring a reader, or documenting them as reserved are all
product or API decisions, so this is an owner decision recorded in
`docs/KNOWN_LIMITATIONS.md` with the three options.

### Verified good ✅

Each of these was checked with something that could have failed the other way.

- **The `update_election` allowlist matches the schema exactly** — 30 fields
  each, nothing silently dropped, no dead entries. (`test_election_update_allowlist.py`
  already locks this; re-derived here rather than inherited.)
- **The frontend's update payloads clear correctly.** The meeting-link edit sends
  explicit nulls for all three nullable columns, with a comment explaining why;
  the candidate edit uses `blankToNull` for `position` and `statement`; the
  create payloads use `|| undefined`; the create form's only blank optional
  string, `description`, is trimmed to `undefined` at submit and everything else
  starts with a real value. The `?? null` hits are all on API-returned values.
- **The in-app ballot contract matches field for field.** The four new routes'
  response models (`MemberBallotResponse`, `BallotSubmissionResponse`,
  `MyProxyAuthorizationsResponse`, `VoteReceiptResponse`) and their nested models
  have identical key sets to the frontend interfaces; the schemas carry no
  `alias_generator`, so the wire is snake_case and the types are too (pitfall
  #5). `BallotElection` is identical to `BallotElectionResponse`, and
  `ElectionBallot.tsx` reads no candidate field the route omits.
- **The browser clock is advisory, never authoritative** (pitfall #29). The
  open-election confirmation and the extend-voting modal compare instants in
  milliseconds rather than wall-clock strings, only gate a warning, and the
  open handler reports the server's returned `start_date` as the real outcome.
- **The settings save deep-copies before reassigning** (pitfall #12), and the
  service's reader of `max_proxies_per_person` degrades a bad stored value to the
  default instead of raising (pitfall #19) — so an explicit null stored by the
  settings endpoint is harmless there.
- **Route gating:** 69 routes in `elections.py`; not re-enumerated this pass,
  because the same-day security review enumerated them.

### Observation (not actioned)

`MemberBallotResponse.candidates` is typed as the full `Candidate`, which
declares `vote_count`, `nominated_by`, `user_id` and `accepted_on_behalf_*` —
fields the ballot route deliberately never sends. No reader touches them today.
A narrow `BallotCandidate` type, matching the backend's `BallotCandidateResponse`
the way `BallotElection` already matches `BallotElectionResponse`, would let the
compiler catch the first reader that does.

### Documentation

The route counts in `docs/module-audit/elections.md` and this file's Pass 1
section are explicitly dated ("46 endpoints", "65 endpoints incl. …
at iteration-5 audit time"), so they are historical rather than wrong. Current
size: 69 routes, 4,618-line endpoint file, 11,208-line service.

### Process note

A first run of the election test suite failed one test, in
`test_storefront_service.py`. My `-k election` expression had matched it because
"s-**election**" contains "election". It was unrelated to this change — but the
failure was a real `(1054, "Unknown column 'users.dashboard_pulse'")` from a
local schema built before `main` gained that column, which is the stale-schema
signature `CHECKLIST.md` describes. The schema was rebuilt
(`alembic upgrade head` + `repair_schema.py`) and the full election run repeated
rather than waving it off as unrelated.

### Completion gate (pass 6)

| Check                                | Result                                                          |
| ------------------------------------ | --------------------------------------------------------------- |
| election-named backend tests         | ✅ **807 passed**, 1 skipped (an unrelated optional dependency) |
| new tests                            | ✅ 22 integration + 7 unit; failing first, mutation-tested      |
| `flake8 app/ tests/`                 | ✅ 0 violations                                                 |
| `black --check app/ tests/`          | ✅ 1,627 files unchanged                                        |
| `isort --check-only` (changed files) | ✅ clean                                                        |
| `npm run typecheck` / `npm run lint` | ✅ 0 errors / clean (no frontend file changed)                  |

---

## Pass 5 (2026-08-21) — public ballot input and write-in authorization

Reviewed the authenticated management/voting routes and all public token routes
from request validation through persistence. Tenant scoping, token hashing,
eligibility snapshots, candidate ownership checks, rate limiting, vote deduplication,
and anonymous-vote metadata purging remain intact.

### ELEC2-3 — MEDIUM — Disabled write-ins accepted by token bulk ballot — ✅ FIXED

The public bulk-ballot service created a write-in candidate whenever the payload
selected `write_in`, but did not enforce the election's `allow_write_ins` setting.
A token holder could therefore add and vote for a write-in candidate even when the
ballot UI hid that option. The service now rejects the selection before creating a
candidate when write-ins are disabled; a database-backed regression test covers the
disabled setting.

### ELEC2-4 — LOW — Public ballot payloads lacked defensive size/uniqueness bounds — ✅ FIXED

Token strings, ballot lists, item ids, choices, and write-in names were accepted
without complete request-layer bounds. Duplicate entries for one ballot item were
also ambiguous and unnecessarily exercised persistence-level deduplication. Public
token credentials are now capped at 256 characters; ballot submissions at 250
items; item ids at the persisted 100-character safe format; choices/write-ins at
200 characters; and duplicate item entries are rejected. Authenticated bulk votes
receive the same 250-entry cap.

### ELEC2-5 — HIGH — Token submissions did not serialize lifecycle/replay checks — ✅ FIXED

Authenticated voting already locked the election row before eligibility and
duplicate checks, but both token write paths validated before taking any row lock.
Two concurrent requests could therefore validate the same unused token, and
concurrent ballots could update `last_chain_hash` from the same predecessor,
forking the tamper-evident vote chain. Token submissions now lock the election and
token rows, in that order, then re-check token use/expiry and election status/window
under the locks before inspecting candidates or creating votes. Focused DB-free
tests cover a token consumed and an election closed between optimistic validation
and lock acquisition.

### ELEC2-6 — LOW — Public schemas silently discarded unexpected fields — ✅ FIXED

The single-token vote schema inherited the authenticated `VoteCreate` payload,
requiring an `election_id` that the service ignored in favor of the token's bound
election. Public ballot models also used Pydantic's default behavior of silently
discarding unknown keys. The token vote now declares only the fields it consumes,
and all public token/ballot request layers reject extra fields rather than accepting
ambiguous or security-looking client input.

**Completion gate (pass 5):** focused DB-free tests 9 passed; black and flake8
clean. The database-backed regression test could not run locally because MySQL was
not available on `localhost:3306`.

---

## Pass 4 (2026-08-09) — invariants re-verified; 2 E712 the pass-3 sweep missed

Re-verified the headline invariants hold (`create_candidate` `user_id`
`assert_in_org`; `CandidateUpdate` exposes no FK fields; `get_client_ip` at every
site; `'/elections'` in `UNCACHEABLE_PREFIXES`; the `status` enum column is
enum-typed in the schemas, so the latent-500 lens stays clean).

### ELEC2-2 — NIT — 2 `== True  # noqa: E712` the pass-3 sweep missed — ✅ FIXED

Pass 3's ELEC2-1 swept the 31 E712 comparisons in **`election_service.py`** and
claimed "every E712 noqa from the module," but two survived in the **endpoint**
file `api/v1/endpoints/elections.py` (`Candidate.accepted == True  # noqa: E712`
at lines 409 and 3504 — the accepted-candidates filter in two list paths).
`Candidate.accepted` is a plain `Boolean` column, so `.is_(True)` is the
behavior-neutral conversion (Pitfall #10). Swept both; the module (service **and**
endpoints) is now fully E712-free.

**Completion gate (pass 4):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · elections DB-free tests unaffected (the sweep changes
only boolean-predicate SQL syntax, never which rows match).

---

## Pass 3 (2026-08-09) — invariants re-verified; the deferred E712 sweep, done

Re-verified the module's headline invariants still hold, then swept the one
standing style item passes 1–2 had deferred.

**Re-verified:** `create_candidate`'s `user_id` validation via `assert_in_org`
(elections.py:1716) intact; `CandidateUpdate` still exposes **no FK fields** (the
update-bypass vector stays closed); the AXC-1 IP fix holds (`get_client_ip` at 6
sites, `request.client.host` at 0); `'/elections'` remains in
`UNCACHEABLE_PREFIXES`. Latent-500 lens clean: the module's only enum column
(`status`) is properly enum-typed in the schemas (no free-string→ENUM 500 path).

### ELEC2-1 — NIT — 31 `== True/False  # noqa: E712` suppressions swept — ✅ FIXED

Passes 1–2 deferred this deliberately, citing churn/risk in the codebase's most
security-critical file (hash-chained audit, ballot forensics). On closer analysis
the risk is churn, not semantics: all 31 are `.where(<boolean flag> == True/False)`
on `User.is_active` / `Vote.is_test` / `Vote.is_manual` / `VotingToken.used` /
`Candidate.accepted` / `Candidate.is_write_in` — the `.is_(True)`/`.is_(False)`
conversion changes only the SQL boolean-predicate syntax, never which rows match, so
it cannot affect vote counting, dedup, or the hash-chain (which operate on data
values, not on this WHERE syntax). Swept all 31 (Pitfall #10), removing every E712
noqa from the module — now consistent with the B2/B3/B4 sweeps. flake8/black clean;
82 non-DB election tests pass unchanged.

### Future development (unchanged)

The prior audits enumerated the remaining product/feature decisions; no further
code work identified. The R-D2 audit-log-IP residual note stands (pre-change
anonymous-election audit rows keep voter IPs by hash-chain design — tamper-evidence
over scrubbing).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · elections tests **82 passed** (all
DB-free; the 121 `db_session` errors are the known no-MySQL fixture failures,
unchanged by this behavior-neutral sweep).

---

## Pass 2 (2026-08-06) — clean-module verification, no code change

Ran the elections FK surface through the four lenses that have been productive
across B1–B4 (update-bypass, projection read-leak, MS2-4 unpopulated names, and
newer FK-input paths beyond the create cluster). **Every one comes back clean** —
a real result for the most-audited module in the codebase, not a rubber stamp.

- **Candidate update-bypass — not present.** `create_candidate` validates
  `user_id` via `assert_in_org` (pass 1), and `CandidateUpdate` exposes **no FK
  fields at all** (only name/position/statement/photo/accepted/display_order), so
  the blind `setattr` loop in `update_candidate` has nothing org-sensitive to
  reassign — `user_id`/`election_id` cannot be changed post-create. This is the
  B2 operator pattern (update omits the FK), verified here.
- **Projection read-leak — not present.** `CandidateResponse` is scalar-only
  (`user_id`, `nominated_by` as bare ids; `name` is the candidate's own stored
  column). No `User` relationship is eager-loaded into a candidate response, so
  there is no AP2-1/INV2-1 member-name leak vector.
- **MS2-4 — not present.** The one place that could exhibit it — the manual-ballot
  batch listing, whose schema declares `recorded_by_name` / attestation `name` /
  `candidate_name` — **populates them correctly**: `list_manual_ballot_batches`
  batch-resolves the recorder/attestor names (service 3318-3326) and joins the
  candidate name (3298), rather than returning a bare ORM row. The MS2-4 pattern
  done right.
- **The newer FK-input paths validate in-org.** `create_nomination` requires the
  `nominee_user_id` to be an **active member of the caller's org** (service
  2800-2808); `merge_write_in_candidates` resolves every source/target id under an
  org-scoped election via `election_id == X AND id IN (…)`, so a foreign candidate
  id falls out as "missing" (3546-3554). Both fail closed.

One minor observation (not fixed, consistent with INV2-2): `election_service.py`
carries ~31 `== True/False # noqa: E712` suppressions. They are suppressed
(flake8 is clean) and this is the codebase's most security-critical file
(hash-chained audit, ballot forensics) — a pure-style sweep with no other change
here is not worth the churn/risk; recorded as a standalone cleanup.

**No code changed.** The verifications above are the deliverable, same disposition
as pass 1 (and the same shape as the B20 finance / B26 public-portal clean passes).

---

## Pass 1 (2026-08-06)

**Prefix:** `ELEC2` · **Iteration:** B5 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/elections.py` (2,721 L, 46 endpoints),
`app/services/election_service.py` (4,616 L), `quorum_service.py`
**Frontend:** `modules/elections`
**Prior audit:** `docs/module-audit/elections.md` — the most heavily reviewed
module in the codebase: iteration 5 (security-critical), plus a full 2026-07
follow-up (R-1…R-13) and a practical-workflow pass (R-D1…R-D5).

---

## Scope

Tier B on the most-audited module. Rather than re-derive the two exhaustive
security passes, this iteration **verified their fixes still hold**, resolved
the one finding the tracker still listed open (ELEC-7), and applied the broader
lens (dead code, docs, frontend pitfalls, and consistency with the AXC-1 sweep
this review made earlier).

**No code change was needed — the module is clean.** That is a real outcome for
the surface that has had the most scrutiny, not a shallow pass; the verifications
below are the deliverable.

## Findings

### ELEC-7 — LOW — `create_candidate` user_id unvalidated — ✅ ALREADY FIXED (doc corrected)

The tracker listed this XC-1 gap as open. It is **fixed**: `create_candidate`
(`elections.py:1669`) resolves the election org-scoped, then validates
`candidate.user_id` via the shared `assert_in_org` helper with `allow_none=True`
(write-ins) and `ValueError → 400`. This landed in the zero-trust review; the
module-audit entry had simply never been ticked. Corrected there.

With ELEC-7 closed, **every** elections finding across all three prior passes is
resolved.

## Verified good ✅ (re-confirmed this pass)

- **AXC-1 fix holds.** The vote-recording paths use `get_client_ip(request)`
  (5 sites), not `request.client.host` (0) — the earlier cross-cutting sweep is
  intact, so per-vote IPs (which feed the fraud detection documented in
  `BALLOT_FORENSICS_GUIDE.md`) resolve to the real client behind the proxy.
- **ELEC-7 XC-1 closed** (above).
- **No dead code.** An AST unreferenced-private scan flagged only
  `_notify_leadership_of_deletion`, which is a false positive — it's called from
  `elections.py:992` (the scan was service-file-local). ELEC-9's genuinely dead
  max-votes branch was already removed in iteration 5.
- **No TODO/FIXME markers** anywhere in the module.
- **Frontend clean:** no Pitfall #1 (`??` on outgoing form values), no banned
  date APIs (`toLocaleDateString`/`date-fns`), and the R-10e cache fix is intact
  — `'/elections'` (no trailing slash) is in `UNCACHEABLE_PREFIXES`, so the list
  endpoint is excluded.
- **The headline security invariants from the prior passes remain in place** by
  inspection: 512-bit tokens hashed at rest (ELEC-5), anonymous-ballot IP purge
  at close (ELEC-6), the eligibility gate on `cast_vote` (ELEC-1), the
  org-scoped candidate update/delete (ELEC-2), the method-aware dedup hash
  (ELEC-3), and the rollback-double-vote guard (ELEC-4).

## Duplication

None found beyond the deliberate shared-source-of-truth the R-7 fix introduced
(`annotate_ballot_items_for_user`, from which the eligibility filter derives) —
which is _de_-duplication, the correct direction.

## Dead code

None (see the false-positive note above).

## Documentation

- `docs/module-audit/elections.md`: ELEC-7 corrected to fixed.
- `BALLOT_FORENSICS_GUIDE.md` remains accurate; note its dependence on the
  AXC-1 IP fix (verified holding) — a reader relying on `suspicious_ips` needs
  `TRUSTED_PROXY_IPS` set, the deployment caveat recorded in
  [`CROSS-CUTTING.md`](./CROSS-CUTTING.md).

## Future development

The prior audits already enumerated the design decisions. The one forward note
this pass adds:

1. **The audit-log IP residual (R-D2) is permanent by design** — voter-action
   audit rows written before the `_audit_ip` change keep their IPs because
   `ip_address` is in the hash-chain input. That is correct (tamper-evidence
   over scrubbing), but it means a pre-change anonymous election's audit trail
   still carries voter IPs. Worth a one-line note in the operator/forensics docs
   so it isn't mistaken for a leak — the _forensics API_ is threshold-only, but
   the _raw audit rows_ from before the change are not.
2. **No further code work identified.** This module is at the point where the
   next increment is product/feature decisions, not defect-fixing.

## Completion gate

| Check                | Result                                                                               |
| -------------------- | ------------------------------------------------------------------------------------ |
| `tsc --noEmit`       | ✅ 0 errors (no change this iteration)                                               |
| `flake8 app/ tests/` | ✅ 0 violations                                                                      |
| `black --check`      | ✅ 503 files unchanged                                                               |
| `eslint`             | ✅ clean                                                                             |
| backend tests        | ✅ unchanged — no code modified. Full suite baseline (2517 passed, 0 failed) stands. |

</content>
