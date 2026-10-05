# Application Review — Locations & Kiosk

**Prefix:** `LOC` · **Iteration:** A8 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-10-04 (pass 3)

## Pass 3 (2026-10-04) — the kiosk grew a card reader and a revocation button

The feature has roughly doubled since pass 2: `locations.py` 294 → 434 lines and
6 → 8 routes, `location_service.py` 279 → 394, `public/display.py` to 550 lines
and 4 routes, `LocationKioskPage.tsx` 246 → 317, plus two new pages
(`RoomCheckInPage`, `RoomQRCodesPage`) and a new permission pair
(`locations.manage_nfc_tags`). **6 fixes, 2 flagged.**

**Dimension 2 (security) was deliberately not re-derived.** The security
rotation reached this same feature _today_ — `LOC5-32-locations-kiosk.md`, its
fifth pass — and enumerated all 15 routes, their auth, permissions, org
scoping, rate limits and the badge-tap response's data minimisation, with one
fix (LOC5-32-1). Re-running that lens would have produced a worse copy of a
better document. This pass re-read its open items and spent its effort on the
five dimensions it does not cover: correctness, duplication, dead code,
documentation and future development. Where the two overlap below, it is to
check a prediction rather than to re-audit.

**LOC-3 is resolved, by the branch nobody picked.** Pass 2 said the dead
authenticated `GET /locations/{id}/display` should be deleted or given a
caller; it got a caller — `RoomCheckInPage`, where a member's phone lands after
tapping a room's own NFC tag. Two consequences, one a non-finding and one a
finding, are recorded as the re-verification below and LOC-40.

### LOC-33 — MED — Rotating a leaked display code did not take the kiosk down — ✅ FIXED

`POST /locations/{id}/regenerate-display-code` is new since pass 2 and is the
documented way to revoke a leaked code: its own docstring says "Invalidates the
current code immediately — posted QR codes and kiosk tablets pointing at the old
`/display/{code}` URL stop working."

The URL stopped working. The tablet did not.

`LocationKioskPage` polls every 30 seconds. On a 404 it set an error message and
returned **without clearing `data`** — and the permanent-error screen is guarded
on `if (error && !data)` (`LocationKioskPage.tsx:163`). So after a rotation every
poll 404s, every poll leaves the previous payload in place, and the wall-mounted
tablet keeps rendering the room's last-known events **indefinitely** — behind a
green "connected" icon, because `connected` is only cleared in the `catch`
branch that handles network failure. The same path covers deactivating the room
or the whole department, both of which make `get_location_by_display_code` stop
resolving the code.

So the one screen revocation exists to clear was the one place it never
reached. An officer who rotates a code because it leaked has no way to tell,
from the tablet, that anything happened.

**Fix:** clear `data` on the 404. A 404 is a definitive answer — this code no
longer resolves — and is categorically different from the transient failure
handled in the `catch` below it, which deliberately keeps showing the last
payload with a disconnected badge so a network blip does not blank a working
display. That distinction is now stated in the code.

The message was changed too, because it will now actually be read: "Display not
found. Check the URL." asks something of a reader standing at a wall-mounted
tablet with no URL bar, no keyboard, and no way to know a code was rotated. It
now names the situation and the remedy without over-claiming which of the three
causes applies.

Two tests, both driving a real poll with fake timers: a revoked room stops
showing its events, and a transient failure still does not blank the display.
Mutation-verified — removing the `setData(null)` fails the first and leaves the
second green, which is the pair behaving as intended.

### LOC-34 — MED — An uncapped duplicate check turned a duplicate pair into a permanent 500 — ✅ FIXED

The (name, building) uniqueness rule is enforced **only in application code**.
`Location.__table_args__` declares four plain indexes — `ix_locations_name`
among them — and **no unique constraint**, so nothing in the schema backs the
rule. The check is also a read-then-write with no lock, so two concurrent
creates can both pass it and leave a duplicate pair behind.

Once that pair exists, `scalar_one_or_none()` raises `MultipleResultsFound` on
**every later create or update of that name**. That is not a `ValueError`, so
`handle_service_errors` falls through to its `except Exception` arm and renders
it as a **500 with the generic fallback** — "Failed to create location" — and the
real cause reaches nobody but the logs. One name in one building becomes
permanently unsaveable, with no message saying why.

