# Security Review 07 — Users & Organizations

**Prefix:** `USR` · **Iteration:** 07 · **Reviewed:** 2026-08-25 · **PR:** TBD

**Backend:** `api/v1/endpoints/users.py` (2,484 L, 23 routes),
`api/v1/endpoints/organizations.py` (1,272 L, 19 routes),
`api/v1/endpoints/member_status.py` (1,046 L, 12 routes),
`api/v1/endpoints/member_leaves.py` (297 L, 7 routes) — 61 routes total
**Frontend:** (in-app, no dedicated module directory)
**Migrations:** `users`/`organizations` are initial-schema tables;
`member_leaves_of_absence` has its own creating migration
(`20260220_0300_add_member_leaves_of_absence.py`). See Schema & migration
notes.

---

## Scope

The highest-risk surface in the codebase by design (privilege escalation):
module-audit iteration 21 (three parallel readers) plus four dedicated
app-review passes (2026-08-06 through 2026-08-09) that exist specifically
because this module governs role/permission/rank assignment. Every finding
across both series is closed except ORU-7c (org-wide `member` role
mass-escalation), which is an intentional-but-sharp design flagged for a
product decision, not a defect — unchanged, re-confirmed still accurate in
`KNOWN_LIMITATIONS.md`.

`member_leaves.py` is not in the module-audit's own file list for this
grouping — it was reviewed under a different module-audit entry
(`module-audit/membership-pipeline.md`, iteration 9, MP-3/MP-4 fixed) that
groups it with `membership_pipeline.py`/`member_status.py` instead. Both
findings there are closed; re-verified below rather than re-derived.

**File sizes have grown since the last full pass** (`users.py` 1,774→2,484 L,
`organizations.py` 1,026→1,272 L, `member_status.py` 911→1,046 L,
`member_leaves.py` 251→297 L) — traced to specific, already-fixed,
already-tested commits (the `hire_date` restricted-field fix, a
`scheduling.assign` permission added to leave creation, admin-navigation/PII
redaction) rather than one large undocumented feature. No new feature of the
`SavedBallotTemplate` shape was found in this module.

**Corrected — a Codex review round on the PR caught eight real issues** the
first pass of this file missed, seven of them by checking only part of what
each claim required (auth coverage checked permission-vs-authenticated but
not a third bare-`get_current_user`-with-no-self-check category; the
unbounded-query dismissal checked current headcount but not that accounts
are archived, never deleted; the completion gate's test selector matched 2
of 37 relevant tests; a "table not found" skip was actually a stale table
name; the audit-history allowlist and its query predicate both had real
gaps; a "covered by existing regression test" claim was true of the helper
function but not its call sites). All eight are addressed below — six with
code fixes, two with corrected claims. Full detail in Findings.

**Read in full:** every route decorator and its auth dependency across all
four files (61 routes), corrected below to a third bare-auth category the
first pass mischaracterized. The privilege-ceiling call sites
(`_enforce_role_grant_ceiling`, `_enforce_rank_grant_ceiling`) and their
callers. The PII-redaction call sites. The settings redaction call sites in
`organizations.py`. Every `.scalars().all()` call across the four files, for
dimension 6. The member audit-history query's full predicate
(`users.py:2198-2246`) and the `_AUDIT_EVENT_DESCRIPTIONS` allowlist it
filters through. `member_leaves.py`'s create/update/delete handlers and
`MemberLeaveService`.

**Re-verified by targeted check, not full re-read:** the pre-existing
findings (ORU-1…9, ORU-7a/b/c/d) — each has a re-verification history across
5 passes; this iteration confirmed the mechanisms are still wired at their
documented call sites rather than re-deriving them.

**Not re-read line-by-line:** the full ~5,100 combined lines. Sections with
no signal of change (no new route, no doc drift, no migration) were not
re-read past the auth-coverage and ceiling/redaction spot checks.

## Route inventory

61 routes across the four files, in three categories — corrected from the
original two-category pass:

- **`require_permission`/`require_all_permissions`-gated:** the large
  majority of the 61.
- **Bare `get_current_user`, self-or-admin checked in the handler body:**
  self-service mutations (contact-info, profile, photo) and the
  target-vs-caller comparisons in `member_leaves.py`.
- **Bare `get_current_user`, no self-check — org-wide reads with no
  permission string at all:** `GET /users/contact-info-enabled`, and in
  `organizations.py` — `GET /settings`, `GET /modules`, `GET /profile`. The
  original pass's route inventory claimed no route falls into this third
  category; wrong. Verified this is the same, already-audited pattern
  ORU-8b covers for `/settings` (`without_infrastructure()` strips secrets/
  `it_team` for non-`settings.manage` callers before the bare-auth response
  goes out) — the org derives exclusively from `current_user.organization_id`
  in all three, and none returns another org's data or a secret to a caller
  who merely authenticated. Not a defect; a genuine third category the
  inventory should have named.

