# Security Review 06 — Elections & Ballots

**Prefix:** `ELEC` · **Iteration:** 06 · **Reviewed:** 2026-08-25 · **PR:** TBD

**Backend:** `api/v1/endpoints/elections.py` (3,809 L, 65 routes — 61 gated,
4 intentionally public token routes), `services/election_service.py`
(7,962 L), `services/quorum_service.py` (139 L)
**Frontend:** `modules/elections`
**Migrations:** all 7 election tables are migration-created (not
`create_all`-only) — see Schema & migration notes.

---

## Scope

The most heavily audited module in the codebase before this iteration even
starts: module-audit iteration 5 (security-critical, 2026-07) plus a full
follow-up (R-1…R-13, R-D1…R-D5) and five app-review passes through
2026-08-21. Every prior finding across all of those is closed.

**The file sizes have nearly doubled since the module-audit's numbers were
written** — `elections.py` 2,721→3,809 L (46→65 routes), `election_service.py`
4,616→7,962 L — and that growth was never called out as a discrete finding in
any pass, so this iteration's primary job was figuring out what accounts for
it rather than re-deriving the (already extensively re-verified) prior
findings. Cross-checking the current route list against everything every
prior pass named (R-1…R-13's voter-overrides/proxy-authorizations/attendees/
manual-ballots/eligibility-roster, ELEC2-5/6's token-lock/schema work, R-D1…5's
token-hashing/receipt/ballot-lookup work) accounts for nearly all of the
growth — those features exist and are individually documented, the endpoint
_count_ at the top of `module-audit/elections.md` was simply never updated as
each was added (the same class of drift AUTH-01 found in the auth module's
route count). Corrected in `module-audit/elections.md`.

**One genuinely new, previously undocumented feature was found:**
`SavedBallotTemplate` (`models/election.py:32`, migration `20260812_0001`,
2026-08-12) — organization-scoped, reusable ballot-item snapshots. No prior
pass mentions it by name. Read in full below.

**Read in full:** the `SavedBallotTemplate` model, schema, and its three
endpoints (`GET/POST /templates/saved-ballots`, `DELETE
/templates/saved-ballots/{id}`). All 31 `select(Election)` call sites in
`election_service.py`, checked for organization scoping. `CHECKLIST.md`
dimension 7 (schema/migration integrity) against every election table.

**Re-verified by targeted check, not full re-read:** the pre-existing findings
(ELEC-1…9, R-1…13, R-D1…5, ELEC2-1…6) — each already has a re-verification
history across 5+ passes; this iteration spot-checked the mechanisms rather
than re-deriving them (see Verified good).

**Not re-read line-by-line:** the ~3,300 lines of `election_service.py` that
implement already-documented features (manual ballots, proxy voting, voter
overrides, PDF generation, package assembly) — each has its own
already-reviewed history and this pass found no signal (doc drift, a new
migration, a route-count change) suggesting undocumented change within them.

## Route inventory

65 routes total. 61 carry `require_permission` (`elections.view` for reads,
`elections.manage` for writes, `elections.configure_approvals`-style dedicated
gates do not apply here — approval-adjacent actions use `elections.manage`
uniformly). 4 are intentionally public (token is the credential, no
`Depends` auth):

| Route                               | Compensating control                            |
| ----------------------------------- | ----------------------------------------------- |
| `POST /ballot/lookup`               | 512-bit token in body (never URL), rate-limited |
| `POST /ballot/vote`                 | same + row-locked (ELEC2-5)                     |
| `POST /ballot/vote/bulk`            | same + row-locked (ELEC2-5)                     |
| `GET /{election_id}/verify-receipt` | receipt hash is the credential, no PII returned |

(Module-audit's iteration-5 count of "5 public token endpoints" predates
R-D3's consolidation of two GET token-lookup routes into the single POST
`/ballot/lookup` — now 4, corrected above.)

## Verified good ✅ (re-confirmed this pass)

- **Tenant isolation holds on every `select(Election)` call.** All 31 sites in
  `election_service.py` checked: 28 filter `organization_id` directly; the
  remaining 3 are safe by construction — `process_election_lifecycle`'s
  per-election re-fetch (`:4104`) re-reads an id already drawn from an
  org-filtered query two lines earlier in the same function; the token path's
  election fetch (`:7019`) resolves through `voting_token.election_id`, where
  the token itself was already looked up by its own hash (the audited
  "token→tenant isolation is sound" mechanism); and the ELEC2-5 locking
  re-fetch (`:7071`) re-locks an election object already loaded and validated
  earlier in the same call. No unscoped scan of the FIN-9 shape exists here.
