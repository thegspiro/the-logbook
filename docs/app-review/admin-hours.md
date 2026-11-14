# Application Review — Admin Hours (Tier B)

**Prefix:** `AH2` · **Iteration:** B15 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-20 (pass 5)

**Backend:** `endpoints/admin_hours.py` (1,042 L, 27 endpoints),
`services/admin_hours_service.py` (1,545 L), model `models/admin_hours.py`
**Frontend:** `modules/admin-hours`
**Prior audit:** `docs/module-audit/admin-hours.md` (iteration 15) — AH-1 (HIGH
self-credit), AH-2 (cross-tenant stale-session mutation), AH-3, AH-4 (SoD) fixed;
AH-5 (minor scoping omissions, flagged not-exploitable) left open.

---

## Pass 5 (2026-10-20) — a mapping update acknowledged a null and changed nothing (1 fixed, 1 observation)

Lens for this pass: the update-payload discipline of B4–B14 driven through the real
handlers, plus the flush-and-return `updated_at` shape B14 found (GF2-1). This module
is in better shape than most of the rotation: every create and update service already
reloads `created_at` / `updated_at` after its flush (`refresh(x, ["created_at",
"updated_at"])` at eleven sites), the category update writes through `apply_updates`,
and the entry edits are deliberately explicit about null (`_apply_entry_edits`:
_"None leaves the description alone; a blank string clears it"_). All 27 routes were
inventoried: `admin_hours.manage` on every officer route, `get_current_user` on the
member's own clock-in / out / entries / edit / withdraw routes, which filter on the
caller's own `user_id`.

Driven over HTTP against the real schema with a `get_db` that commits on success and
rolls back on an exception, as `get_session` does: a real change through the category,
event-mapping and officer entry-edit `PATCH`es (all three save and answer 200, so the
GF2-1 shape is **not** present here), and `null` for every field of the two column-backed
update schemas.

### AH2-1 — LOW — `PATCH /event-mappings/{id}` with `percentage: null` or `is_active: null` answered 200 and changed nothing — ✅ FIXED