## Verified good ✅ (re-confirmed this pass)

- **The privilege-escalation ceilings are still wired at their documented
  call sites.** `_enforce_role_grant_ceiling` (`users.py:677`) is called from
  `create_member` (`:325`) and the add-role paths (`:828`, `:954`).
  `_enforce_rank_grant_ceiling` (`users.py:713`) is called from
  `create_member` (`:253`) and `update_user_profile`'s rank-change branch
  (`:1433`) — closing both ORU-1 and the CRITICAL ORU-7d parallel-escalation
  path. **Corrected:** the original pass cited `test_rank_grant_ceiling.py`
  as covering this; it calls `_enforce_rank_grant_ceiling` directly, not
  through either route, so it cannot detect the call being silently dropped
  from either wiring point — which is exactly how ORU-1 and ORU-7d
  originally happened. A new source-inspection guard test closes that gap
  (see Guard tests).
- **PII redaction gates (ORU-8) still wired on both `with-roles` callers.**
- **Settings secret redaction (ORU-2/3/5) still holds.**
- **`hire_date` restriction (2026-08-16 fix) confirmed present and tested.**
- **No SQL injection; no CSV export in this module.**
- **Schema & migration integrity clean** (see Schema & migration notes).

## Findings

Six fixed, two doc corrections (no code change needed for those two).

### USR-1 — LOW/MED — Leave-of-absence create/update/delete never wrote an audit event — ✅ FIXED

**What:** `_AUDIT_EVENT_DESCRIPTIONS` and `_AUDIT_EVENT_FILTERS` have
declared `leave_of_absence_created`/`_updated`/`_deleted` since the
audit-history feature shipped, but no code anywhere called `log_audit_event`
with any of the three — confirmed by a repo-wide search for the literal
strings. `create_leave_of_absence`/`update_leave_of_absence`/
`delete_leave_of_absence` (`member_leaves.py`) committed straight to the
database with no audit trail.

**Failure scenario:** an officer creates, backdates, or deactivates a
member's leave of absence — which also drives training-waiver eligibility
and shift-assignment cancellation — and nothing records who did it or when.
A member disputing an incorrect leave record, or an audit of officer
activity, finds no entry for any of it.

**Fix:** each handler now calls `log_audit_event` with the declared event
type, `target_user_id` set to the leave's member, and the relevant detail
(dates/type on create, changed field names on update, the leave id on
delete) — matching the shape every other event in the allowlist already
uses, so the audit-history query picks these up with no further change.

### USR-2 — MED — Member audit-history query leaked unrelated members' events into an actor's own history — ✅ FIXED

