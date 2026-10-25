# Security Review — Feature 32: Locations & Kiosk (pass 9)

**Prefix:** `LOC9` · **Iteration:** 32 · **Reviewed:** 2026-10-25 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/api/public/display.py` (4 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`. Also checked: `backend/alembic/versions/20261023_1916_a8c3b50b6d9b_nfc_card_taps_and_auto_suspend.py` (adds a new FK to `locations.id`) and `app/services/facilities_service.py`'s `delete_room` (the one other caller of `remove_location`).
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx`.

**Watchdog pickup** — the dedicated loop session for this rotation (`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (no agent via `ListAgents`).

---

## Scope

Pass 8's baseline is PR #3530, tip `47fbdce7` (merged 2026-10-21). `git log 47fbdce7..HEAD`, scoped to this feature's full file list, found changes in exactly one backend file and three frontend files — `location_service.py`, `endpoints/locations.py`, `display.py`, `admin_hub.py`, `admin_hub_service.py`, and both model files are byte-identical to the baseline:

| File                                                   | Change                                                                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas/location.py`                                  | Repo-wide numeric-bounds sweep (`74638250`) added `le=INT32_MAX` to `capacity` on both `LocationBase` and `LocationUpdate`, alongside the existing `ge=1`.            |
| `pages/LocationKioskPage.tsx`                          | a11y contrast-only fix: the "Check-In Active" badge's light-mode text moved from `text-green-700` to `text-green-800`.                                                |
| `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx` | Both gained a "Card Readers" link to `/locations/card-readers`, gated by `canViewReaders` (`locations.manage_nfc_tags` OR `locations.manage` OR `facilities.manage`). |

**Not re-read, byte-identical to the baseline** (confirmed by diff, not inherited from pass 8's claim): `endpoints/locations.py`, `services/location_service.py`, `api/public/display.py`, `endpoints/admin_hub.py`, `services/admin_hub_service.py`, `models/location.py`, `models/admin_hub.py`, `schemas/admin_hub.py`, `components/admin/AdminHubFrame.tsx`.

One migration outside this feature's own files touches `locations.id`: `20261023_1916_a8c3b50b6d9b` (Apparatus & NFC's `nfc_card_taps` table, reviewed by Feature 31's pass 9 for its scheduled-task caller) adds `nfc_card_taps.location_id`, `ForeignKey("locations.id", ondelete="SET NULL")`, `nullable=True` — correct per Pitfall #2, and read here only for its effect on this feature's reference-tracking invariant (below).

## Route inventory

Enumerated from the live FastAPI app's merged OpenAPI schema (not a grep) plus each route's `dependant.dependencies` for auth/permission: **15 routes, identical to pass 8's table** — same paths, same methods, same `PermissionChecker` permission strings (`locations.create`/`.manage` on POST, `locations.edit`/`.manage` on PATCH and regenerate-display-code, `locations.delete`/`.manage` on DELETE, `locations.manage_nfc_tags` on badge-check-in), same `get_current_user`/`get_current_active_user` on the plain-read and admin-hub routes, same four public routes carrying a `_rate_limit_*` dependency. No drift since pass 8.

## Verified good ✅

- **The capacity bound is sound and additive.** `le=INT32_MAX` only rejects a value no legitimate room capacity would ever reach; `ge=1` is unchanged. No existing caller is affected.
- **The a11y contrast fix changes no logic.** Tailwind class only.
- **The new "Card Readers" links are correctly gated, and match their destination's own gate exactly.** `/locations/card-readers` (`frontend/src/modules/facilities/routes.tsx:164-174`) requires `requiredAnyPermission={['locations.manage', 'facilities.manage', 'locations.manage_nfc_tags']}` — the identical three permissions, same OR logic, as `canViewReaders` in both `LocationsPage.tsx` and `RoomQRCodesPage.tsx`. A user who sees the link can open the page; a user who can't see it would hit the same gate if they typed the URL directly. `CardReadersPage` itself and its backend (`/nfc-activity/readers`) are Apparatus & NFC's surface (feature 13), not this feature's — consistent with Feature 31's pass-9 cross-feature note that feature 13's new NFC admin surface (Member ID Cards, and now Card Readers) hasn't had its own re-review since landing. Nothing in _this_ feature's files needed changing to add the links.
- **The new `nfc_card_taps.location_id` FK doesn't break the delete-or-deactivate invariant.** It is `ON DELETE SET NULL` (non-blocking), so `tests/test_location_restrict_references.py` correctly does not require it in `_RESTRICTING_LOCATION_REFERENCES` — re-ran the guard test directly against the current schema (3 passed) rather than assuming it from the migration's `ondelete` clause alone. It does, however, widen LOC8-2's open decision from 8 to 9 tables that silently lose their location on a hard delete (see below).
- **All prior-pass findings remain fixed**; LOC8-1's guard test still passes against the now-larger schema, confirming it checks the live metadata rather than a frozen count.

## Findings

No new findings this pass. One standing finding's scope widened by a change outside this feature, not by a defect in it:

### LOC8-2 — LOW — hard-deleting a location nulls its location on now nine kinds of records — 🚩 still FLAGGED (owner decision, unchanged disposition; count updated)

**What:** unchanged from pass 8 — a location nothing blocking references is hard-deleted, and every `ON DELETE SET NULL` reference to `locations.id` goes to NULL silently. Pass 8 counted eight such tables; Apparatus & NFC's `nfc_card_taps` (added 2026-10-23, outside this feature) is now a ninth.
**Where:** the FK columns' `ondelete="SET NULL"`; the decision point is still `LocationService.remove_location` (`location_service.py:285`, unchanged).
**New table's category:** `nfc_card_taps` is a tap log, not a historical compliance record — closer to `inventory_items`/`storage_areas` (an "ordinary state to clear") than to `training_records` (where losing _where_ training happened may matter). Added to `docs/KNOWN_LIMITATIONS.md`'s table under that category.
**Impact / fix:** unchanged from pass 8 — a product decision, not a code defect. Not applied.

## Schema & migration notes

- Alembic head is single (confirmed via `validate_migrations.py --strict`, see gate below).
- `ondelete="SET NULL"` columns pointing at `locations.id` remain `nullable=True` on every one, including the new `nfc_card_taps.location_id` (Pitfall #2): checked directly against the model metadata, 9 of 9.

## Completion gate

| Check                                                                                                                                | Result                                         |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `python3.13 -m flake8 app/ tests/ alembic/` (7.3.0, CI-pinned)                                                                       | ✅ 0 violations                                |
| `python3.13 -m black --check app/ tests/ alembic/` (26.5.1, CI-pinned)                                                               | ✅ clean                                       |
| `python3.13 -m isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned)                                                           | ✅ clean                                       |
| `python3.13 scripts/validate_migrations.py --strict`                                                                                 | ✅ single head                                 |
| Route re-enumeration (OpenAPI schema + live `dependant`)                                                                             | ✅ 15/15, no drift from pass 8                 |
| `pytest tests/test_location_restrict_references.py`                                                                                  | ✅ 3 passed                                    |
| Scoped `pytest -k "location or admin_hub or display or facilit or restrict_references or live_schema_drift or account_status_gates"` | ✅ 883 passed, 1 skipped (optional dependency) |
| `npm run typecheck`                                                                                                                  | ✅ 0 errors                                    |
| `npm run lint`                                                                                                                       | ✅ 0 errors, 0 warnings                        |
