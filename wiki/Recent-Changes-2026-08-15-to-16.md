# Recent changes: August 15–16, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is available in the source repository at
[`docs/CHANGE_AUDIT_2026-08-15_TO_16.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-15_TO_16.md).
Predecessor: [August 12–14](Recent-Changes-2026-08-12-to-14).

## Pages and connection points

| Area                        | Pages                                                                                                                                          | API/data connection                                                                                                                                                                                       | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facilities — nested rooms   | Facility detail → Rooms (tree, sub-room counts, add-a-room-inside); room form "Located inside" picker; Events/Training/Scheduling room pickers | `facility_rooms.parent_room_id` (self-FK, SET NULL); `GET /api/v1/facilities/rooms` returns `parentRoomId`, accepts `parent_room_id` / `top_level_only`; linked Location names carry the containment path | Parent must be same organization **and** same facility; no cycles; five levels maximum. Deleting a room moves its sub-rooms up one level — never deletes them. Moving a room to another building carries its subtree and re-points the linked Locations. A room with a missing parent shows at top level instead of vanishing. Clearing a form field now persists (explicit nulls). |
| Elections                   | Election detail candidate list                                                                                                                 | `GET /elections/{id}/candidates`                                                                                                                                                                          | Members see pending nominations **only while nominations are open** (so nominees can respond); afterwards, accepted candidates only. `elections.manage` always sees all.                                                                                                                                                                                                            |
| Member directory & profiles | Colleague profile; profile edit                                                                                                                | `GET /users/{id}/with-roles`; `PATCH /users/{id}/profile`                                                                                                                                                 | With only `members.view`, a colleague's profile omits email-verification, MFA status, last login, created/updated timestamps, notification preferences, and role permission lists (role names remain). `hire_date` is now a restricted field — leadership, secretary, or membership coordinator only — because it drives automatic membership-tier advancement.                     |
| Finance                     | External approver email links                                                                                                                  | Approval token consumed atomically, cleared on approve/deny                                                                                                                                               | One click, one action: a re-used link reports the step as already actioned, even under concurrent clicks.                                                                                                                                                                                                                                                                           |
| Public forms                | Public submission page                                                                                                                         | Daily cap enforced in the service, after validation                                                                                                                                                       | Bots and invalid submissions no longer consume the form's daily allowance; the cap counts valid submissions only and still answers `429` when reached.                                                                                                                                                                                                                              |
| Public endpoints            | All                                                                                                                                            | Redis-error handling in `public_rate_limit`                                                                                                                                                               | A Redis outage now falls back to the in-memory limiter instead of disabling public rate limiting. Login/registration remain fail-closed.                                                                                                                                                                                                                                            |
| Shared devices              | Logout                                                                                                                                         | `localStorage` draft purge                                                                                                                                                                                | Equipment-check drafts (`equipment-check-draft-*`) are now purged at logout alongside shift-report drafts and offline queues — the next person on a station computer cannot read them.                                                                                                                                                                                              |
| Onboarding                  | Setup wizard                                                                                                                                   | `onboarding_session_id` in `sessionStorage` (was `localStorage`)                                                                                                                                          | The setup session is tab-scoped and does not survive a browser restart; legacy stored identifiers are cleaned up automatically. Multi-tab onboarding is intentionally not shared.                                                                                                                                                                                                   |
| Theming                     | Public forms, ballots, status pages                                                                                                            | Root (`html`) now paints the themed gradient canvas                                                                                                                                                       | Fixes dark-mode white-on-white on pages outside the app shell, and paints the scrollbar gutter.                                                                                                                                                                                                                                                                                     |
| Module API clients          | All modules                                                                                                                                    | 401 → failed refresh now rejects the request                                                                                                                                                              | Callers no longer continue with an empty response while the browser redirects to login.                                                                                                                                                                                                                                                                                             |

## Database upgrade route

One migration in this window: `20260816_0001` (revises `20260814_0004`) adds
`facility_rooms.parent_room_id` with an index and a self-referential foreign
key `ON DELETE SET NULL`. No backfill — existing rooms come up top-level and
nothing changes until someone nests a room. SET NULL is the database backstop;
the application re-parents sub-rooms before deletion ever reaches it. Back up,
require one `alembic heads` result, run `alembic upgrade head`. (Later
same-day merges appended `20260816_0002`/`_0003` — storage-area barcode and
inventory-vendor backfills — so the head today is `20260816_0003`; see the
[Aug 10–16 rollup](Recent-Changes-2026-08-10-to-16).)

## Deployment notes

- **`docker-compose.prod.yml` requires Docker Compose v2.24.4+.** It uses
  `volumes: !override` so production clears the development file's source-tree
  bind mounts instead of merging them. If an older Compose errors on the tag,
  upgrade Compose — do not delete the tag.
- **Unraid:** the example environment now shows
  `ALLOWED_ORIGINS=https://logbook.yourdomain.com`. The default production
  posture enforces HTTPS, so a plain `http://<LAN-IP>:port` origin will not
  work as shipped; front the app with an HTTPS reverse proxy.

## Documentation and media actions

Screenshots are needed for: the nested Rooms tree with sub-room counts, the
"Located inside" picker (own subtree excluded), the delete-room confirmation
("sub-rooms move up a level"), a cross-module room picker showing indentation
and the containment path, the members-vs-managers candidate list in and out of
the nominations phase, a `members.view`-only directory profile beside the
`users.view` version, and a rejected `hire_date` edit. Replace or re-verify
any capture showing the old flat Rooms list, the room form without "Located
inside", a flat room picker, or a white-background dark-mode public page.

Before recording, update YouTube scripts **03/04** (facilities and rooms),
**04/06/07** (any location-picker B-roll), **12** (candidate visibility),
and **06/08** (directory privacy and the shared-computer logout claim). The
queue with per-script details is
[`docs/youtube-scripts/SCRIPT_CURRENCY.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/youtube-scripts/SCRIPT_CURRENCY.md).
