# Change audit: August 15–16, 2026

Net changes merged to `main` after the
[August 12–14 audit](./CHANGE_AUDIT_2026-08-12_TO_14.md) snapshot (post
PR #1456), through PR #1471 on 2026-08-16. One schema migration, one
feature (nested facility rooms), nine security/privacy fixes with a
follow-up red-team review, a coverage-measurement correction, and two
frontend session/rendering fixes.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 15–16 section). Wiki handoff:
[`Recent-Changes-2026-08-15-to-16`](../wiki/Recent-Changes-2026-08-15-to-16.md).

## Release map

| Area                                 | PRs                  | Pages / connection points                                                                                                                                                                       | API / data points                                                                                                                                                                                                                                    | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facilities — nested rooms            | #1461                | Facility detail → Rooms section (tree view, sub-room counts, add-a-room-inside per row, "Located inside" picker on the room form); cross-module room picker in Events, Training, and Scheduling | `facility_rooms.parent_room_id` (new, self-FK, `ON DELETE SET NULL`); `GET /api/v1/facilities/rooms` returns `parentRoomId`, accepts `parent_room_id` / `top_level_only`; `roomTree.ts` helpers; linked `Location` name carries the containment path | Parent must be same org **and** same facility; no cycles (a room cannot enter its own subtree); depth capped at `MAX_ROOM_NESTING_DEPTH` = 5 (backend `facilities_service.py` is the authority, frontend mirrors it); deleting a room re-parents children one level up, never cascades; moving a room to another facility carries its subtree and re-syncs Location `facility_id`; a room whose parent is missing surfaces at top level rather than disappearing; room form sends explicit nulls so cleared fields persist |
| Elections — candidate visibility     | #1462                | Election detail candidate list (member view)                                                                                                                                                    | `GET /elections/{id}/candidates` → `ElectionService.list_candidates(accepted_only=…)`                                                                                                                                                                | Pending (unaccepted) nominations are returned only while the election status is `nominations`, or to callers with `elections.manage`. Outside that phase members see accepted candidates only. Managers always see all.                                                                                                                                                                                                                                                                                                    |
| Users — profile privacy              | #1464, #1469         | Member directory profile; admin member edit                                                                                                                                                     | `PATCH /users/{id}/profile` restricted-field set now includes `hire_date`; `GET /users/{id}/with-roles` clears account metadata for `members.view`-only callers (`_clear_directory_only_profile_metadata`)                                           | `hire_date` drives automatic membership-tier advancement, so it now requires leadership / secretary / membership coordinator like rank, station, platoon, membership number. Directory-only callers no longer receive `email_verified`, `mfa_enabled`, `last_login_at`, `created_at`, `updated_at`, notification preferences, or role permission lists; role **names** stay (the profile shows them); `users.view`, members-managers, and the subject are exempt.                                                          |
| Finance — approval tokens            | #1465                | External approver email link (approve/deny without login)                                                                                                                                       | `FinanceService.approve_step_by_token` / `deny_step_by_token`: `SELECT … FOR UPDATE` + `approval_token = None` on action                                                                                                                             | A token is consumable exactly once, even under concurrent clicks; the second request sees the already-actioned state. No schema change — the token column is cleared, not migrated.                                                                                                                                                                                                                                                                                                                                        |
| Public forms — daily cap             | #1466                | Public form submission page                                                                                                                                                                     | Cap moved from the route (`api/public/forms.py`) into `FormsService.submit_public_form(enforce_daily_cap=True)`; `PUBLIC_DAILY_CAP_ERROR` → `429`                                                                                                    | Only submissions that pass authorization and validation count toward `PUBLIC_FORM_DAILY_LIMIT`; honeypot hits and rejected payloads no longer exhaust the allowance (an anonymous bot can no longer deny service on a form's daily quota). Honeypot still returns fake success.                                                                                                                                                                                                                                            |
| Rate limiting — Redis outage         | #1467                | All public endpoints behind `public_rate_limit`                                                                                                                                                 | `is_rate_limited(raise_on_error=True)` re-raises Redis errors so `public_rate_limit` falls to its in-memory fallback limiter                                                                                                                         | Previously `fail_closed=False` meant a Redis error silently disabled public rate limiting. Security-critical fail-closed paths (login, registration) unchanged.                                                                                                                                                                                                                                                                                                                                                            |
| Deployment — prod volumes            | #1468                | —                                                                                                                                                                                               | `docker-compose.prod.yml` `volumes: !override`                                                                                                                                                                                                       | Clears development bind mounts instead of merging them; **requires Docker Compose v2.24.4+**. Older Compose versions error on the tag — upgrade Compose, do not remove the tag.                                                                                                                                                                                                                                                                                                                                            |
| Deployment — Unraid origin           | #1463                | —                                                                                                                                                                                               | `unraid/.env.example` `ALLOWED_ORIGINS=https://logbook.yourdomain.com`                                                                                                                                                                               | Default posture enforces HTTPS, so the previous `http://<LAN-IP>:7880` example was unusable as shipped. Existing installs with a working HTTPS origin are unaffected.                                                                                                                                                                                                                                                                                                                                                      |
| Shared devices — draft purge         | #1470                | Logout (station/shared computers)                                                                                                                                                               | `clearAllDrafts()` sweeps `equipment-check-draft-*` alongside `shift-report-draft-*`, including orphaned keys                                                                                                                                        | Red-team RT-08 (medium, CWE-922): equipment-check drafts survived logout and were readable by the next browser user. Unrelated browser preferences are preserved. See [`security/RED_TEAM_REVIEW_2026-08-16.md`](./security/RED_TEAM_REVIEW_2026-08-16.md).                                                                                                                                                                                                                                                                |
| Onboarding — session storage         | #1459                | Onboarding wizard (all steps)                                                                                                                                                                   | `onboarding_session_id` moved `localStorage` → `sessionStorage`; legacy key removed on load and on `clearSession()`                                                                                                                                  | The session can authorize setup mutations, so it is now tab-scoped and does not survive browser restart. Multi-tab onboarding is intentionally no longer shared state. CSRF token remains a `SameSite=Strict` cookie. [`ONBOARDING_FLOW.md`](./ONBOARDING_FLOW.md) has the full model.                                                                                                                                                                                                                                     |
| Theming — dark canvas                | #1459                | Every page outside `AppLayout`: public forms, ballots, status pages                                                                                                                             | Gradient canvas + `scrollbar-gutter: stable` moved `body` → `html`                                                                                                                                                                                   | Dark-mode surface tokens are translucent white by design; without a painted root canvas those pages composited over browser-default white (white page, light-on-light text). The root owns the canvas because the scrollbar gutter sits outside the body's box.                                                                                                                                                                                                                                                            |
| Module API clients — refresh failure | (direct, `a9204af9`) | Every module using `createApiClient`                                                                                                                                                            | On 401 → refresh failure: `handleExpiredSession()` + `reportApiError()` + **reject** the original request                                                                                                                                            | Previously the client redirected to `/login` but resolved the request with `undefined`, letting callers continue against a missing Axios response mid-navigation.                                                                                                                                                                                                                                                                                                                                                          |
| CI / coverage                        | #1471                | —                                                                                                                                                                                               | `frontend/vitest.config.ts` `coverage.include`; backend `--cov-fail-under=51` + separate 35% gate on `api/services/core/utils`; `stryker.pilot.json`                                                                                                 | Frontend coverage previously counted only imported files, hiding 384 of 758 source files; honest baseline is 33.10% lines and the ratchet floors were re-based (31/23/25/30) — not a regression. Backend logic layers gate separately so ~97%-covered declarative models/schemas can't mask regressions. Mutation pilot: 90.6%; survivors cluster in `apiCache.ts` eviction.                                                                                                                                               |