This is the shape pass 1 called out and cleared for a different query: it noted
`get_location_by_display_code` uses `scalar_one_or_none()` and would 500 on a
duplicate, "but `display_code` is `unique=True` **globally** … here the
constraint actually backs the assumption." For (name, building) there is no such
constraint, and the same pattern was two call sites away.

**Fix:** `.limit(1)` on both duplicate queries. The check only ever needed to
know whether a match exists; capped at one row, multiplicity is
unrepresentable and a duplicate still reports as the clean 400 it should be.
The real repair is a unique constraint, which is a migration and a decision
about `building`'s nullability in MySQL — flagged as LOC-41 rather than taken
here.

An earlier version of this fix used `.scalars().first()` and broke two existing
tests whose db stub models `scalar_one_or_none` and nothing else. `.limit(1)`
with the original call shape is both the smaller diff and the better fix — the
cap, not the accessor, is what makes multiplicity impossible — so the stubs
were left alone rather than extended.

### LOC-35 — LOW — The kiosk's 30-second poll dragged every RSVP along with it — ✅ FIXED

`get_current_events_in_check_in_window` carried
`.options(selectinload(Event.rsvps))`, and **no caller reads the collection**.
Checked all three: both display endpoints project scalar columns into
`QRCheckInData`, and `NfcTagService._only_event_checked_into` issues its own
query narrowed to one member's open check-ins rather than walking
`event.rsvps`. `EventService._get_check_in_window`, which every caller runs over
the result, is a `@staticmethod` reading scalar columns only.

So a drill with 150 RSVPs loaded 150 unread rows per poll, per open event,
behind a public unauthenticated endpoint that every kiosk hits every 30 seconds.

**Fix:** removed, with the now-unused import. Verified safe before removing
rather than after: in async SQLAlchemy, touching an unloaded lazy relationship
raises `MissingGreenlet`, so a caller that _did_ read `event.rsvps` would have
started failing at runtime on a public endpoint. Locked by a test asserting the
statement carries no loader options at all, which is mutation-verified.

### LOC-36 — LOW — Two comments documented a 30-minute default that has always been 60 — ✅ FIXED

`locations.py` said the canonical window's `check_in_minutes_before` "defaults
to 30", and `location_service.py`'s docstring said "FLEXIBLE opens N minutes
before start (default 30)". The default is **60**: `Event.check_in_minutes_before`
is `Column(Integer, nullable=True, default=60)`, the create and update schemas
both `Field(default=60, …)`, and `_get_check_in_window`'s own fallback for a
NULL column is `else 60`.

**This traces back to this file's own prior reasoning, and that is corrected
here too.** Pass 1's LOC-1 wrote that the old hardcoded `start - 1h` "opened the
window **twice as early** as the default for FLEXIBLE events" — which is only
true if the default were 30; at 60 the old code was _identical_ to the default,
not twice as early. Pass 2's LOC-4 then said the docstring "contradicted the
30-min canonical default." Both claims are wrong in the same direction.

What this does **not** change: LOC-1 and LOC-4's fixes were right, for the half
of their reasoning that held. Calling the canonical helper is correct whatever
its default, a STRICT event's window genuinely does open at
`actual_start_time` rather than an hour before start, and the selection query
genuinely did return a superset. Only the stated magnitude was wrong — but it
was wrong in two code comments, where the next reader would have believed a
FLEXIBLE window opens 30 minutes before start.

**Fix:** both comments now name the column rather than guessing a number, and
the service docstring states the column default. One observation left in place
rather than changed: `_get_check_in_window`'s fallback for the _same_ column is
60 under FLEXIBLE and **15** under WINDOW. Only reachable when the column is
NULL, which the default prevents for anything created normally, so it is
recorded here rather than touched — it belongs to the events iteration.

### LOC-38 — LOW — Three `# noqa: E712` the file already knew how to avoid — ✅ FIXED

`Event.is_cancelled == False`, `Location.is_active == True` and
`Organization.active == True`, each with a `# noqa: E712`. CLAUDE.md allows a
`# noqa` only for "a documented, unavoidable reason"; these are avoidable, and
the same file already avoids them — `get_current_events_in_check_in_window` was
written with `.is_(False)` eleven lines above one of them. Pass 2 swept one of
these and left three.

**Fix:** `.is_(False)` / `.is_(True)`, identical SQL, no suppression.

### LOC-39 — LOW — The API reference lists three of the four public display endpoints — ✅ FIXED

