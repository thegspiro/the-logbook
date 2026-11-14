# Security Review — Feature 32: Locations & Kiosk (pass 11)

**Prefix:** `LOC11` · **Iteration:** 32 · **Reviewed:** 2026-10-30 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py` (the two fields this feature's public routes read), `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.

**Watchdog pickup** — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable (confirmed via
`ListAgents`, "No reachable agents"). PR #3857 (Feature 31, Scheduled tasks,
pass 11) had already merged into `main` (itself a prior watchdog pickup for
the same reason); `search_pull_requests` for `is:pr is:open
head:claude/security-review-` returned zero results, checked immediately
before starting. Row 32 was confirmed the next `⬜` row by reading the
rotation table directly on a freshly-fetched `main` (`8ecf004b`).

---

## Scope

Pass 10's baseline is PR #3787, tip `6c27ea21` (merged 2026-10-27). A
path-scoped `git log 6c27ea21..HEAD` against this feature's declared
backend/frontend files found six commits, none touching
`endpoints/locations.py`, `services/location_service.py`,
`endpoints/admin_hub.py`, `services/admin_hub_service.py`,
`models/location.py`, `models/admin_hub.py`, `schemas/location.py`,
`schemas/admin_hub.py`, `pages/LocationKioskPage.tsx`,
`pages/GuestCheckInPage.tsx` or `components/GuestEmailSignIn.tsx` — all ten
confirmed byte-identical to pass 10 via `git diff 6c27ea21..HEAD --`.

What did change, all read in full:

| Commit     | What it did here                                                                                                                                                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9458cb31` | Events & requests' own change (`guest-check-in-link`, outside this feature). It consolidates `_assert_guest_sign_in_open`'s two checks (`check_in_window_state` then `attendance_is_finalized`) into one new classmethod, `GuestCheckInService.guest_sign_in_state`, and repoints this feature's `display.py` at it. |
| `f2ea7ba5` | `AdminHubFrame.tsx` — holds the summary/metrics/nav/body invisible (not unmounted) until the first fetch and `nav` settle, to stop a load-time layout jump. Pure presentational.                                                                                                                                     |
| `e65c45b8` | Follow-up to `f2ea7ba5`: swaps `display: contents` wrappers for ordinary boxes (a WebKit click-target regression on hub cards) and adds a `data-held` attribute two e2e specs wait on.                                                                                                                               |
| `fd047c32` | Same change, continued — no new logic.                                                                                                                                                                                                                                                                               |
| `18e105b4` | `LocationsPage.tsx` header — `page-header`/`page-header-actions` utility classes replace a hand-rolled flex pair, plus `whitespace-nowrap` on the two header links, to stop them wrapping at tablet widths.                                                                                                          |
| `cf8fdae3` | Same utility-class swap on `RoomQRCodesPage.tsx`'s header.                                                                                                                                                                                                                                                           |

**`9458cb31` read for behavior preservation, not re-reviewed as new logic**
(the window/finalized-attendance gate itself is Events & requests' own rule,
already reviewed under Feature 16): `guest_sign_in_state` is an `is_open,
closed_reason = check_in_window_state(...); if is_open and
attendance_is_finalized(event): return False, "..."; return is_open,
closed_reason` — exactly the two checks `_assert_guest_sign_in_open`
previously ran inline, in the same order, same short-circuit (the finalized
check only runs when the window is already open, matching the removed
`if not is_open: raise ...` / `if attendance_is_finalized(...): raise ...`
sequence). `attendance_is_finalized` moved from an unused import in
`display.py` to a used one in `guest_check_in_service.py` (`event_service.py`
already exported it; confirmed via `grep` — no new coupling). The new
`GuestCheckInLinkResponse` fields (`is_open`, `closed_reason`,
`check_in_opens_at`, `check_in_closes_at`) are populated and consumed
entirely inside `events.py`'s `_guest_link_response` (Feature 16's own
authenticated endpoint) — this feature's public `display.py` routes neither
set nor read them.

**No new migration** touches `locations` or `admin_hub` or any FK to
`locations.id`: `git diff --stat 6c27ea21..HEAD -- backend/alembic/versions/`
lists 12 new revision files (follow-up forms, elections eligibility,
position-kind/committee seeds, member-type/voting-wait, a weather-alerts
task, three merge revisions, an encryption migration for leaves/training
waivers), none altering a table this feature declares. One
(`d8f1a4c27b93_positions_kind_and_committee_seeds.py`) contains the string
`locations.view` — a permission string seeded onto a committee position, not
a schema change — confirmed by `grep -n` against the full file.

## Route inventory

Re-enumerated by AST walk (`ast.walk` over all three files' `@router.<verb>`
decorators, the same script as pass 10): **17 routes, unchanged from pass
10** — 8 in `locations.py`, 6 in `display.py`, 3 in `admin_hub.py`. No drift
on any path, auth dependency or permission string; see pass 10's table in
`LOC10-32-locations-kiosk.md`, re-verified identical.

## Verified good ✅

- **Route count and gating unchanged**, re-derived by AST rather than trusted
  from the prior pass's table — 17/17, same auth dependencies and permission
  strings as pass 10.
- **`ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True` on every one** (Pitfall #2) — re-derived from
  `Base.metadata`: 5 `RESTRICT`, 9 `SET NULL`, unchanged count from pass 10,
  since neither `models/location.py` nor any other model file changed in
  this window.
- **The guest-sign-in consolidation is behavior-preserving** — `git diff`
  shows the window check still runs first, the finalized-attendance check
  still only fires when the window is open, and the same two
  `CodedHTTPException`s (`EVT_CHECKIN_WINDOW_CLOSED`) still fire from
  `_assert_guest_sign_in_open`, now via one classmethod instead of two calls.
- **The new response fields carry no new exposure on this feature's public
  surface** — `is_open`/`closed_reason`/`check_in_opens_at`/`check_in_closes_at`
  are written and read only inside Feature 16's authenticated
  `_guest_link_response`; `display.py`'s public routes import
  `GuestCheckInLinkResponse` nowhere.
- **No new migration reaches this feature's tables** — confirmed by path
  grep across all 12 new revision files, matching the "schema & migration
  notes" pattern every prior pass in this feature has used.

## Findings

**0 new findings.** Every file this diff touches either belongs to another
already-reviewed feature reaching in for shared logic (Events & requests,
`9458cb31`) or is a layout-only change with no data, auth or permission
surface (`AdminHubFrame.tsx`'s load-flash fix, the two page-header utility
swaps). Standing items re-confirmed OPEN, unchanged since pass 10:

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                   |
| ------- | -------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC10-2 | LOW      | 🚩 FLAGGED  | The guest-confirm token comparison; closing it is a test-fixture-convention decision, not a one-line guard (unchanged from pass 10).                                                                      |
| LOC8-2  | LOW      | 🚩 FLAGGED  | Hard-deleting a location nulls its location on 9 kinds of records (owner decision; `docs/KNOWN_LIMITATIONS.md` already reflects it).                                                                      |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection log line still carries the raw email — cross-feature, out of this feature's own files, flagged for Membership pipeline's own next pass. |

No edit to `docs/KNOWN_LIMITATIONS.md` needed — the LOC8-2 entry's figures
(9 affected tables) are unchanged.

## Guard tests added

None. No new invariant was introduced this pass to guard — the one behavior
change (`guest_sign_in_state`'s consolidation) is already exercised by
Feature 16's own test suite for the endpoint that calls it, and this
feature's existing `test_guest_email_first_sign_in.py` continues to cover
the window/finalized-attendance refusal path it always has (re-run below,
all passing against the renamed method).

## Completion gate

| Check                                                                                                                                                                                        | Result                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                                                                                                                             | ✅ 0 violations                                             |
| `black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                                                                                                                                    | ✅ clean, 2744 files unchanged                              |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                                                                                                                                 | ✅ clean                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                            | ✅ PASSED, 678 revisions, single head `f90b1124e6f4`        |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                                                                                                   | ✅ 17/17, unchanged from pass 10                            |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                            | ✅ 280 routes, 0 errors/warnings                            |
| Scoped `pytest -k "location or admin_hub or display or facilit or restrict_references or live_schema_drift or account_status_gates or guest_email_first or guest_check_in or guest_sign_in"` | ✅ 1020 passed, 1 skipped (optional `pywebpush`, unrelated) |
| `npm run typecheck`                                                                                                                                                                          | ✅ 0 errors                                                 |
| `npm run lint`                                                                                                                                                                               | ✅ 0 errors, 0 warnings                                     |