**What:** the query's final `OR` clause was `AuditLog.user_id ==
user_id_str` with no further condition — "this member was the actor,"
unconditionally. Every other clause matches on a specific target field
(`target_user_id`, `new_user_id`, etc.), so an event where this member acted
**on someone else** was included by the actor clause even though the target
fields correctly identify a different person.

**Where:** `users.py:2198-2246` (`get_member_audit_history`).

**Failure scenario:** a manager views member A's audit history (advertised
as "changes to the member's record"). A previously reset member B's MFA
(`admin_mfa_reset`, `target_user_id=B`). That event now appears in **A's**
history too, because A was the actor — showing the manager an entry that
names B and describes an action on B's account, under a page whose header
says it's A's record.

**Fix:** the actor-fallback clause now additionally requires that none of
the five known target-field keys are populated in `event_data` — i.e. it
only fires for genuinely self-inherent events (no separate target recorded
at all, such as a member editing their own contact info). Any event that
does carry a target is decided solely by the target-match clauses, on their
own merits — narrower than before, never broader.

### USR-3 — LOW — Two real, emitted audit event types were invisible in member history — ✅ FIXED

**What:** `admin_mfa_reset` (`users.py:1820`) and `compliance_exemption_changed`
(`member_status.py:1028`) are both real events, already written with a
`target_user_id` in the same shape every other tracked event uses — but
neither was a key in `_AUDIT_EVENT_DESCRIPTIONS`, so `member_event_types =
list(_AUDIT_EVENT_DESCRIPTIONS.keys())` silently excluded both from the
query's `event_type.in_(...)` filter regardless of the target match.

**Failure scenario:** a manager investigating a member's account cannot see
that their MFA was administratively reset, or that a compliance exemption
was granted or revoked — two of the more security/compliance-relevant
actions this endpoint exists to surface.

**Fix:** added both to `_AUDIT_EVENT_DESCRIPTIONS`.

### USR-4 — LOW — A schema regression test silently skipped instead of verifying anything — ✅ FIXED

**What:** `test_user_roles_junction_has_both_fks` looked up a table named
`user_roles` in the reflected schema. `models/user.py:546` declares
`user_roles = user_positions` — a **Python-level** backward-compatible
alias, not a second database table; the live table is `user_positions`
(`:522`). The lookup always returned `None`, so the test always
`pytest.skip()`'d and never once checked the real junction table's foreign
keys.

**Fix:** look up `user_positions` and assert its FKs target `users` and
`positions` (not `roles` — `Role = Position` is also just an alias). Now
passes for real rather than skipping (verified: reverting the fix reproduces
the skip).

### USR-5 — LOW/MED — Unbounded lists over data that accumulates without deletion — 🚩 FLAGGED (corrected from "no defect")

**What:** the original pass of this section checked `list_users_with_roles`
and `get_archived_members` for the FIN-9/ELEC-12 unbounded-scan shape and
dismissed both, reasoning they're bounded by "real department headcount."
That reasoning is wrong: `archive_member` changes `User.status` without
deleting the row, so archived accounts accumulate for the organization's
entire lifetime, and `list_users_with_roles` filters only `deleted_at`, not
`status` — both grow with **all-time membership**, not current headcount.
The same pass also missed two more instances in this module's own file set:
`leave_widget_summary` (`member_leaves.py:57-69`, every `active` leave, and
end dates don't clear that flag) and `MemberLeaveService.list_leaves`
(`member_leave_service.py:160-177`), which runs `.scalars().all()` before
`member_leaves.py`'s callers apply an in-memory slice.

**Impact:** LOW today for a young/small department, growing over the life of
the organization; all four are `members.manage`-gated (not reachable by an
ordinary member) and org-scoped (not cross-tenant).

**Fix:** not applied — pagination on any of these four is a response-envelope
change needing a decision on default page size and whether existing callers
(the roster page, the leave widget) tolerate a paginated response without a
frontend change, the same category of judgment call FIN-7's export cap and
ELEC-12 were left flagged for. Mirrored into `KNOWN_LIMITATIONS.md`.

### USR-6 — Doc correction — Route inventory omitted a third bare-auth category

Covered under Route inventory above — not a code defect, a mischaracterization
of the existing (already-audited, ORU-8b-covered) design.

## Schema & migration notes

`users` and `organizations` are part of the initial schema migration — not
`create_all`-only, unlike several modules reviewed earlier in this rotation.
`member_leaves_of_absence` (`member_leaves.py`'s table) has its own dedicated
migration (`20260220_0300_add_member_leaves_of_absence.py`). The one
`ondelete="SET NULL"` FK in `models/user.py` is paired `nullable=True`.

## Guard tests added

- `tests/test_member_leave_audit_events.py` — three tests (create/update/
  delete) asserting the expected `leave_of_absence_*` audit row now exists
  with the correct `target_user_id` (USR-1).
- `tests/test_member_audit_history_scoping.py` — asserts the two new
  allowlist entries are present (USR-3), and a DB-backed test proving a
  manager's own audit-history no longer includes an event they performed on
  a different member, while still including a genuine self-action
  (USR-2) — verified to fail without the fix.
- `tests/test_database_schema.py::test_user_roles_junction_has_both_fks`
  (USR-4) — corrected in place to look up the live table name; verified to
  actually run (not skip) and to still pass against the real schema.
- `tests/test_privilege_ceiling_wiring.py` — two source-inspection tests
  asserting `create_member` calls both ceiling functions and
  `update_user_profile` calls the rank ceiling — cheap, and it fails loudly
  if either call is ever silently dropped (the exact shape of the original
  ORU-1/ORU-7d bugs), closing the coverage gap Codex identified in the
  existing helper-level tests.

## Completion gate

| Check                                                                                                                             | Result                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                     | ✅ 0 violations                                                                     |
| `black --check app/ tests/ alembic/`                                                                                              | ✅ clean                                                                            |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin)                                                                       | ✅ clean                                                                            |
| `validate_migrations.py --strict`                                                                                                 | ✅ 356 revisions, single head                                                       |
| `pytest tests/test_pii_exposure.py`                                                                                               | ✅ 37 passed (full file — corrected from a `-k` selector that matched only 2 of 37) |
| `pytest tests/ -k "user or organization or member_status or member_leave or rank_grant or role_edit or audit_history or ceiling"` | ✅ 320 passed, 1 skipped (unrelated `py_vapid` optional dep)                        |
| `tsc --noEmit`                                                                                                                    | ✅ 0 errors (no frontend file changed)                                              |
| `eslint .`                                                                                                                        | ✅ 0 errors/warnings (no frontend file changed)                                     |
