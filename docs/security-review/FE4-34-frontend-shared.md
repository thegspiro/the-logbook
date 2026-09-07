# Security Review — Feature 34: Frontend Shared (pass 4)

**Prefix:** `FE4` · **Iteration:** 34 · **Reviewed:** 2026-09-07 · **PR:** (opening)

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`utils/errorHandling.ts`, `services/errorTracking.ts`, all 13 module axios instances
(`modules/*/services/api.ts`), `components/ProtectedRoute.tsx`,
`stores/authStore.ts`, `stores/learningProgressStore.ts`,
`stores/pendingSyncStore.ts`, `stores/skillsTestingStore.ts`, plus a
diff-based sweep of `components/ux/*` and the whole frontend for new
cache-exposure risk since the pass-3 baseline.
**Backend:** none owned by this feature — read-only cross-reference of
`backend/app/api/v1/endpoints/auth.py`'s logout endpoint for FE3-34-2.
**Migrations:** none.

**0 new findings from the original pass. 1 prior HIGH finding (FE3-34-4)
confirmed fixed by an intervening commit not authored by this rotation.
1 prior HIGH finding (FE3-34-5) initially marked fixed by this pass, then
reopened after Codex review on this PR found the fix covers the timing race
but not the purge-failure case (see below) — disposition corrected to OPEN.
1 prior HIGH finding (FE3-34-2) re-verified still open — unchanged, still
needs a product decision. All 9 FE2-34 findings and FE3-34-1/FE3-34-3
re-confirmed intact.**

---

## Method

This is the 4th pass over a feature whose prior three passes (module-audit
iteration 27, `app-review/frontend-shared.md` passes 1-4, `FE2-34`, `FE3-34`)
already read every file in scope line-by-line at least once and found/fixed
16 issues total. Re-reading all of it line-by-line a fourth time would mostly
reconfirm what a diff can prove faster and more completely, so this pass:

