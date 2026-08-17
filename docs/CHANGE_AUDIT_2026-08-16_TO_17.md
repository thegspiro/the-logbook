# Change audit: August 16–17, 2026

Net changes merged to `main` in the 24 hours after the
[August 15–16 audit](./CHANGE_AUDIT_2026-08-15_TO_16.md) snapshot — from
2026-08-16 17:30 ET through PR #1532 at 2026-08-17 17:28 ET. Sixty non-merge
commits: three new security subsystems (challenge-response, breached-password
detection, suspicious-IP throttling), nine authorization and data-exposure
fixes, one schema migration plus a four-head Alembic repair, a dependency
sweep that changed a documented invariant, and a large screenshot re-capture
pass.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 16–17 section). Wiki handoff:
[`Recent-Changes-2026-08-16-to-17`](../wiki/Recent-Changes-2026-08-16-to-17.md).
Media disposition:
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md) and
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

---

## Release map

| Area | PRs | Pages / connection points | API / data points | Boundary and edge cases |
| --- | --- | --- | --- | --- |
| **Auth — challenge-response (CAPTCHA)** | #1513 (+#1534) | Forgot-password page; public form submission page. **Not** guest check-in | `GET /api/v1/auth/captcha-config` (anonymous); `require_captcha` dependency on `POST /api/v1/auth/forgot-password` and `POST /api/public/forms/{slug}/submit`; token rides in the **`X-Captcha-Token`** header; `app/core/captcha.py`; `frontend/src/hooks/useCaptcha.ts` | **Fails closed** — a provider outage rejects submissions (opposite of breached-password, deliberately: nothing else guards these forms). Off by default. Enabled-without-a-secret logs an error and enforces **nothing** rather than rejecting everything. Enabling widens the CSP to the provider's widget origins (`_WIDGET_ORIGINS`); with CAPTCHA off the policy is byte-for-byte unchanged, `frame-src` included. Tokens are single-use, so a rejected submission resets the widget. Rejections are generic — provider error codes are never relayed. Frontend mirrors the server's decision and treats an unreachable config endpoint as "not required" (the server still enforces). reCAPTCHA v3 is scored against `CAPTCHA_MIN_SCORE`, not read as a boolean. |
| **Auth — breached-password rejection** | #1513 | Registration; self-service password change; reset-by-token; admin user creation; admin password reset — all five paths | `app/core/breached_password.py` → `check_password_not_breached()`; HIBP range API (`BREACHED_PASSWORD_API_URL`), k-anonymity: only the first **5 hex characters** of the SHA-1 are sent | **Fails open** by design — an unreachable, slow, erroring or unparseable provider **accepts** the password, because complexity rules, history, MFA and lockout still apply and a third-party outage must not stop a department setting passwords mid-incident. Degradation is logged so operators can alert on it. Off by default (needs outbound network). The rejection message **omits the breach count** — a precise count is a free oracle over the corpus and tells the member nothing actionable. The SHA-1 is marked `usedforsecurity=False`: it is the corpus's lookup index, never stored, never compared to a credential, and the marking keeps the call working on FIPS builds. |
| **Auth — suspicious-IP throttling** | #1513 | All sign-in surfaces (no new page) | `app/core/suspicious_ip.py`: `record_auth_failure()`, `clear_auth_failures()`, `get_block_remaining()`, `enforce_suspicious_ip()`; Redis keys `suspicious_ip:fail:{ip}` / `suspicious_ip:block:{ip}`; wired into `POST /auth/login` and `POST /auth/mfa/login`, **including the pre-verification challenge rejections** | Counts **failed** attempts per IP across **all** accounts over a long window — the gap between the per-IP burst limit and the per-account lockout, through which a spray (two passwords × a thousand usernames) walks unmetered. **A successful sign-in clears the IP's counter only after full authentication**, never on a correct password alone — otherwise an attacker holding one leaked password for an MFA-protected account could zero the tally at will. **Clearing never lifts an already-active block.** Redis-backed and shared across workers; degrades to a per-process counter that is capped and evicted per Pitfall #9. |
| **Auth — CI-11 rate-limit fail-open** | #1513 | — | `check_rate_limit` now calls `is_rate_limited(..., raise_on_error=True)` | The helper swallows its own exceptions and returns "not limited" unless `raise_on_error` is set, so the documented in-memory fallback was **unreachable**: in the window where Redis is connected but a command transiently fails, the request was limited by neither backend. The sibling `public_rate_limit` already passed the flag; the auth path did not. |
| **Scheduling — platoon roster exposure** | #1531, #1532 | Shift detail (hold-over / availability roster); Platoon Management page (`/scheduling/platoons`) | `GET /scheduling/shifts/{id}` returns `platoon_roster: []` unless `_can_view_platoon_roster()`; `GET /scheduling/platoons/overview` moved `scheduling.view` → **`scheduling.manage`** | The roster reveals other members' **availability and leave status**. Visible to `scheduling.assign`, `scheduling.manage`, or the shift's own `shift_officer_id`; everyone else keeps general shift details and gets an empty list — the roster is not even fetched. `scheduling.view` is implicit for all authenticated members, so it was never a meaningful gate on a department-wide roster. |
| **Scheduling — deleted members on generated shifts** | #1526 | Generated platoon shifts | `SchedulingService` platoon generation filters `User.is_active` (was `User.status == "active"`) | `status` and `is_active` are different columns: a soft-deleted / anonymized member can retain a `status` of `active` while `is_active` is false, so deleted users were being staffed onto generated shifts. |
| **Scheduling — pattern rendering crash** | #1527 | Scheduling → Patterns tab | `PatternsTab.tsx` reads `schedule_config.platoons` defensively | `schedule_config` is unvalidated JSON. A non-array (or an array with non-string members) reached `.map()` and took the whole tab down. Now filtered to strings, defaulting to `[]`. |
| **Prospective members — form auto-advance** | #1523 | Pipeline stage of type `form_submission` with `auto_advance` | `FormsService._auto_advance_pipeline_step(form, submission)` now also filters `ProspectiveMember.form_submission_id == submission.id`; audit `action_result` gains `form_submission_id` | **One submission advanced every active prospect parked on that step.** A submission is evidence about its own submitter only. Now exactly the bound prospect advances, and the audit row records which submission caused it. |
| **Inventory — impact-plan PDF injection** | #1529 | Impact Planner → export PDF | `app/utils/impact_plan_pdf.py` wraps `org_name`, each parameter string, member `full_name` and the contact cell in `xml.sax.saxutils.escape` | ReportLab `Paragraph` parses a mini-HTML dialect, so a member name or org name containing `<`/`&` was interpreted as markup — corrupting or failing the render, with the text under a member's own control. Non-`Paragraph` cells (membership number, rank, station) are drawn as plain strings and are not affected. |
| **Logging — exception diagnostics** | #1533 | — | `app/core/logging.py`: `diagnose=False` on all three sinks (JSON, console, rotating file) | Loguru's `diagnose` prints **local variable values** in tracebacks. On a password-set or token-verify frame that is the credential itself, written to disk with 30-day retention and shipped wherever logs are shipped. Off on every sink, not just the file one. |
| **CORS — CAPTCHA header** | #1534 | — | `X-Captcha-Token` added to `allow_headers` in `backend/main.py` | Without it, a cross-origin browser preflight strips the header and every challenged submission fails verification — presenting as "the CAPTCHA never passes" rather than as a CORS error. Same-origin deployments were unaffected, which is why it survived the feature's own tests. |
| **Meetings — card counts** | #1519 | Minutes page (`/meetings`) meeting cards | `MeetingsService.attach_child_counts()` fills `attendee_count` / `action_item_count`; called from the list endpoint | `MeetingResponse` declared both counts and the cards rendered them, but the list query loaded no children — every card read "0 attendees · 0 action items" over a meeting whose detail view showed eight and two. Two grouped `COUNT()`s, not loaded rows, since only totals are rendered. Seeder now populates `/meetings` (approved business meeting with attendees, motions and open action items; a draft board meeting; a pending public event request), guarded per title so a half-finished run tops up rather than skipping. |
| **Dashboard — readiness correctness** | #1518 | Dashboard readiness line | `currentCredentials` (newest credential per course) feeds both the verdict and the "Needs you" filter; screening window read from `days_until_next_expiration` | **A renewed certification grounded the member permanently** — `my-training` returns a history, so a lapsed 2024 row outvoted the valid 2026 one. Screenings were judged on the backend's 30-day `expiring_soon_count` while certifications used 60, so a screening lapsing in 45 days read as current beside a certification that read as a condition; the verdict now reads its own window, which also catches one lapsing **today** (excluded by the backend's `0 < days` bound). A failed screening refresh now **clears** the counts instead of leaving a stale "Clear to respond" behind a scope note claiming screenings were checked. A screening-only verdict links to the department feed, not the training page. |
| **Training — driver / EVOC block** | #1511 | Shift assignment; pattern generation; shift edit; driver-exception review | `driver_exceptions` table (migration `20260816_0008`); `DriverExceptionService`; `EvocLevelService`; `ShiftEligibilityService` | Certification expiry is judged **on the shift's date**, not today. Pattern generation writes assignments directly and bypassed the block entirely — it now checks each driver seat, leaves the seat empty rather than failing the run, and reports the skip. A shift edit moving `apparatus_id` or `shift_date` revalidates drivers already seated (otherwise: seat a driver on an apparatus-less shift, then set the apparatus). Deleting an apparatus **CASCADEs** the exception instead of `SET NULL` — a `SET NULL` grant for one retired unit is indistinguishable from a blanket one and silently widens to the whole fleet; the audit log retains the approval. Concurrent chief reviews are settled by a conditional `UPDATE`. **Every** certification a member holds is considered, not just the highest (cumulative L3 + non-cumulative L4 was refused for an L2 apparatus). `valid_from` is bounded, not only the window length. |
| **Medical supplies — alert domain leak** | #1500 | Low-stock, expiring-supply and NFPA-retirement emails/SMS | `_stock_alert_audiences(db, org_id)` → `{frozenset({"gear","medical"}): [...], frozenset({"medical"}): [...]}` in `app/services/scheduled_tasks.py` | Widening recipients to medical-only officers handed them a **single rendered table built from every row** — gear item names, categories and counts the API refuses them by design. Mailing data is the same disclosure as serving it. Recipients are now grouped by the domains they may see and each group gets only its own rows; someone holding both grants lands in the two-domain group and receives **one** complete email, not two partial ones. Expiring lots are fetched per domain. Deployed-on-apparatus sections stay with every recipient — that is checklist content governed by `equipment_check.*`, a different permission axis. The SMS carries only a count, so it is not split, and says so. |
| **Medical supplies — lot-stocked "On hand"** | #1500 | Medical Supplies → edit supply | `quantity` omitted from the payload for lot-stocked items | A lot-stocked item's count comes from its lots. Editing "On hand" wrote `quantity`, returned a success toast, and the displayed number did not move. The field is replaced for such items by the lot figure and a pointer to **Receive delivery**; `quantity` is left out of the payload entirely rather than sent as a null that would clear a column nothing shows. |
| **Medical supplies — migration downgrade** | #1500 | — | `20260816_0005` downgrade | The downgrade removed the medical and `equipment_check` grants **unconditionally**, including ones a department had granted by hand long before the migration — while the comment above it claimed the opposite. |
| **Prospective members — approve-step authority** | #1510 | Pipeline stage approval (`/approve-step`) | `MembershipPipelineService` rejects roles the stage did not request; refuses a stage with no approver roles configured | `/approve-step` is deliberately **not** manager-gated — the caller's only authority is that the stage asks for a role they hold. The service checked only that they hold the submitted role, never that the stage requested it: any member could write their own position into any prospect's workflow (with arbitrary notes, receiving the full prospect record back), and a stage with **no** configured approvers left nothing "missing", completing and advancing the prospect outright. The manager route rejects unrequested roles too, since recording one files misleading sign-off evidence. |
| **Events — copied lifecycle markers** | #1510 | Event duplication; rolling-series extension | Shared reset-key constant on the event model, applied at both copy sites | Copying stripped the older lifecycle markers but not `attendance_finalized`, so a copy of a finalized event looked finalized and never got its own validation prompt. |
| **Scheduling — reopened shift reminders** | #1510 | Shift reopen | `reopen_shift` clears `validation_notification_sent` | The post-shift task skipped a reopened shift forever, so nobody was reminded to re-finalize. |
| **Events — date-only timezone** | #1510 | Event-request form | Date-only picker values anchored to midnight in the **organization's** timezone | They were stamped UTC midnight, displaying the previous day for every negative-offset department. |
| **PWA — force refresh offline guard** | #1512 | Settings → App → Force refresh | `forceAppRefresh()` probes `/version.json` and returns `'unreachable'` without touching anything | The precache is the app's **only** offline copy and workbox heals a deleted entry only by fetching it, so purging offline deleted the shell and reloaded into nothing — bricking the installed PWA until signal returned. Reachability means a **parseable `/version.json`**, not `navigator.onLine`, which reports a healthy connection on station Wi-Fi behind a captive portal. `navigator.onLine === false` is still a fast path (unreliable when true, conclusive when false). Residual window between probe and reload is milliseconds and cannot be closed from the page. |
| **Inventory — CSV vendor import** | #1513, #1517 | Gear Admin → import CSV | Unmatched-vendor report on the import result | Names are deduplicated on the **case-folded** key (matching what Attach-all does), displaying the first spelling seen — "Gals"/"gals"/"GALS" was reported as three pieces of work for one. A name is recorded only **after** its row imported, because `create_item` still rejects rows the CSV parse accepted (duplicate serial, pool item with no quantity). A name matching a **deactivated** vendor now links to it rather than being reported as unmatched and sending the reader to a creation form that rejects inactive duplicates — a dead end. |
| **Public API — token alphabet** | #1515 | `GET /api/public/v1/application-status/{token}`; finance approval-by-token | OpenAPI `pattern` declared for base64url on both token parameters | The schema constrained length but not alphabet, so the contract fuzzer generated arbitrary Unicode; percent-encoding is byte-oriented and lossy, so ten characters arrived as eight and tripped `min_length=10`. These are `secrets.token_urlsafe` values — base64url is the truth about them. **The calendar feed's token is deliberately left alone**: it answers 404 for a malformed token, so it cannot trip the check, and adding a pattern would turn that into a 422, leaking "wrong format" apart from "not found" on a public feed. |
| **Onboarding — CSRF token storage** | #1521 | Setup wizard | Onboarding CSRF token moved from an origin-wide cookie to **`sessionStorage`** (tab-scoped) | Two concurrent onboarding tabs could overwrite each other's token. Migration path: a client still holding the legacy cookie has it **adopted** into the tab and the cookie retired; a stray cookie with **no session id behind it** is ignored rather than adopted as a credential. Both paths are covered by tests, because one-time migration code fails silently once the deploy needing it has rolled past. |
| **Onboarding — email header injection** | #1521 | Onboarding forms | `isValidEmailSecure` newline check is now case-insensitive | It rejected `%0a`/`%0d` with a **case-sensitive** `includes()`. RFC 3986 prefers uppercase hex, so `%0A` — the canonical spelling and the one an attacker is most likely to send — went straight through. The backend's equivalent in `security_middleware.py` is **not** affected: it lowercases the address first. |
| **Dependencies** | #1504, #1505, #1506, #1507 | — | `bcrypt` 4.3.0 → **5.0.0**; python-minor-patch group (12 packages); npm-minor-patch group (4 packages); `typescript` **5.9.3 → 7.0.2** in `frontend/package.json` | The TypeScript bump **collapsed a documented invariant** — see [TypeScript dependency drift](#typescript-dependency-drift-action-required) below. |
| **Migrations** | #1511, #1514, #1524, #1530 | — | Revision ids are now Alembic-generated; `validate_migrations.py` errors on a hand-authored `YYYYMMDD_SSSS` id dated 2026-08-17 or later, and prints the head | The validator no longer hands out **single-parent guidance for a forked chain** — "set `down_revision = X`" printed once per head names two parents that cannot both be right. |