`wiki/API-Reference.md`'s **Public Endpoints** table enumerates
`/display/{code}`, `…/events/{id}/guest` and `…/events/{id}/guest-check-in` and
omits `POST /display/{code}/badge-tap` — a public, unauthenticated endpoint that
writes attendance, added 2026-10-03. The behaviour is well described in
`wiki/Member-ID-Cards.md`; it was the machine-readable surface table that had
the gap, which is the one an integrator reads.

The same file's module table also had **no `/api/v1/locations` row** while
listing every sibling (`/api/v1/facilities`, `/api/v1/apparatus`, …). Added,
with its split auth: authenticated reads, `locations.create`/`.edit`/`.delete`/
`.manage` to write, and `locations.manage_nfc_tags` for the badge toggle.

## Pass 3 flagged

### LOC-37 — MED — A member who taps a room tag with an expired session loses the room — 🚩 FLAGGED

`/locations/:locationId/check-in` is where a room's NFC tag lands a phone. It is
the **only route in the app entered cold from a physical object** rather than
from inside a live session — which makes it the one route most likely to be hit
with no valid session, and the one that handles that worst.

It carries no `ProtectedRoute`. So a member whose session has expired renders
the page, which calls `GET /locations/{id}/display`, gets a 401, and is
hard-redirected by `handleExpiredSession` (`apiClient.ts:207`) via
`window.location.href = '/login'`. That is a full page load carrying **no
`state.from`**, so `postLoginRedirect` falls through to its default and the
member lands on the dashboard. They have to walk back to the door and tap the
sticker again.

Every `ProtectedRoute` in the app does this correctly:
`<Navigate to="/login" state={{ from: location }} replace />`, which
`postLoginRedirect` reads and validates against open-redirect before returning
`pathname + search + hash`. The machinery exists and works; this route simply
never reaches it.

**Why flagged rather than fixed.** The obvious fix — wrap the route in a bare
`<ProtectedRoute>`, which gates on authentication alone and so preserves the
route comment's intent exactly (no module gate, no permission gate) — would
make this page inconsistent with `/events/:id/check-in`, which it forwards to
and which is ungated the same way. So this is a convention shared by both
check-in landing pages, not a one-route slip, and the fix belongs to both at
once. It is also a session-flow change, which this repo's standing instructions
put behind an explicit confirmation. The route comment now records the
mechanism and names this finding so the next reader does not have to re-derive
it.

### LOC-40 — LOW — Both display implementations are live now, and they fill the same schema differently — 🚩 FLAGGED

Pass 2's duplication note ended "delete the authenticated copy, or give it a
caller. Keeping two implementations of 'what is happening at this location right
now' guarantees they drift again." It got a caller, and the duplication is now
load-bearing in both directions. `LocationDisplayInfo` has six fields; its two
producers fill different subsets:

| Field                    | `public/display.py`                 | `locations.py`                 |
| ------------------------ | ----------------------------------- | ------------------------------ |
| `is_valid`               | `_validate_check_in_window(...)`    | hardcoded `True`               |
| `can_check_in`           | `is_valid`                          | hardcoded `True`               |
| `timezone`               | the organization's                  | **unset** (`None`)             |
| `badge_check_in_enabled` | room switch **and** org integration | **unset** (`False`)            |
| `allow_guest_check_in`   | per event                           | **absent** from the event dict |
| `event_description`      | `None`                              | `None` (LOC5-32-1 aligned it)  |

Nothing is broken today: both omissions default to the safe value, and
`RoomCheckInPage` reads neither. The ~20 lines of `QRCheckInData` construction
are near-identical between the two, which is how LOC-1 happened the first time.
Consolidating onto one builder is the right answer and is not a safe fix — the
two differ deliberately in `is_valid` (the public endpoint computes it
permissively; the authenticated one hardcodes it because its selection query
already applied the stricter window), so a shared builder needs that as a
parameter, and the blast radius is a public kiosk endpoint.

### LOC-41 — LOW — (name, building) uniqueness has no constraint behind it — 🚩 FLAGGED

The durable fix for LOC-34. Two obstacles make it a decision rather than a
chore: a `UNIQUE (organization_id, name, building)` index does not prevent
duplicates where `building IS NULL`, because MySQL permits repeated NULLs in a
unique index — which is precisely the case the application check handles with an
`IS NULL` branch — and existing installations may already hold duplicate pairs
that a migration would have to resolve before the constraint could be added.

## Pass 3 re-verified ✅

