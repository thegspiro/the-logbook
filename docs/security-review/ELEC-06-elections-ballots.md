# Security Review 06 — Elections & Ballots

**Prefix:** `ELEC` · **Iteration:** 06 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2) · **PR:** [#1810](https://github.com/thegspiro/the-logbook/pull/1810) (pass 1)

---

## Pass 2 (2026-08-27)

Scoped to the **full elections domain** since pass 1's merge commit
(`56b897ec`, PR #1810) — `endpoints/elections.py`, `election_service.py`,
`quorum_service.py`, `models/election.py`, `schemas/election.py`, the
elections frontend module, and every migration since, checked by content
(not just filename) for anything touching election tables or eligibility
logic. Three real changes since pass 1, all reviewed in full:

- **`election_service.py` (+58/-25) — voter eligibility rewritten for the
  member-class/status split.** A same-day feature
  (`20260826_1400_f1a2b3c4d5e6_split_member_class_and_status.py`) replaced
  the fused `membership_type` column with independent `member_class`
  (operational/administrative/social) and `member_status`
  (prospective/probationary/regular/life/retired/honorary/junior) columns.
  `_user_has_role_type` — the function every ballot-eligibility and
  results-visibility check in the module calls — was rewritten to read the
  new columns, with a fallback to `split_membership_type()` for a
  pre-migration row. This is exactly the kind of change that could
  silently widen a restricted ballot's electorate, so it was read in full
  rather than skimmed:
  - Every legacy category (`operational`, `administrative`, `regular`,
    `life`, `probationary`) reproduces its pre-split meaning exactly —
    `operational` now requires `member_class == operational AND
member_status == regular`, matching the old `membership_type == "active"`
    check precisely, not just "any operational member" (which would have
    wrongly included probationary and retired members). `regular` and
    `life` are likewise class-**and**-status, not class-only.
  - `split_membership_type()`'s fallback deliberately returns `(None,
None)` for an org-configured custom tier (e.g. `"senior"`) rather than
    defaulting to a permissive value — confirmed by reading its docstring's
    own stated reasoning and cross-checked against the `_reconcile_membership`
    event listener (`models/user.py:542`, wired to both `before_insert` and
    `before_update`), which fills both columns on every ORM write, making
    the fallback a rare defense-in-depth path rather than the common case.
  - A new `"social"` category was added (`member_class == social`). Not
    dead code: `eligible_voter_types` (`schemas/election.py:86`) accepts
    any string with no fixed enum, falling back to a role-slug match, so
    an admin can set `"social"` today. Verified it satisfies only its own
    category, not `operational`/`administrative`/`regular` (no prior test
    covered this — added one).
  - The migration itself: guarded on `users` table existence (Pitfall
    #26), deliberately no `server_default` (would silently misclassify
    non-operational-regular rows on a raw-SQL insert — documented
    reasoning in the migration matches the fallback's), reversible with a
    documented, bounded information loss.
- **`election_service.py`, `notify_leadership_of_rollback` (~L4908) — an
  unrelated correctness fix in the same file.** Removed a
  `.join(User.roles)` that produced one row per position held, double-
  counting and double-emailing a leadership member who held two roles.
  Not a security issue (no access-control implication, an org-scoped
  notification path); confirmed no other instance of the same join pattern
  remains in the file (`get_package_recipients`'s sibling query was already
  correct).
- **`quorum_service.py` (+8) — `calculate_quorum` now takes a
  `.with_for_update()` locking read on the `MeetingMinutes` row before
  computing `present_count` from its own `attendees` JSON column.**
  Pitfall #27 compliant by construction here: since the count is read
  directly off the same row the lock was taken on (not a separate COUNT
  query against a different table), the lock alone makes the read fresh —
  there is no second, unlocked read to miss. Confirmed the write
  (`quorum_met`/`quorum_count`) and `commit()` happen inside the same
  method, so the lock is held across the whole read-decide-write.
- **`frontend/src/modules/elections/routes.tsx` (+18/-14)** — added
  `requiredModule="elections"` to all three election routes. Mirrors a
  pre-existing backend `module_gate("elections", "Elections")`
  (`api/v1/api.py:206`, unchanged) — a frontend gate catching up to a
  server-side one already in place, not a new access-control boundary.

**No findings.** One test gap closed (the new `"social"` category had no
coverage; the existing `TestVoterTypeMembershipBoundaries` class already
covered every other category's boundary precisely because a prior pass
built it with this exact concern in mind — added
`test_social_is_eligible_only_for_social_category` and
`test_administrative_is_eligible_for_administrative_category` alongside
it).

**Completion gate (pass 2):** flake8/black/isort clean on `app/ tests/
alembic/`; `validate_migrations.py --strict` passed (383 revisions, single
head); scoped backend tests (`-k "elections or quorum or ballot"`) 250
passed, 1 skipped (pre-existing), 0 failed; full backend suite 9067
passed, 22 skipped (pre-existing), 0 failed. No frontend logic changed
this pass beyond the already-shipped route-gating diff reviewed above, so
no frontend gate re-run was needed.

---

## Pass 1 (2026-08-25)

**Backend:** `api/v1/endpoints/elections.py` (3,809 L, 65 routes — 56
`require_permission`-gated, 5 authenticated-only self-scoped, 4 intentionally
public token routes), `services/election_service.py` (7,962 L),
`services/quorum_service.py` (139 L)
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

**One feature outside the module-audit/app-review/security-review doc set was
found:** `SavedBallotTemplate` (`models/election.py:32`, migration
`20260812_0001`, 2026-08-12) — organization-scoped, reusable ballot-item
snapshots. None of those three review series mentions it by name — but it is
not entirely unreviewed: `docs/KNOWN_LIMITATIONS.md` already carries a
2026-08-12 entry on it ("Saved Ballot Templates Accept Fields They Then
Discard"), evidently written at ship time rather than by a later audit pass.
That entry covers a schema-tolerance quirk (a stray key inside `ballot_items`
is silently dropped, while one at the template's own level correctly 422s);
this iteration's read confirms it is still accurate and did not re-derive
it. Read in full below for the angles that entry doesn't cover
(access control, tenant isolation, abuse resistance).

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

**Corrected (Codex review, PR #1810):** the original pass of this section
said "61 carry `require_permission`... 4 are intentionally public," which
conflated _authenticated_ with _permission-gated_ for five self-scoped
voter-facing routes. The accurate split is 56 `require_permission`-gated + 5
authenticated-only (self-scoped) + 4 public = 65:

- **56 routes** carry `require_permission` (`elections.view` for reads,
  `elections.manage` for writes).
- **5 routes are authenticated-only** (`Depends(get_current_user)`, no
  permission string): `GET /{election_id}/eligibility` (`check_eligibility`),
  `POST /{election_id}/vote` (`cast_vote`), `POST /{election_id}/vote/bulk`
  (`cast_bulk_votes`), `GET /{election_id}/results` (`get_results`), and
  `POST /{election_id}/proxy-vote` (`cast_proxy_vote`). This is not a gap —
  it is the module's documented, audited design: these five do their own
  eligibility/self-scoping rather than a coarse permission string (any org
  member can attempt to vote; `check_voter_eligibility` inside the service
  decides whether that specific member, on that specific election, actually
  may — the ELEC-1 fix closed the one place this enforcement was missing).
  `module-audit/elections.md`'s own Notes section already states this; the
  route-inventory table just failed to reflect it accurately.
- **4 routes are intentionally public** (token is the credential, no
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
  access-control clean, but not abuse-resistance clean (see ELEC-12).**
  List/create/delete are all `elections.manage`-gated and org-scoped
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

One real gap (ELEC-12, flagged), one doc-accuracy correction (NIT, applied),
and one informational item.

### ELEC-12 — LOW/MED — `SavedBallotTemplate` list/create are unbounded — 🚩 FLAGGED

**What:** `list_saved_ballot_templates` runs an organization-scoped query and
returns `result.scalars().all()` with no pagination or limit
(`elections.py:395-400`), and `save_ballot_template` imposes no per-org cap
on how many templates can exist (`elections.py:408-452`). Caught by a Codex
review comment on the PR — the original pass of this section recorded the
endpoint as clean, which was correct on access control but wrong to call it
clean under checklist dimension 6 (abuse resistance).

**Where:** `backend/app/api/v1/endpoints/elections.py:395-400` (list),
`:408-452` (create).

**Failure scenario:** an `elections.manage` holder (a trusted role, not any
member) creates templates without limit; each may carry up to 250 ballot
items (`SavedBallotTemplateCreate.ballot_items`, `max_length=250`) with
2,000-character descriptions. Every load of the Ballot Builder's saved-templates
list materializes and serializes the organization's entire accumulated
collection in one response, with cost scaling per-org rather than being
capped.

**Impact:** LOW under the current threat model (gated to `elections.manage`,
not reachable by an ordinary member, and bounded per-item by the existing
schema limits) but MED in shape — it is the same "no `all()` over an org-wide
table" class flagged elsewhere in this rotation (e.g. FIN-7's unbounded
transaction export), and nothing currently stops it from growing unbounded
over the life of an organization.

**Fix:** not applied. Both remedies are behavior changes needing a product
decision rather than a mechanical fix: pagination on the list endpoint
changes the response envelope (this codebase's established pattern is
`PaginationParams` + slice, e.g. `finance.py`'s `list_member_dues`, but
adopting it here is a frontend-affecting contract change, not a drop-in);
a per-org creation cap needs an actual limit chosen by the org
(the same open-ended question FIN-7's export cap and CS-config's other
numeric limits were left to an owner decision). Flagged rather than guessed,
per this review's own standing rule against a wrong fix in a judgment call.
Mirrored into `KNOWN_LIMITATIONS.md`.

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

### ELEC-11 — INFO — `SavedBallotTemplate` had no security-lens review until now

Not a defect — recorded so a future reader doesn't assume "most audited
module" implies "every table security-reviewed." The feature is two months
newer than the iteration-5 audit and was added without a corresponding entry
in the module-audit or app-review series (it does have a `KNOWN_LIMITATIONS.md`
entry from ship time, but that covers a schema-tolerance quirk, not access
control/tenant isolation/abuse resistance — the angle this review adds, and
where ELEC-12 was found). No action needed beyond this note.

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