1. **Established the pass-3 baseline commit** — `b10ecfe3` (the merge that
   landed `docs/security-review/FE3-34-frontend-shared.md`) — and ran
   `git diff --stat b10ecfe3..HEAD` scoped to every file this feature owns
   (`utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
   `components/ProtectedRoute.tsx`, all 4 stores, all 13 module `api.ts`
   files). Only three files differ at all:
   `utils/apiCache.ts` (+5 lines), `stores/authStore.ts` (+19 lines),
   `modules/scheduling/services/api.ts` (+50 lines, three new fields/methods).
   `services/apiClient.ts`, `utils/createApiClient.ts`,
   `components/ProtectedRoute.tsx`, `learningProgressStore.ts`,
   `pendingSyncStore.ts`, `skillsTestingStore.ts`, and all 12 _other_ module
   `api.ts` files are **byte-identical** to what pass 3 already read in full
   and verified — re-confirmed directly (`git diff` empty for each), not
   assumed from the doc.
2. **Read every line the diff touched** — all three changed files — in full,
   in current context, not just the diff hunks.
3. **Re-verified every open/flagged item from FE2-34 and FE3-34 against
   current code** (not against what the docs say): re-read the actual lines,
   don't just trust "✅ FIXED".
4. **Ran the same whole-frontend diff-sweep FE3-34 used** for new
   cache-exposure risk — every `api.get(`/`api.get<` line added anywhere in
   `frontend/src` since `b10ecfe3`, not only inside this feature's file list,
   since a new gap could just as easily land in a page component calling
   `api.get` directly.
5. **Checked `components/ux/*`** (read in full by FE3-34) for new files/diffs
   since the baseline, since a prior pass explicitly scoped it into this
   feature.

**Not re-read line-by-line this pass:** the ~150 non-module `services/*.ts`
files and the pages/hooks/components calling the global `api` instance
directly — per FE2-34/FE3-34's own scoping rationale, unrelated business
logic in those files belongs to their own feature's rotation slot; only their
cache-exclusion correctness is this feature's concern, and step 4 covers
that across the whole tree, not just this feature's own files.

## Diff-based sweep — new `api.get` calls since the pass-3 baseline

Every `api.get(`/`api.get<` line added anywhere in `frontend/src` between
`b10ecfe3` and `HEAD` (non-test files):

| File                                                             | New call                                           | Cache path                   | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/inventoryService.ts`                                   | `GET /inventory/requests/{id}/fulfillment-options` | global cached `api`          | Already in `UNCACHEABLE_SUBSTRINGS` (`'/fulfillment-options'`) — added in an earlier commit than this pass but after FE3-34 was written; verified present at `apiCache.ts:124`. Deliberately cacheable-adjacent per its own comment ("not PII... a 30s-stale count is how a quartermaster is offered stock another one just issued") — correct, not a gap.                                                                                                                                                                           |
| `services/*` (`adminServices`/`notificationsService` call sites) | `GET /notifications/logs`, `GET /notifications/my` | global cached `api`          | Both already covered by existing prefixes (`'/notifications/logs'`, `'/notifications/my'`). No gap.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `services/inventoryService.ts`                                   | `GET /inventory/requestable-catalog`               | global cached `api`          | Already in `UNCACHEABLE_PREFIXES` (`'/inventory/requestable-catalog'` — "request form: embeds the caller's own size preferences (PII)"). No gap.                                                                                                                                                                                                                                                                                                                                                                                     |
| `services/inventoryService.ts`                                   | `GET /inventory/items/colors`                      | global cached `api`          | **New, no exclusion entry.** Checked the backend (`backend/app/api/v1/endpoints/inventory.py:741`, `response_model=List[str]`) — a deduplicated list of colour names in use across inventory items (e.g. `["Navy", "White"]`), confirmed by the three e2e specs that mock it (`e2e/capture-inventory-*.spec.ts`). No PII, no per-member data, no free-text field. Correctly left cacheable — added to `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` only when a URL actually needs it, and this one does not carry sensitive data. |
| `modules/scheduling/services/api.ts`                             | `GET /scheduling/shifts/needing-closeout`          | `createApiClient()` instance | This module's client has zero caching logic (confirmed again by reading `createApiClient.ts` in full — no `isCacheable`/`setCache`/`getCached` call anywhere in it), so this can never reach the shared cache regardless of the exclusion list.                                                                                                                                                                                                                                                                                      |

**Conclusion: zero new cache-exclusion gaps** since the pass-3 baseline. The
one genuinely new endpoint (`/inventory/items/colors`) is correctly
low-sensitivity and correctly left cacheable; every other "new" call in the
diff was already covered by an exclusion added between the pass-3 doc being
written and its PR actually merging (see "Two findings resolved out from
under the rotation" below for why the doc and the code disagree in more than
one place).

## `components/ux/*` — diff check

`git diff --stat b10ecfe3..HEAD -- frontend/src/components/ux` shows 5 files
touched: `Breadcrumbs.tsx`/`breadcrumbRoutes.ts` (+ their tests, new) and a
one-line permission-string change in `CommandPalette.tsx`
(`members.manage` → `users.create` for the "Add Member" quick-action).

- **`breadcrumbRoutes.ts`** is a fail-closed allowlist by design: a path is
  only ever a link if it appears in `BREADCRUMB_ROUTES` **and** the viewer
  holds one of its listed permissions; everything else renders as plain text.
  Its own `breadcrumbRoutes.test.ts` resolves each entry's permission list out
  of the actual route source and fails on drift, so a stale entry here cannot
  silently open a door `ProtectedRoute` would refuse. No XSS sink
  (`grep` for `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `Breadcrumbs.tsx`:
  0 hits). Not a security boundary of its own — it mirrors routes'
  real gates rather than enforcing anything — so no finding.
- **`CommandPalette.tsx`**'s permission string is a client-side visibility
  filter for a keyboard-launched shortcut list, not an access-control
  decision; the destination route (`/members/add`) carries its own
  `ProtectedRoute` permission gate independently. Changing which permission
  hides/shows the palette entry has no security effect either way.

No findings in this directory this pass.

## Re-verification of prior findings

### FE2-34's 9 findings — all still intact

Re-read the current file at each finding's location (not just trusted the
doc): all 3 `/training/*` cache exclusions (`apiCache.ts:69-71`), the
`/forms`/`/grants` trailing-slash fixes (`:84,98`), `/analytics/export`
(`:105`), `authStore.ts`'s `getCsrfCookie` `decodeURIComponent` call (`:55`),
`scheduling/services/api.ts`'s `getMyAttendance` 404-only catch, and
`authStore.ts` calling `purgeLocalMemberData()` on both the logout path
(`:469`) and the confirmed-auth-failure branch of `loadUser` (`:536`) are all
present verbatim in current code. No regressions.

### FE3-34-1 (MEDIUM) — `loadUser()` purges local data only on a confirmed 401/403 — ✅ still fixed

`authStore.ts:521-547`: the catch block classifies
`appError.status === 401 || appError.status === 403` and purges
(`purgeLocalMemberData()`) only on that branch; any other error (offline
browser, timeout, backend 5xx) clears session state but leaves local
drafts/queues untouched. Unchanged since pass 3.

### FE3-34-3 (MEDIUM-HIGH) — `/auth/mfa/login`'s intentional 401 was mistaken for an expired session — ✅ still fixed

`services/apiClient.ts:304-312`: `/auth/mfa/login` is present in the
`isAuthEndpoint` list alongside the other genuine auth-flow endpoints, so a
wrong/expired MFA code's 401 is rejected directly rather than entering the
refresh→purge→redirect path. `apiClient.test.ts`'s three guard tests for this
(no refresh on MFA 401; refresh still happens on a genuine protected-endpoint
401; a failed refresh there still purges+redirects) all pass. Unchanged.

### FE3-34-2 (HIGH) — a failed client-side logout presents an unauthenticated UI while the session cookies stay live — OPEN, still flagged

**What:** unchanged. `authStore.ts:433-479`'s `logout()` still wraps
`await authService.logout()` in
`try { ... } catch { /* Logout errors are non-critical; cookies are cleared
by the backend */ }` and unconditionally proceeds to clear local state and
set `isAuthenticated: false`. The comment's premise is still false on the
failure path.
**Where:** `frontend/src/stores/authStore.ts:437-440`. Backend counterpart
has **moved** since pass 3 was written — re-verified at its current location,
`backend/app/api/v1/endpoints/auth.py:1334-1372` (was cited as `:1197-1235`
in the FE3-34 doc; same logic, new line numbers after intervening churn).
`_clear_auth_cookies(response)` (`:1371`) still runs **only** after
`auth_service.logout_user(token)` returns `True` (`:1362-1368`); a missing
token, or `logout_user()`'s own `except Exception: return False` on a
transient DB error (`auth_service.py:578-580`), both raise a 400 with the
httpOnly access/refresh cookies left exactly as they were.
**Failure scenario:** unchanged from FE3-34-2 — a member on a shared station
computer clicks Sign Out; the logout POST fails (network blip, or the
session-row delete hitting the logged "Logout failed" exception path); the
UI shows the login screen while the previous member's session cookies remain
valid until they naturally expire.
**Impact:** unchanged — on the app's own shared-workstation threat model
(the same one `purgeLocalMemberData()` two lines below exists to defend),
a failed logout silently leaves the session live while telling everyone it
ended.
**Why still not fixed:** the remediation is a product decision (retry
automatically with what backoff/limit, or block the UI with an explicit
"couldn't confirm sign-out" message, or something else) that pass 3
correctly judged out of scope for a drive-by patch, and nothing about the
code or the tradeoff has changed since. Re-confirmed, not re-derived: kept
in `KNOWN_LIMITATIONS.md` (line numbers refreshed there in this pass, see
Documentation corrections below).

## One finding resolved out from under the rotation, one reopened on review

`FE3-34-4` is **fixed in current code** by a commit authored outside this
security-review rotation (regular feature work that happened to close a
flagged security gap) between the FE3-34 pass being written and its PR
actually merging. The fix was **already present** in `b10ecfe3` — the very
commit that landed the FE3-34 doc calling it open — so the doc was stale
from the moment it merged, not from later drift. This class of race (two
branches landing concurrently, one unaware of the other) is the same
pattern `PROGRESS.md` documents elsewhere in this rotation for Alembic merge
conflicts; here it produced a stale-on-arrival finding instead.

`FE3-34-5` looked like the same story initially — its cited fix
(`claimDeviceForMember`) was also already present in `b10ecfe3` — but Codex's
review of this PR found the fix only closes the timing race the original
finding described, not the purge-failure path. See its full writeup below;
it is reopened, not resolved.

### FE3-34-4 (HIGH) — a stale in-flight cacheable GET could write into the shared cache after a session-boundary `clearCache()` — ✅ CONFIRMED FIXED

**Original defect:** `clearCache()` emptied the cache Map but did nothing to
stop a GET already in flight from writing its (pre-boundary) response into
the cache after the boundary passed — a narrow race where member A's slow
cacheable request could settle after A logged out and B logged in, and be
served to B as if it were B's own data.
**Fix, verified present:** `utils/apiCache.ts` now versions every cache write
against two counters — a whole-cache `generation` (bumped by every
`clearCache()`) and a per-resource-prefix `prefixEpochs` map (bumped by every
`invalidateByPrefix()`). `cacheWriteToken(url)` captures both at request time;
`setCacheIfCurrent(key, data, token)` (called from both the main response
interceptor at `services/apiClient.ts:262-264` and the background
stale-revalidation branch at `:128-131`) discards the write if either counter
has moved since the token was captured. The response interceptor fails
closed on a missing/malformed token via `isCacheWriteToken`'s type guard
(`:258-264`) rather than caching an unstamped response.
**Guard tests confirmed passing:** `services/apiClient.test.ts` — "does not
repopulate the cache with a response a mutation has since invalidated"
(`:234`), "does not cache a bypassed read that was issued before logout
cleared the cache" (`:269`), "does not repopulate the cache with a response
issued before logout cleared it" (`:307`) — all three exercise exactly the
FE3-34-4 scenario (a request in flight across a `clearCache()`/
`invalidateByPrefix()` boundary) and all pass against current code.
**Disposition:** no longer open. `KNOWN_LIMITATIONS.md`'s FE3-34-4 entry
removed per its own stated convention ("When one is resolved... remove it
here") — this doc is now the record of the fix.

### FE3-34-5 (HIGH) — an offline queue item could sync under the next member's identity on a shared device — ⚠️ PARTIALLY FIXED, REOPENED

**Original defect:** none of the three offline queues
(`genericOfflineQueue.ts`, `offlineQueue.ts`, `shiftReportOfflineQueue.ts`)
recorded which member queued an item, and FE3-34-1's own fix (correctly)
stopped wiping the queue on every `loadUser()` failure — so a queued item
from member A could survive a session boundary with no owner, and
`useOfflineSyncEngine`/the page-scoped drain paths would flush it under
whichever session's cookies were attached to `api` when the device next came
online, attributing A's action to B.
**Fix, verified present:** `stores/authStore.ts` now tracks a
`device_member_id` in `localStorage` (`DEVICE_MEMBER_KEY`, `:124`) and
`claimDeviceForMember(userId)` (`:180-198`) runs — and is `await`ed — before
`isAuthenticated` is ever set `true`, on every path that establishes a
session: password login (`:318`), MFA completion (`:392`), and a page
reload/OAuth-callback resolution through `loadUser()` (`:515`). It purges
(`purgeLocalMemberData()`) whenever the recorded device owner differs from
the incoming user **and** either this is a genuine sign-in
(`markSignInPending()`/`signInPending`, distinguishing a fresh credential
entry from a reload of an already-live session) or the device already had a
different recorded owner. Because the purge is awaited before
`isAuthenticated`/`user` are set, `AppLayout` — and therefore
`useOfflineSyncEngine` and every page-scoped drain path — cannot mount and
begin draining until after the purge has already run; there is no window in
which B's authenticated state exists alongside A's still-queued items.
**Guard tests confirmed passing:** `stores/authStore.test.ts:646-718` — six
cases: purges on a different member's password sign-in; does **not** purge
when the same member signs back in; purges on a sign-in to a
never-before-claimed device (the one-time upgrade cost); purges on an OAuth
sign-in to an unclaimed device (the case a plain sign-in flag can't see,
since the provider redirect reloads the module); leaves a live session's own
data alone across a plain reload; purges on a reload when the recorded owner
is a different member. All six pass against current code — but every case
only asserts that `purgeLocalMemberData()` was _called_, never that its
underlying IndexedDB clears actually succeeded.

**Reopened by Codex review on this PR** (`#2379`, comment on this file at the
original `:239` line): the ordering fix above is real and does close the
timing race this finding originally described — `claimDeviceForMember`
`await`s the purge before `isAuthenticated` is ever set, so there is no
window where B's live session coexists with A's still-queued items _as a
race_. But `purgeLocalMemberData()`'s own contract (see its file-level
docstring) is to **never throw and always settle**, precisely so a purge
failure can never block sign-in — `clearAllQueuedChecks`/
`clearAllQueuedReports`/`clearAllGenericQueued` each resolve their `clear()`
request's `onerror` the same as `onsuccess` (never let a purge failure block
logout"), and `purgeLocalMemberData`'s own `bounded()` wrapper resolves with
a fallback zero if any store takes longer than 3s. So when IndexedDB is
blocked, slow, or otherwise fails, the purge silently no-ops: it still
resolves (satisfying the `await`), `claimDeviceForMember` still proceeds to
record B as the device owner and the caller still authenticates B — while
A's queue entries can remain in IndexedDB with no owner tag distinguishing
them from anything B queues afterward. If IndexedDB recovers later in the
same session, `useOfflineSyncEngine` drains the queue under B's now-live
cookies with no way to tell A's stale entries apart from B's own.
**Verified as a real, reachable gap, not merely theoretical:** none of the
three queue stores tag an entry with the member who queued it, and none of
`purgeLocalMemberData`'s call sites check its `PurgeResult` for a failure
signal (the type doesn't even carry one) before proceeding — the design (per
its own docstring) treats "purge attempted" and "purge succeeded" as
interchangeable for the caller's purposes, which is correct for logout
(never stranding a member signed in matters more than a delayed purge) but
is exactly backwards for the sign-in side: gating _authentication_ on
confirmed deletion, or tagging queue entries with a validated owner checked
at sync time, would close this without reintroducing the logout-side risk.
**Disposition: OPEN**, not fixed. Restored to `KNOWN_LIMITATIONS.md`. This is
a product/architecture decision (which of the two remediations above, and
how to treat already-queued untagged legacy entries), not a same-PR patch —
correctly flagged rather than guessed at, matching this doc's own standard
for FE3-34-2.