---

## Alembic route (upgrade data path)

The window opened with a single head at `20260816_0005` and closed with a
single head at `8050e5a61f34`, by way of a four-head fork that made the
versions directory unloadable for roughly an hour.

### Revisions added

| Revision | Revises | File | What it does |
| --- | --- | --- | --- |
| `20260816_0006` | `20260816_0005` | `20260816_0006_backfill_legacy_shift_finalization.py` | Backfills `is_finalized` on shifts predating the finalization feature |
| `20260816_0007` | `20260816_0005` | `20260816_0007_unify_email_notification_preference.py` | Folds the split email-notification preference into one column |
| `20260816_0008` | (`_0006`, `_0007`) | `20260816_0008_add_driver_exceptions.py` | Creates `driver_exceptions` (org-scoped, `justification`, `restrictions`, `valid_from`/`valid_until`, review fields) with four indexes; **also merges** the fork |
| `20260816_0009` | (`_0006`, `_0007`) | `20260816_0009_track_reversible_completion_effects.py` | Adds `previous_status`, `phase_before_id`, `phase_after_id`, `completion_credit_id`; **also merges** the fork |
| `71d86eba9a9e` | (`_0006`, `_0007`) | `20260817_1757_71d86eba9a9e_merge_…py` | No-op merge |
| `bb34f8937c89` | (`_0006`, `_0007`) | `20260817_1757_bb34f8937c89_merge_…py` | No-op merge |
| `8050e5a61f34` | (`_0008`, `_0009`, `71d86eba9a9e`, `bb34f8937c89`) | `20260817_1847_8050e5a61f34_rejoin_the_four_heads_left_by_.py` | **Current head.** Names all four surviving heads as parents |

