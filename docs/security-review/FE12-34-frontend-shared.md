# Security Review — Feature 34: Frontend Shared (pass 12)

**Prefix:** `FE12` · **Iteration:** 34 · **Reviewed:** 2026-10-28 · **PR:** #TBD

**Frontend:** `utils/apiCache.ts`, `services/apiClient.ts`, `utils/createApiClient.ts`,
`services/passwordChangeGate.ts` (new), `utils/embedOrigins.ts` (new),
`utils/formEmbedSnippet.ts` (new), `utils/passkeys.ts` (new),
`contexts/StepUpContext.tsx`, `stores/authStore.ts`, `services/authService.ts`,
`services/eventServices.ts`, `services/facilitiesServices.ts`,
`services/adminServices.ts`, `services/communicationsServices.ts`,
`services/userServices.ts`, `services/formTypes.ts`, all 13
`modules/*/services/api.ts` files, the 4 second per-module clients, plus a
repo-wide sweep for new `api.get(`/`api.post(` etc. call sites, new
`axios.create(`/`createApiClient(` call sites, new top-level files under
`stores/`, `services/`, `utils/`, `contexts/`, `localStorage.setItem`/
`sessionStorage.setItem` call sites, hardcoded secret/token literals, and XSS
sinks (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
the pass-11 baseline.
**Backend:** read-only cross-reference only — `POST /auth/step-up`,
`POST /auth/step-up/passkey-options`, the embed-origin CSP assembly
(`app/utils/embed_origins.py`, `app/api/public/forms.py`), the guest
check-in link management endpoints (`app/api/v1/endpoints/events.py`) and the
public guest-check-in consumption endpoints (`app/api/public/display.py`,
`app/api/public/event_guest.py`) were read to confirm each new frontend call
site reaches a server decision this pass can trust, not implemented or
re-audited here — they belong to Auth (#01), Core infrastructure (#33),
Forms (#26), Events & requests (#16) and Public surface (#03), all already
`✅` in this rotation.
**Migrations:** none written or reviewed as in-scope (666 revisions, single
head `0d9897752425`, confirmed via `validate_migrations.py --strict` —
unrelated to this feature).

**0 fixes, 0 new OPEN/FLAGGED findings.**

---

## Scope

Read in full: every file named above, both before/after content (not diff
snippets alone) for the five new files (`passwordChangeGate.ts`,
`embedOrigins.ts`, `formEmbedSnippet.ts`, `passkeys.ts`, and
`printChecklist.ts`, found by the top-level-file sweep but out of this
feature's scope — see below), and the full diff for every changed file.
Sampled: the unchanged files were confirmed byte-identical via `git diff
--stat`, not re-read in full (same precedent as FE10/FE11 — nothing to find
in a file with a zero-line diff). Not read: the full body of
`events.py`/`display.py`/`event_guest.py`/`forms_service.py` beyond the
specific functions the new frontend calls reach — those files are other
features' rotation slots, already `✅`, and re-auditing them whole is outside
this pass's scope.

## Method

1. **Step 0 (rotation-level):** `list_pull_requests`/`search_pull_requests`
   (open, `head:claude/security-review-`) returned 0 results immediately
   after PR #3790 (Feature 33, pass 11) merged (`4a4eb2fd`), confirming
   Feature 34 as the only `⬜` row.
2. **Established the baseline**: `e007f1f5` (the merge that landed
   `FE11-34-frontend-shared.md`, PR #3682, **0 fixes, 0 new findings**).
3. **Re-verified prior art before reading new code**: read `CHECKLIST.md` and
   `FE11-34-frontend-shared.md` in full. As of FE11, 0 items were OPEN; the
   one standing product trade-off (`FE5-34-1`, excluding the whole inventory
   catalog from caching) remains recorded in `KNOWN_LIMITATIONS.md`, not
   re-litigated. Checked `docs/module-audit/frontend-shared.md` and
   `docs/app-review/frontend-shared.md` for open items touching these
   files — none.
4. **Diffed every feature-owned file** against the baseline
   (`git diff --stat e007f1f5..HEAD -- <each file>`). 24 files changed
   (883 insertions, 56 deletions) — five new source files
   (`passkeys.ts`, `embedOrigins.ts`, `formEmbedSnippet.ts`,
   `passwordChangeGate.ts`, plus their tests), `StepUpContext.tsx` (passkey
   step-up UI), `authStore.ts`/`authService.ts` (passkey + password-change-gate
   wiring), `apiCache.ts`/`createApiClient.ts`/`apiClient.ts` (small,
   targeted additions — see below), and small additive changes to
   `eventServices.ts`, `facilitiesServices.ts`, `adminServices.ts`,
   `communicationsServices.ts`, `userServices.ts`, `formTypes.ts`,
   `grants-fundraising/services/api.ts`, `prospective-members/services/api.ts`.
   Everything else named in the scope line above is byte-identical to the
   baseline (0-line diff-stat): `services/api.ts` (barrel), `ProtectedRoute.tsx`,
   the offline queues, `errorHandling.ts`, `errorTracking.ts`/
   `errorReporting.ts`, and 11 of the 13 module `api.ts` files.
5. **Enumerated every axios-instance-creating file fresh**
   (`createApiClient(`/`axios.create(` at baseline vs. `HEAD`): 13 module
   `services/api.ts` files confirmed by directory listing (11 via
   `createApiClient()`, 2 — `ip-security`, `testing` — via the global `api`
   import), the 4 second-client files, and the 2 factory definitions. Same
   19-file set as FE11 — no new axios instance anywhere in the frontend; the
   one new `axios.create()` hit from the diff sweep is inside
   `passwordChangeGate.test.ts`'s own test-recorder helper, not source.
6. **Ran a repo-wide diff sweep** for new/changed `api.<verb>(` call sites
   since the baseline. All new call sites (guest-check-in-link get/issue/
   rotate, passkey management, admin passkey list/remove, forms settings,
   facilities paginated list, grants/prospective-members field additions) go
   through an axios instance already covered by step 5 — no new instance, no
   bypass of the shared interceptors.
7. **Ran a repo-wide sweep** for new top-level files under `stores/`,
   `services/`, `utils/`, and `contexts/` since the baseline. Found five:
   `services/passwordChangeGate.ts`, `utils/embedOrigins.ts`,
   `utils/formEmbedSnippet.ts`, `utils/passkeys.ts` (all audited below), and
   `components/labels/printChecklist.ts` — a bounded (`MAX_SKIPPED_SIZES = 20`)
   per-browser "don't show this checklist again" preference for a label size
   key, wrapped in try/catch, no PII and out of this feature's scope
   (Inventory, #11, already `✅`).
8. **Ran a repo-wide sweep** for `localStorage.setItem(`/`sessionStorage.
setItem(`, hardcoded API-key/secret/token literals, and new XSS sinks
   (`dangerouslySetInnerHTML`/`innerHTML =`/`document.write`/`eval(`) since
   the baseline. `localStorage.setItem` hits are `printChecklist.ts` (above)
   plus two test files recording the same key. `innerHTML =` hits are a
   static, non-interpolated SVG fixture string and jsdom teardown
   (`document.head/body.innerHTML = ''`), both inside `.test.ts`/`.test.tsx`
   files. The one secret-shaped literal (`mockMfaToken = 'pending-token'`) is
   a test fixture, not a real credential. Zero hits in frontend source.
9. **Cross-referenced the backend half** of each genuinely new client-side
   control, read-only (see Backend line above and the findings below).
10. **Ran the full backend+frontend completion gate** (below).

## Verified good ✅

- **`passwordChangeGate.ts` cannot grant anything — it only pre-empts a
  refusal the server would send anyway, and fails open toward the server's
  own decision, not toward access.** `holdDuringPasswordChange()`
  (`services/passwordChangeGate.ts:66-82`) only intercepts a request when its
  own module-level `passwordChangePending` flag is already `true`; if that
  flag is ever wrong (stale, never set, cleared early), the request is simply
  sent over the network as before and the server's own `must_change_password`
  check in `get_current_user`/`_MUST_CHANGE_PW_ALLOWED_SUFFIXES`
  (`backend/app/api/dependencies.py`, confirmed present and unrelated to this
  diff) still enforces the refusal. The client-side short-circuit changes
  _only_ whether a doomed request crosses the network and gets logged as a
  fault — never whether it is allowed. `authStore.ts`'s new
  `useAuthStore.subscribe` keeps the flag in step with `user.
must_change_password` from the one place the signed-in user is set
  (login, `/auth/me`, logout), so a stale flag cannot outlive the session
  that set it.
- **The allowlist is a client-side mirror of the server's, and the test
  proves they agree rather than assuming it.**
  `PASSWORD_CHANGE_ALLOWED_SUFFIXES` is asserted equal (sorted) to
  `_MUST_CHANGE_PW_ALLOWED_SUFFIXES`, read live out of
  `backend/app/api/dependencies.py` by `passwordChangeGate.test.ts`'s first
  test — a path added to one list and not the other fails CI rather than
  silently drifting (the same shape as `embedOrigins.test.ts`'s own comment
  citing `test_form_embedding.py` as its backend counterpart, below).
- **The step-up passkey control is server-verified, purpose-scoped, and
  cannot be weakened by a client that skips it.** `StepUpContext.tsx`'s new
  `confirmWithPasskey()` only calls `authService.stepUp({ passkey_credential
})`; the server (`backend/app/api/v1/endpoints/auth.py:1571-1625`,
  `step_up()`) decides `proven` itself via
  `passkey_service.verify_authentication(..., PURPOSE_STEPUP)` — a
  purpose-scoped challenge distinct from sign-in's, so a captured sign-in
  assertion cannot be replayed as a step-up proof. The same function also
  explicitly downgrades a password-only proof to `proven = False` for a
  member who has enrolled a passkey but not TOTP
  (`elif has_passkey: ... proven = False`, line ~1612) — the server refuses
  to accept a weaker factor than the one the member actually enrolled,
  regardless of what the client offers or omits. `typedProof === null`
  correctly hides the password/code input entirely for a passkey-only
  member (`StepUpContext.tsx`), matching that server rule rather than
  inviting a proof the server would reject anyway.
- **`requestStepUp()`'s existing single-flight dedupe
  (`utils/stepUp.ts:39-45`, unchanged since FE11) still applies unmodified**
  to the new passkey path — `confirmWithPasskey()` runs inside the same
  `StepUpProvider` dialog the dedupe already guards, not a parallel path that
  could race it.
- **`embedOrigins.ts` is a UX mirror of a server-authoritative, fail-closed
  control — not itself the security boundary.** The actual clickjacking
  defense is `Content-Security-Policy: frame-ancestors`, assembled per
  request by `GET /{slug}/embed-policy`
  (`backend/app/api/public/forms.py:147-191`) from
  `valid_embed_origins(stored)` (`backend/app/utils/embed_origins.py`), which
  defaults to `NO_EMBED` whenever the form is unpublished, not public,
  `allow_embed` is off, or the stored list is empty/invalid — never to
  "allow everything". The frontend's `normalizeEmbedOrigin`/
  `parseEmbedOrigins` only let the settings screen reject a bad entry before
  save instead of after; a bug in the frontend regex could at worst show a
  wrong inline error, not open the header to an origin the backend's own
  `_ORIGIN` regex and `normalize_embed_origin` would refuse at write time.
  Confirmed the backend write path (`organizations.py`/`organization_service.py`,
  both grepped for `embed_origins` imports) is reached through that same
  `normalize_embed_origin`, not a separate, looser check. `embedOrigins.test.ts`
  states explicitly that it mirrors `backend/tests/test_form_embedding.py`'s
  `TestOriginRule`, and both regexes reject the same shapes (scheme-less,
  wildcard, path, query, CSP-breaking characters, out-of-range port) —
  compared line by line, not just by test-name.
- **`formEmbedSnippet.ts`'s generated `<script>` block cannot be broken out
  of or turned into stored script by any of its three inputs.** `appOrigin`
  is always `window.location.origin` at the one call site
  (`components/forms/FormEmbedShare.tsx:42`) — a browser-supplied value, not
  attacker- or even admin-controlled. `slug` is `form.public_slug`, which the
  backend generates as `uuid.uuid4().hex[:12]`
  (`backend/app/models/forms.py:36-38`) and never accepts from a client
  request body (`public_slug` appears only in `FormResponse`, not in any
  `FormCreate`/`FormUpdate` schema field list) — always exactly 12 lowercase
  hex characters, which cannot contain `</script>`, a quote, or any character
  `JSON.stringify` would need to escape in a way that breaks out of the
  script context. The one genuinely free-text input, `formName`
  (`form.name`, admin-settable), is used only inside the iframe's `title`
  attribute through `escapeAttribute()` (`&`/`"`/`<`/`>` all escaped) and is
  never concatenated into the `<script>` body at all.
- **`passkeys.ts` is a thin wrapper with no verification logic of its own** —
  `createPasskey`/`getPasskeyAssertion` just forward the server's own
  options to `@simplewebauthn/browser` and return whatever the browser's
  WebAuthn API produces; the server (`py_webauthn`, already reviewed under
  Core infrastructure/Auth) is what verifies the signature. Nothing here
  could be used to forge a credential — a wrapper that mis-handled an error
  would at worst show the wrong message via `passkeyPromptError()`, never
  grant an unverified login.
- **No new axios instance, no token written to `localStorage`/
  `sessionStorage`, no hardcoded secret, no new XSS sink** anywhere in the
  diff since the baseline — all four sweeps (Method steps 5, 8) returned
  zero hits in frontend source.
- **Every new call site that reaches the global cached client is correctly
  excluded from caching where it carries a credential, and correctly left
  cacheable where it doesn't.** `GET /events/{id}/guest-check-in-link` (the
  manager-facing view of the event's own guest QR token) is covered by the
  new `/guest-check-in-link` entry in `UNCACHEABLE_SUBSTRINGS`
  (`apiCache.ts:201-202`, added this pass's diff, documented for the same
  reason as the existing `/ical-feed` entry — a cached copy would keep
  showing a rotated-out token). `GET /users/{id}/passkeys`
  (`userServices.ts`'s new `adminListPasskeys`) is covered by the existing
  `/users` prefix (`apiCache.ts:33`/`:187`, unchanged). The guest-check-in
  link's actual unauthenticated consumption path (the token a guest scans)
  never touches this frontend's shared client at all — it is served by
  `backend/app/api/public/display.py`/`event_guest.py` directly to an
  unauthenticated browser.
- **The guest check-in link management endpoints the new `eventServices.ts`
  methods call are permission-gated and org-scoped, not merely
  authenticated.** `GET`/`POST /{event_id}/guest-check-in-link` and
  `POST .../rotate` (`backend/app/api/v1/endpoints/events.py:3035-3115`) all
  require `events.manage` and resolve the event through
  `_event_for_guest_link(db, event_id, current_user.organization_id)` —
  Pitfall #14a's org-scoped-by-id shape, not a bare `select(...).where(id ==
...)`. This is Events & Requests' (#16) own rotation slot, already `✅`;
  confirmed rather than assumed because the new frontend calls are new
  surface this pass had not previously traced end-to-end.
- **`StepUpContext.test.tsx` was extended for the new behavior, not left
  behind it** — 75 lines added covering: the passkey option offered/used
  when `hasPasskey && passkeysSupported()`, the typed-proof field hidden for
  a passkey-only member, and the unsupported-browser message shown when a
  passkey-only member's browser lacks WebAuthn. Not a gap this pass had to
  flag.
- **All 13 module `services/api.ts` files, enumerated fresh by directory
  listing rather than carried over from FE11's count, still split 11
  `createApiClient()` / 2 global-`api`-import** (`ip-security`, `testing`),
  matching FE11's count and conclusion; only 2 of the 13
  (`grants-fundraising`, `prospective-members`) changed since the baseline,
  and both changes are type/field additions through the module's existing,
  already-audited client — no auth, CSRF, or caching code touched.
- **`prospective-members/services/api.ts`'s `publicStatusService` bare
  `axios.get`/`.post` calls (pre-existing, unchanged pattern) and the new
  `nextMeetingCalendarUrl()` helper carry no new risk** — the helper builds a
  URL string only (the browser fetches it directly as a download link, not
  through this service), and its one interpolated value, `token`, is passed
  through `encodeURIComponent`.

## Not fixed — considered, judged correctly scoped

- **`FE5-34-1`'s broader ask** (excluding the whole `/inventory/items`
  catalog from caching for its unconstrained `color` field) — unchanged,
  still a recorded product trade-off in `KNOWN_LIMITATIONS.md`. Not
  re-litigated.

No product decision from this pass needs mirroring into
`KNOWN_LIMITATIONS.md` — there is nothing to fix or flag this pass.

## Documentation corrections

None needed.

## Schema & migration notes

n/a — no owned tables; this feature is frontend-only.
`validate_migrations.py --strict` run as part of the completion gate
regardless: 666 revisions, single head (`0d9897752425`) — unrelated to this
feature, confirmed clean.

## Guard tests added

None — no finding required a fix this pass. The new/extended tests this
pass's own diff already carries (`passwordChangeGate.test.ts`,
`embedOrigins.test.ts`, `formEmbedSnippet.test.ts`, `passkeys.test.ts`, the
75-line `StepUpContext.test.tsx` extension) were written by the feature
work itself, not by this review, and were read and judged adequate above
rather than authored here.

## Completion gate

| Check                                                | Result                          |
| ---------------------------------------------------- | ------------------------------- |
| `flake8 app/ tests/ alembic/`                        | ✅ 0 violations                 |
| `black --check app/ tests/ alembic/`                 | ✅ clean, 2,706 files unchanged |
| `isort --check-only app/ tests/ alembic/`            | ✅ clean                        |
| `validate_migrations.py --strict`                    | ✅ 666 revisions, single head   |
| `npm run typecheck` (whole frontend)                 | ✅ 0 errors                     |
| `npm run lint` (whole frontend, `--max-warnings 10`) | ✅ 0 errors, 0 warnings         |
| Scoped frontend suite (9 files, the reviewed delta)  | ✅ 180 passed                   |

No backend file was touched this pass; the backend gate was still run in
full per CLAUDE.md's completion-gate requirement and confirmed clean. No
frontend _source_ file was touched by this pass either — the diff for this
PR is this findings file plus `PROGRESS.md` bookkeeping — so beyond
`typecheck`/`lint` (which cover the whole tree regardless of what changed),
the scoped suite above (`passwordChangeGate.test.ts`, `embedOrigins.test.ts`,
`formEmbedSnippet.test.ts`, `passkeys.test.ts`, `StepUpContext.test.tsx`,
`apiCache.test.ts`, `apiClient.test.ts`, `createApiClient.test.ts`,
`stepUp.test.ts`) was run to confirm the reviewed delta's own tests pass on
the current tree, per the same precedent FE10/FE11 recorded.

Diff scope for this pass: 24 files changed since the `e007f1f5` baseline
(883 insertions, 56 deletions; none requiring a fix), reviewed against all
seven checklist dimensions, plus this findings file and `PROGRESS.md`.