## Verified good ✅

All of FE2-34's and FE3-34's "Verified good" claims re-checked and still
true this pass:

- **Cache size is bounded** — `MAX_CACHE_ENTRIES = 200`, FIFO eviction via
  `Map` insertion order (`apiCache.ts:24,181-204`); unchanged.
- **`prefixEpochs`/the new `generation` counter are themselves bounded** —
  `prefixEpochs` holds at most one entry per first-path-segment across the
  whole API surface (bounded by the route table, not by request volume or
  user input), and `generation` is a single incrementing number. Neither is
  a Pitfall #9 unbounded tracker.
- **All 13 module axios files** (up from 12 at FE2-34, matching FE3-34's
  count) use either `createApiClient()` (11 modules — confirmed by grepping
  every `modules/*/services/api.ts` for its import) or the global `api`
  instance directly (`ip-security`, `testing` — both confirmed to get the
  fuller global client's CSRF/refresh/cache handling, not a bypass).
- **`ProtectedRoute.tsx`** — byte-identical to what FE3-34 verified: gates
  strictly pre-render, distinguishes "not authenticated" from "authenticated
  but lacks permission", handles the loading/pending-session state without a
  false-negative redirect. The `ModuleGate` wrapper (present since before
  FE3-34, unchanged) is explicitly a UX gate, not an access-control boundary
  — its own doc comment says so, and it renders only after the permission
  checks above it have already passed, so a module being switched off never
  substitutes for or weakens a permission check.
- **`createApiClient.ts`, `learningProgressStore.ts`, `pendingSyncStore.ts`,
  `skillsTestingStore.ts`** — byte-identical to FE3-34's verified state
  (confirmed via empty `git diff` against the `b10ecfe3` baseline for each);
  their prior verifications (per-user-namespaced storage key on
  `learningProgressStore`, no `persist` middleware on `skillsTestingStore`,
  the blob-error-decoding branch in `createApiClient.ts`) still hold.
- **No XSS sinks** introduced anywhere in the diff since the pass-3
  baseline — confirmed via `grep` for `dangerouslySetInnerHTML`/
  `innerHTML`/`eval`/`document.write` across every file the diff touched.

## Findings

No new findings this pass. See "Re-verification of prior findings" and "Two
findings resolved out from under the rotation" above for the full accounting
of every prior open item.

## Not fixed — considered, judged correctly scoped

- **FE3-34-2** (HIGH) — remains open, needs a product decision (see above).
  Carried forward unchanged in `KNOWN_LIMITATIONS.md`.
- **FE3-34-5** (HIGH) — reopened by Codex review on this PR (see full
  writeup above); the timing-race fix is real but doesn't cover the
  purge-failure path, and closing that gap properly needs an
  owner-tagged-queue-entry design, not a drive-by patch. Restored to
  `KNOWN_LIMITATIONS.md`.

## Documentation corrections

- **`docs/KNOWN_LIMITATIONS.md`**: removed the `FE3-34-4` entry (confirmed
  fixed above) per the page's own stated convention ("When one is resolved,
  move it to the relevant module doc / CHANGELOG and remove it here" — the
  fix commit already carries its own CHANGELOG entry, see below, so nothing
  further to add there). The `FE3-34-5` entry was removed and then
  **restored** within this same PR after Codex review reopened it (see
  above) — its description updated to state the remaining gap precisely
  (purge-failure path, not the timing race). Refreshed the `FE3-34-2`
  entry's backend line-number citation (`auth.py:1197-1235` → `:1334-1372`)
  to match the endpoint's current location; the described behavior is
  unchanged.