### How the fork happened, and why the repair looks redundant

`20260816_0006` and `20260816_0007` both revise `20260816_0005` — two branches
open at once, each landing a migration. **Five pull requests independently
noticed the fork and each wrote a merge for it. All five merged within the
hour**, so the repair became the fork: `main` was left with four heads and two
files claiming revision id `20260816_0008`. A duplicate revision id makes the
versions directory unloadable — `alembic upgrade head` fails outright, a fresh
install cannot migrate, and the head-count tests fail on every open PR.

The repair, and the reasoning that constrains it:

- **`20260816_0008_merge_finalization_and_email_prefs.py` was deleted.** The
  duplicate id has to go for Alembic to load *either* revision, and this file
  is a no-op merge — the only member of the set whose removal has no schema
  consequence. The driver-exceptions revision keeps the id.
- **The two redundant no-op merges (`71d86eba9a9e`, `bb34f8937c89`) were
  kept.** A deployment may already have stamped them, and deleting a recorded
  revision strands that database at an id its chain no longer contains.
- **One merge revision names all four surviving heads.** Alembic runs each
  ancestor exactly once however many merge paths reach it, so the redundancy
  costs nothing at upgrade time.

Backend suite after the repair: 5,092 passed, 2 skipped.

### Operational notes

- **`driver_exceptions.apparatus_id` is `ON DELETE CASCADE`, not `SET NULL`.**
  This is the one place in the schema where CASCADE is the *safe* choice: a
  nulled `apparatus_id` on an approved exception is indistinguishable from a
  blanket fleet-wide grant, so `SET NULL` silently widens an authorization on
  apparatus retirement. The audit log retains the approval record.