`update_event_hour_mapping(percentage=None, is_active=None)` reads `None` as "not
provided", and the handler passes `**data.model_dump(exclude_unset=True)`, so an
**explicit** null arrives as the same `None` an omitted key would. Both columns are NOT
NULL. Every other update path in the rotation answers that with a 400 ("cannot be
cleared"); this one acknowledged the write with a 200 and left the old value, the
mirror image of the bug CLAUDE.md #1 describes for the backend. Reproduced: 2 of 13 cases
failed on the unmodified schema — the other eleven passed, including the category's four
NOT NULL columns, which already answer 400.

**Fixed** in the request schema, not the service: a `field_validator` on
`EventHourMappingUpdate` answers 422 for an explicit null on either field and does nothing
when the key is omitted (a validator does not run for a key that was not sent). The
service's own "None means skip" contract is untouched, so the internal callers that pass
`None` on purpose keep working. The frontend type
(`EventHourMappingUpdate`) never allows null for either field, so no screen changes.

Tests: `tests/test_admin_hours_update_endpoints_integration.py` (13). Three real-change
tests (category description, mapping percentage, officer entry edit) each assert **200 and
that the value is in the table afterwards**; the null cases are derived from update schema
and model: a NOT NULL column must answer exactly 400 or 422 and keep its value, and a
nullable one must accept the null and clear. 2 fail with the schema change stashed, 11 pass
either way, and 0 are selected under the unit job's marker expression.

### Observation, not changed — the event-mapping `PATCH` has no caller in the app

`eventHourMappingService.update` (`modules/admin-hours/services/api.ts`) is defined, typed
and tested, and nothing in the frontend calls it: `HourTrackingSection` lists, creates and
deletes mappings, so a mapping can be added or removed but its percentage cannot be edited
or switched off from the screen. The endpoint is live and gated, so the wrapper is left in
place; whether the settings screen should gain an edit control is a product call, the same
shape as NOTIF2-6, and this one is small enough to record here rather than as an owner
decision of its own.

### Verified good ✅ (this pass)

- **Nothing unreferenced.** The AST scan (counting `tests/`, `scripts/`, `alembic/`) over
  the endpoint, service, model and schema found no unused module-level name or class
  method, and no `noqa` / `TODO`.
- **The AH-1 / AH-4 / AH-6 invariants** (manual entries start `PENDING`; approver cannot
  approve their own entry on either approval path) are covered by the existing service and
  scope suites, which pass.
- **Org scoping.** Every by-id read in the endpoint filters `organization_id`
  (`get_category`, the locked entry fetches, the mapping fetch), and the org-scoping ratchet
  passes.

### Not read (scope, stated plainly)

The 2,449-line service was read at its update, edit and mapping paths and scanned for dead
names; clock-in / out, auto-close, event-attendance crediting, the summary and report
builders and the export were left to their dedicated suites, which pass. The frontend module
was read at its category form, the update calls and the mapping wrapper.

### Completion gate (pass 5)

| Check                                                           | Result                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/`                                            | ✅ exit 0, no output                                               |
| `black --check app/ tests/`                                     | ✅ 1845 files unchanged                                            |
| `isort --check` (changed files)                                 | ✅                                                                 |
| `mypy app/schemas/admin_hours.py`                               | ✅ no issues                                                       |
| Related backend suites (14 files incl. the org-scoping ratchet) | ✅ 191 passed                                                      |
| New file                                                        | ✅ 13 pass; 2 fail without the fix; 0 under the unit job's markers |
| `check_route_permissions.py --strict`                           | ✅ 0 errors, 0 warnings                                            |
| Frontend                                                        | n/a — no frontend change                                           |

---

## Pass 4 (2026-08-09) — invariants re-verified, no code change

Re-verified this HIGH-sensitivity self-credit / SoD module holds:

- **AH-4 / AH-6 separation-of-duties intact** — `assert_different_person` guards
  the single-entry approve path, and `bulk_approve` skips approver-owned entries
  (both approval paths covered; 2 refs).
- **AH-1** manual entries start `PENDING`; **AH-5** internal queries org-scoped;
  **latent-500 lens clean** (`entry_method`/`status` enum-typed in the request
  schemas); **E712-free**.

Open item unchanged: the per-org SoD toggle (only for a genuine sole-officer
department) — a deliberate product/config decision.

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — verified clean, no code change

Re-verified this HIGH-sensitivity (self-credit / SoD) module's guards all hold:

- **AH-4 single-entry self-approval** — `review_entry`'s approve path calls
  `assert_different_person(approver_id, entry.user_id, …)` (service ~750).
- **AH-6 bulk-approve** — `bulk_approve` (service 889) iterates and **skips**
  self-owned entries (`if entry.user_id == approver_id: skipped_self += 1; continue`,
  ~917), so the bulk path can't self-approve; it returns a `skipped_self` count. The
  AH-1+AH-4 control is intact on both approval paths.
- **AH-1** — manual entries still start `PENDING`; **AH-5** internal queries stay
  org-scoped.

**Latent-500 lens clean:** the only enum columns (`entry_method`, `status`) are
properly typed in the request schemas — no free-string→ENUM path. **E712-free.** The
FIN-7 float-money concern doesn't map here — admin hours are _time_, not currency,
bounded by AH-1's 24h-per-entry cap.

### Still flagged (unchanged)

- **Per-org SoD toggle** (AH-4 refinement) — only if a genuine sole-officer department
  needs to self-approve; a deliberate product/config decision, unchanged.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · no tests changed (no code change).

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified the pass-1 fixes hold (AH-1 self-credit, AH-2 stale-session, AH-4 SoD
on the single-entry approve, AH-5's three org-scoped internal queries). The
six-lens sweep found **the single-entry AH-4 control had a sibling path that
bypassed it** — a genuine escalation the pass-1 finding-by-finding review missed.

### AH-6 — HIGH — Bulk-approve bypassed the AH-4 self-approval control — ✅ FIXED

`approve_or_reject` calls `assert_different_person(approver_id, entry.user_id)` on
approve — its own comment calls forbidding self-approval "the entire control,"
because officers hold `admin_hours.manage` over the very pool they log hours into.
But `bulk_approve` (`POST /entries/bulk-approve`, same permission) looped over the
entry ids and approved each with **no actor-vs-subject check**. Since
`create_manual_entry` always forces `status=PENDING`, an officer could create
their own manual entries and self-approve them in bulk — fully defeating AH-1+AH-4
at scale. **Fix:** the loop now skips entries the approver owns (they stay
`PENDING` for a different approver) rather than aborting the whole batch on one
self-owned id, and logs the skipped count for audit. 2 regression tests: a mixed
batch approves only the other member's entry (self-owned stays pending), and an
all-self batch approves nothing.

**Lenses clean:** 1 (update loops — `AdminHoursCategoryUpdate`/event-mapping
schemas expose no FK; `edit_pending_entry` re-validates `category_id` in-org), 2
(no relationship name projected), 3 (every admin by-id op filters
`organization_id`; clock-out is user-scoped, one org per user), 4 (no
join-derived `*_name`).

**Flagged (LOW) — ✅ now fixed, correction by `docs/security-review/AH-21-admin-hours.md` pass 12 (2026-10-30):**
the `start_date`/`end_date` query params on four list/export/summary endpoints
were `datetime.fromisoformat`-parsed outside any try/except, so a malformed
value yielded a `500` instead of a `400`. This item sat marked "unchanged"
through pass 5 (2026-10-20) even though the fix had already landed three days
earlier (2026-10-17, `admin_hours.py`'s `_parse_optional_date` helper, used by
all four endpoints this item named) — found stale by the security-review
rotation, which also added the regression coverage the original fix shipped
without (`TestParseOptionalDate` in
`tests/test_admin_hours_endpoint_permission_scope.py`). Also noted: `edit_pending_entry` recomputes duration but
(unlike create) doesn't re-run the future/24h/overlap guards — integrity holds
because the entry stays `PENDING` under AH-4, so it's a parity nit, not a hole.

---

## Pass 1 (2026-08-06)

## Scope

Tier B: the one open finding plus the broader lens. This is a clean module — the
time-integrity and self-service-ownership guarantees were re-confirmed (clock-out
duration computed server-side, no member-callable edit/delete, approvals org-scoped
and SoD-guarded). AH-5 was the only remaining item.

## Findings

### AH-5 — LOW — Minor scoping omissions — ✅ FIXED (defense-in-depth)

Three internal queries filtered a narrower key than `organization_id`. None were
exploitable (each was already constrained by an org-verified parent or the
one-org-per-user invariant), but the codebase's standard is that every by-id /
aggregate query is org-scoped, so all three are now uniform:

- **`_get_active_session`** (and `get_active_session`) — took only `user_id`; both
  now take and filter `organization_id`, and `get_active_session`'s category read
  is org-scoped too. The endpoint passes `current_user.organization_id`.
- **`_check_overlap`** — filtered `user_id` only; now also filters
  `organization_id` (the manual-entry overlap check).
- **`delete_category`** active-session count — now filters `organization_id`
  alongside `category_id`.

`AdminHoursEntry.organization_id` already exists, so these are pure filter
additions with no schema change. **2 regression tests added**
(`TestOrgScopedQueries`) asserting the `organization_id` predicate is present in
the compiled `_get_active_session` and `_check_overlap` queries.

## Verified good ✅ (re-confirmed)

- AH-1 (manual entries always start PENDING; `clock_out_at <= now`; 24h cap),
  AH-2 (`auto_close_stale_sessions` takes an optional org; endpoint scoped, cron
  global), AH-3 (`approved_at` stamped on auto-approval), AH-4 (approve calls the
  shared `assert_different_person` SoD guard) all hold.
- 27 endpoints authed; writes/approvals require `admin_hours.manage`; clock-out
  duration computed server-side (no client-trusted duration, no negative); no
  member-callable edit/delete; `create_manual_entry` stamps `user_id` from the
  caller (no impersonation).

## Dead code / duplication

None found. No TODO/FIXME.

## Documentation

`docs/module-audit/admin-hours.md` updated: AH-5 resolved. The AH-4 note (SoD is
unconditional; a sole-officer department needs a second `admin_hours.manage`
holder) stands as the accepted ISO 27001 A.5.3 posture.

## Future development

1. **Per-org SoD toggle** (AH-4 refinement) — only if a genuine sole-officer
   workflow proves necessary; the shared guard is currently unconditional by
   design.

## Completion gate

| Check                                | Result                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `flake8` (service + endpoint + test) | ✅ 0 violations                                                                                          |
| `black --check`                      | ✅ formatted                                                                                             |
| `tsc --noEmit`                       | ✅ n/a — no frontend change                                                                              |
| backend tests                        | ✅ `test_admin_hours_service` **19 passed** (+2 new `TestOrgScopedQueries`). No DB needed for this file. |