- **CHANGELOG.md**: no new entry needed for FE3-34-4 — it already shipped
  with its own entry when it landed ("A successful edit no longer reads as
  though it had not happened", 2026-09-04). FE3-34-5 has no CHANGELOG entry
  because it is not actually resolved (see reopening above); nothing to add
  there until a real fix lands.
- **`docs/module-audit/frontend-shared.md`**, **`docs/app-review/
frontend-shared.md`**: both re-read in full this pass. Nothing in either
  contradicts current code; no correction needed (the one prior correction,
  the `createApiClient.ts` 401-handler note, was already made by FE2-34).

## Schema & migration notes

n/a — frontend-only feature, no owned tables.

## Guard tests added

None new this pass — every fix confirmed above already carries the guard
tests its own commit added (`apiClient.test.ts`'s three cache-boundary cases
for FE3-34-4; `authStore.test.ts`'s six device-claim cases for FE3-34-5), and
FE3-34-2 remains flagged rather than fixed, so no test is added for it (a
test would either lock in the current unsafe behavior or need the
not-yet-decided remediation shape — same reasoning pass 3 gave).

## Completion gate

| Check                                                                                                                                     | Result                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` (`tsc-native.mjs`, aliased 7.0.2 compiler)                                                                            | ✅ 0 errors                                                                                                                                                                                      |
| `npx eslint .` (whole frontend)                                                                                                           | ✅ 0 errors, 2 warnings (pre-existing `react-refresh/only-export-components` in `modules/scheduling/components/CallTypeChips.tsx`, unrelated to this feature, within the max-warnings 10 budget) |
| Scoped tests (`apiCache`, `apiClient`, `authStore`, `createApiClient`, `learningProgressStore`, `pendingSyncStore`, `skillsTestingStore`) | ✅ 221 passed (7 files)                                                                                                                                                                          |
| `ProtectedRoute.module.test.tsx`, `prospective-members/services/api.test.ts`                                                              | ✅ 18 passed (2 files)                                                                                                                                                                           |
| Backend                                                                                                                                   | n/a — no backend files changed this iteration (read-only cross-reference of `auth.py` for FE3-34-2's line refresh)                                                                               |

## Next

Feature 34 is the last row in the 00-34 cycle. Every row (00-34) is now ✅ —
the rotation wraps to **00 (cross-cutting baseline)** for the next full pass
over whatever has landed since `SEC-00`'s pass 3 (2026-09-01).
