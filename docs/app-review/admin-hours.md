# Application Review — Admin Hours (Tier B)

**Prefix:** `AH2` · **Iteration:** B15 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/admin_hours.py` (1,042 L, 27 endpoints),
`services/admin_hours_service.py` (1,545 L), model `models/admin_hours.py`
**Frontend:** `modules/admin-hours`
**Prior audit:** `docs/module-audit/admin-hours.md` (iteration 15) — AH-1 (HIGH
self-credit), AH-2 (cross-tenant stale-session mutation), AH-3, AH-4 (SoD) fixed;
AH-5 (minor scoping omissions, flagged not-exploitable) left open.

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
FIN-7 float-money concern doesn't map here — admin hours are *time*, not currency,
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

**Flagged (LOW, unchanged):** the `start_date`/`end_date` query params on four
list/export/summary endpoints are `datetime.fromisoformat`-parsed outside any
try/except, so a malformed value yields a `500` instead of a `400` — a
module-wide status-code robustness gap, not a tenancy/integrity bug; recorded
here for a future robustness sweep (not a product decision, so not mirrored to
`KNOWN_LIMITATIONS.md`). Also noted: `edit_pending_entry` recomputes duration but
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

| Check | Result |
|-------|--------|
| `flake8` (service + endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_admin_hours_service` **19 passed** (+2 new `TestOrgScopedQueries`). No DB needed for this file. |