- **Pass 2's precondition on the newly-live endpoint, assessed rather than
  assumed.** It flagged that if `GET /locations/{id}/display` were ever wired
  up, it "must compute `is_valid` like the public path and populate
  `timezone`." It is wired up, and neither holds as stated. `is_valid=True` is
  sound: the selection query keeps only events satisfying the strict
  `check_in_start <= now <= check_in_end`, and `_validate_check_in_window` is
  the _permissive_ check (it admits the Flexible/Window early-arrival grace), so
  anything reaching that loop is certainly checkable-into — the code already
  argues this and the argument holds. `timezone` is a kiosk concern: LOC-2's
  defect was that an _unauthenticated_ tablet has no profile to read the
  department zone from. This endpoint's only caller is reached **signed in**, so
  `useTimezone()` already resolves the department zone (its own docstring
  confirms `user.timezone` _is_ the department's), and populating the field
  would cost a query per request for a consumer that reads it never. Recorded
  in the endpoint so the next reader does not mistake it for LOC-2 returning.
- **LOC-2's fix is in use on the path that needs it** —
  `LocationKioskPage.tsx:62` reads `data?.timezone || fallbackTz`, and the
  public endpoint populates it.
- **LOC-4's narrowing holds**, and its prefilter horizon has since been widened
  to 24 hours to cover `check_in_minutes_before`'s validated maximum (1440) —
  correct, and the comment explains why a 1-hour prefilter reintroduced the
  LOC-1 drift for an event opening check-in more than an hour early.
- **`delete_location`'s event count is not org-filtered, and does not need to
  be.** `select(func.count(Event.id)).where(Event.location_id == ...)` resolves
  through a location already fetched org-scoped, which is CLAUDE.md #14a's
  parent-resolution shape rather than a gap.
- **`_generate_unique_display_code` escalates 8 → 12 characters after 10
  attempts and raises rather than looping**, as pass 1 recorded.
- **No banned date API on either page**, and `tz` is passed to every formatter
  (`formatTime`, `formatDateCustom`).

## Pass 3 completion gate

| Check                        | Result                                                |
| ---------------------------- | ----------------------------------------------------- |
| `npm run typecheck`          | ✅ 0 errors                                           |
| `flake8 app/ tests/`         | ✅ 0 violations (and three `# noqa` removed — LOC-38) |
| `black --check app/ tests/`  | ✅ 1351 files unchanged                               |
| `isort --check-only`         | ✅ clean                                              |
| `eslint`                     | ✅ clean                                              |
| docs link check              | ✅ 428 files, 0 broken links                          |
| route permission registry    | ✅ 244 routes, 0 errors                               |
| backend location/kiosk tests | ✅ 267 passed, 1 skipped (was 264 — 3 added)          |
| `LocationKioskPage.test.tsx` | ✅ 6 passed (was 4 — 2 added)                         |

New backend tests are DB-free and marked `unit` per class; confirmed by
collection under `-m "not integration and not slow and not docker"` (3 of 3),
not by a local run. Every fix was mutation-verified: reverted, the new test
confirmed to fail, and the revert undone with the mechanism that applied it.

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1: 6/6 endpoints gated + org-scoped; PP-3 display-code regex + no
PP-1 recurrence intact; LOC-1 (display _rendering_ uses canonical
`_get_check_in_window`) and LOC-2 (kiosk timezone from org) hold; frontend clean (no
banned date APIs, tz passed to every formatter, no Pitfall #1). Lenses 1–4/6 clean.
**1 fix.**

### LOC-4 — MED — Kiosk event _selection_ still used a hardcoded 1-hour window (LOC-1, one layer down) — ✅ FIXED

LOC-1 fixed the display _rendering_ to use `EventService._get_check_in_window`, but
the **selection** query `get_current_events_in_check_in_window` still computed
`check_in_start_threshold = now + 1h` and selected `start_datetime <= that` — a
**superset** of the canonical per-event windows (FLEXIBLE opens 30 min before, STRICT
at `actual_start_time`, WINDOW ±N). The live kiosk frontend renders "Check-In Active"

- a scannable QR for **any** returned event (it never reads `is_valid`), so a STRICT
  or early-FLEXIBLE event showed an active check-in QR up to an hour before its window
  opened; the scan was then rejected by `_validate_check_in_window` — confusing, and
  the docstring's "1 hour before start" contradicted the 30-min canonical default.
  **Fix:** keep a generous 1-hour SQL prefilter to bound rows, then narrow in Python to
  exactly the events whose canonical `_get_check_in_window` is open now — the same
  predicate `_validate_check_in_window` enforces. Swept an adjacent E712. 1 DB-free
  regression test (an open FLEXIBLE event is returned, a not-yet-open STRICT event is
  filtered out).

**Flagged (LOW, folded into LOC-3):** the authenticated `/locations/{id}/display`
endpoint (still zero callers) hardcodes `is_valid=True` and omits the new `timezone`
field — if LOC-3's dead-code is ever wired up rather than deleted, it must compute
`is_valid` like the public path and populate `timezone`.

---

**Backend:** `app/api/v1/endpoints/locations.py` (294 L, 6 endpoints),
`app/services/location_service.py` (279 L),
`app/api/public/display.py` (the kiosk's actual data source)
**Frontend:** `pages/LocationKioskPage.tsx` (246 L), routed publicly at
`/display/:code` from `modules/facilities/routes.tsx`
**Docs:** none specific

---

## Scope

All 6 location endpoints and the service read in full, plus the public display
endpoint and the kiosk page — the kiosk is the reason this feature is
interesting, and it turned out **not** to use the locations module's own display
endpoint at all.

`app/api/public/display.py` overlaps with **B26 public-portal**, which owns its
rate limiting and access logging. It is covered here only where it is the
kiosk's data path.

## Verified good ✅

- **All 6 endpoints authenticated and correctly tiered** — reads on
  `get_current_user`, create/edit/delete each on their own permission paired
  with `locations.manage`. Every service call passes
  `current_user.organization_id`, so XC-3 is clean.
- **PP-3's fix is intact.** The public display code is validated with an
  explicit ASCII regex (`[A-Za-z0-9]{6,12}`) rather than `str.isalnum()`, and
  the comment records why — `isalnum()` also accepts Unicode letters and digits,
  a looser gate than the codes actually issued.
- **No PP-1 recurrence.** `get_location_by_display_code` uses
  `scalar_one_or_none()`, which would 500 on a duplicate — but `display_code` is
  `unique=True` **globally** (not per-org) and the generator checks globally
  before assigning, so more than one match is impossible. This is the exact
  shape that broke public-portal API-key auth in PP-1; here the constraint
  actually backs the assumption.
- **Code generation escalates on collision** (8 chars for the first 10 attempts,
  then 12) and fails loudly rather than looping forever. The ~40-bit entropy of
  an 8-character code remains the accepted design limitation recorded in PP-7,
  not re-flagged here.
- **The kiosk page uses `formatDateCustom` with a timezone argument** and no
  banned date API — the ESLint-enforced rules are respected. (What it passed as
  that timezone was the problem; see LOC-2.)
- **The public display endpoint is rate-limited and data-minimised** — event
  descriptions are explicitly not exposed (`event_description=None` with a
  comment).

## Findings

### LOC-1 — MED — The authenticated display endpoint kept a stale check-in window — ✅ FIXED

**What:** `GET /locations/{location_id}/display` computed the check-in window
inline:

```python
check_in_start = event.start_datetime - timedelta(hours=1)
check_in_end = event.actual_end_time or event.end_datetime
```

**Where:** `locations.py` `get_location_display_info`.

**Impact:** the canonical window is `EventService._get_check_in_window`, and it
is **per-event configurable**: `check_in_window_type` (FLEXIBLE / STRICT) and
`check_in_minutes_before`, which defaults to **60 minutes**. So this copy was
wrong in two distinct ways — it opened the window **twice as early** as the
default for FLEXIBLE events, and for a STRICT event it ignored the rule entirely
(STRICT opens at `actual_start_time`, not "start minus an hour"). A display
fed by it would tell members they could check in when the check-in endpoint
would still refuse them.

What makes this a clean example of the duplication hazard: **the sibling public
endpoint was already fixed.** `tests/test_public_display.py`'s own docstring
says the kiosk "must report the authoritative check-in window/validity (the same
logic the check-in endpoint enforces), **not a hardcoded 1-hour guess**". That
correction was applied to the copy the kiosk uses and missed on this one.

**Fix:** calls `EventService._get_check_in_window(event)`, with a comment naming
why a local copy is wrong. The now-unused `timedelta` import was removed.

### LOC-2 — MED — The kiosk rendered times in the tablet's timezone — ✅ FIXED

**What:** `LocationKioskPage` is routed **publicly** (`/display/:code`, marked
"no auth — for tablets in rooms") but derived its timezone from
`useTimezone()`, which reads `useAuthStore(s => s.user?.timezone)` and falls
back to `Intl.DateTimeFormat().resolvedOptions().timeZone`.

**Impact:** with no session there is no user, so the fallback **always** won: the
kiosk rendered every time in whatever zone the tablet was set to. A
wall-mounted display left on its factory default — commonly UTC — showed event
times and check-in windows shifted by hours, on the screen members rely on to
know whether they can check in. It also contradicts the project's own rule that
times are displayed "in their local timezone (**or the organization's
configured timezone**)": the department's configured timezone was the one value
never consulted.

**Fix:** `LocationDisplayInfo` gained an optional `timezone` field, populated
from the organization in the public display endpoint; the kiosk prefers it and
keeps the browser value as a fallback. Optional so nothing breaks if the field
is absent, and an org that never set a timezone still renders. Covered by two
new tests.

### LOC-3 — LOW — `GET /locations/{id}/display` has no consumer — 🚩 FLAGGED

**What:** the endpoint LOC-1 just corrected has **zero frontend callers**. The
kiosk fetches `/api/public/v1/display/{code}` instead, and no service method
wraps the authenticated route.

**Impact:** none today — it is a second, authenticated implementation of the
same capability (location + events in their check-in window + `has_overlap`),
superseded by the public one. But it is dead weight that already drifted once,
which is how LOC-1 happened.

**Why not fixed:** deleting an endpoint is an API-surface decision, not a
correction — nothing documents it as a public integration point, but nothing
rules it out either. It is now _correct_ dead code rather than _wrong_ dead
code, so the decision can be taken calmly. Second instance of this shape in two
iterations, after DASH-2.

## Duplication

**The display capability exists twice** — authenticated (`locations.py`) and
public (`public/display.py`) — and the two had already diverged before this
review, which is LOC-1. The public one is strictly better: rate-limited, uses
the canonical window helper, computes `is_valid` via
`_validate_check_in_window`, and withholds event descriptions.

Now that LOC-1 has aligned the window logic, the honest resolution is LOC-3:
delete the authenticated copy, or give it a caller. Keeping two implementations
of "what is happening at this location right now" guarantees they drift again.

## Dead code

- `GET /locations/{location_id}/display` — no consumer (LOC-3).
- Removed: the `timedelta` import in `locations.py`, unused after LOC-1.
- Nothing else unreferenced; no TODO/FIXME markers.

## Documentation gaps

None corrected. Worth noting for the operator docs: the kiosk is a **public,
unauthenticated URL** whose only secret is an 8-character display code. That is
a deliberate design (a tablet cannot hold a session), and the endpoint is
rate-limited and data-minimised accordingly — but a department should know that
anyone with the URL sees which events are running at that location, and that
rotating the code is the only revocation.

## Future development

1. **Resolve the duplicate display path** (LOC-3) — delete or wire up.
2. **The kiosk has no way to signal a stale session of its own.** It polls every
   30 s and shows a `connected` flag, which is good; but if the display code is
   rotated or the location deactivated, the tablet shows a 404 screen with no
   guidance for whoever walks past it.
3. **No test covers the locations module's own endpoints.** The 6 CRUD routes
   have no direct coverage; the tests that exist are for the public display
   path. The org-scoping on `get_location` is currently asserted only by
   reading.
4. **`display_code` has no rotation endpoint.** It is assigned at creation and
   there is no way to reissue it if a code leaks, short of editing the row —
   which matters given it is the kiosk's only access control.
5. **`is_valid=True` is hardcoded** in the authenticated endpoint on the grounds
   that the query already filtered by window. True today, but the public
   sibling computes it properly; if LOC-3 resolves toward keeping this endpoint,
   it should do the same.

## Completion gate

| Check                | Result                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors                                                                                                                                 |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                             |
| `black --check`      | ✅ 503 files unchanged                                                                                                                      |
| `eslint`             | ✅ clean                                                                                                                                    |
| backend tests        | ✅ **2514 passed, 0 failed** (was 2512 — 2 tests added). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
| frontend tests       | ✅ **2207 passed** (159 files)                                                                                                              |

> Note: LOC-2's extra query broke three existing `test_public_display.py` tests,
> whose `db` stub was a bare `MagicMock`. The stub was **extended** to serve the
> new lookup — not loosened, and no assertion was weakened — because the
> endpoint genuinely acquired a dependency the test had to model.
> </content>