- **`SavedBallotTemplate` (new feature, reviewed for the first time) is
  clean.** List/create/delete are all `elections.manage`-gated and org-scoped
  (`elections.py:397,421,467`); the create schema is `extra="forbid"` and
  accepts only name/description/ballot_items/voting_method/allow_write_ins —
  no election, voter, candidate, token, or result field, so a template cannot
  become a route for copying stateful or sensitive election data (the model's
  own docstring states this as an invariant, and the schema enforces it);
  per-org name uniqueness is a normalized hash (`name_key`) so an org can't be
  blocked by a case/whitespace variant; delete is 404-not-200 on a
  cross-org/missing id; both writes emit an audit event.
- **No SQL injection.** Zero `.like()`/`.ilike()` calls anywhere in the module
  (checked both files) — nothing for the LIKE-escaping class to apply to.
- **Schema & migration integrity clean.** All 7 election tables
  (`saved_ballot_templates`, `elections`, `candidates`, `voting_tokens`,
  `votes`, `manual_ballot_batches`, `manual_ballot_attestations`) are
  migration-created, not `create_all`-only — unlike the finance module
  reviewed last iteration, this is one of the codebase's foundational
  modules with full migration coverage. Every `ondelete="SET NULL"` FK in
  `models/election.py` (11 sites, all `created_by`/`recorded_by`/`checked_in_by`-
  style actor columns) pairs with `nullable=True`.
- **The headline security invariants (re-confirmed present, not re-derived):**
  512-bit tokens hashed at rest (ELEC-5), anonymous-ballot IP purge at close
  (ELEC-6), the eligibility gate on `cast_vote` (ELEC-1), org-scoped candidate
  update/delete (ELEC-2), method-aware vote-dedup hash (ELEC-3), rollback
  double-vote guard (ELEC-4), token-write row locking (ELEC2-5), and public
  schema `extra="forbid"` (ELEC2-6).

## Findings

No fixable defect found. One doc-accuracy correction (NIT, applied) and one
informational item.

### ELEC-10 — NIT — Stale endpoint/line counts in `module-audit/elections.md` — ✅ FIXED

**What:** the module-audit header still read "2,721 L, 46 endpoints incl. 5
public token endpoints" / "4,616 L" — both roughly half the current size, and
never updated as R-1…R-13, R-D1…R-D5, and ELEC2-1…6 each landed real features.
**Where:** `docs/module-audit/elections.md:3-5`.
**Impact:** none directly, but an unmaintained size/count claim is exactly
what let this iteration's actual question — "is there unreviewed code here" —
go unasked for four app-review passes. **Fix:** corrected with both the
original and current numbers, and a pointer to this file for what the growth
accounts for.

### ELEC-11 — INFO — `SavedBallotTemplate` had no dedicated review until now

Not a defect — recorded so a future reader doesn't assume "most audited
module" implies "every table audited." The feature is two months newer than
the iteration-5 audit and was added without a corresponding doc entry in any
of the five subsequent app-review passes. Reviewed in full above; found
clean. No action needed beyond this note.

## Schema & migration notes

All 7 election tables are migration-created (`saved_ballot_templates` via
`20260812_0001`; the original 6 via `20260118_0004` and `20260119_0006`/
`20260801_0007`) — none are `create_all`-only, unlike most of the modules
reviewed in this rotation so far. Every `SET NULL` FK is `nullable=True`
(verified line-by-line). No JSON-column shape concerns:
`SavedBallotTemplate.ballot_items` is written once per row at create time
(templates are immutable snapshots — there is no update endpoint), so
CLAUDE.md Pitfall #20's "one canonical shape, normalized on every write path"
concern about multiple writers disagreeing on shape doesn't apply — there is
exactly one writer.

## Guard tests added

None. No behavior changed this iteration — the fix is a documentation
correction, not code, so there is no class of regression for a test to guard
against.

## Completion gate

| Check                                                       | Result                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations (no Python file changed)                    |
| `black --check app/ tests/ alembic/`                        | ✅ unchanged                                                |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin) | ✅ clean                                                    |
| `validate_migrations.py --strict`                           | ✅ 356 revisions, single head                               |
| `pytest tests/ -k elections`                                | ✅ 94 passed, 1 skipped (unrelated `py_vapid` optional dep) |
| `tsc --noEmit`                                              | ✅ 0 errors (no frontend file changed)                      |
| `eslint .`                                                  | ✅ 0 errors/warnings (no frontend file changed)             |
