# Security Review — Feature 32: Locations & Kiosk (pass 10)

**Prefix:** `LOC10` · **Iteration:** 32 · **Reviewed:** 2026-10-28 · **PR:** [#3788](https://github.com/thegspiro/the-logbook/pull/3788)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes, unchanged), `app/services/location_service.py` (unchanged), `app/api/public/display.py` (**6 routes, up from 4** — gained `guest-lookup`/`guest-confirm`), `app/api/v1/endpoints/admin_hub.py` (3 routes, unchanged), `app/services/admin_hub_service.py` (unchanged), `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py` (all unchanged). Also checked: `app/services/facilities_service.py`'s `delete_room`/`remove_location` call site (unchanged — the pass's diff to that file is unrelated pagination work, confirmed by line range), and `app/services/guest_check_in_service.py` (the new shared callee — read for this feature's own endpoint wiring; its internal logic was read in full and verified by Feature 16's pass 11, see below).
**Frontend:** `pages/LocationsPage.tsx` (unchanged), `pages/RoomQRCodesPage.tsx` (one Tailwind class, unrelated mobile-layout fix), `pages/LocationKioskPage.tsx` (unchanged), `components/admin/AdminHubFrame.tsx` (unchanged).

**Watchdog pickup** — the dedicated loop session for this rotation (`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (no agent via `ListAgents`, re-checked fresh at the start of this run). No PR with a `claude/security-review-` head branch was open (`search_pull_requests`/`list_pull_requests`, 0 results beyond two unrelated docs PRs #3774/#3772). Row 32 was the first `⬜` on a freshly-fetched `main` (`8213ae8f`, after PR #3786, Feature 31 Scheduled tasks pass 10, merged).

---

## Scope

Pass 9's baseline is PR #3677, tip `5d38437a` (merged 2026-10-25). `git log 5d38437a..origin/main`, scoped to this feature's full file list, found changes in exactly one backend file and one frontend file carrying real feature content, plus a trivial CSS-class touch:

| File                                 | Change                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/public/display.py`          | **Real delta.** Two new public routes, `POST /{display_code}/events/{event_id}/guest-lookup` and `POST /{display_code}/events/{event_id}/guest-confirm`, from commit `dd034161` ("Sign in recruitment-event guests by email, recognising active applicants"). |
| `frontend/pages/RoomQRCodesPage.tsx` | One Tailwind class (`field-min` added to a search box) — part of an unrelated phone-layout commit (`19fe610e`), no logic change.                                                                                                                              |

**Not re-read, byte-identical to the baseline** (confirmed by `git diff --stat` returning nothing): `endpoints/locations.py`, `services/location_service.py`, `endpoints/admin_hub.py`, `services/admin_hub_service.py`, `models/location.py`, `models/admin_hub.py`, `schemas/location.py`, `schemas/admin_hub.py`, `pages/LocationsPage.tsx`, `pages/LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx`.

`app/services/facilities_service.py` also changed substantially in this window (+188/-23), but the diff is confined to new `page_maintenance_records`/`page_inspections` pagination helpers (Facilities' own feature, 12); `delete_room` (line 2660) and its call into `LocationService.remove_location` (line 2703) are outside every changed hunk — confirmed by line range, not by trusting the commit message.

**No new FK to `locations.id`** landed this window: `grep 'ForeignKey("locations.id"' app/models/*.py` returns the same 9 `SET NULL` columns pass 9 counted (`event_request.py`, `inventory.py` ×2, `meeting.py`, `nfc_tag.py`, `training.py` ×3), all still `nullable=True` — re-confirmed directly against the model source rather than trusted from the prior pass's count.

## Route inventory

Re-enumerated by AST (`ast.walk` over every `@router.{get,post,put,patch,delete}` decorator in each file, not a grep or a count carried forward):

- `locations.py`: **8 routes**, identical set to pass 9.
- `admin_hub.py`: **3 routes**, identical set to pass 9.
- `display.py`: **6 routes, up from 4** — the two new ones are the only change:
  - `POST /{display_code}/events/{event_id}/guest-lookup` — `dependencies=[Depends(_rate_limit_guest_lookup)]`, no `current_user` (public by design, matching every other route in the file).
  - `POST /{display_code}/events/{event_id}/guest-confirm` — `dependencies=[Depends(_rate_limit_guest_check_in)]`, same public shape.

**17 routes total across the feature, up from 15.** No existing route's method, path or auth posture changed.

## Verified good ✅

- **The new routes are correctly org-scoped through the display code, not through anything client-supplied.** Both call `_resolve_guest_event(db, display_code, event_id)`, the same helper the existing `guest-check-in`/`guest` routes use: it validates the display-code shape, resolves the `Location` by that code, then resolves the `Event` filtered on `Event.organization_id == location.organization_id AND Event.location_id == location.id` — the display code is the only credential in play and determines the organization, exactly as the existing routes' own (previously-reviewed) pattern requires. Every failure mode (bad code shape, unknown code, event not in that room, guest check-in switched off) answers the identical `EVT_SIGNIN_UNAVAILABLE` 404, so the new routes cannot be used to probe which events exist or which have the pipeline flag set, matching the file's own stated invariant for its pre-existing routes.
- **The two new routes are gated by the same rate-limit/abuse-resistance shape as the file's existing write routes**, not a new, weaker one: `_rate_limit_guest_lookup` (new, modeled directly on `_rate_limit_guest_check_in`) is 10/minute per IP with a 10-minute lockout; `guest-confirm` reuses `_rate_limit_guest_check_in` itself. Both sit behind `_require_email_first` (404 unless `event.guest_check_in_creates_prospect`, same uniform-404 shape) and `_assert_guest_sign_in_open` (window + finalized-attendance checks) before `daily_cap_exceeded` is touched, and the honeypot check in `guest_lookup` runs before any of those paid checks — the same "refuse before spending the cap" ordering the file's own `guest_check_in` route already established and this pass re-confirmed by direct read of the ordering, not inherited from the route's docstring.
- **The one-time token binding `guest-confirm` depends on is scoped to this room and this event, not just this prospect.** `GuestCheckInService.issue_confirm_token`/`read_confirm_token` (reviewed by Feature 16's pass 11 — see cross-feature note below) encode `{type, sub, evt, loc, org}` into a signed, 10-minute JWT, and `read_confirm_token`'s call from this file's `guest_confirm` passes the _current_ `event_id`/`location.id`/`location.organization_id` — a token issued at a kiosk in one room, for one event, is refused if replayed at another room or another event, closing the IDOR shape a bare prospect id in the request body would have opened. `check_in_known_prospect` (also Feature 16-reviewed) re-reads the prospect's status and org at confirm time rather than trusting the lookup's answer from a minute earlier, closing the TOCTOU window where the applicant could be withdrawn between the two taps.
- **The lookup's email-enumeration surface is bounded and audited, not merely rate-limited.** `guest_lookup` can only be reached on an event that both (a) is resolvable through a specific room's display code and a specific event in that room, and (b) opts into `guest_check_in_creates_prospect` — not every event in the department. Within that narrowed surface, every outcome (prospect / member / not-found) is logged via `log_audit_event` with the outcome and prospect id, never the typed email, so a run of misses from one caller is visible to the department even though the per-IP rate limit (10/min, 10-minute lockout) is the primary defense. This is the identical disposition Feature 16's pass 11 reached for the sibling event-link path reading the same service, not a new judgment call this pass is making independently.
- **No new finding in `facilities_service.py`.** The pagination refactor touching that file this window does not reach `delete_room`/`remove_location`; LOC9-2/LOC8-2's open count (9 tables silently losing their location on a hard delete) is unaffected.

## Cross-feature note, not a finding

The shared implementation (`GuestCheckInService.lookup_guest`/`issue_confirm_token`/`read_confirm_token`/`check_in_known_prospect`) was read in full and verified — correct JWT channel-scoping, org-scoped prospect re-check, PII-free audit payloads — by **Feature 16 (Events & requests) pass 11**, PR #3748, which explicitly deferred `display.py`'s own route wiring ("Locations' own rotation slot") to this pass. This pass reviewed exactly that deferred piece: the two new routes' dependency wiring, gate ordering and org-resolution in `display.py` itself, rather than re-deriving the service's internals Feature 16 already verified line-by-line.

## Findings

No new findings this pass. One standing finding re-confirmed unchanged:

### LOC9-2 — LOW — hard-deleting a location nulls its location on nine kinds of records — 🚩 still FLAGGED (owner decision, unchanged disposition)

**What:** unchanged since pass 8/9 — a location with nothing _blocking_ its deletion is hard-deleted, and every `ON DELETE SET NULL` reference to `locations.id` goes to NULL silently. Re-counted directly against the model source this pass (not carried forward from pass 9's number): still **9** tables (`event_requests`, `inventory_items`, `storage_areas`, `meetings`, `nfc_card_taps`, `training_programs`/`training_sessions`/`external_training_records` — the three `training.py` FKs).
**Where:** the FK columns' `ondelete="SET NULL"`; the decision point is still `LocationService.remove_location` (`location_service.py:285`, unchanged).
**Impact / fix:** unchanged — a product decision, not a code defect. Not applied. No change to the `KNOWN_LIMITATIONS.md` entry needed this pass (count unchanged).

## Schema & migration notes

- Alembic head is single (confirmed via `validate_migrations.py --strict`, see gate below): 666 revisions, head `0d9897752425`.
- No migration touches this feature's own tables this pass.
- `ondelete="SET NULL"` columns pointing at `locations.id` remain `nullable=True` on every one, 9 of 9 — re-checked directly against model metadata.

## Completion gate

| Check                                                                                                                                                                                                  | Result                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.4.1, CI-pinned)                                                                                                                                         | ✅ 0 violations                                                         |
| `python3.13 -m black --check app/ tests/ alembic/` (26.10.1, CI-pinned)                                                                                                                                | ✅ clean, 2706 files unchanged                                          |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.2, CI-pinned)                                                                                                                             | ✅ clean                                                                |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                                                                                   | ✅ 666 revisions, single head `0d9897752425`                            |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                      | ✅ 279 routes, 0 errors, 0 warnings                                     |
| Route re-enumeration (AST walk, this feature's 3 files)                                                                                                                                                | ✅ 17/17 (up from 15 — the 2 new display.py routes), no drift otherwise |
| Scoped `pytest -k "location or admin_hub or display or facilit or restrict_references or live_schema_drift or account_status_gates or guest_lookup or guest_confirm or guest_check_in or event_guest"` | ✅ 1022 passed, 1 skipped (optional `pywebpush`, unrelated)             |
| `npm run typecheck`                                                                                                                                                                                    | ✅ 0 errors                                                             |
| `npm run lint` (`--max-warnings 10`)                                                                                                                                                                   | ✅ 0 errors, 0 warnings                                                 |
| Scoped `npx vitest run` (this feature's page/component tests)                                                                                                                                          | ✅ 67 passed (5 files)                                                  |