- Standard procedure is unchanged: back up, confirm exactly one
  `alembic heads` result, run `alembic upgrade head`.
- `python scripts/validate_migrations.py` (from `backend/`) is the source of
  truth for the head and the `down_revision` to use.
  [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md) no longer records it by
  hand.

---

## End-to-end data paths and sharing boundaries

### 1. Password set → breach corpus (new outbound path)

```
member/admin sets password
  → AuthService / users endpoint
    → check_password_not_breached(password)
      → SHA-1(password) locally
        → first 5 hex chars ────HTTPS───▶ api.pwnedpasswords.com/range/{prefix}
        ◀──── every suffix sharing that prefix
      → match made in-process against BREACHED_PASSWORD_MIN_COUNT
  → accept, or reject without naming the count
```

**What leaves the deployment:** five hexadecimal characters. Never the
password, never its full hash, never which suffix was being asked about, never
a member identifier. **What happens on failure:** the password is accepted and
the degradation is logged. **Default:** off — this is the only feature in the
platform that makes an outbound request during authentication, and some
deployments cannot permit that.

### 2. Anonymous submission → challenge provider (new outbound path)

```
browser loads forgot-password / public form
  → GET /api/v1/auth/captcha-config   (anonymous; returns enabled/provider/siteKey — never the secret)
  → widget renders (Turnstile | hCaptcha | reCAPTCHA v3)
  → submit carries X-Captcha-Token header
    → require_captcha dependency (runs before body parsing — no schema change)
      → POST provider verify URL with CAPTCHA_SECRET_KEY + token + remote IP
      ◀── success boolean, or a 0.0–1.0 score for reCAPTCHA v3
    → reject generically on failure; token is burned either way
  → FormsService.submit_public_form / password-reset flow
```