## Alembic route (upgrade data path)

One revision this window:

| Revision        | Revises         | File                                        | What it does                                                                                                                                                            |
| --------------- | --------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260816_0001` | `20260814_0004` | `20260816_0001_add_facility_room_parent.py` | Adds `facility_rooms.parent_room_id` VARCHAR(36) NULL, index `idx_facility_rooms_parent`, self-referential FK `fk_facility_rooms_parent_room` with `ON DELETE SET NULL` |

`20260816_0001` was the single head at this audit's snapshot; later
same-day merges appended `20260816_0002` (storage-area barcode backfill) and
`20260816_0003` (inventory vendors — renumbered from a colliding `_0002`), so
the current head is `20260816_0003`. The migration is introspection-guarded
(no-op if the table is absent or the column already exists) and the downgrade
removes FK, index, and column defensively in that order.

Operational notes:

- **`ON DELETE SET NULL` is a deliberate backstop, never CASCADE** — removing a
  room must not silently delete the sub-rooms (and their kiosk codes and stored
  inventory) beneath it. The service re-parents children onto the deleted
  room's own parent before the constraint would ever fire.
- No data backfill: existing rooms upgrade with `parent_room_id = NULL` (all
  top-level) and behavior is unchanged until someone nests a room.
- Standard procedure: back up, require exactly one `alembic heads` result, run
  `alembic upgrade head`.

## End-to-end data paths and sharing boundaries

- **Nested rooms → Locations → Events/QR check-in.** A room's linked Location
  record now derives its name from the containment path ("Quartermaster's
  Storage — Volunteer Office — Station 1"), and its `facility_id` follows the
  room when the room changes buildings. Anything consuming Locations (event
  location picker, kiosk displays, QR directory) sees the path automatically.
  Nesting validation is org-scoped end to end: the parent room must be in the
  caller's organization and the same facility.
- **Election candidates.** The member-facing list is now phase-dependent. Any
  integration or export that read pending nominations through the member list
  outside the nominations phase must use an `elections.manage` credential.
- **Directory profiles.** `members.view` now yields strictly less data than
  `users.view` on `GET /users/{id}/with-roles`. Consumers must tolerate the
  redacted fields being `null` (`UserProfileResponse` makes them Optional).
- **Public form quota.** The cap decision moved a layer down, into the service,
  and is now made after honeypot + validation. Anything invoking
  `FormsService.submit_public_form` directly gets cap enforcement only when it
  passes `enforce_daily_cap=True` (the public route does).
- **Shared-device residue.** Post-logout, `localStorage` holds neither
  shift-report nor equipment-check drafts; IndexedDB offline queues were
  already purged. Onboarding session identity is tab-scoped.

## Documentation and media disposition

### SCREENSHOT NEEDED (new captures)

Tracked in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md)
with exact demo-data requirements:

1. Rooms section rendering a nested tree with sub-room counts and the
   add-a-room-inside row action.
2. Room form "Located inside" picker, showing the excluded own-subtree and a
   depth-capped selection.
3. Delete-room confirmation stating sub-rooms move up one level.
4. Cross-module room picker (an event form) with indented sub-rooms and the
   containment path under the selected room.
5. Member-vs-manager candidate list during and after the nominations phase.
6. Directory profile as seen with only `members.view` (redacted metadata)
   beside the same profile with `users.view`.
7. Profile edit rejecting a `hire_date` change without the coordinator grant.

### REPLACE / re-verify (existing images invalidated)

- `06-11-facility-detail.png` — re-verify; replace if the Rooms section is
  visible with the old flat list.
- Any capture showing a flat Rooms list or the old room form without the
  "Located inside" field (the Rooms section was substantially re-rendered).
- Event/training/scheduling captures showing the room picker with a flat,
  un-indented list — re-verify; the picker now indents sub-rooms and prints
  the containment path.
- Dark-mode captures of public pages (forms, ballots, status) taken before the
  canvas fix showed a white background — replace any that did.

### YouTube scripts

Queued in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md):
facilities/rooms narration (scripts 03, 04), any location-picker B-roll
(04, 06, 07), elections candidate-list claims (12), member privacy/directory
narration (06), and the shared-computer logout claim (06, 08). Nothing is
recorded yet, so these are pre-take corrections, not re-records.

## Verification checklist

- [ ] `alembic heads` returns exactly `20260816_0001`; `alembic upgrade head`
      clean on a backup-verified database.
- [ ] Nest a room, delete its parent, confirm the child re-parents (not
      deletes) and its Location name re-syncs.
- [ ] Attempt to nest a room under its own descendant and past depth 5 — both
      rejected with a clear message, surfaced in the toast.
- [ ] As a member without `elections.manage`, list candidates on a closed
      election — pending nominations absent.
- [ ] As a `members.view`-only member, open a colleague profile — no MFA/login
      metadata, no role permission lists.
- [ ] Click a finance approval email link twice — second click reports the
      already-actioned state.
- [ ] Submit an invalid public form repeatedly — valid submissions still
      accepted afterward (cap not consumed).
- [ ] Log out on a shared machine — no `equipment-check-draft-*` or
      `shift-report-draft-*` keys remain.
- [ ] `docker compose version` ≥ 2.24.4 anywhere `docker-compose.prod.yml` is
      deployed.