**Shared with the provider:** the token and the submitter's IP address.
**Never shared:** form contents, the member's email, the organization.
**CSP consequence:** enabling CAPTCHA adds the provider's widget origins to
`script-src` and `frame-src` in `SecurityHeadersMiddleware`. A new provider
needs an entry in **both** `_VERIFY_URLS` and `_WIDGET_ORIGINS` — a hardcoded
`script-src 'self'` silently blocks the widget, and the symptom is "the
challenge never appears", not a CSP error.

### 3. Failed sign-in → suspicious-IP ledger

```
POST /auth/login or /auth/mfa/login (incl. pre-verification challenge rejection)
  → enforce_suspicious_ip(request)         ← blocks before any credential work
  → on failure: record_auth_failure(ip)    → INCR suspicious_ip:fail:{ip}, EXPIRE window
      → threshold crossed → SET suspicious_ip:block:{ip}, EXPIRE block
  → on FULL authentication success: clear_auth_failures(ip)
      → clears the counter; does NOT lift an active block
```

**Keyed on IP only** — no account identifier is stored, so this ledger holds
no member data. Redis-backed and shared across workers; the in-memory fallback
is per-process, capped and evicted.

### 4. Stock alerts → per-domain audiences

```
scheduled task
  → _stock_alert_audiences(db, org_id)
      → {frozenset({"gear","medical"}): [recipients…],
         frozenset({"medical"}):        [recipients…]}
  → per audience: fetch only that audience's rows (expiring lots fetched per domain)
  → render one message per audience
  → deployed-on-apparatus sections → every recipient (equipment_check.* axis)
  → SMS → count only, not split, and says so
```

A member holding both grants appears in the two-domain group **once**, and
receives one complete email rather than two partial ones.

### 5. Shift detail → platoon roster

```
GET /scheduling/shifts/{id}
  → _can_view_platoon_roster(shift, user)
      scheduling.assign OR scheduling.manage OR user is shift.shift_officer_id
  → true  → service.get_platoon_roster_for_shift(shift)
    false → []   (not fetched at all)
```

The roster carries other members' availability and leave status. Everything
else on the shift stays visible to any member with `scheduling.view`.

---

## TypeScript dependency drift (action required)

**Dependabot PR #1504 bumped `frontend/package.json`'s `typescript` from
`5.9.3` to `7.0.2`, collapsing the two-install arrangement CLAUDE.md
documents.** The manifest now declares:

```jsonc
"typescript": "7.0.2",
"typescript-eslint": "^8.67.0",
"typescript-native": "npm:typescript@7.0.2",   // now identical to the above
```

`typescript-eslint@8.67.0` still caps its peer at `typescript >=4.8.4 <6.1.0`.
The tree resolves today only because **npm auto-installed a second TypeScript
(5.9.3) at the repository root as a peer dependency** — `package-lock.json`
carries `node_modules/typescript@5.9.3` with `"peer": true`, alongside
`frontend/node_modules/typescript@7.0.2`.

CI on `main` is green with this arrangement (last full-suite success:
run for PR #1528, 2026-08-17 20:27 UTC), so nothing is broken **right now**.
What changed is that the arrangement went from **declared** to **incidental**:

- The alias `typescript-native` is now redundant — both names resolve to
  `typescript@7.0.2`.
- The linter's 5.9.3 is no longer pinned by anything the repository controls.
  It exists because npm chose to satisfy a peer range, which is not a
  guarantee across npm versions or a `--strict-peer-deps` install.
- CLAUDE.md's warning that "plain `tsc` on `PATH` is the 5.9.3 one" is now
  **stale inside the frontend workspace** — `frontend/node_modules/.bin/tsc`
  is 7.0.2.

CLAUDE.md has been corrected to describe the current state. Deciding whether
to re-pin `typescript` at 5.9.3 (restoring the declared arrangement) or to
drop the alias and let the peer stand is a code change, not a documentation
one, and is left to the maintainers. It is tracked as **BUILD-1** in
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

Other dependency notes from this window:

- **`bcrypt` 4.3.0 → 5.0.0** (major). Password hashing is unchanged in
  behaviour; the API key verification path and the login path both exercise it
  and pass. Worth re-reading if a deployment pins a bcrypt wheel.
- **Stryker is deliberately absent from `package.json`.** `stryker.pilot.json`
  and `vitest.stryker.config.ts` are committed but `@stryker-mutator/core`
  pulls a transitive `qs` advisory through `typed-rest-client` with no released
  fix, taking `npm audit` from 0 findings to 2 moderate for every developer.
  [TESTING.md](../TESTING.md) carries the pinned install-for-the-run line, both
  invocation forms, the sandbox cleanup, and the wrong-package trap (`npx
  stryker` fetches an unrelated pre-scoped registry package and never reads the
  config).

---

## Test and tooling changes

- **Backend guards now fail when their subject moves.** 18 guards in
  `test_changelog_fixes.py` skipped themselves when the file they inspect was
  missing. Every one of those paths is tracked, so "not found" means someone
  moved the file — a guard that retires itself exactly when its subject is
  renamed is worse than no guard. Three more skipped on an empty migrations
  glob, which would let the chain-integrity checks pass over an empty set.
  All now assert, with a message saying to repoint the path.
- **`test_push_service.py` imports `py_vapid` via `pytest.importorskip`.** It
  ships with the optional `pywebpush`; a failed module-level import is a
  *collection* error and pytest aborts the whole session on one, so a developer
  without that optional dependency got 0 tests instead of 4,535.
- **`vitest/prefer-called-with` is `off` and must stay off.** Its autofix
  rewrites `expect(m).toHaveBeenCalled()` into the **zero-argument**
  `toHaveBeenCalledWith()` without inspecting how the mock was called, and the
  pre-commit hook runs `eslint --fix`. That is the mechanism behind "34 of 46
  broken tests" — see CLAUDE.md Pitfall #13.
- **New coverage:** the shared axios factory every module's auth depends on;
  API cache TTL boundaries and eviction ordering (the eviction path is now
  mutation-proof at 90.43%); onboarding storage and the API client transport;
  onboarding utils (validation 0→100%, security 0→100%, errorHandler 0→93.4%);
  the offline queue, the one path where a defect loses field data.
- **Interpretation caveat, recorded in TESTING.md:** inspect mutation
  survivors by hand before treating any as a gap. A meaningful share are
  *equivalent* mutants no test can kill — all three survivors in
  `formValues.ts` were equivalent, so its effective score is 100%, not the
  reported 96%. `isValidHostSecure`'s IPv4 branch is unreachable (every
  digit-only label is already a legal hostname label), and 34 mutants inside it
  have no input that can distinguish them; the regex is kept as documentation
  of intent, with a test recording the observable consequence — octet ranges
  are **not** enforced, so it is a syntax gate, not an address validator.

---

## Documentation and media disposition

### Corrected in this pass

| Document | Correction |
| --- | --- |
| `CLAUDE.md` | "Two TypeScript installs" section rewritten to match the post-#1504 reality |
| `docs/ALEMBIC_MIGRATIONS.md` | Head note points at `8050e5a61f34`; the four-head fork recorded as history |
| `docs/KNOWN_LIMITATIONS.md` | BUILD-1 added (TypeScript peer drift); EV-5 and FORM-5 confirmed resolved |
| `docs/SCHEDULING_MODULE.md` | Platoon overview permission; shift-roster visibility rule |
| `wiki/Module-Scheduling.md` | Same, for the wiki audience |
| `wiki/Configuration-Security.md` | Brute-force control matrix; CAPTCHA configuration and its CSP consequence |
| `wiki/Security-Authentication.md` | Breached-password check; suspicious-IP throttling |
| `wiki/Configuration-Environment.md` | Twelve new environment variables |
| `docs/training/19-august-2026-release-changes.md` | August 16–17 operator section |
| `docs/training/03-scheduling.md` | Who can see the platoon roster |
| `docs/DATABASE_SCHEMA.md` | **Regenerated** — it was stale by three merges |
| `docs/PUBLIC_API_DOCUMENTATION.md` | Token parameters declare a base64url pattern |
| `docs/MEETING_MINUTES_MODULE.md` | List-response child counts |
| `docs/PROSPECTIVE_MEMBERS_MODULE.md`, `docs/FORMS_MODULE.md` | Auto-advance is bound to the submitting prospect |
| `wiki/Module-Inventory.md` | CSV unmatched-supplier report; impact-plan PDF escaping |
| `docs/training/05-inventory.md` | Lot-stocked "On hand"; CSV supplier-name edge cases |

**`DATABASE_SCHEMA.md` is generated** (`backend/scripts/generate_schema_docs.py`
reads `app/models/`, which *is* the schema a fresh install receives) and had not
been regenerated since three model changes landed. It was understating the
database by one table and 21 columns:

- **`driver_exceptions`** (17 columns) was entirely absent
- `inventory_items.item_type` was missing the `medical` enum member
- `requirement_progress_credits` was missing three columns
- `apparatus_operators` was missing one

Regenerating is a one-command step and is worth doing in any pull request that
touches `app/models/` — a schema reference that silently omits a whole table is
the kind of staleness a reader has no way to detect.

### Screenshots

Flagged for **replacement** (the pictured screen changed) and for **new
capture** (the screen is new) in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).
The short version:

- **Replace:** any Minutes-page card capture (the counts were rendering `0`),
  the shift-detail capture that shows a populated roster (it is now empty for
  most viewers), and the Platoon Management capture (its permission changed).
- **Capture:** the challenge widget on forgot-password and public form submit;
  the breached-password rejection; Settings → App with the unreachable-server
  refusal; the driver-block refusal and the exception-request flow.

### YouTube scripts

Two scripts carry narration this window falsified, and three carry B-roll that
will now behave differently on camera. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

---

## Upgrade notes for administrators

1. **Run `alembic upgrade head`.** If you pulled `main` between roughly 17:30
   and 18:50 UTC on 2026-08-17 you may have a checkout whose versions directory
   does not load at all (duplicate revision id `20260816_0008`). Pull again —
   the repair is `8050e5a61f34`. No database recovery is needed; the broken
   state prevented migration rather than corrupting it.
2. **Nothing new is on by default** except suspicious-IP throttling, which is
   `SUSPICIOUS_IP_THROTTLE_ENABLED=true` with a deliberately generous
   threshold (50 failures per hour per IP, 15-minute block). Departments
   behind a single NAT egress should confirm the threshold suits their roster
   size before assuming it will never fire; a fully successful sign-in from
   that IP clears the counter, so ordinary typo traffic does not accumulate.
3. **CAPTCHA and breached-password checks are opt-in** and both need
   configuration beyond a boolean — see
   [`wiki/Configuration-Security.md`](../wiki/Configuration-Security.md).
   Enabling CAPTCHA without `CAPTCHA_SECRET_KEY` logs an error and enforces
   nothing; that is deliberate, so a half-finished setup does not read as an
   outage.
4. **If you run behind a reverse proxy on a different origin,** the
   `X-Captcha-Token` header must survive it. It is in the app's CORS
   allowlist as of #1534; a proxy with its own header allowlist needs the same
   entry.
5. **Platoon Management now requires `scheduling.manage`.** Anyone who reached
   it with `scheduling.view` will now get a permission error — grant
   `scheduling.manage` to the roles that legitimately need the
   department-wide roster.
