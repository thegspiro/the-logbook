# Changelog

All notable changes to The Logbook project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> **Older entries are archived by month** under
> [`docs/changelog/`](docs/changelog/). This file carries the current month;
> when August closes it is archived the same way. Nothing was rewritten in the
> move except link paths.
>
> [July 2026](docs/changelog/2026-07.md)  ·  [June 2026](docs/changelog/2026-06.md)  ·  [May 2026](docs/changelog/2026-05.md)  ·  [April 2026](docs/changelog/2026-04.md)  ·  [March 2026](docs/changelog/2026-03.md)  ·  [February 2026](docs/changelog/2026-02.md)

### Documentation gates: two that were not gating (2026-08-18)

**Fixed**

- **202 routes were exempt from the endpoint permission check.**
  `check_endpoint_permissions.py` compares each route's docstring against the
  permissions it enforces, and its regex read only one of the **two** spellings
  in use: `Requires permission:` (428 uses) but not `Permissions required:`
  (202 uses). That was worse than a miscount. A docstring the regex cannot see
  contributes **no** documented permissions, so it could never produce a
  `mismatch` — it fell into `understated`, a warning that does not fail the
  build. Those 202 routes could have named a permission the route did not
  enforce, indefinitely, while CI stayed green and reported them as merely
  under-documented. Widening the regex surfaced **two real
  docstring/enforcement disagreements** that had been invisible.
- **The checker read only the signature, so eight routes looked undefended.**
  Enforcement lives in two places: a `Depends(require_permission(...))`
  dependency, and — where the permission is not the only way in — a helper
  called in the route body. The officer named on a shift may manage its crew,
  attendance, calls, finalization and cancellation **without**
  `scheduling.assign` / `scheduling.manage`, and that check needs the loaded
  shift row, so it cannot be a dependency. Reading only the signature reported
  those routes as `undefended` — the script's most alarming finding, and here
  entirely wrong. **Anyone "fixing" the report by adding the dependency would
  have removed the shift officer's access.** Body authorizers are now read,
  including the permission a helper hardcodes internally, resolved from the
  helper's own definition so the mapping cannot drift.
- **A wrapped permission list lost everything after the wrap.** Four
  alternatives do not fit on one line inside an indented docstring; the capture
  stopped at the newline, which reads as a `mismatch` against a docstring that
  is complete and correct. Continuation now stops at a blank line, a new
  emphasis block, or a sentence end, so prose below the list cannot contribute
  tokens.
- **`docs/DATABASE_SCHEMA.md` had no drift gate.** It is generated from
  `app/models/`, and on a fresh install those models **are** the schema —
  `_fast_path_init()` calls `create_all()` and stamps Alembic at head, so
  nothing replays the migration chain. Nothing verified the file was current,
  and it had drifted across three merges: a whole table (`driver_exceptions`,
  17 columns) plus 21 columns were missing. A missing table is the dangerous
  kind of stale, because a reader has no way to detect it. CI now regenerates
  and fails on a diff.

**Changed**

- **The endpoint permission check runs with `--strict`.** The 189-route
  "under-documentation backlog" was mostly not a backlog — 163 were documented
  in the unread spelling and 8 more enforced through a body authorizer. The
  genuine remainder, **22 routes** across `users.py`, `roles.py` and
  `elections.py`, were documented rather than waived, so the count is zero and
  under-documentation now fails the build. Warnings accumulate; an error has to
  be dealt with by whoever caused it.
- Those 22 docstrings also lost an older, narrower `Requires \`x\` permission.`
  line that named fewer permissions than the route accepts — 18 in total, now
  replaced by one complete statement each.

**Added**

- `scripts/test_check_endpoint_permissions.py` — 10 regression tests, one per
  way the checker was wrong, each in the direction that made an unchecked route
  look fine. Includes the inverse case: an **unrecognised** helper must not
  read as protection, or a genuine `undefended` finding would become a silent
  pass. Repo-root script tests now run in CI.

### Documentation: the Medical Supplies module is documented (2026-08-18)

**Documentation**

- **The module shipped 2026-08-16 with no reference documentation at all.** It
  appeared in no `docs/*_MODULE.md`, nowhere in `wiki/`, not in
  `APPLICATION_PAGES.md`, and its `ems_supply_officer` role and
  `inventory.view_medical` / `inventory.manage_medical` permissions were in no
  role or permission reference. A department appointing an EMS supply officer
  had nothing to hand them.
- Added [`docs/MEDICAL_SUPPLIES_MODULE.md`](docs/MEDICAL_SUPPLIES_MODULE.md)
  and `wiki/Module-Medical-Supplies.md`, covering the module toggle, the two
  domain-scoped permissions and the OR check that keeps single-supply-line
  departments unaffected, the EMS Supply Officer role, the domain boundary
  (**404 not 403** on a cross-domain id, so the endpoint is not an existence
  oracle over the gear catalog), lot-based on-hand, the per-domain alert
  audiences, both migrations, and the edge-case table.
- Registered it in `APPLICATION_PAGES.md`, `ROLE_SYSTEM_README.md`,
  `docs/README.md`, `wiki/Home.md` and the wiki sidebar.

**Fixed**

- **The 2026-08-16 gear renames left instructions pointing at navigation items
  that no longer exist.** `docs/training/00-getting-started.md` told a reader to
  "navigate to **My Equipment** under **Inventory**" — both renamed (**My Issued
  Gear** under **Gear & Uniforms**). 74 label references were corrected across
  11 documents, plus four lines of narration in YouTube script 06.
  **If that chapter is already recorded, the audio is wrong** and is flagged in
  `SCRIPT_CURRENCY`. Dated historical notes and the changelog were deliberately
  left alone — rewriting them would falsify the record of what the screens were
  called at the time. `My Equipment Checklists` is a different, still-current
  scheduling screen and is untouched.

### Scheduling: the platoon roster is staffing information, not a directory (2026-08-17)

**Security**

- **A shift's platoon roster is no longer returned to every member.**
  `GET /scheduling/shifts/{id}` carried `platoon_roster` — the hold-over list
  of who is available, which is derived from **who is on approved leave**.
  Every authenticated member could read it, because the shift detail endpoint
  is gated on `scheduling.view`, which is implicit for all members. It now
  requires `scheduling.assign`, `scheduling.manage`, or being the shift's own
  `shift_officer_id`; everyone else gets an empty list and the roster is not
  fetched at all. General shift details — time, apparatus, assignments,
  check-in state — are unchanged for everyone.
- **Platoon Management moved from `scheduling.view` to `scheduling.manage`.**
  `GET /scheduling/platoons/overview` is the department-wide roster: every
  platoon, every member in it, plus the unassigned bucket. `scheduling.view`
  never gated it meaningfully. **Anyone who reached `/scheduling/platoons`
  with only `scheduling.view` will now get a permission error** — grant
  `scheduling.manage` to the roles that legitimately need it.

**Fixed**

- **Deleted members were being staffed onto generated platoon shifts.**
  Generation filtered `User.status == "active"`, but `status` and `is_active`
  are different columns — a soft-deleted or anonymized member can still carry
  a `status` of `active`. It filters `User.is_active` now.
- **The Patterns tab crashed on a malformed platoon list.**
  `schedule_config` is unvalidated JSON; a non-array `platoons` value (or an
  array holding non-strings) reached `.map()` and took the whole tab down.
  Non-string entries are filtered out and a missing or non-array value reads
  as empty.

### Auth: three controls between the brute-force gaps (2026-08-16 → 08-17)

**Security / Added**

- **Challenge-response (CAPTCHA) on the two internet-exposed forms** —
  public form submission and forgot-password. Both are reachable by anyone and
  were defended only by rate limiting, a honeypot and a daily cap: controls
  that raise the cost of automation without ever requiring a human, so a bot
  pacing itself under the limit still got through. Turnstile, hCaptcha and
  reCAPTCHA are all supported — operators do not share constraints, and the
  first two offer accessible challenges without a Google dependency. Off by
  default (`CAPTCHA_ENABLED`).

  **This control fails closed**, the opposite of the breached-password check
  below. That asymmetry is the point: there, complexity rules and password
  history still guard the account when the lookup is skipped, so an outage
  costs a supplementary signal. Here there is no fallback, and accepting
  unverified traffic during an outage is exactly the state an attacker wants —
  one they can bring about by attacking the provider or waiting for a bad day.
  An operator who cannot accept that availability tradeoff should leave the
  feature off rather than run it bypassable.

  Decisions worth keeping:

  - **Enabling it without a secret logs an error and enforces nothing**,
    rather than rejecting every public submission. A half-finished setup
    should not read as an outage.
  - **The token rides in an `X-Captcha-Token` header**, so verification is a
    pure dependency that runs before body parsing and needs no schema changes.
    The header is in the CORS allowlist; a reverse proxy with its own header
    allowlist needs the same entry.
  - **Enabling it widens the CSP** for the configured provider's widget
    origins. Without that the browser blocks the script and iframe, and the
    failure presents as "the challenge never appears" rather than as anything
    naming the CSP. With CAPTCHA off the policy is byte-for-byte unchanged,
    `frame-src` included. A new provider needs an entry in **both**
    `_VERIFY_URLS` and `_WIDGET_ORIGINS`.
  - **Rejections are generic.** The provider's error codes separate "bad
    secret" from "token already redeemed" from "forged", which is a map of
    what to probe.
  - **The frontend mirrors the server's decision** rather than making its own,
    and treats an unreachable config endpoint as "not required" — the server
    still enforces independently, so that cannot bypass a live challenge,
    while the opposite default would make every anonymous form unsubmittable.
  - **Tokens are single-use**, so a rejected submission resets the widget
    instead of replaying a token the provider already burned.
  - **Deliberately not applied to guest check-in**, which is reached by
    scanning a QR code on a station display — a challenge there is hostile to
    someone standing in a firehouse.

  `GET /api/v1/auth/captcha-config` is unauthenticated by necessity (its
  callers have no session) and is registered in the endpoint-auth allowlist
  with that reasoning. It returns the provider and the **public** site key,
  never the secret, and reports `enabled: false` when CAPTCHA is switched on
  but misconfigured — matching what the server actually enforces.

- **Passwords that appear in known breach corpora are rejected.**
  "Firetruck2024!" clears every rule the platform enforces — length, all four
  character classes, no sequences, not in the hardcoded common-passwords list
  — and sits in public breach corpora, which is exactly what credential
  stuffing tries first. The hardcoded list covers a few dozen of the hundreds
  of millions that have leaked.

  Checked via the Have I Been Pwned range API under **k-anonymity**: the
  password is SHA-1'd locally and only the **first five hex characters** of
  the hash are sent. The provider returns every suffix sharing that prefix and
  the match is made in-process, so it never sees the password, its full hash,
  or which suffix was being asked about. (That SHA-1 is the corpus's lookup
  index, not a storage decision — password storage is bcrypt/Argon2,
  elsewhere. It is marked `usedforsecurity=False`, which is a declaration
  rather than a suppression and also keeps the call working on FIPS builds.)

  **The check fails open, deliberately:** an unreachable or slow provider, an
  HTTP error, or an unparseable body all accept the password. This is
  supplementary to complexity rules, password history, MFA and lockout, and a
  third-party outage must not stop a department setting passwords during an
  incident. The degradation is logged so operators can alert on it.

  **The rejection message omits the breach count.** A precise count is a free
  oracle over the corpus for anyone who can reach a password form, and it
  tells the member nothing they can act on — they need a different password
  either way.

  Wired into all five paths that set a password: registration, self-service
  change, reset-by-token, admin user creation, and admin reset. Off by default
  (`BREACHED_PASSWORD_CHECK_ENABLED`), since it needs outbound network access
  some deployments do not permit.

- **Suspicious-IP throttling** (`app/core/suspicious_ip.py`). The per-IP rate
  limit caps burst speed and the per-account lockout caps guesses against one
  user, but a spray slips between them: one IP trying two passwords each
  against a thousand usernames stays under 5/min and never reaches
  `MAX_LOGIN_ATTEMPTS` on any single account, because no account is tried more
  than twice. This counts **failed** attempts per IP across **all** accounts
  over a long window and blocks the IP once the total crosses the threshold.

  Two security-relevant defaults, both load-bearing:

  - **A fully successful sign-in clears the IP's counter**, so a shared NAT
    egress (station computers, where ordinary typos accumulate) does not drift
    into a block. The clear happens only after **full** authentication, never
    on a correct password alone — otherwise an attacker holding one leaked
    password for an MFA-protected account could zero the tally at will.
  - **Clearing never lifts an already-active block**, for the same reason.

  Wired into `/login` and `/mfa/login`, **including the pre-verification
  challenge rejections**, which resolve no account and so would otherwise be
  the one unmetered door into the auth surface. Redis-backed and shared across
  workers, degrading to a per-process counter that is capped and evicted per
  Pitfall #9. On by default (`SUSPICIOUS_IP_THROTTLE_ENABLED`) at 50 failures
  per hour per IP with a 15-minute block.

**Fixed**

- **The auth rate limiter's documented fallback was unreachable (CI-11).**
  `check_rate_limit` asked `is_rate_limited` for the Redis verdict with
  `fail_closed=False` and a comment saying it would fall back to the in-memory
  limiter on error. It never did: the helper catches its own exceptions and
  returns `False` ("not limited") unless `raise_on_error` is set, so the outer
  `except` → in-memory path could not be reached. In the window where Redis is
  connected but a command transiently fails, the request was limited by
  **neither** backend. The sibling `public_rate_limit` helper already passed
  the flag; the auth path did not.
- **Loguru no longer prints local variables in tracebacks.** `diagnose=False`
  is now set on all three sinks — JSON, console and the rotating file. On a
  password-set or token-verification frame those locals are the credential
  itself, written to disk with 30-day retention and shipped wherever logs are
  shipped.

### Fixes: exposure, correctness and crash paths (2026-08-17)

**Security**

- **A form submission advanced only the prospect who submitted it.**
  `FormsService._auto_advance_pipeline_step` found *every* active prospect
  parked on the auto-advancing step and completed the step for all of them —
  so one applicant returning a form advanced the whole cohort behind it. It is
  now bound to the submission's own prospect
  (`ProspectiveMember.form_submission_id == submission.id`), and the audit
  row records `form_submission_id` so the cause of an advance is legible
  afterwards.
- **Impact-plan PDFs escape untrusted text.** ReportLab's `Paragraph` parses a
  mini-HTML dialect, so an organization name, a filter parameter, a member's
  full name or a contact string containing `<` or `&` was interpreted as
  markup — corrupting or failing the render, on text under a member's own
  control. All four are escaped now. Cells drawn as plain strings (membership
  number, rank, station) were never affected.
- **Stock alerts no longer cross domains.** Widening low-stock and
  expiring-supply recipients to medical-only officers handed them a single
  rendered table built from *every* row — gear item names, categories and
  counts the API refuses them by design. Mailing the data is the same
  disclosure as serving it. Recipients are now grouped by the domains they may
  actually see and each group receives only its own rows; someone holding both
  grants lands in the two-domain group and gets **one** complete email rather
  than two partial ones. Expiring lots are fetched per domain. The
  deployed-on-apparatus sections stay with every recipient — that is checklist
  content governed by `equipment_check.*`, a different permission axis — and
  the SMS carries only a count, so it is not split, and says so.
- **`/approve-step` now checks that the stage asked for the role.** The route
  is deliberately not manager-gated: the caller's only authority is that the
  stage requests a role they hold. The service checked only that they hold the
  submitted role, so any member could write their own position into any
  prospect's workflow, with arbitrary notes, receiving the full prospect
  record back — and a stage with no configured approvers left nothing
  "missing", completing and advancing the prospect outright. Unrequested roles
  are rejected, and a stage with no approver roles configured is refused. The
  manager route rejects unrequested roles too, since recording one files
  misleading sign-off evidence.
- **The frontend's email header-injection guard was case-sensitive.**
  `isValidEmailSecure` rejected `%0a`/`%0d` with a case-sensitive
  `includes()`; RFC 3986 prefers uppercase hex, so `%0A` — the canonical
  spelling, and the one an attacker is most likely to send — went straight
  through. The backend's equivalent check is unaffected: it lowercases the
  address before testing.
- **The onboarding CSRF token moved from an origin-wide cookie to tab-scoped
  `sessionStorage`,** so two concurrent onboarding tabs can no longer
  overwrite each other's token. A client still holding the legacy cookie has
  it adopted into the tab and the cookie retired; a stray cookie with **no
  session id behind it** is ignored rather than adopted as a credential. Both
  migration paths are covered by tests, because one-time migration code fails
  silently once the deploy needing it has rolled past.

**Fixed**

- **Meeting cards showed "0 attendees · 0 action items"** over meetings whose
  detail view showed eight and two. `MeetingResponse` declared both counts and
  `MinutesPage` rendered them, but the list query loaded no children. Two
  grouped `COUNT()`s now populate them — totals, not loaded rows, since totals
  are all that is rendered. The demo seeder also populates `/meetings` (the
  Minutes page was rebuilt onto it while the seeder still filled the older
  `/minutes-records` model, so a real record sat behind a "No Meeting Minutes"
  empty state).
- **A renewed certification grounded the member permanently.** The dashboard
  readiness verdict read `my-training`, which returns a *history* — a member
  who renewed EMT-B has both the lapsed 2024 row and the valid 2026 one, and
  the verdict counted the lapsed one: "Not clear to respond", forever, for
  having done the right thing. Only the newest credential per course is
  considered, by both the verdict and the "Needs you" filter.
- **Screenings were judged on a narrower window than certifications** — the
  backend's `expiring_soon_count` covers 30 days while the readiness window is
  60, so a screening lapsing in 45 days read as current beside a certification
  at the same distance that read as a condition. The verdict reads
  `days_until_next_expiration` against its own window, which also catches one
  lapsing **today** (excluded by the backend's `0 < days` bound).
- **A failed screening refresh kept stale counts**, leaving a scope note still
  claiming screenings were checked and a member who had since gone overdue
  still reading "Clear to respond". It clears now.
- **A screening-only verdict opened the training page**, which has nothing to
  say about a screening. Those members go to the department feed.
- **Driver/EVOC enforcement had five ways around it.** Certification expiry is
  judged on the **shift's** date, not today — scheduling is forward-looking,
  and a card that lapses before the shift does not qualify anyone to drive it.
  Pattern generation wrote assignments directly and bypassed the block
  entirely (a recurring pattern would seat an uncertified driver on every
  occurrence); it now checks each driver seat, leaves the seat empty rather
  than failing the whole run, and reports the skip. A shift edit that moves
  `apparatus_id` or `shift_date` revalidates the drivers already on it —
  otherwise the block was side-stepped by seating a driver on an
  apparatus-less shift and then setting the apparatus. Concurrent chief
  reviews are settled by a conditional `UPDATE` rather than both committing
  with the later write deciding silently. **Every** certification a member
  holds is considered, not just the highest: cumulative Level 3 plus
  non-cumulative Level 4 was refused for a Level 2 apparatus.
  `driver_exceptions.apparatus_id` is now `ON DELETE CASCADE` — a `SET NULL`
  left a grant for one retired unit indistinguishable from a blanket one,
  silently widening it to the whole fleet; the audit log retains the approval.
- **Editing "On hand" on a lot-stocked medical supply did nothing.** The field
  writes `quantity`, but a lot-stocked item's count comes from its lots — the
  ledger the page and summary actually display. A manager could change the
  box, get a success toast, and watch the number stay put. The field is
  replaced for such items by the lot figure and a pointer to **Receive
  delivery**, and `quantity` is left out of the payload entirely rather than
  sent as a null that would clear a column nothing shows.
- **The medical-supplies migration's downgrade destroyed pre-existing grants.**
  It removed the medical and `equipment_check` permissions unconditionally,
  including ones a department had granted by hand long before the migration —
  while the comment above it claimed the opposite.
- **Copying an event carried its finalized marker.** Duplication and
  rolling-series extension stripped the older lifecycle markers but not
  `attendance_finalized`, so a copy of a finalized event looked finalized and
  never got its own validation prompt. The key list is a single shared
  constant on the event model now, applied at both copy sites.
- **Reopening a finalized shift left `validation_notification_sent` set,** so
  the post-shift task skipped it forever and nobody was reminded to
  re-finalize.
- **Date-only event-request values were stamped UTC midnight**, displaying the
  previous day for every negative-offset department. They are anchored to
  midnight in the organization's timezone.
- **CSV vendor import reported three pieces of work for one.** Unmatched names
  were deduplicated on the exact string while matching, the cleanup list and
  Attach-all compare case-folded — so "Gals", "gals" and "GALS" were listed
  separately although Attach handles all three in one pass. Keyed on the fold
  now, displaying the first spelling seen. A name is recorded only once its
  row actually imported (`create_item` still rejects rows the CSV parse
  accepted — duplicate serial, pool item with no quantity — so a failed import
  sent the reader to Attach for rows that were never written). And a name
  matching a **deactivated** vendor now links to it rather than being reported
  as unmatched: vendor creation rejects inactive duplicates, so the advice was
  a dead end.
- **The migration validator handed out single-parent guidance for a forked
  chain.** "New migrations set `down_revision = X`" was printed once per head,
  naming two parents that cannot both be right; following either extends one
  branch and leaves the fork in place.

### Migrations: four pull requests each repaired the same fork (2026-08-17)

**Fixed**

- **The Alembic chain is one head again: `8050e5a61f34`.**
  `20260816_0006` (shift-finalization backfill) and `20260816_0007` (email
  preference unification) both revise `20260816_0005` — two branches open at
  once. Five pull requests independently noticed the fork and each wrote a
  merge for it; **all five merged within the hour**, so the repair became the
  fork. `main` was left with four heads and two files claiming revision id
  `20260816_0008`, which makes the versions directory unloadable: `alembic
  upgrade head` fails outright, a fresh install cannot migrate, and the
  head-count tests fail on every open pull request.

  - `20260816_0008_merge_finalization_and_email_prefs.py` was **deleted**. The
    duplicate id has to be resolved for Alembic to load either revision, and
    this file is a no-op merge — the only member of the set whose removal has
    no schema consequence. The driver-exceptions revision keeps the id.
  - The two redundant no-op merges (`71d86eba9a9e`, `bb34f8937c89`) were
    **kept**: a deployment may already have stamped them, and deleting a
    recorded revision strands that database at an id its chain no longer
    contains.
  - One merge revision names all four surviving heads as parents. Alembic runs
    each ancestor exactly once however many merge paths reach it.

  Backend suite after the repair: 5,092 passed, 2 skipped. **If you pulled
  `main` between roughly 17:30 and 18:50 UTC on 2026-08-17, pull again** — the
  broken state prevented migration rather than corrupting anything.

### Public API: token parameters declare their alphabet (2026-08-17)

**Fixed**

- **`GET /api/public/v1/application-status/{token}` rejected schema-compliant
  requests.** The published schema constrained the token's length but not its
  alphabet, so the contract fuzzer generated arbitrary Unicode;
  percent-encoding is byte-oriented and lossy for anything that will not
  round-trip through UTF-8, so a string of ten characters arrived as eight and
  tripped `min_length=10`. These are `secrets.token_urlsafe` values, so
  base64url is the truth about them and declaring the pattern makes the
  published schema honest. The finance approval-by-token parameter carries the
  identical hazard and is covered too.
- **The calendar feed's token is deliberately left alone.** It answers `404`
  for a malformed token rather than `422`, so it cannot trip the check, and
  adding a pattern would turn that into a `422` — leaking "wrong format" apart
  from "not found" on a public feed.

### Dependencies (2026-08-17)

**Changed**

- `bcrypt` 4.3.0 → **5.0.0** (major); the python-minor-patch group (12
  packages); the npm-minor-patch group (4 packages).
- **`typescript` bumped 5.9.3 → 7.0.2 in `frontend/package.json`,** which
  collapses the two-install arrangement documented in CLAUDE.md: `typescript`
  and `typescript-native` now resolve to the same 7.0.2. `typescript-eslint`
  still caps its peer at `<6.1.0`, and the tree resolves only because npm
  auto-installed a second TypeScript (5.9.3) at the repository root as a
  **peer** dependency. CI is green, so nothing is broken today — but the
  arrangement went from declared to incidental, and the linter's compiler is
  no longer pinned by anything the repository controls. Recorded as **BUILD-1**
  in [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md); CLAUDE.md has been
  corrected to describe the current state rather than the intended one.

**Documentation**

- **TESTING.md now says how to install Stryker before telling anyone to run
  it.** `stryker.pilot.json` and `vitest.stryker.config.ts` were committed
  without the packages — Stryker was installed with `--no-save`, so after a
  fresh `npm ci` the documented command could never have worked. Worse than an
  unpinned download: `stryker` is an unrelated registry package (last
  published as `stryker@1.0.1`, the pre-scoped name), so `npx` offers to fetch
  *that* and never reads the config. The packages are deliberately kept out of
  `package.json` — `@stryker-mutator/core` pulls a transitive `qs` advisory
  through `typed-rest-client` with no released fix, taking `npm audit` from 0
  findings to 2 moderate for every developer, which is a poor trade for a
  diagnostic CI never runs. The pinned install line, both invocation forms,
  the sandbox cleanup, and the reason `vitest.stryker.config.ts` narrows the
  runner are all recorded there.

### Tests: guards that fail instead of vanishing (2026-08-16 → 08-17)

**Changed**

- **Eighteen backend guards skipped themselves when their subject moved.**
  `test_changelog_fixes.py` checks are written against tracked paths —
  `errorHandling.ts`, `portal.py`, `main.py`, the Makefile,
  `alembic/versions` — so "file not found" does not mean "not applicable", it
  means someone moved the file. A guard that retires itself exactly when its
  subject is renamed is worse than no guard: CI stays green and nobody learns
  the check stopped running. Several assert on **frontend** TypeScript by
  reading it as text, so a routine frontend refactor was enough to disarm
  them. They now assert the path exists, with a message saying to repoint it.
  Three more skipped on an empty migrations glob, which would let the
  chain-integrity checks pass over an empty set.
- **`test_push_service.py` imports `py_vapid` through
  `pytest.importorskip`.** It ships with `pywebpush`, which is optional (Web
  Push is gated behind `PUSH_ENABLED`) and whose wheel does not build on every
  platform. A failed module-level import is a **collection** error and pytest
  aborts the whole session on one, so a developer without that optional
  dependency got 0 tests rather than 4,535.

**Added**

- Coverage for the shared axios factory every module's auth depends on; the
  API cache's TTL boundaries and eviction ordering; onboarding storage and the
  API client transport; the onboarding utility modules (validation 0 → 100%,
  security 0 → 100%, errorHandler 0 → 93.4%, module 5.6% → 12.2%); and the
  offline queue, the one path where a defect loses field data.

### Events: public request intake is opt-in and spam-controlled (2026-08-17)

**Security / Added**

- **A department must opt in before the internet can file requests against it**
  (closes EV-5). `POST /event-requests/public` takes the organization from a
  query parameter, and organization ids are discoverable through the public
  calendar — so every _active_ department was reachable by anyone who looked
  one up, with a per-IP limit of 10 as the only gate, while each submission
  wrote rows and emailed a coordinator. Intake is now governed by
  `events.request_pipeline.accept_public_requests`, **default false**, set
  under **Events → Settings → Request pipeline → Accept Public Requests**. It
  lives in the settings JSON behind a defaults merge, so there is no migration
  and existing organizations read `false` until an admin turns it on.
- **A closed department answers exactly like one that does not exist** — same
  404, same detail. A distinguishable refusal would turn the endpoint into an
  oracle for which departments accept requests, which is the reconnaissance
  step before the flood the opt-in exists to stop.
- **Honeypot and human challenge**, matching the forms module: an aliased
  `website` field (a filled one returns the success shape and writes nothing,
  so a bot has nothing to tune against) and the `require_captcha` dependency
  that public form submit and password reset already carry. Event-request
  intake had been left out of that work, making it the last unchallenged
  internet-exposed write path.
- **Per-organization daily ceiling** (`public_daily_limit`, default 50),
  counted **only after** authorization, honeypot and validation — the
  valid-only rule the forms module needed, where counting rejected traffic let
  anonymous submissions exhaust a department's allowance and deny service to
  legitimate ones. Exhaustion answers `429` with a clear message.

Covered by `backend/tests/test_event_request_public_intake.py` (6 tests) plus
the existing `test_captcha.py`.

### Migrations: revision ids are generated, not hand-authored (2026-08-17)

**Changed**

- **`alembic revision` now owns the id.** `docs/ALEMBIC_MIGRATIONS.md` used to
  mandate a hand-authored `YYYYMMDD_SSSS` id and state "**No hex/random IDs**"
  as a rule. That rule is what caused the collisions the document exists to
  prevent: two branches open on the same day each counted from `_0001` and each
  picked `_0002`, git merged the files without a word because they do not
  overlap, and Alembic then refused to load the chain. It happened four times,
  twice in one day. A generated id carries entropy, so two branches cannot pick
  the same one; the date still leads the filename, which is what keeps listings
  sorted. Nothing parses an id's structure — the validator compares them as
  opaque strings — so the format was never load-bearing.
- **`validate_migrations.py` enforces it and reports the head.** A
  `YYYYMMDD_SSSS` id dated 2026-08-17 or later is an error. The rule is keyed
  on the date the id already carries rather than on a position in the chain: a
  revision anchor would need bumping every time another branch landed a
  migration first, and whoever forgot would get a failure blaming a migration
  written under the old rules. Everything already written is untouched —
  renumbering released history would break every database that has already
  stamped those ids.

**Fixed**

- **`ALEMBIC_MIGRATIONS.md` no longer records the current head by hand.** Every
  migration PR edited the same lines to update it, which guaranteed a conflict
  on each one and went stale whenever someone forgot — as it had, still naming
  `20260816_0003` after `20260816_0004` landed. The validator prints the head
  and the `down_revision` to use; the historical notes are kept, folded away,
  and marked as history rather than the source of truth.
- Vendor `item_count` came back as a `Decimal` from MySQL's `SUM()` over an
  integer `CASE`, against an `int` field, which Pydantic warned about on every
  vendor response rather than coercing silently.

**Added**

- **CSV import now reports vendor names it could not match.** A `Vendor` cell
  naming nothing on file correctly keeps the typed-in name and creates no
  vendor — importing must not invent suppliers nobody reviewed — but it did so
  silently, quietly refilling the list the vendor cleanup screen exists to
  drain. One misspelling in a 200-row sheet did it 200 times and surfaced weeks
  later. The unrecognized names now come back in the import's existing
  `warnings`, leading the list so the 50-warning cap cannot drop them and
  pointing at Attach on the Vendors screen.

  Three ways that report could have misled, all closed: names are folded to
  the same case-insensitive key the matching and Attach use, so `Gals`, `gals`
  and `GALS` are one entry rather than three pieces of apparent work; a name is
  recorded only once its row has actually imported, since `create_item` still
  rejects rows the CSV parse accepted and a name banked earlier would send the
  reader to Attach for rows that were never written; and the vendor lookup now
  includes **deactivated** vendors, so a name matching one links to it instead
  of being reported. Deactivating a vendor keeps every existing link —
  purchase history for equipment still in service is why the record exists —
  and excluding them had left the warning advising "add this vendor" for a name
  that vendor creation rejects as an inactive duplicate, a dead end.

- Endpoint-level tests for the vendor financial redaction. The existing tests
  cover the serializer, which proves the function blanks the fields but not
  that the routes ask it to. These drive the real router through
  `require_permission` with the grant coming from actual position rows, and
  assert on the JSON that leaves the endpoint. Verified to fail with the
  redaction stubbed out.

**Documentation**

- **Retired the "Full Revision Chain" table in `docs/ALEMBIC_MIGRATIONS.md`.**
  It was abandoned at `20260223_0300` in February and listed 115 of 314
  migrations — 37% of a chain it claimed to document in full, which is worse
  than absent because it reads as authoritative. A note added in May recorded
  that it was stale; it was never brought up to date. `alembic history` answers
  the same question and cannot drift.
- Corrected the vendor redaction field names in the changelog and
  `wiki/Module-Inventory.md`. They were published as `accountNumber` /
  `paymentTerms` / `totalPurchaseValue`, but the inventory response schemas set
  no `alias_generator`, so the wire format is snake_case — `account_number`,
  `payment_terms`, `total_purchase_value`, which is what the frontend reads.

### Dashboard: the station board answers whether you can respond tonight (2026-08-17)

**Added**

- **A readiness line above "Needs you"** — _Clear to respond_, _Clear, with
  conditions_, or _Not clear to respond_. The station board answered "what needs
  me" and "what am I doing this week"; it never answered the question a fire
  department asks first. It reads three things a member already has: their
  certifications, the shift positions they may hold, and — where the department
  tracks them — their medical screening compliance.

  Three rules keep it from overstating, and each is tested:

  - **It renders nothing when there is nothing to judge.** A member with no
    tracked certifications and no screening requirements is _unknown_, not
    clear, and a green verdict from an empty set asserts a clearance the
    department has no basis for.
  - **It names its inputs on screen** ("Certifications, screenings and seats"),
    so it can never imply a check it did not make. SCBA fit-test dates are not
    modelled anywhere in the product and are never among them.
  - **A failed read is not a pass.** If the screening read fails, those
    requirements drop out and the scope note narrows to what was confirmed.

  It counts rather than names: the verdict says "2 certifications expiring", the
  "Needs you" rows below name them and carry the buttons. Naming the soonest one
  reproduced the row beneath it word for word — the "said twice" fault the
  dashboard redesign existed to remove.

- **`GET /medical-screening/compliance/me`** — a member's own screening
  compliance, as counts. The existing compliance route takes a `user_id` and
  requires `medical_screening.view`, which is the officer permission that reads
  _anybody's_; there was no way for a member to see their own. The new route
  takes no id — the subject comes from the authenticated session, so there is
  nothing to substitute — and is registered before `/compliance/{user_id}` so
  `me` is not captured as a user id. Both properties are structural rather than
  runtime checks, so tests assert them.

  It returns counts only: no requirement name, screening type, date or result.
  The dashboard is a shared surface — The Logbook is installed as a kiosk on
  tablets left at stations — so a line reading "Psychological evaluation
  expired" would be legible to whoever walks past. A test asserts the serialized
  shape, because the detail is one attribute access away in the summary it is
  built from.

**Changed**

- **Concurrent identical GETs now make one request.** `useEnabledModules`
  carried a comment promising that mounting it in several components did not
  mean several round trips. Measured against the running app, the dashboard made
  three requests for `/organization/modules` and two for `/auth/branding` on a
  single mount: the response cache only helps a caller arriving _after_ an
  identical request finishes, and the navigation surfaces all mount together
  against a cold cache. `dedupeInFlight` shares the promise instead, and retains
  nothing once it settles — so it adds no caching to the endpoints the HIPAA
  rules exclude from caching. It wraps at the service layer, where the response
  interceptor's 401 → refresh → retry has already run, so followers get the
  retried result rather than the pre-refresh failure. Both endpoints now measure
  at one request per mount.

**Fixed**

- **Shift times on the dashboard read "N/A – N/A".** A shift's `start_time` is a
  time of day (`"08:00"`), and it was being formatted by a function that parses
  an instant, so every row rendered `Invalid Date`. They go through
  `formatTimeOfDay` now.
- **The open-shift de-duplication never ran.** `loadOpenShifts` filtered its
  response against `myShifts` read from its render closure, but both lists are
  fetched concurrently from the same effect, so that set was always empty on
  mount — the guard was defeated by exactly the race its comment described. It
  now happens in a memo over both arrays, and every consumer reads the deduped
  list.

**Documentation**

- `docs/training/13-medical-screening.md` records what the audit trail actually
  covers. It claimed all access to the module is logged; only creates, updates
  and deletes are. Reads are not — including one officer reading another
  member's records or compliance, which is the access an audit trail most exists
  to detect. This is documented as an open gap, not fixed here.

### Inventory: vendor pricing is a purchasing matter, not a directory one (2026-08-16)

**Changed**

- **Account numbers, payment terms and vendor spend totals now require
  `inventory.manage`.** They were readable by anyone holding `inventory.view` —
  a broad, member-level grant whose job is answering "who do we buy this from
  and how do I reach them". What the department pays a supplier, on what terms,
  and under which account is a different question. `GET /inventory/vendors` and
  `GET /inventory/vendors/{id}` now blank `account_number`, `payment_terms` and
  `total_purchase_value` unless the caller can manage inventory; names, phone,
  email, fax, website, address, contacts and the item/reorder counts are
  unchanged, so the directory still works. No UI changes: the vendors screen
  already sits behind `inventory.manage`, and the item and reorder pickers only
  ever read the name.

  The serializer's clearance flag is keyword-only with no default, so a call
  site that forgets it raises rather than falls open.

**Fixed**

- The schema-drift measurement recipe in `docs/DATABASE_SCHEMA_DRIFT.md` created
  its two scratch databases without naming a collation, relying on the reader
  having set `collation-server` to match docker-compose. On a stock server
  (`utf8mb4_0900_ai_ci` on MySQL 8, `utf8mb4_general_ci` on MariaDB) the chain
  dies at the first cross-table FK with errno 150, because some migrations
  hardcode `COLLATE utf8mb4_unicode_ci` and the rest inherit the database
  default. The `CREATE DATABASE` statements now name the collation themselves.

### Inventory: vendors get database-backed tests, and a guard rail for migration-id collisions (2026-08-16)

**Added**

- **Backend Lint now runs `validate_migrations.py`.** The vendor migration
  collided with a same-day revision id twice in one day — first with the
  facilities room-nesting migration, then with the storage-area barcode
  backfill — each time leaving `alembic upgrade head` failing with "Multiple
  head revisions" for anyone upgrading through migrations. Git merges two files
  that declare one revision id without a word, because they do not overlap;
  only this script notices. It is stdlib-only, needs no database, runs in under
  a second, and sits beside flake8 so a collision is caught at PR time rather
  than after the merge. (Both renumberings themselves landed separately; this
  is the part that stops the third one.)
- `test_inventory_vendors_db.py` — the vendor flows against a real database,
  marked `integration` so CI's MySQL and MariaDB jobs run them. The mocked
  suite passed in full while merging a vendor deleted the contacts it reported
  as moving; a cascade is precisely what a mock cannot have. These assert on
  what is still in the database afterwards: contacts survive a merge, links
  survive a deactivation, the case-folded matching the cleanup screen promises
  actually matches across spellings and departments, spend counts retired
  items while the catalog count does not, and a relinked reorder comes back
  naming its new vendor. Verified to fail against the pre-fix merge.

### Inventory: medical supplies split onto their own page (2026-08-16)

**Added**

- **Medical Supplies** module at `/medical-supplies` — EMS stock with lot
  numbers and expiration dates, on its own page rather than mixed into the gear
  catalog. Opens on what is expiring, with an all-supplies tab, category
  management, an add-supply form, and a receive-delivery form that books a whole
  shipment as one dated lot per item line.
- `ItemType.MEDICAL`, appended to the enum (never inserted — MySQL stores an
  ENUM as its ordinal, so a mid-list insert would silently reclassify every
  existing category). Migration `20260816_0001`.
- Domain-scoped permissions `inventory.view_medical` and
  `inventory.manage_medical`, so a department can appoint an EMS supply officer
  for medical stock while the quartermaster keeps gear. Every medical route
  accepts either these or the broad `inventory.view` / `inventory.manage`, so a
  department running one supply line is unaffected, and `inventory.*` still
  grants everything.
- `ems_supply_officer` system role and matching email-signature office. It holds
  the medical permissions plus `equipment_check.*` — both halves of the
  shelf-to-truck loop — and no access to gear or uniforms.
- `apparatus_officer` now states the medical permissions explicitly (it already
  reached medical stock through the broad `inventory.manage`, so nothing is
  widened — the role editor is simply honest about it now), and gains the
  `equipment_check.*` set its description has always promised.
- `medical_supplies` module toggle (off by default), so departments that do not
  run EMS never see the page.

**Changed**

- Renamed the gear side so the two are distinguishable: **Inventory** →
  **Gear & Uniforms**, **My Equipment** → **My Issued Gear**, **Inventory
  Admin** → **Gear Admin**, **Equipment Requests** → **Gear Requests**,
  **Equipment Kits** → **Gear Kits**. Routes and table names are unchanged, so
  no existing link breaks.
- Gear listings now exclude medical-domain items and categories, and the medical
  routes are pinned to the medical domain server-side — the domain is never read
  from a query parameter, and every by-id write re-checks that its target is in
  the domain before touching it.

**Fixed**

- Low-stock, NFPA-retirement, and expiring-supply alerts had never been
  delivered. All three filtered recipients on `u.role`, a column `User` does not
  have (roles are the many-to-many `positions` relationship), so every send
  raised `AttributeError` inside the per-organization guard, which logged it and
  moved on. Recipients now resolve through the `inventory.manage` permission via
  the roles relationship.

### Failures now say so: eight silent-error paths surfaced (2026-08-16)

**Fixed**

- **A rejected equipment check no longer pretends it was queued.** The submit
  path treated every failure as a connection loss: a 400/403/422 — validation
  failure, revoked permission, shift already checked — got a "Connection lost
  — check queued for sync" toast, the draft was deleted, and the offline queue
  re-sent the identical doomed body on every reconnect without ever giving up
  (the retry counter was incremented but never read). Server rejections now
  surface as errors; only genuine transport failures queue (shared
  `isNetworkError` helper), and the drain loop abandons a check past
  `CHECK_QUEUE_MAX_RETRIES` **and reports the loss** — including photos that
  failed to upload, whose only copy was previously dequeued undiscoverably.
- Quick RSVP failures now surface instead of being indistinguishable from a
  tap that never registered; bulk event cancel reports refusals rather than
  "Cancelled 0 events" in a success toast; compliance attestation errors are
  shown inline on the form instead of replacing the dashboard; election
  package creation on stage advance treats only a 409 as "already exists";
  event-request assignee notification failures are actually logged; a skills
  test score is no longer cleared from its input when the save was refused.

### Inventory: every storage area is assigned a barcode (2026-08-16)

**Added / Changed**

- **Storage areas always carry a barcode.** Creation auto-assigns the next
  code in a per-organization sequential series (default prefix `SA-`, counter
  in `organization.settings["storage_area_barcode"]`, manually-entered codes
  skipped) when the caller doesn't supply one; a blank from an older client
  cannot strip a code already printed on the shelf; pre-barcode areas pick one
  up on first edit; migration `20260816_0002` backfills the rest.
- The Storage Areas page shows **all areas by default**, and its facility
  picker was fixed.

> **The code is assigned and displayed, not yet resolvable by the scanner.**
> The inventory scanner's `/inventory/lookup` searches `InventoryItem` fields
> only (`search_by_code`), so scanning an `SA-…` code returns no result today.
> The one query against `StorageArea.barcode` is the uniqueness check used when
> allocating the next code. The Storage Areas form also tells the user the code
> is assigned "so it can be scanned" — see
> [KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) (INV-8) for the gap.

### Small fixes from the open-PR resolution pass (2026-08-16)

**Fixed / Changed**

- The admin-hours Summary tab computes its date boundaries through the
  timezone utilities (`useTimezone` + `localToUTC`) instead of raw `Date`
  math.
- Sidebar/top navigation deduplicate the Administration-section permission
  check into a shared `hasAdministrationAccess` helper (no behavior change).
- The frontend `TrainingSessionResponse` type caught up with the backend
  response: `instructor_id`, `co_instructors`, `apparatus_id`, and
  `counts_toward_certification` (false when a session's delivery would not be
  accepted by a certifying body, so its hours must not advance linked
  certificate requirements). Session linkage is now covered by integration
  tests against a real database.

### Forcing a stale device back onto the current build (2026-08-16)

**Added**

- **Settings → App**, a new tab holding the three things a member needs when
  the app looks out of date and the automatic update path has already failed
  them:
  - **Installed version** — the build ID this device is actually running.
    Previously unknowable from inside the app, which made "which version are
    you on?" unanswerable on a support call.
  - **Check for updates** — an on-demand version check that reports "you're on
    the latest version" or swaps in the new service worker and reloads onto the
    new build. The automatic checks are rate-limited to once a minute and hang
    off route changes, tab focus and a five-minute poll; this one answers now.
  - **Force refresh** — clears every client-side copy of the app (the workbox
    precache holding the app shell, the `app-chunks` runtime cache holding
    lazily-loaded screens, the in-memory API response cache) and reloads from
    the server, behind a confirmation that says what it will do.

  An installed PWA has no address bar and no `Ctrl+Shift+R`, so a home-screen
  app that wedged on an old shell had no user-reachable way out at all — the
  only advice was to uninstall it or clear website data.

- The force refresh also drops the **branding cached in localStorage**
  (`departmentName`, `logoData`). `AppLayout` writes those on first load and
  only re-fetches when `departmentName` is missing, so a department that
  renamed itself or changed its logo left every existing device showing the old
  one indefinitely, with no expiry and no invalidation.

- **Force refresh refuses to run when the server is unreachable**, leaving the
  device untouched and saying so. The precache is the app's only offline copy
  and workbox heals a deleted entry only by fetching it, so purging offline
  would delete the shell and reload into nothing — bricking the installed PWA
  until signal returned, which is far worse than the stale build being fixed,
  and worst on the rural cellular connections this app is used from. A member
  who taps this _because_ something looks wrong is exactly the person likely to
  be out of signal at the time. Reachability is proven by fetching a parseable
  `/version.json` rather than trusting `navigator.onLine`, which reports a
  healthy connection on station Wi-Fi behind a captive portal — the same
  interception already documented as a cause of blank screens.

**Notes on what force refresh deliberately leaves alone** — each of these would
be a worse failure than the one being fixed:

- **The service worker registration.** Unregistering is the more thorough nuke,
  but a Web Push subscription belongs to the registration and nothing
  re-subscribes automatically, so it would silently switch off callout
  notifications on that device. Deleting the caches is sufficient: workbox's
  precache strategy falls back to the network on a miss and re-caches what it
  fetches, so the precache heals itself on the very reload this triggers.
- **The offline queues (IndexedDB).** They hold work done but not yet synced.
- **`has_session` and the auth cookies.** This is a refresh, not a sign-out.

**Changed**

- `getCurrentBuildId` / the `/version.json` fetch moved out of `useAppUpdate`
  into `utils/appVersion.ts`, so automatic detection and the manual check agree
  on what "current" means rather than carrying two copies of the comparison.

### Inventory: vendor review fixes (2026-08-16)

**Fixed**

- **Merging a vendor no longer deletes the duplicate's contacts.** The source's
  contacts were repointed with a bulk `UPDATE` while still sitting in the
  loaded relationship, which cascades `delete-orphan` — so deleting the merged
  vendor deleted the contacts the merge had just reported as moved. They are
  re-parented through the ORM now, and the count comes from what actually
  moved.
- **A reorder's PATCH response named the previous vendor.** Re-reading the row
  after an update returns the same identity-mapped instance and leaves loaded
  relationships alone, so a changed `vendor_id` came back beside the old
  vendor's name. The refresh asks for `populate_existing`.
- **Linking a vendor on a reorder now clears the typed-in name and contact.**
  They were serialized as omitted rather than null, so the stale supplier
  survived behind the link and reappeared if it was ever unlinked.
- **A vendor deactivated after being linked still shows in the edit pickers**,
  marked "(inactive)", rather than dropping out and leaving the field reading
  "Not linked" while it submitted the old id.
- **Retired items count toward the cleanup list.** Attaching updates them and
  vendor spend includes them, so a supplier named only on retired items was
  stranded with no way to reach it from the screen.
- The vendors screen sits behind `inventory.manage`, matching the rest of
  `/inventory/admin`; it was reachable only by URL for anyone else.

### Inventory: cleaning up duplicate and unattached suppliers (2026-08-16)

**Added**

- **Merging duplicate vendors.** A department that has been typing supplier
  names for years ends up with "Galls" and "Galls Inc." as separate rows — the
  migration folds case, not spelling. Merge moves the duplicate's items, reorder
  requests and contacts to the vendor you chose and removes the duplicate, so
  its name is free again rather than reserved by an inactive row nobody can see.
  The target's own details are never overwritten.
- **Attaching names that were never linked.** The vendors screen now counts the
  supplier names typed onto items and reorder requests with no vendor behind
  them, and offers each one as a new vendor or an attachment to an existing one
  — linking every row carrying that name in a single pass. Rows already pointing
  at a different vendor are left alone; that is a decision, not a leftover.

**Changed**

- The vendor card's purchase total counts every item ever bought from that
  vendor, not just the ones still in the catalog. Retiring a coat was quietly
  reducing what the department had spent with the vendor who sold it. The item
  count still means the catalog as it stands, matching the list it links to.

### Inventory: vendors are records, not a typed-in name (2026-08-16)

**Added**

- **Vendor tracking.** `inventory_vendors` gives each supplier one row per
  organization — account number, main line, orders inbox, website, remit-to
  address, payment terms, a preferred flag — and `inventory_vendor_contacts`
  holds the named people at it (rep, service desk, accounts receivable) with
  title, email, phone and extension. Exactly one contact is primary: flagging
  one demotes the rest, and a vendor left with none promotes its first, so a
  vendor card always names someone to call.
- **Vendors screen** (`/inventory/admin/vendors`, `inventory.view` to read and
  `inventory.manage` to change). Each card shows the contact details, the
  primary contact, and live purchasing history: items bought from that vendor,
  open reorders, and total purchased. The item count links to the catalog
  filtered to that vendor (`/inventory/admin/items?vendor_id=…`).
- **Items and reorder requests link to a vendor.** The item form and the reorder
  form pick from the tracked list; picking a vendor on a reorder prefills its
  primary contact. A name that is not on file can still be typed, exactly as
  before.

**Changed**

- The CSV export and the item detail page now name the linked vendor, falling
  back to the free-text value only for rows never linked. A CSV import whose
  `Vendor` cell matches a vendor already on file links to it; an unrecognized
  name stays free text rather than silently creating suppliers nobody reviewed.
- Deactivating a vendor keeps every item and reorder pointing at it. Purchase
  history for equipment still in service is the reason the record exists.

**Migration**

- `20260816_0003` (renumbered from `20260816_0002`, which the storage-area
  barcode backfill already held) adds both tables and the `vendor_id` columns,
  then backfills:
  every distinct free-text vendor name already on file becomes a vendor
  (case-folded per organization, first spelling wins) and the items and reorder
  requests that named it are linked to it. The free-text columns are left in
  place and unread where a link exists.

### Security and privacy hardening batch (2026-08-16)

Nine targeted fixes landed together, plus a follow-up red-team review
([`docs/security/RED_TEAM_REVIEW_2026-08-16.md`](docs/security/RED_TEAM_REVIEW_2026-08-16.md))
that confirmed no new critical or high-severity findings.

**Security**

- **Pending election nominations are no longer exposed through the member
  candidate list.** `GET /elections/{id}/candidates` returns accepted
  candidates only, unless the election is in its nominations phase (so nominees
  can respond) or the caller holds `elections.manage`. Election managers still
  see everything.
- **Directory profiles no longer reveal account-security metadata.** A caller
  with only `members.view` opening a colleague's profile no longer receives
  `email_verified`, `mfa_enabled`, `last_login_at`, `created_at`, `updated_at`,
  notification preferences, or the permission lists attached to the
  colleague's roles. Role names remain visible because the profile displays
  them. `users.view`, members-managers, and the subject themselves are exempt.
- **`hire_date` joined the restricted profile fields.** It drives automatic
  membership-tier advancement, so — like rank, station, platoon, and membership
  number — it now requires leadership, the secretary, or the membership
  coordinator, not merely `users.edit`.
- **Finance email-approval tokens are consumed atomically.** The token row is
  locked (`SELECT … FOR UPDATE`) while acting, and the token is cleared on
  approve/deny, so a link can be used exactly once even under concurrent
  clicks; a second attempt sees "already actioned," not a duplicate approval.
- **Public form daily caps count only valid submissions.** The per-form daily
  cap is now enforced inside the service after authorization and validation, so
  bots tripping the honeypot and rejected payloads no longer burn a form's
  daily allowance and deny service to legitimate submitters. Cap exhaustion
  still returns `429`.
- **Public rate limits survive Redis failures.** `is_rate_limited()` gained
  `raise_on_error` so `public_rate_limit` falls back to its separate in-memory
  limiter on Redis errors instead of silently failing open (fail-closed paths
  such as login are unchanged).
- **Equipment-check drafts are purged on shared-device logout** (red-team
  finding RT-08, medium). The logout purge previously removed shift-report
  drafts and offline queues but left `equipment-check-draft-*` keys in
  `localStorage`, so the next member on a station computer could read the
  previous member's apparatus results and notes.
- **Production compose no longer inherits development bind mounts.**
  `docker-compose.prod.yml` uses `volumes: !override` (requires Docker Compose
  v2.24.4+) so the source-tree mounts from the development file are cleared
  rather than merged into production.
- **The Unraid example environment now shows an HTTPS origin.**
  `unraid/.env.example` sets `ALLOWED_ORIGINS=https://logbook.yourdomain.com`;
  the app enforces HTTPS in its default production posture, so the old
  `http://192.168.1.10:7880` example could not work as shipped.

### Test coverage is now measured honestly (2026-08-16)

**Changed**

- **Frontend coverage counts every source file.** Vitest 4 measures only files
  a test imports unless `coverage.include` is set; that hid 384 of 758 source
  files (48% of the frontend) and reported 60.32% lines where the honest figure
  is 33.10%. The denominator is now the full `src/**/*.{ts,tsx}` tree
  (Playwright specs excluded), and the ratchet floors were re-based against the
  corrected measurement (31/23/25/30 lines/functions/branches/statements) — the
  same suite measured honestly, not a regression.
- **Backend coverage floor raised from 46 to 51,** matching today's 53.1%
  measurement, and CI now gates `app/api`+`app/services`+`app/core`+`app/utils`
  separately at 35 (measured 37.6%) so declarative model/schema bulk (~97%
  covered by import alone) cannot absorb a regression in real business logic.
- Added a Stryker mutation-testing pilot config (`frontend/stryker.pilot.json`
  - `vitest.stryker.config.ts`). Pilot score: 90.6% on three well-covered
    utilities; the surviving mutants cluster in the `apiCache.ts` eviction path.
- **The eviction gap that pilot found is closed** _(2026-08-17)_. The
  `apiCache.ts` eviction path was 89% line-covered and could be deleted
  wholesale with the suite still green: its one test never asserted how many
  entries were evicted, so an off-by-one loop bound and the loss of the
  re-insertion refresh both went unnoticed. Three tests now pin it — at the cap
  nothing is evicted, each insert past the cap evicts exactly one oldest-first,
  and re-caching a key makes it newest so it outlives older keys. `apiCache.ts`
  now scores 90.43%, and deleting the eviction block fails the suite. The two
  mutants that still survive are _equivalent_ — a comparison made redundant by
  the excess arithmetic, and a runtime-unreachable guard that exists to satisfy
  the type checker (removing it is a TS2345 error, not a behaviour change) —
  and both are documented in place so they are not chased again.
- Corrected CLAUDE.md pitfall #13: no lint rule guards bare
  `toHaveBeenCalledWith()` — it is review discipline, and a blanket ban was
  evaluated and rejected because the zero-argument form is the stronger, correct
  assertion for genuinely zero-arity functions.

### Onboarding session storage and dark-mode canvas (2026-08-15)

**Security**

- **The onboarding session identifier moved from `localStorage` to
  `sessionStorage`.** An onboarding session can authorize setup mutations, so
  it no longer survives a browser restart or leaks to unrelated tabs.
  Identifiers persisted by older clients are removed on load, and
  `clearSession()` sweeps both the new and legacy locations.
  [`docs/ONBOARDING_FLOW.md`](docs/ONBOARDING_FLOW.md) documents the model.

**Fixed**

- **Dark mode outside the app shell no longer renders white-on-white.** The
  themed gradient canvas moved from `body` to `html` so the stable scrollbar
  gutter — which sits outside the body's box — is painted too, and pages
  rendered outside `AppLayout` (public forms, ballots, status pages) composite
  their translucent dark-mode surface tokens over the gradient instead of the
  browser's default white.

### Module API clients reject after a failed refresh (2026-08-14)

**Fixed**

- When a 401 retry's cookie refresh also fails, module axios clients
  (`createApiClient`) now report the error and **reject the original request**
  instead of returning `undefined` while the browser navigates to `/login` —
  callers no longer continue against a missing response, and the expired
  session is handled through the shared `handleExpiredSession()` path.

### Documentation backfill: August 8–14 changes recovered by a history audit (2026-08-16)

A commit-by-commit sweep of the repository's full history (which begins
2026-08-08) found ~40 merged changes that never reached this changelog — five
of them contradicted by the documentation then in force. The affected module
docs, wiki pages, and training guides were corrected in the same pass; the
disposition of every finding is recorded in
[`docs/DOCUMENTATION_BACKFILL_2026-08-16.md`](docs/DOCUMENTATION_BACKFILL_2026-08-16.md).
The entries below are dated by when the change actually merged.

**Training & programs (2026-08-08)**

- A program phase can **link an existing department requirement** instead of
  only creating one inline (`RequirementLibraryPicker` in the create-pipeline
  wizard and phase edit modals). Provenance is tracked in
  `program_requirements.owns_requirement`: unlinking deletes the underlying
  requirement only when the link created it, so removing the department's
  shared CPR requirement from a recruit phase no longer deletes it out from
  under every other program. Editing a linked-in requirement applies everywhere
  it is used.
- The **Requirements tab on `/training/programs` can edit requirements** —
  per-card Edit and a New Requirement button using the shared
  `RequirementModal`; previously the tab was read-only and changes required
  the separate Training Admin page. Registry-imported requirements stay
  read-only (the backend refuses updates to them).
- Skills testing gained the `score_pass_fail_criteria` scoring model and
  officer actions on the result page (candidate notification included) —
  documented at the time in `docs/SKILLS_TESTING_FEATURE.md` §1.5/§21 but
  never entered here.

**Equipment checks & apparatus supply — authorization pass (2026-08-11)**

- **Submitting a shift equipment check requires crewing the shift.**
  `POST /equipment-checks/shifts/{id}/submit` now requires
  `equipment_check.submit`/`.manage` and restricts ordinary submitters to
  shifts they actively crew (`ASSIGNED`/`CONFIRMED`) or officer for; any
  authenticated member could previously submit a check against any shift.
- **Template reads are scoped to the submitter.** Without
  `equipment_check.view`, template list/detail return only active templates
  that are general or match the caller's own shift positions; a non-matching
  template's compartment/item tree is a 404, not a disclosure.
- **Corrections of record went manage-only.** Withdrawing a restock report and
  swapping a lot now require `equipment_check.manage`/`inventory.manage`
  (`equipment_check.submit` was dropped); editing a deployed lot's
  `lot_number`/`expiration_date` is likewise guarded, while reporting usage
  and quantity updates remain crew-level.
- **A submitted check can no longer rewrite an item's expiration.**
  `expiration_found` is recorded on the check but not written back onto the
  template item — asserting a fresh date could clear an expired-item
  auto-fail. Submitted items must belong to the named template.
- Standalone checks **reject deactivated templates** (2026-08-12): managers
  can still view/edit an inactive template, but no new check records can be
  created from it.
- **Bulk checklist→inventory link changes are audited** (`log_template_change`
  with `inventory_links` and `changed_count`); the operation previously left
  no trail.

**Scheduling & shift reports (2026-08-11 → 08-12)**

- **Shift completion reports are officer-released.** A trainee gets 404 on a
  report that is not `approved` — unconditionally, even with the optional
  second-review workflow off — and training/pipeline credit is applied only on
  the transition to `approved`, never at `pending_review` (which could
  previously credit early or double-credit). Reports also auto-populate
  `tasks_performed` from the trainee's own equipment checks plus apparatus
  name and shift start time.
- **Shift check-in is bounded by a configurable window**:
  `shift_reports.checklist_timing.checkin_opens_hours_before` (default 2) and
  `checkin_closes_hours_after` (default 12) — a link to a shift that ended
  last week is refused instead of stamping an arrival.

**Cross-tenant, privacy, and enumeration fixes (2026-08-11)**

- Instructor-qualification create/update validate that `user_id`, `course_id`,
  `skill_evaluation_id`, and `category_id` belong to the caller's org, and
  list joins are org-scoped — another tenant's names can no longer be resolved
  through a colliding id.
- Training requirement/progress reads **strip officer-only checklist steps**
  (`member_visible: false`) and their ids for members without
  `training.view_all`/`training.manage` — "references called" and similar
  steps were being returned to the member they were about.
- **Guest check-in no longer reveals prospect existence**: `prospect_created`
  was removed from the public kiosk response (an unauthenticated caller could
  probe whether a name/email was already a prospect); the "someone will follow
  up" notice is driven client-side from the event's
  `collects_prospect_details` flag.
- `scripts/seed_skills_testing.py` dropped `--password`/`--examiner-password`
  in favor of `LOGBOOK_PASSWORD`/`LOGBOOK_EXAMINER_PASSWORD` env vars or a
  hidden prompt, keeping credentials out of shell history and `ps`.

**Operations (2026-08-11)**

- **Startup refuses the destructive fresh-database path on an unknown Alembic
  revision.** When the stamped revision is not in the release, boot raises
  `RuntimeError` instead of silently deleting `alembic_version` and re-running
  fresh-install initialization — which could destroy a real installation whose
  revision id had merely been renamed. Compatibility revision `20260809_0002`
  keeps already-released databases upgradable. See
  `docs/TROUBLESHOOTING.md` → "Migration version mismatch".

**Security & correctness batch (2026-08-12 → 08-13)**

- **Member-import rejected-rows CSV neutralizes formula injection** — cells
  beginning `= + - @ \t \r` are apostrophe-prefixed in the client-side writer,
  so a malicious member name can't execute when an admin opens the error file
  in Excel (the earlier `SafeCsvWriter` fix covered server-side exports only).
- **Duplicate skill credit closed**: shift-completion reports release
  training/pipeline credit only when `approved` (see scheduling section
  above); the same pass fixed crediting twice via `pending_review`.
- **Duplicating a skill template copies its result-visibility settings**
  (`result_disclosure`, `result_release`, `result_viewer_positions`) instead
  of silently falling back to defaults that widened who could see results.
- **PWA updates land in one reload.** Proactive service-worker checks on app
  resume + a 30-minute interval; "Reload now" waits for the fresh worker to
  take control before reloading (previously the reload was often served by the
  old worker's cached shell); stale-chunk loads self-heal through the same
  path; `sw.js`/`registerSW.js`/`push-sw.js` are exempted from the 1-year
  immutable cache header in both nginx configs, and update checks bypass the
  HTTP cache.
- **`Permissions-Policy` camera directive changed from `camera=()` to
  `camera=(self)`** in the app's security middleware and both nginx configs so
  the barcode scanner works; operators mirroring headers on their own proxies
  need the same change. A lifecycle guard releases the camera when the scanner
  modal closes.
- **Onboarding role saves no longer smuggle invisible grants.** The
  two-checkbox (View/Manage) position editor rebuilds permission lists; only
  an explicit allow-list of read-only sub-permissions (currently
  `facilities.view_sensitive`) survives, so action grants like
  `members.assign_positions` no longer outlive an admin clearing Manage.
  Roles saved before this may still carry legacy invisible grants — review in
  Role Management.
- **Compliance permissions tightened**: report generation is `training.manage`
  only (`reports.manage` dropped — it manages saved definitions, not
  member-level data); config/report reads dropped `compliance.view`.
- **Dues ledger scoped to its owner**: `GET /finance/dues/{id}/payments`
  filters by the member's own `user_id` unless the caller holds
  `finance.manage`.
- **Waiver reasons stay out of the immutable audit log** — reversing this
  changelog's earlier 2026-08-02/04 design: un-waiving dues erases the
  free-text `waive_reason` outright instead of copying it into the
  `finance.dues_waiver_reversed` event, because waiver reasons may carry
  personal information that must remain reachable by privacy scrubbing.
- **Member hard-delete rejections no longer enumerate the blocking records**,
  closing an information-disclosure channel; the error states that dependent
  records exist without listing them.
- **Marking an expense report paid no longer crashes** — the
  separation-of-duties guard referenced a nonexistent `requested_by`
  attribute; it now compares against `submitted_by`.
- **Waived storefront orders report a zero balance** everywhere (order detail,
  notifications, service) instead of showing an outstanding balance and
  generating collection notices.
- **Election feature toggles reject explicit `null`** (`nominations_enabled`,
  `paper_ballots_enabled`, `reminders_enabled`, `auto_open_enabled`) with a
  validation error; legacy persisted nulls resolve to `true`.
- **Approving a training submission verifies the credit actually applied** —
  a failed apply (e.g. the enrollment vanished after pre-flight) returns 400
  instead of reporting success on a no-op.
- **Voiding a never-validated skill test no longer notifies the candidate** —
  an unvalidated official result was only a placeholder, so its withdrawal
  and reason stay undisclosed.
- **Prospect pipeline concurrency hardened**: `SELECT … FOR UPDATE` locking in
  the state machine plus a unique index on `(prospect_id, step_id)` — the
  index lives in the model (`create_all`), so fresh installs enforce it;
  existing installations are protected by the locking and can add the index
  after deduplicating.
- **Role endpoints constrain `{role_id}` to UUIDs**, so static sub-paths are
  no longer swallowed by the dynamic detail route.
- **Property-return delivery email moved outside the request's DB session** —
  a slow SMTP server can no longer hold a pooled connection for its full
  timeout.
- Error logs **redact token-bearing route params** (`sanitize_path` covers
  finance approval tokens, application-status tokens, `.ics` calendar
  tokens) before persistence.
- The public-portal timestamp migration **converts offset-aware values to UTC
  instead of truncating the offset** — the earlier form discarded valid API-key
  expirations, creating non-expiring keys; installations that ran the old
  revision should review key expirations.

**Navigation & UI (2026-08-13)**

- The sidebar entry **"Events Admin" was renamed "Manage Events"** and points
  at `/events`; Create and Settings deep-link into the admin hub via
  `/events/admin?tab=create` / `?tab=settings`.
- **Apparatus fleet-summary cards and admin actions are hidden without the
  manage/create/edit permissions** — members see their apparatus list without
  the admin affordances, and the summary fetch is skipped entirely.

### Facilities: rooms can sit inside other rooms (2026-08-16)

**Added**

- A room can now be placed inside another room in the same facility — the
  quartermaster's storage space within the volunteer office — via a "Located
  inside" picker on the room form and an add-a-room-inside action on each row.
  The rooms list renders the resulting tree, and each room reports how many
  sub-rooms it holds. Nesting is capped at five levels.
- `GET /api/v1/facilities/rooms` returns `parentRoomId` on every room and
  accepts `parent_room_id` / `top_level_only` to fetch a single level.
- The cross-module room picker (events, training, scheduling) lists sub-rooms
  indented under their container and shows the containment path for the
  selected room. A nested room's linked Location now carries the same path, so
  "Quartermaster's Storage — Volunteer Office — Station 1" is distinguishable
  from a storage room elsewhere in the building.

**Changed**

- Deleting a room keeps its sub-rooms, re-parenting them onto the deleted
  room's own container rather than cascading the delete through everything
  stored below it. The confirmation says so before you commit.
- The room form now sends explicit nulls on save, so clearing a field (floor,
  capacity, description) persists instead of silently keeping the old value.

### Six-day release documentation rollup (2026-08-16)

**Documentation**

- Published [`docs/CHANGE_AUDIT_2026-08-10_TO_16.md`](docs/CHANGE_AUDIT_2026-08-10_TO_16.md),
  the six-day frame around the existing three-day audit. It adds what a
  three-day window could not show: the five routes added across the window with
  their real permission gates, the full 28-revision Alembic route from
  `20260809_0002` to the then-head `20260814_0004`, the supply-loop and
  restock data paths, a client-side storage map, and the 08-15 → 08-16 changes
  that had no coverage anywhere. The
  [three-day audit](docs/CHANGE_AUDIT_2026-08-12_TO_14.md) remains authoritative
  for 08-12 → 08-14.
- **A YouTube script told installers to do the thing that now loses their
  work.** Script 02's Welcome Screen narration read _"the wizard auto-saves your
  progress, so if you need to step away or your browser closes, you'll pick up
  right where you left off."_ That became false on 2026-08-15, and it was already
  misleading — the onboarding session has always expired after 30 minutes idle.
  Nothing in the series had been recorded yet, which is the cheap moment to catch
  this. Rewritten in `02-first-time-setup-and-onboarding.md` with the
  one-tab/one-sitting caution and the refilled-form trap, plus an EDITOR note:
  every timecode from Chapter 2 onward re-times (~45–70 seconds added).
- The skills-testing guide had **no printing section at all**, though both print
  routes shipped 2026-08-11. Added, with the disclosure rules that decide what a
  printed scorecard may contain and why neither route is gated on
  `training.manage`.
- **Four trackers had drifted and are corrected at the source.** The Alembic
  "Current Head" banner still named `20260812_0001` — four revisions and one
  merge behind the real head, which is exactly the staleness that causes a new
  migration to be chained onto a dead branch. `APPLICATION_PAGES.md` was missing
  five routes that had been live for days (`/learning`, `/locations/qr-codes`,
  `/scheduling/apparatus-inventory`, and the two skills-testing print pages).
  `ONBOARDING.md` still described the session identifier as living in
  `localStorage`. The public-page dark-mode troubleshooting entry still said
  `body` carries the canvas.

### Onboarding: the setup session no longer outlives the tab (2026-08-15)

**Security**

- **The onboarding session identifier moved from `localStorage` to
  `sessionStorage`.** It is a bearer credential — presented as `X-Session-ID`, it
  authorizes the mutations that create the organization, its stations and
  apparatus, the IT team, and the first System Owner. In `localStorage` it
  survived browser restarts indefinitely and was readable from every tab on the
  origin, which on a shared or station-kiosk machine is a standing grant to
  finish somebody else's installation. It now ends with the tab.
- Identifiers written by the previous build are deleted on the first page load
  of the new one, in both `loadSession()` and `clearSession()`, so a browser
  carrying a stale identifier drops it rather than presenting it.
- The CSRF companion (`onboarding_csrf_token`, `SameSite=Strict` cookie) and the
  server's 30-minute sliding session TTL are unchanged. No endpoint, schema,
  model, migration, or permission changed.

**Edge cases worth teaching**

- **Onboarding is now one tab, one sitting.** A second tab does not inherit the
  wizard — it starts a new server session, and a step that needs an established
  one answers `401` / `ONBD_SESSION_INVALID`. (A _duplicated_ tab does carry the
  identifier, because Chrome and Firefox copy `sessionStorage` into duplicates.
  That is browser behavior, not a supported resume path.)
- **The wizard can look resumable when it is not.** The typed answers live in
  `localStorage` under `onboarding-storage` and are untouched by this change, so
  reopening `/onboarding` after a restart repaints them. The failure surfaces at
  the next mutating step, not at the repaint. The recovery is to restart the
  wizard, not to re-type.
- Seeing "Onboarding has already been completed" (`403` /
  `ONBD_ALREADY_COMPLETED`) is a _different_ condition — the install finished and
  the operator should sign in, not restart setup.

### Interface: the scrollbar gutter stopped showing through in dark mode (2026-08-15)

**Fixed**

- **A bright strip ran down the right edge of every page in dark mode.** The
  dark-mode surface tokens are translucent white by design — they composite over
  the themed gradient. `scrollbar-gutter: stable` reserves its gutter on `html`,
  **outside the body box**, so painting the gradient on `body` left that strip
  showing the browser's default canvas. The gradient now sits on `html`, which is
  also what reserves the gutter, and `scrollbar-gutter` folds into the same rule.
  Painting the gutter a flat fallback colour was the alternative and was
  rejected: it trades the seam for a different seam.
- `overscroll-behavior: none` deliberately stayed on `body` — iOS bounce
  suppression is a body concern.

**Two regressions it introduced, found and fixed 2026-08-16**

Both follow from one CSS rule nobody restated: a `body` background propagates to
the window **only** while the root element's `background-image` is `none` and its
`background-color` is `transparent`. Once `html` is painted, nothing on `body`
propagates — and two things were relying on it.

- **Six in-app print routes lost their screen backdrop.** `print/template`,
  `print/scorecard`, `training/print/member`, `training/print/program`,
  `training/print/compliance` and `scheduling/shift-reports/print` each carried
  their own copy of `@media screen { body { background: #f3f4f6 } }`, putting a
  grey desk behind a white letter-size sheet. That grey had been painting the
  body box alone while the app gradient framed it — a dark gradient around a
  white sheet in dark mode. Cosmetic; printed output was never affected.

  All six now render **`components/print/PrintPageStyles`**, which marks the root
  element so a single `html.print-preview` rule beside the canvas rule in
  `index.css` supplies the desk. **The duplication was the actual defect** — six
  copies of a rule, none of them naming what they depended on, is why one global
  change altered six pages invisibly. `InventoryBarcodePrintPage` and
  `LabelPrintPage` were never affected: they `document.write` into a fresh
  iframe, so the app stylesheet never reaches them.

- **The `@media print` reset missed `html` — in light mode only.** It reset
  `body, main, .dark`, and because `ThemeContext` puts the `dark` class on
  `document.documentElement`, **dark mode was covered by accident while light
  mode was not.** Browsers do not print background images by default, so ordinary
  printing was unaffected; a reader who enabled "Background graphics" to print a
  scorecard, skill sheet, label or QR sign could get the gradient behind it in
  light mode. `html` is now named explicitly, which also makes the `.dark`
  coverage intentional rather than incidental.

**Neither would have been caught, because nothing asserted the canvas contract.**
`PrintPageStyles.test.tsx` now guards all three invariants — the canvas belongs
to the root, the print-preview override sits on the root beside it, and the print
reset names the root. It reads the stylesheet rather than a rendered page on
purpose: jsdom does not apply the real cascade, so no DOM assertion could catch
this class of break. Each assertion was verified by re-introducing the exact
regression it guards.

**Screenshot impact**

- **39 captured images show the unpainted gutter**, found with
  `scripts/screenshots/audit_images.py --check edges`. Only one is a dark-mode
  page; the other 38 are **light-mode captures of modal dialogs**, where the
  overlay darkens the viewport but sits inside `body`, leaving the gutter white
  behind it. The trigger is dark content at the right edge, not the theme — do
  not skip light-mode captures on the assumption that this is a dark-mode defect.
  Only the dark page (`10-11-public-form-dark`) is worth re-shooting on its own;
  the rest change by a pale 15px strip. Queued in
  `docs/training/SCREENSHOT_CURRENCY.md`.

### YouTube scripts: August release changes are written into the takes (2026-08-14)

**Documentation**

- Replaced the script-currency-only queue with word-for-word recording inserts in
  scripts 01, 03, 04, 06, 07, 12, 13, 14, 15, and 16, plus new Room QR Short
  8AF. The scripts now cover TLS/upgrades, dashboard data scopes, Events,
  permissions/privacy, notification cleanup, saved/frozen-roll elections,
  storefront operations, linked training sessions, and skills scoring/resume/
  visibility behavior with screen directions and edge-case narration.
- Each changed script now identifies its insertion point, B-roll state, runtime
  added, and exact chapters/clip tables requiring re-timing. Final timecodes are
  intentionally a recording-production task because narration pacing determines
  them; no behavioral content remains only in `SCRIPT_CURRENCY.md`.

### Events: reminder audience and check-in teaching update (2026-08-14)

**Changed**

- Documented the `going` / `all` / `none` reminder audience across the event and
  template workflows, including mandatory/optional legacy defaults, recipient
  preferences, organization boundaries, series copies, and disabled reminders.
- Corrected the Flexible check-in default from 30 to 60 minutes throughout the
  training/schema references and documented Strict/Window behavior, early-member
  notices, guest blocking, actual-time boundaries, and the overlapping-meeting
  15-minute exception. Added exact screenshot and YouTube B-roll requirements.

### Security, privacy, permissions, and dashboard follow-up (2026-08-14)

**Changed**

- **Audit archives are private on disk.** Archive directories are created with
  mode `0700` and files with `0600`; creation uses an exclusive file descriptor
  rather than writing permissively and tightening permissions afterwards.
- **Frozen election rolls are enforced at both connection points.** Ballot email
  issuance and token redemption reject members outside the snapshot captured
  when voting opened. Secretary overrides remain the explicit admission path;
  legacy elections with a null snapshot retain their prior live-roll behavior.
- **Personal data exports respect training visibility.** Officer-only
  `ShiftCompletionReport` evaluation fields are omitted when the organization's
  Training result-visibility setting does not expose them to the trainee.
- **Member-directory and scanner permissions are distinct.** `members.view`
  reaches the redacted colleague directory/profile; ID-card scanning requires
  `users.view` or `members.manage`. Navigation uses the same OR permission rules
  as the protected routes.
- **Dashboard views separate personal and organization data.** Leaders can
  switch to the Organization view while the personal view retains the member's
  own equipment and activity; management affordances remain permission-gated.
- Event and series duplication deep-copy mutable JSON, preserve reminder
  audience/check-in configuration, and remove lifecycle markers so copied or
  extended events cannot mutate or inherit the source's processing state.

**Security / compatibility notes**

- Existing archives are not chmod-migrated; operators should audit and repair
  permissions on historical archive directories separately.
- A member removed from a frozen election roll cannot redeem an already issued
  token unless a secretary override admits them. Null legacy snapshots are the
  intentional compatibility exception.
- Export visibility affects newly generated exports; previously downloaded
  files remain the recipient's responsibility under department retention rules.

### Three-day release documentation handoff (2026-08-14)

**Documentation**

- Audited the net changes from 2026-08-12 through 2026-08-14 and published a
  single cross-functional map of pages, routes, models and data points,
  Alembic migration order, end-to-end data paths, organization/permission
  sharing boundaries, operational edge cases, screenshot replacements, and
  YouTube script updates. The narrative audit is
  [`docs/CHANGE_AUDIT_2026-08-12_TO_14.md`](docs/CHANGE_AUDIT_2026-08-12_TO_14.md);
  its generated 879-path net manifest is retained beside it for traceability.
- Added the same handoff to the repository wiki index and added explicit
  **SCREENSHOT NEEDED** / **REPLACE** and pre-recording script queues so media
  work cannot be mistaken for completed documentation.
- Updated the relevant storefront, forms, prospective-member, scheduling,
  training-program, and Alembic references plus the affected numbered training
  guides. Added an operator-facing release lesson with exact screenshot state,
  required demo data, permissions, non-shared data, and edge cases for each
  changed workflow; expanded the wiki page so it also works outside `docs/`.

### Messaging: the guides now say what delivery actually does (2026-08-13)

**Changed**

- **The dashboard "Department Messages" card now shows only what still needs
  your attention** — unread messages, acknowledgment-required messages you
  haven't acknowledged, and persistent standing notices — instead of the 10
  most recent messages regardless of read state. Messages you've dealt with
  clear off the card on your next visit (never mid-read — a message you just
  opened stays put until then), and already-read messages no longer crowd a
  persistent notice off the card. Full history remains on the Messages page.
  Fixes MSG2-6: an unpinned persistent notice — the "SCBA inspection mandatory
  by March 31" kind — could previously be paged off the dashboard by ten newer
  messages, read or not. Persistent notices are now ordered ahead of newer
  non-persistent messages before the 10-item preview is selected; pinning still
  keeps the most important standing notices first. Inbox pagination now has a
  deterministic tie-breaker, and its user metadata lookups are organization-
  scoped as defense in depth. Targeted messages now reject empty audiences and
  invalid member-status values instead of accepting notices that can never be
  delivered. Author lookups run only for the selected page, and the API now
  rejects acknowledgment attempts for messages that do not request one. Read
  and acknowledgment writes also fail closed for inactive, expired, deleted,
  or not-yet-published messages, and validation ignores stale audience fields
  that are irrelevant to the selected target type. New and audience-edited
  messages also clear those irrelevant lists instead of retaining ambiguous
  targeting data.

**Fixed (documentation — app behavior unchanged)**

- **The department-message delivery matrix was wrong in every guide.** The
  training guide, the technical doc, the wiki page and two video scripts all
  said a Normal/Important message stays in-app and only ack-required/urgent
  messages email. In reality **every department message is emailed to every
  targeted member at every priority** — the deliberate record-of-notice design
  (owner rule 2026-08-05: "messages always go to the member's email"), asserted
  by the delivery tests. An officer following the old guide would post a
  "Normal" FYI believing it stays in-app and email the whole department. The
  wiki also wrongly claimed members can opt out of message email under
  Settings → Notifications — they cannot (SMS yes, email never). All five
  documents now match the code; urgent messages still add SMS under the same
  Twilio/consent/preference gates.
- The technical doc's migration list cited the pre-renumber
  `20260720_0001_..._deleted_at` filename; corrected to `20260720_0004`.
- Verified both messaging training screenshots (`07-11-new-message-form`,
  `07-12-acknowledgment-report`) still match the shipped UI element-for-element,
  and every other documented behavior (read/ack semantics, scheduling,
  soft-delete evidence retention, persistent messages, targeting, member
  controls) against the code — see
  `docs/app-review/messaging.md` pass 5. One UX gap flagged for an owner call:
  an unpinned persistent notice can be paged off the dashboard card
  (`KNOWN_LIMITATIONS.md` → "Persistent Notices Can Fall Off the Dashboard
  Card").

### Elections: reusable saved ballots, and the votes that counted when they shouldn't (2026-08-12)

**Added**

- **Saved ballot templates.** A secretary who runs the same officer slate every
  year can save the ballot as a named template and apply it next year instead
  of rebuilding it item by item. Three endpoints under
  `/api/v1/elections/templates/saved-ballots` (list / save / delete), all
  `elections.manage`, all org-scoped; model `SavedBallotTemplate`
  (`saved_ballot_templates`, migration `20260812_0001`); audit events
  `ballot_template_created` / `ballot_template_deleted`.

  Three design decisions worth knowing:
  - **Configuration only, by construction.** A template snapshots ballot
    _structure_ — never candidates, voter rosters, votes, tokens, or
    attendance. The create schema is `extra="forbid"`, so a payload that tries
    to smuggle any of those in is a 422, not a stored secret.
  - **Names are unique per org, case-insensitively** — uniqueness rides on
    `name_key` (SHA-256 of the NFKC-casefolded name), so "Annual Officers" and
    "annual officers" collide with a 409 while the display name keeps its
    casing.
  - **Applying regenerates ballot-item ids**, so an applied snapshot can never
    carry ids already referenced by the draft it replaces. The BallotBuilder
    grows a "Save as Template" button and a "Your saved ballots" section in
    the template picker, with two-step confirms on both replace and delete.

- **Ballot definitions are validated on the way in** — create _and_ update.
  Item ids must be `^[A-Za-z0-9_-]+$` and unique per ballot; voting methods
  and victory conditions are checked against the known sets;
  `victory_percentage` is required for a supermajority item; voter-type lists
  are de-duplicated and `'all'` cannot be combined with other types; position
  names must be unique case-insensitively. Quorum is cross-validated on update
  against the _stored_ row merged with the patch — and the blanket `le=100`
  that wrongly capped **count** quorums at 100 is gone (a percentage quorum
  still caps at 100).

- **Election detail tabs are addressable.** `/elections/{id}?tab=` round-trips
  all nine workflow tabs, derived from the URL rather than mirrored into state
  — so the Back button works, and the **Eligibility roster** is finally
  linkable (`?tab=eligibility`) and photographable. An unknown value falls
  back to the first tab the viewer may see. Same fix, same reasons, as Email
  Templates on 2026-08-11.

**Fixed**

- **Unattested paper ballots could decide runoffs and membership outcomes.**
  Pending paper batches were already excluded from published results, but two
  raw SQL tallies on the close path didn't know that: the runoff-advancement
  count and the membership-package Approve/Deny sync. A batch nobody attested
  was invisible in the results yet could pick who advanced to a runoff or flip
  a prospect to `elected`. Both queries now carry the `_is_attested_vote`
  predicate. Electronic votes, confirmed batches, and pre-attestation batches
  are unaffected; a batch confirmed later counts again everywhere.

- **A token voter could double-vote a position by omitting it.** On the public
  token-ballot path, a vote sent without `position` for a positioned candidate
  was stored positionless — a different bucket from the same voter's explicit
  vote, unseen by the duplicate/limit filters and hashed differently by the
  dedup constraint. The stored position, the limit filters, and the dedup hash
  now all normalize to `position or candidate.position`. A genuinely
  positionless candidate still stores NULL and is limited as before.

- **Two simultaneous votes could both pass validation.** The dedup hash is
  method-aware (distinct candidates/ranks legitimately hash differently), so
  its unique constraint cannot enforce per-voter limits by itself — and two
  concurrent `cast_vote` requests could each read "votes so far" before either
  inserted. The election row is now locked (`SELECT … FOR UPDATE`) for the
  whole validate-then-insert window, serializing voters through one at a time.

- **Every `elections.view` holder could read applicant PII.** The
  prospective-member _election package_ bundles the interview and coordinator
  material the vote is based on — unlike ordinary election data. Both package
  read endpoints dropped `elections.view` from their permission lists (now
  `prospective_members.view` / `prospective_members.manage` /
  `elections.manage`); a regression test pins the set exactly, so additions
  fail it too.

- **Cloning an election now copies its ballot items** (deep-copied, so editing
  the clone can never mutate the source through a shared reference — the same
  JSON-column trap as CLAUDE.md pitfall #12).

---

### Sign-in: MFA reaches OAuth, refresh replay dies, and resets meet a ceiling (2026-08-12)

Four authentication fixes, each closing a way around a control that existed:

**Security**

- **OAuth logins now face the MFA challenge.** "Sign in with Google/Microsoft"
  verified only the primary credential: an account with TOTP enabled got full
  session cookies straight from the callback, so a compromised IdP account
  bypassed the app's second factor entirely. The callback now issues **no
  session** for MFA-enabled accounts — it redirects to
  `/auth/callback#mfa_token=<jwt>` (a 5-minute `mfa_pending` token in the URL
  **fragment**, which browsers never send to a server), the SPA strips it from
  history and routes to the normal two-factor form, and only
  `POST /auth/mfa/login` issues cookies. Audit: `oauth_mfa_challenge`.

- **A used refresh token is dead immediately.** The 30-second "rotation grace
  window" — which answered a _previous_ refresh token with the session's
  _current_ token pair, to tolerate multi-tab races — was a session-takeover
  gift to anyone who stole a token: replay within 30s of the legitimate
  rotation and you own the session, with replay detection suppressed. Removed
  outright. A stale refresh token now revokes **all** of the user's sessions
  as presumed theft. Multi-tab refreshes that slid through the grace window
  will now trip this — an accepted trade, stated here on purpose.
  `REFRESH_ROTATION_GRACE_SECONDS` and `previous_refresh_token` remain as
  inert residue (tracked in KNOWN_LIMITATIONS).

- **Members of a deactivated organization can no longer log in** with a
  password. The candidate query now joins `organizations` and requires
  `active IS TRUE` in both the canonical-org resolution and the cross-org
  username fallback. The rejection is indistinguishable from a wrong password
  (same message, same dummy-hash timing defense), so org status is not
  enumerable. Two edges recorded rather than hidden: existing sessions are not
  revoked on deactivation (they expire), and the **OAuth path still lacks the
  org-active check** — filed in KNOWN_LIMITATIONS rather than silently
  shipped.

- **Admin account resets hit a privilege ceiling.** `members.manage` could
  reset the password or MFA of a `security.manage` admin — reset-to-escalate,
  the oldest trick in the helpdesk book. Both endpoints
  (`POST /users/{id}/reset-password`, `/reset-mfa`) now require every
  permission the target holds to be within the caller's own set (wildcards
  honored; equal peers still resettable). Violations 403 with "You cannot
  reset the account of a user with privileges beyond your own" and file a
  privilege-escalation report. The check runs before the MFA-enabled probe, so
  the 400/403 difference can't be used to learn a superior's MFA state.

---

### Audit log: the legacy-hash boundary moves out of the database (2026-08-12)

**Security**

- **`AUDIT_LOG_LEGACY_MAX_ID`** (new setting, default `0`). Which audit rows
  may verify under the legacy _unkeyed_ SHA-256 scheme was decided by each
  row's own `hash_version` column — a column in the same attacker-writable
  table the chain protects. An attacker with SQL write access could rewrite
  the entire keyed suffix, stamp every forged row `hash_version=1`, recompute
  the unkeyed chain **without the HMAC key**, and verification would call it
  intact; the no-downgrade guard was blind to it because it derived its
  high-water mark from the same column. The boundary now lives in trusted
  application config: rows above `AUDIT_LOG_LEGACY_MAX_ID` **must** be keyed,
  whatever their column claims. New installs leave it at `0` (no unkeyed row
  is ever valid); upgraded installs set it once, to the last row that existed
  before the HMAC upgrade. Verification flags violations as "Unkeyed hash is
  not permitted after the trusted legacy audit boundary"; rehash refuses them
  as a possible downgrade attack rather than laundering them into the chain.

---

### Data boundaries: Salesforce rank, cohort rosters, result emails, undated training (2026-08-11 → 08-12)

**Security**

- **Salesforce inbound sync can no longer change a member's rank.** `rank` is
  authorization-adjacent (`fire_chief` vs `firefighter`), and it was on the
  inbound whitelist mapped from the Contact `Title` — so anyone who could edit
  a Contact in the department's Salesforce org, or forge a webhook payload,
  could promote a member inside The Logbook. Removed from
  `INBOUND_UPDATABLE_FIELDS`; inbound now writes contact/demographic fields
  only (names, phones, station, address). Outbound is deliberately unchanged —
  The Logbook still _pushes_ rank to `Title`; it just never takes it back.
  Consequence worth knowing: a Contact whose only difference is `Title` now
  counts as `unchanged`, and previously-overwritten ranks are not repaired.

- **A cohort student no longer sees the whole roster.** The cohort detail
  endpoint returned the officer payload to any roster member: every peer's
  name, email, withdrawal status, officer notes, program progress percentage,
  and per-class attendance counts. A non-officer now gets the metadata and
  class timeline only — `members` empty, `member_count` 0, per-class
  `rsvp_count`/`checked_in_count` `null` (withheld, distinguishable from a
  real zero). The withheld data is never _queried_, so there is no
  serialization-layer bypass; `/mine` stopped disclosing roster sizes too. The
  same pass org-scoped every query in the detail path, closing cross-tenant
  reads via colliding ids.

- **Skills-testing result emails are officer-only, final-only, and escaped.**
  The email-results endpoint was open to any authenticated user via the
  examiner path, had no status gate (a draft — i.e. attacker-authored —
  scorecard could be mailed as an official-looking result), and interpolated
  the DB-sourced result string raw into the HTML body. Now
  `require_permission("training.manage")`, completed tests only (400
  otherwise), `html.escape` on the result text, and the recipient remains
  derived server-side from the test's own candidate — there is no recipient
  parameter to abuse. Disclosure is still resolved for the _recipient_, so
  "email results" cannot bypass a department's decision to withhold them.

**Fixed**

- **An undated training record could satisfy a freshness window.** The officer
  apply path's recency check was wrapped in `if completed_on is not None` — so
  a record with _no_ completion date failed **open** against a "within the
  last N days" requirement, crediting freshness that was never verified, while
  the read-path evaluator already said no. The apply/approve step now rejects
  it pre-flight with "That training has no completion date, so it can't be
  credited toward this requirement's N-day window"; nothing is mutated, so
  there is no approved-but-unapplied half-state. Requirements without a window
  are untouched, and previously-credited undated records are not backed out.

---

### Production compose fails closed on transport TLS (2026-08-11)

**Changed — breaking for compose deployments**

- `docker-compose.prod.yml` now defaults `SECURITY_REQUIRE_TLS` to **`true`**
  (was `false`). The documented production stack could previously carry
  database, session, and cache traffic in cleartext without any explicit
  operator decision. Upgrading operators running the bundled plaintext
  MySQL/Redis containers will now **fail at startup** until they either
  configure TLS on those services (`DB_SSL`/`REDIS_SSL` + CA paths) or write
  an explicit `SECURITY_REQUIRE_TLS=false` into their `.env` — cleartext is
  still available, but only as a decision on the record. `GEOIP_FAIL_CLOSED`
  stays opt-in (it requires a mounted GeoLite database to not block legitimate
  traffic).

### Removed: the autonomous review workflow (2026-08-12)

- `.github/workflows/functionality-review-loop.yml` — a scheduled (every 30
  minutes) unattended Claude agent with `contents: write`, auto-committing and
  pushing to a working branch with no human review gate, holding a long-lived
  OAuth token as a repo secret. Removed as unsafe; no workflow consumes
  `CLAUDE_CODE_OAUTH_TOKEN` any more. (Landed twice — two sessions deleted the
  same file with identical commits.)

---

### Mobile: every page fits a phone, and dialogs a browser can't suppress (2026-08-11)

**Changed**

- **The remaining ~115 app pages are responsive at phone widths.** Two sweeps
  (the training admin tabs, then everything else) applied the idiom the
  Training Officer Dashboard fix established: header rows stack below `sm`
  (`flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`), titles
  downscale (`text-2xl sm:text-3xl`), badge/filter/toolbar rows wrap,
  segmented bars scroll (`hscroll`), two-up modal grids collapse to one
  column, and step indicators compact their labels. Almost entirely
  layout-classes-only; the user-visible exceptions: the facilities detail
  sidebar stacks above content on phones, the Member Training Status page
  gained the standard page gutter it had been missing **at every width**, the
  admin-hours QR code scales instead of overflowing, and public-form
  half/third-width fields go full-width on phones.

- **The mobile hamburger moved to the left edge of the header.** The drawer
  slides in from the left (matching the desktop sidebar), so the button that
  opens it now sits on the edge it emerges from; the logo/department name
  moved right and stretches. One component (`SideNavigation`), but it renders
  the top bar of **every authenticated page on a phone** — which is why the
  screenshot tracker flags every phone-width capture that includes the header.

**Fixed**

- **The last 20 native `confirm()`/`alert()` call sites are gone** — 15 files:
  course deactivation, training submission/requirement deletes, election
  close, waiver deactivation, role deletes, member-form discard, role
  removals, proxy revocation, attendee/candidate removal, minutes deletes
  (section/motion/action-item/draft), meeting deletes, country unblock, and
  bulk item retire. All use `useConfirm()` per pitfall #16 (a suppressed
  native dialog is indistinguishable from Cancel), with the decision named on
  the buttons ("Delete" / "Keep it", "Discard changes" / "Keep editing") and
  the consequence stated ("Members assigned to it will lose its permissions").
  One honesty fix along the way: the course dialog now says **Deactivate** —
  the old native text promised a delete the code never performed. Zero live
  `window.confirm`/`alert`/`prompt` call sites remain in `frontend/src`.

- **The equipment-check template builder's catalog dropdown was clipped in
  half.** The compartment card's `overflow-hidden` cut the quick-add results
  list mid-row — no z-index can escape a clipping ancestor. The clip is
  removed (the header rounds its own top corners instead); a source comment
  says why it must not come back. Deliberately no unit test: jsdom does not
  compute overflow clipping, so a class assertion would pin the letter of the
  fix and not the fact of it.

---

### Small fixes the screenshots surfaced (2026-08-11 → 08-12)

The screenshot pass keeps finding product bugs — photographing a screen is
reading it. This batch:

**Fixed**

- **Shift reports named no apparatus for onboarding-era rigs.** The batched
  label lookup only consulted the full `apparatus` table, so a shift on a
  `basic_apparatus` rig rendered a blank label. Ids the first query doesn't
  claim are now retried against `basic_apparatus` (org-scoped, `Apparatus`
  wins a contested id — mirroring the options endpoint's own priority), and
  only when something is actually missing, so the common case costs zero extra
  queries.

- **A lot number was shown with a different lot's date.** An item's Stock tab
  paired the legacy scalar `lot_number` (last swap) with the _derived_
  soonest expiration across deployed lots — "Lot NLX-2411 · Exp 9/4/2026" when
  NLX-2405 is the box expiring in September. Third of three projections with
  this shape (the supply worklist and apparatus inventory were fixed earlier);
  a source-scanning test now fails any future projection that pairs the scalar
  with a derived date, because "a behavioural test can only cover the
  projections somebody remembered."

- **Date-only values rendered a day early west of UTC — twice more.** The
  stock-lots panel's expiration chips and the cohort wizard's holiday
  blackout chips both ran calendar dates through the timezone-aware
  `formatDate`, which parses `"2026-11-26"` as UTC midnight — so Thanksgiving
  was offered as the 25th, and a lot read "Exp 9/3/2026 · 24d left" on 8/11
  (24 days after 8/11 is 9/4; the date and the count disagreed in one
  sentence). Both now use `formatCalendarDate`, which pins UTC round-trip.
  The blackout case was the dangerous one: the _label_ lied while the value
  submitted was correct, so an officer ticked a date they had not been shown.
  Same defect class `formatCalendarDate` was added for on 2026-08-10 — and
  `formatDate` is an approved wrapper, so no lint rule flagged it.

- **An inventory item's Stock tab is linkable.** `/inventory/items/{id}?tab=`
  round-trips all five tabs (validated against the declared list, so
  `?tab=nonsense` falls back to History instead of rendering nothing), derived
  from the URL so Back works. Fifth page found with the mirrored-tab-state
  pattern, after Email Templates, Notifications, Medical Screening and
  Compliance Config.

---

### Security: clear cryptography findings from every scanner (2026-08-12)

**Fixed**

- Removed the unused `fastapi-mail` dependency, whose `<50` cryptography cap
  was the only blocker preventing the security upgrade. The application already
  uses its own SMTP/provider email service, so this does not change email
  delivery behavior.
- Upgraded `cryptography` to 50.0.0 for the `CVE-2026-69247` fix and removed the
  corresponding pip-audit and Trivy suppressions. Both blocking scans now
  enforce the patched dependency rather than accepting a documented exception.
- Reconciled two stale security-review findings with the implemented controls:
  access tokens already carry unique random `jti` claims, and the in-memory
  limiter checks its request ceiling before recording an allowed request. Added
  a token-collision regression test and linked both controls to executable tests.
- Removed the last two `pip-audit` exceptions. They targeted the pre-upgrade
  Black release but survived after the repository moved to Black 26.5.1; the
  blocking Python dependency scan now runs with no suppressed advisories.
- Added a CI policy check and regression tests that reject new `pip-audit`
  advisory exceptions or active `.trivyignore` entries. Scanner suppressions
  can no longer quietly return in a later dependency update.
- Minimized the duplicate-archived-member prospect conflict response. A
  name-based match can no longer disclose the archived member's stored name or
  email; the response retains only the guidance to use the reactivation flow.
- Applied the same minimization to prospect-to-member transfers. Internal
  duplicate-match details are now converted to a generic `409` at the HTTP
  boundary instead of passing service-layer names, emails, or IDs to clients.

---

### Communications: the Email Templates tabs are addressable (2026-08-11)

**Fixed**

- **None of the five tabs on the Email Templates page could be linked to.** The
  page held its tab in plain `useState('templates')`, so `?tab=footers` — or any
  other value — landed on Templates. Two costs, and the second is what made this
  worth fixing rather than noting:
  - A secretary could not send a colleague a link to the **footer library**,
    which is the tab a colleague is most likely to be pointed at.
  - The screenshot harness could only ever capture the default tab. That is
    exactly how `02-21`/`02-41` and `04-20`/`17-01` came to be **byte-identical
    images published under different captions** — all four were hub routes
    defaulting to a tab nobody asked for.

  All five now round-trip: `?tab=templates`, `?tab=footers`, `?tab=officers`,
  `?tab=scheduled`, `?tab=history`. The query value is validated against the
  declared tab list rather than cast, so `?tab=nonsense` falls back to Templates
  instead of rendering nothing. Same fix, and the same two reasons, as the
  Notifications page took on 2026-08-10.

  A test pins **every call site**, because a single missed `setActiveTab` is the
  whole defect: that one tab silently stops round-tripping while the other four
  look fine.

- **And the Back button works.** The active tab is **derived from the URL**
  rather than mirrored into state. Reading the parameter once, on mount, makes a
  _link_ work and leaves navigation broken: click Send Log, then Rules, press
  Back — the address bar says `?tab=log` while the page still renders Rules.

  **The Notifications page had this too**, from its 2026-08-10 fix; the Email
  Templates page inherited it by copying the pattern. Both are now derived, so
  there is no state left that can fall out of step with the URL. Caught in
  review on the second PR, which is the argument for deriving rather than
  syncing: one source of truth removes the class of bug instead of patching
  the instance.

---

### Demo seeder: supply state, and a check type nothing could read (2026-08-11)

Not shipped behaviour — this is `scripts/screenshots/seed_demo_data.py`, which
builds the demo department every documentation screenshot is taken against.

**Added**

- **`seed_supply_tracking`.** The supply screens that landed on 2026-08-10 had
  no data behind them, so every one of them rendered truthfully and pictured
  nothing. The step builds the whole loop on the medic unit: five dated
  consumables with shelf lots, catalog links on the counted positions, and lots
  actually deployed on the truck.

  The end state is deliberately **mixed**, because each filter on the supply
  worklist needs a row and a screenshot of one uniform state teaches nothing:

  | Seeded                                                   | What it makes picturable                                                                                    |
  | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
  | Naloxone from **two lots with two dates** on one bracket | The lots sheet, and the "soonest aboard" rule                                                               |
  | Gauze at **18 of 24**                                    | The amber short count — and the Set All to Par warning, which is suppressed on a compartment already at par |
  | A restock report raised **by the demo member**           | A worklist row naming a real reporter, which is the whole claim about who may record use                    |
  | One **already-expired** shelf lot                        | The struck-through row, and the swap refusing it                                                            |
  | Three positions left **unlinked**                        | The toolbar's coverage count, and the bulk-match dialog                                                     |

**Fixed**

- **Every seeded checklist item used a check type nothing recognises.** The
  seeder wrote `"check_type": "presence"`. The column is a free `String(30)` so
  the API accepted it, but the eight types the check form knows spell it
  **`present`** — and an unrecognised value falls through the form's switch to
  the pass/fail branch. So every seeded item rendered **Pass / Fail** buttons
  under a guide describing Present / Missing, and nothing anywhere reported a
  problem.

  New rows are written correctly, and `_repair_check_types` rewrites the ones a
  long-lived demo database already holds — re-seeding does not touch a template
  that exists by name, so without the repair the old rows would never change.

  Same shape as the skills-testing `"checkbox"` criterion type
  (`KNOWN_LIMITATIONS.md`, 2026-08-10). **Worth assuming there are more of these
  wherever a type is stored as a free string** rather than validated on the way
  in.

- **`seed_equipment_checks` picked its template by position, not by name.** It
  took `templates[0]` and submitted every seeded check against it, so any step
  that created a template first would both suppress the Engine Daily Check _and_
  silently become the template the equipment-check screenshots picture. The new
  supply step is exactly such a step. Selected by name now, and ordered after it
  as well — ordering that does not depend on the fix is one less thing to get
  wrong later.

---

### Supplies: the shelf and the truck are now one loop (2026-08-10)

The largest single change in this release. An inventory item's ready stock and a
checklist position's contents were two records with no arithmetic between them,
so nothing could answer the two questions a supply officer actually asks: _what
is about to expire on my trucks_, and _which trucks carry this item_. Everything
below is that loop being closed.

**Added**

- **`check_item_deployed_lots` — one row per lot's presence on one position.**
  A position that carries four of something can be carrying units from three
  lots with three expiration dates. `CheckTemplateItem` holds a single
  `lot_number` / `expiration_date` pair, so only one of them could ever be
  recorded — and the one recorded was whichever was restocked last. The truck's
  real exposure, the **soonest date aboard**, was unrepresentable.

  A position's on-truck count is now the **sum** of its deployed lots, and its
  expiration is the **earliest** of them. All four surfaces that read a date —
  the supply worklist, the apparatus inventory page, the equipment-check form
  and the item-to-apparatus lookup — read that derived minimum rather than the
  column.

  Lot number and expiration are **snapshotted** onto the deployed-lot row rather
  than read through `inventory_lot_id`. Shelf lots get consumed and deleted, and
  what is on a truck has to remain answerable after the shelf record is gone.

  Existing single-lot data migrates across (`20260810_0008`): any item carrying a
  lot number or expiration becomes one deployed-lot row, so nothing already
  recorded is lost and every derived count matches what the item reported before.

- **`check_template_items.quantity_on_truck` — how many are actually aboard.**
  The row recorded how many an apparatus _should_ carry (`required_quantity`,
  the state-mandated floor, and `expected_quantity`, the department's own
  target) but never how many it has. "Used two of the four" had nowhere to go,
  so a box down to its last unit and one just opened looked identical.

  **NULL means nobody has counted since the item was defined**, and the target
  stands in. Reading NULL as zero would report every untouched truck as stripped.

  Four things move the count, and they mean different things:

  | Action                          | Meaning                                                                                                                |
  | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
  | **Minus** on the apparatus page | Consumption — the count drops _and_ a restock report goes up with it                                                   |
  | **Plus**                        | A hand restock                                                                                                         |
  | **Swap**                        | Draws N units off a shelf lot and puts N on the truck; defaults to the shortfall, so filling a gap needs no arithmetic |
  | **An equipment check**          | A recount — a crew standing at the compartment outranks a running total that has drifted                               |

- **`check_template_items.restock_needed` — a report raised at the moment of
  use.** The only writes to a checklist item came from an equipment check, so a
  crew that used the last of something at 03:00 either left a note somewhere or
  left it for the next morning's check to discover — which is exactly the window
  in which a truck runs a call short.

  The report carries who raised it, when, and an optional note
  (`restock_reported_by` / `restock_reported_at` / `restock_note`). It shows on
  the supply worklist **beside** the expiring items rather than in a list of its
  own, because to a supply officer "expires Thursday" and "the crew used it last
  night" are the same job.

- **`shift_equipment_check_items.expiration_found` — the missing counterpart to
  `serial_found` / `lot_found`.** A crew replacing a unit in the field could
  already write back the new serial and lot number, but not the new expiration.
  The old date survived the replacement — and because an expired item is
  force-failed on every submission, the item then **failed forever**, held its
  apparatus in a deficiency state, and never left the supply worklist. The found
  date is written back onto the template item on submit, exactly as the lot
  number already was.

- **Apparatus Inventory (`/scheduling/apparatus-inventory`) — a standing view of
  a truck, outside any check.** An equipment check is a scheduled, signed pass
  over a whole apparatus that produces a report; until now it was also the only
  way anything about a truck's stock could be written down. The new page lists
  what an apparatus is carrying compartment by compartment, with the lots aboard
  and the ready stock behind each position, and it is readable at any hour.

  Reached from **My Equipment Checklists → Apparatus Inventory**. It is gated on
  `equipment_check.submit` / `equipment_check.view` / `inventory.view` —
  crew-level, not officer-level, because recording what you just used is the
  whole point and gating it behind a manage permission is what leaves the gap.

- **Receive Stock — a whole delivery in one pass.** Pre-stocking was a page at a
  time: recording a delivery meant opening each item's detail page and adding
  one lot, which is a large part of why the stock a crew went looking for often
  did not exist. The Receive Stock screen takes item, lot number, expiration and
  quantity per line with one received date for the lot of it, through
  `POST /inventory/lots/bulk`, which validates every item is in the caller's org
  and **applies all lines or none**. A partly applied delivery is worse than a
  rejected one: the officer cannot tell which lines landed, and re-entering it
  would double-count whatever did.

- **Add Several — paste a catalog in.** Stocking the catalog is list-shaped
  work that only had a one-item-at-a-time modal.
  `POST /inventory/items/bulk` creates many at once; **names already in the
  catalog are skipped and reported, not rejected**, so a list can be re-pasted
  after it grows. Any validation failure writes nothing. The CSV import that was
  built, routed and unreachable from the items page is now surfaced beside it.

- **Catalog linking while an item is being added.** Expiration, lot and restock
  tracking all hang off a checklist item's `inventory_item_id`. Setting it was a
  separate act from adding the item and lived three clicks deep inside the item's
  advanced panel, so on a real rig checklist almost nothing was linked and almost
  nothing was tracked. Every bulk path made it worse — quick add, bulk paste,
  Add Kit presets and CSV import all posted a name and nothing else.

  The quick-add bar now searches the catalog as you type; picking a result links
  it and inherits what the catalog knows (name, counted-vs-serialized, whether it
  carries dated stock). Typing a name nobody stocks still adds a plain checklist
  line, because plenty of lines are not stock and never will be. When the search
  finds nothing, the bar offers to **create the item in inventory and link it in
  one step** — gated on `inventory.manage`, since a scheduling officer without it
  would only get a 403 they cannot act on.

- **A reviewed bulk link pass for checklists that already exist.**
  `GET /equipment-checks/templates/{id}/inventory-matches` proposes a catalog
  item for every unlinked position;
  `POST /equipment-checks/templates/{id}/inventory-links` applies the reviewed
  set. **Only exact name matches are pre-selected.** A close match is
  deliberately never pre-selected — "Oxygen Mask" scores high against both the
  adult and the pediatric mask, and quietly picking one would put the wrong
  expiry on a truck. The template toolbar now carries a linked/unlinked count so
  the holes are visible at all.

- **`GET /equipment-checks/supply/item-deployments/{inventory_item_id}` — the
  link read backwards.** The supply worklist answers "what is expiring on my
  trucks"; there was no way to ask "which trucks carry this item", which is the
  direction a recall or an expiring lot is actually worked from — the officer is
  holding the item. The stock tab on an inventory item now lists the checklist
  positions it fills, each with what that truck is carrying right now.

- **A weekly expiring-supply alert.** There are alerts for certifications, low
  stock, overdue checkouts and NFPA retirement; the supply worklist was
  pull-only. `supply_expiration_alerts` reports **both ends of the same
  shelf-to-truck loop together**, which is the part neither module can do alone:
  it splits the deployed items by whether an in-date lot is actually behind them,
  because "swap it" and "order it" are different jobs and the officer plans the
  week around which one each row is.

  **Weekly rather than daily** — an item that has already expired fails its
  apparatus on every check and notifies through that path, so this alert exists
  to get ahead of the date, not to repeat what the check already says.

**Changed**

- **On-hand now comes from in-date lots.** Lots and `InventoryItem.quantity` were
  separate ledgers that never spoke: adding a lot did not touch `quantity`, and a
  swap decremented only the lot. The reorder alert read `quantity`, so a
  consumable stocked purely through lots — which is what the supply-officer
  screens create — could sit at **zero ready units and never trip it**, while one
  whose `quantity` column was never maintained tripped it every day.

  On-hand is now the sum of in-date lots for any item that has them, and
  `quantity` for the rest. One shared helper backs the alert, the items grid and
  the CSV export, so the three cannot disagree. The Qty column labels the figure
  **"in-date lots"** so it is not mistaken for the pool count beside it, and the
  export carries it in its own **Ready Lot Stock** column. The alert says which
  ledger each figure came from, so a number that disagrees with the item's own
  `quantity` reads as the count that matters rather than as a bug.

- **Expired shelf stock is no longer ready stock.** A lot past its own date was
  counted in `ready_stock`, offered in the swap list, and **accepted by the swap
  endpoint** — which would have put expired supplies in service and failed the
  item on the next check. It is now excluded from the count, flagged in the
  payload, struck through in the supply view, and refused by the swap. An item
  whose lots have all expired reads as **zero**, not as its stale `quantity`:
  counting expired stock would hide the shortage most in need of ordering.

- **Expiry is decided by the server.** It was taken from a client-supplied
  `is_expired` flag — which is what force-fails a safety-critical item. It is now
  recomputed from the template item, or from the replacement just logged, and
  from the **soonest date actually aboard** rather than the position's column.
  The frontend badge switched to a calendar-day comparison in the organization's
  timezone to match, instead of parsing the date-only string at UTC midnight and
  calling an item expired a day early.

- **Swapping is no longer gated on the date.** The swap action only appeared when
  an item was expired or expiring, but expiry is one reason a unit comes off a
  truck — used, damaged, contaminated, missing and recalled are the others. A
  crew holding an empty bracket had ready stock on the shelf and no way to reach
  it. The action now shows for any item linked to inventory, emphasised only when
  the date is the reason.

- **A lot swap is now in the changelog every manual edit writes to.**
  `swap_item_lot` took a `user` parameter and never used it, so the one change to
  a check template that nobody typed was also the only one with no author — a lot
  number would appear on an apparatus from nowhere. It now logs a `swap` entry
  carrying the previous and new lot/expiration and the shelf lot it came from.

- **A quantity item arrives on the check form carrying the running count, and
  arrives unchecked.** It used to be seeded from the _last check's_ count, which
  is the wrong memory now that a running one exists: a crew that pulled two at
  03:00 opened the morning check at the four the last check had seen — the exact
  drift this work removes, reintroduced at the screen where it matters most. The
  running on-truck count is now the source, with the last check's number as the
  fallback for items never counted.

  More seriously, seeding also set each item to **pass or fail**. A crew could
  open a sixty-item check, submit it untouched, and file a complete report
  against a truck nobody had looked at, with the progress counter agreeing. Items
  now seed with **no status**, so a pre-filled number is a starting point to
  correct rather than an assertion, and the counter reflects what was actually
  looked at. An unchanged count still takes one tap to affirm.

- **"Confirm Counts" leads; "Set All to Par" warns before it claims stock.**
  Set All to Par wrote the required quantity over whatever each position was
  showing. On a truck carrying eighteen of twenty-four gauze, one tap recorded
  twenty-four — six on the record that are not in the bag — with no signal it had
  done so. Carrying counts over from the last recorded count made that worse,
  because the number being overwritten is now usually real.

  "The numbers are right" and "it is all full" are different claims, and only the
  second had a button. **Confirm Counts is now its own action and it
  leads**: it is the common case and it cannot record stock nobody has. Status
  still comes from the number, so confirming eighteen of twenty-four files a
  failure rather than quietly passing it. Set All to Par keeps its meaning and
  its place but names the items whose count it is about to raise; a compartment
  already at par is untouched and stays one tap.

- **Consumption draws first-expiring-first-out.** That is the order a crew should
  be pulling from and the only order that keeps what remains as fresh as
  possible. Undated lots sort **last** — an undated unit is never the one that
  needs using up.

- **A restock report is settled only when the truck is back at its target.** Two
  of four back is still a truck short two, and clearing the flag there would
  close the gap on paper while leaving it open on the apparatus. A counted
  position below target reaches the supply worklist on its own, with or without a
  report behind it, and the row shows the numbers rather than only that something
  is needed.

- **On a counted position the old "Used" action became "Flag".** The minus button
  is what records use there, so "Flag" covers damaged, contaminated or missing
  without pretending a unit was consumed.

- **The equipment-check form lists every lot's date.** A bag holding three boxes
  with three dates was described by whichever was restocked last. The form now
  receives the lots and lists each with its own date, and the expiry verdict is
  taken from the soonest date aboard. The verdict **recomputes the minimum**
  rather than trusting the payload's order, because it is not a decision that
  should depend on how a list arrived.

- **Count, lot number and date travel together in one correction.** Correcting a
  lot could only set a count, so a crew swapping a box in could record that one
  was there without recording when it expires — leaving the application
  confidently asserting an expiration for a unit that had left the bag. The
  correction is now available from inside the check as well as from the apparatus
  view, and both screens render the **same panel** rather than two lot lists that
  would drift. Omitted fields are left alone and an explicit `null` clears; zero
  quantity removes the lot, so a spent box stops contributing its date.

- **The "item swapped?" panel exists for every check type that can carry an
  expiration**, not only `date_lot`. Types that could carry a date but not
  `date_lot` had no route to record a replacement at all; they get a
  "replaced — new date" control of their own — shown only where there are no lots
  to correct, so one fact never has two contradictory inputs.

- **Three hand-rolled `split(',')` CSV readers replaced with a real RFC 4180
  parser.** A supply catalog is exactly the data that breaks them —
  `"Gauze Pads, 4x4 Sterile"` is one field, and splitting on commas shifted every
  column after it, so the import preview disagreed with what the import would
  actually do.

**Fixed**

- **A swap stamped the incoming lot's date onto the units already aboard.** The
  item's `lot_number` and `expiration_date` were overwritten before the existing
  units were given a deployed-lot row of their own, so they were recorded
  carrying the new lot's date — the exact substitution the deployed-lot table was
  added to prevent, moved one step along. The existing units are now given their
  row first.
- **A recount was silently discarded on any position carrying lots.** Both the
  apparatus recount and an equipment check's `quantity_found` wrote
  `quantity_on_truck`, which stops being what anything reads the moment lots
  exist. A counted total now reconciles against the lots: short of the record
  comes off soonest-first like any other consumption; over the record lands in an
  **undated** row, because the honest answer to when found stock expires is that
  nobody knows.
- **The supply worklist matched only the item's own expiration column** while
  displaying the soonest date aboard, so a position whose column read next year
  while it carried a lot expiring this week never appeared — precisely the case
  the table was added for.
- **A lot drawn down to nothing stayed on the record**, accumulating dead rows
  against every position a truck ever restocked and holding a spent lot's foreign
  key for no reader.
- **Cloning a template dropped `inventory_item_id`**, silently severing the
  catalog link on the copy — which is how a department stands up its second
  engine.
- **Completing an incomplete check stored found values but never propagated them
  to the template**, so which write path a crew took decided whether the truck's
  record was updated.
- **The template builder sent blanks as omitted keys on update**, so clearing an
  expiration date or unlinking an inventory item reported success and changed
  nothing (CLAUDE.md pitfall #1, update half).
- **`InventoryItem.assigned_to_user_id` is `String(36)` and the endpoint passed a
  `UUID`.** "Everything issued to this member" answered "nothing", for every
  member, silently, with a 200 and an empty list. Every other id filter in the
  same query already cast with `str()`. Four tests pin the rule for all four id
  filters.
- **The apparatus picker was always empty.** The page asked for 200 apparatus and
  the endpoint caps `page_size` at 100, so every load 422'd. The fleet is now
  walked a page at a time.
- **The lots sheet was cut off by the mobile tab bar** — a position carrying two
  lots showed the first and hid the second behind the fixed bottom navigation,
  which is exactly the case the sheet exists for. Both sheets now sit above the
  bar and pad their scroll area clear of it.
- **An expired item counted as neither short nor needing restock**, so an
  apparatus carrying two expired naloxone and nothing else summarised as fully
  stocked. Expired is now counted, and reported **apart from** expiring: lumping
  them reads as "two things want attention some time soon" when one of them is
  unusable now.
- **An expired position rendered its count in green.** Two of two expired units
  meet the number and are still nothing a crew can use; the count now reads red.
- **The supply worklist showed a "300d left" countdown against an item listed for
  being short**, which reads as an expiry warning for something ten months out.
- **Ranks rendered as "Deputy_chief"** on the impact planner's member table. CSS
  `capitalize` uppercases the first letter of each _word_, and a snake_case value
  is one word. `enumLabel` already solved this but lived in the facilities
  module's types file; it moved to `utils/displayValue.ts` and is re-exported from
  `facilities/types` so the 27 existing imports keep working.

**Edge cases worth knowing**

- **A crew reporting more used than the record held draws what was there.** That
  is a correction to the record, not a negative quantity.
- **A position carrying units with no lot row gets one before the first lot joins
  them**, or the lot sum would become the authority and the units nobody had
  recorded a lot for would vanish.
- **Headers and free-text lines are left out of the apparatus view.** They are
  checklist scaffolding, not things anyone stocks.
- **Clearing a restock report drops the reporter and note too**, so a stale name
  is never attached to the next report. A swap of fresh stock clears the report
  on its own, since the item has been dealt with.
- **A position with lots aboard opens them rather than offering a stepper.** Two
  units with two dates cannot be moved by one plus or minus. Each lot carries its
  own count and a Remove.
- **Deleting a shelf lot does not erase what is on a truck.** `inventory_lot_id`
  is `ON DELETE SET NULL` and the lot number and expiration are snapshotted.

**Migrations** — `20260810_0005` (`expiration_found`), `20260810_0006`
(`restock_needed` and its three companion columns, plus
`idx_check_item_restock`), `20260810_0007` (`quantity_on_truck`), `20260810_0008`
(`check_item_deployed_lots` and its data migration). They were renumbered from
`0003`–`0006` after `main` landed the email-template pair at those ids: two
revision IDs with two files each is not a merge conflict git can see — it is a
chain Alembic refuses to load, and the backend crashes on startup rather than at
review.

---

### Communications: one email design, and a footer library instead of 35 copies (2026-08-10)

**Added**

- **A named footer library on the organization.** The footer was copy-pasted into
  all 35 default bodies: 32 copies of "This is an automated message from …" and
  25 of the contact line. Changing the wording meant opening 35 templates one at
  a time — and once a template had been edited by hand, the only way back was
  Reset, which discards the rest of that template's edits too.

  It is now a library, with each template naming the footer it closes with.
  **Named rather than singular** because a department does not want to say the
  same thing to everybody:

  | Footer              | Who gets it                                                                                                                                                                                                  |
  | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | **Internal**        | Members. The routine "do not reply" close. The default.                                                                                                                                                      |
  | **Public**          | Outside the department. Invites a reply and carries the mailing address — telling somebody who asked the station to visit their school not to reply was wrong. Event requesters and applicants get this one. |
  | **Official notice** | On the record: separations, property return, election results.                                                                                                                                               |

  Departments can rename, reword, add and delete these; a footer names its own
  lines and toggles the contact and address blocks. Managed at
  **Communications → Email Templates → Footers**
  (`GET` / `PUT /email-templates/footers`, `settings.manage` or
  `organization.update_settings`).

  Mechanically the footer is two more variables, `{{footer_html}}` and
  `{{footer_text}}`, that `build_context` injects like the organization ones — so
  every render path picks it up, including the code defaults behind a template
  row and the one-off bodies `wrap_email_body` builds for scheduled tasks. It is
  resolved **a step before** the template body, because rendering is a single
  substitution pass: a `{{organization_name}}` sitting inside an
  already-substituted `{{footer_html}}` would mail as those literal braces.

- **Nine more `{{organization_*}}` variables.** Seven fields a department fills in
  on Organization Settings could not be put in an email or a footer: fax, county,
  founded year, tax ID, and the three department identifiers (FDID, state ID,
  department ID). The description and the organization type were missing too.

  | Variable                                                            | Why it exists                                                                                                                                                                  |
  | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `organization_tax_id`                                               | A 501(c)(3) asking for money is expected to state its EIN on the message that asks                                                                                             |
  | `organization_identifier` / `organization_identifier_label`         | Whichever of the three identifiers the department nominated, **with the name of the scheme**, so an official notice can read "FDID 12345" and be right about which one that is |
  | `organization_founded_year`, `organization_county`                  | The "Serving X County since 1923" line departments write by hand today                                                                                                         |
  | `organization_fax`, `organization_description`, `organization_type` | Completeness                                                                                                                                                                   |

  Which columns reach templates is now a **two-map ledger** —
  `ORGANIZATION_FIELD_VARIABLES` for the ones offered and
  `ORGANIZATION_FIELDS_WITHOUT_VARIABLES` for the ones deliberately withheld and
  why. A column in neither is one nobody ruled on, and the catalogue test says so
  by name; that is the part that keeps the gap from silently regrowing the next
  time a column is added.

- **Template rows for three notices that had none.** `shift_assignment`,
  `shift_decline` and `shift_reminder` were listed by the enum and by the Email
  Templates screen but composed in code, so **the mail departments send most
  often was the mail they could not reword**. Each now has a default body, a
  documented variable list and sample data, and each send site renders through
  the department's template with the code default behind it.
  `ballot_eligibility_summary` had a template but neither variables nor samples,
  so its editor palette was empty and its preview rendered blanks.

**Changed**

- **One stylesheet, one document shell, one table style.** `app/services/email_theme.py`
  is now shared by the template service, the storefront and the election report,
  replacing three copies with drifting hex codes. The design is a white card on a
  grey page — system font stack, rounded header band, consistent paragraph
  rhythm, light table headers — in place of the full-bleed red band over a grey
  slab.
- **Untouched templates track the built-in stylesheet.** `create_template` copied
  `DEFAULT_CSS` into every row, so an organization's templates were frozen on
  whatever stylesheet shipped the day they signed up, and improving the default
  reached new departments only. The service now stores NULL and falls back at
  render time. Migration `20260810_0003` NULLs the rows still holding a
  **verbatim** copy of one of the two stylesheets ever shipped as a default; a
  department that edited its CSS matches neither string and is left alone.
- **The preview endpoint runs the inliner**, so what an admin approves is what
  ships.
- **Two lines that were genuinely per-notice rather than boilerplate** — "A copy
  has been placed in your member file" and "Please retain this email for your
  records" — moved into the notice itself or into the official footer.

**Fixed**

- **The CSS inliner styled the first paragraph of every email and nothing after
  it.** `".parent child"` rules stopped at the first closing tag inside the
  parent, so `.content p` matched once. Gmail strips `<style>`, so that was the
  spacing most recipients actually saw. It now scopes by element depth, and
  declarations are normalised so a quoted font name cannot close the style
  attribute it lands in.
- **`items_removed_html` and `recipients_html` were missing from
  `_RAW_HTML_VARIABLES`**, so the inventory notice's removed-items list and the
  eligibility summary's recipient list were escaped and mailed as visible angle
  brackets.
- **The code-default fallback never filled in the organization variables.** That
  path is the normal one until somebody opens the Email Templates screen — which
  is the only thing that creates the rows — so those departments were receiving
  footers reading a literal `{{organization_phone}}`.
- **The event-request status notice labelled Scheduled Date, Reason and Message
  unconditionally**, and most status changes carry only one of them. A member of
  the public who asked the department to attend their event was getting bare
  "Reason:" lines. The optional blocks are now assembled by the sender.
- **The event-request fallback fed each value to `re.sub` as a replacement
  string**, so a backslash in a public contact name was read as a group
  reference. It goes through `_render_with_fallback` like everything else — which
  also gets these sends into Message History for the first time.
- **The duplicate-application notice printed its contact line twice.**
- **Three header colours failed WCAG AA against their white text** (`#f59e0b` at
  2.2:1, `#d97706` at 3.2:1, `#059669` at 3.8:1), as did the 11px `#9ca3af`
  contact line in every footer.
- **"Send Test Email to Me" posted a blank recipient.** SMTP rejected it, the
  endpoint returned 200, and the UI reported success for an email nobody
  received.
- **The mailing/physical address composer read every column except country**, so
  an address outside the US lost its last line. The country is appended except
  when it is the `"USA"` the column defaults to — printing it unconditionally
  would put a line of noise under every US department's own address.

**Edge cases worth knowing**

- **Which footer a template uses is `email_templates.footer_key`, NULL meaning
  "the one marked default"** — so a department that changes its default reaches
  every template that has not overridden it, without a data migration.
- **An unrecognised key resolves to the default rather than to nothing.**
  Deleting a footer should cost the templates naming it their _choice_, not their
  footer. The Footers screen says how many templates use each one before you
  delete it.
- **The library lives in `Organization.settings`**, like the officer directory and
  for the same reason: rendering is synchronous and already receives the
  organization, so it needs no extra query on any send path.
- **Malformed settings fall back to the seeded library rather than raising.** Mail
  has to keep going out.
- **Footer text is admin-entered**, so it is escaped before its variables are
  substituted, and the substituted values are escaped too.
- **The library saves whole.** A per-footer save could leave `default_key` naming
  a footer the same request deleted.

**Migrations** — `20260810_0003` (clear verbatim default CSS copies),
`20260810_0004` (`email_templates.footer_key`).

---

### Twenty-two defects found by photographing the application (2026-08-10)

Every item below was found while capturing screenshots for the training guides —
by opening the resulting image and comparing it with the caption. None was
reported by a test.

**Fixed**

- **One training attachment made the whole records list return 500.**
  `POST /training/records/{id}/attachments` stores a **dict** per file while
  `TrainingRecordResponse` declared `attachments: Optional[List[str]]`, so the
  moment anybody attached a certificate, `GET /training/records` failed response
  validation for the **entire list**. The response now uses a
  `TrainingAttachment` schema listing only client-safe fields — the stored dict
  carries the absolute path of the file on the server's disk and the uploader's
  id, so widening the type to `List[dict]` would have started leaking
  `/app/uploads/...` to every caller. A validator stamps each attachment with its
  index (the download route addresses them that way; they have no id) and carries
  legacy bare-string attachments through as file names.
- **Setting a required EVOC level on an apparatus returned 500 — and took the
  whole fleet list with it.** `ApparatusResponse` and `ApparatusListItem` both
  project `required_evoc_level`, but the detail query, the list query and the
  update path all left it unloaded. The gap was invisible while every apparatus
  had a NULL `required_evoc_level_id`, because SQLAlchemy returns None for a null
  FK without touching the database; the moment a value existed, response
  validation lazy-loaded on an async session and raised `MissingGreenlet`. **One
  unloaded row was enough to fail the entire page.** This is why no apparatus in
  the demo data had a requirement: the feature could not be used.
- **Adding or editing an apparatus operator with an EVOC level returned 500.**
  Same shape — both write paths ended on `db.refresh()`, which repopulates
  columns and not relationships. The row was committed first, so the UI reported
  a failure over an operator that had in fact been created. Both paths now reload
  with `selectinload`.
- **The Operators tab labelled every row "Operator ID: a8c2c854-…".** The
  operator's user has always been eager-loaded but never projected;
  `ApparatusOperatorResponse` now carries `user_name`. The add form asked for that
  UUID by hand in a free-text box — nothing in the UI shows a member's id — so it
  is now a member picker.
- **The member-deletion impact preview reported 0 inventory items for every
  member in the system.** `get_deletion_impact` imported `InventoryAssignment`
  from `app.models.inventory`, a class that has never existed there (the models
  are `ItemAssignment` and `ItemIssuance`). The `ImportError` was swallowed by a
  bare `except Exception: pass` and the count stayed at its initialized zero, so
  **an administrator about to permanently delete a member was told the deletion
  would cost nothing.** Now counts both models, with the swallows removed and the
  imports hoisted to module scope where a bad name fails at import.
- **Creating a cohort's classes failed with "Training course not found", for a
  course that plainly existed.** `TrainingCourse.id` is `String(36)` but
  `course_id` arrives from the schema as a `UUID`, and both course lookups in
  `TrainingSessionService` bound it raw. The path is only reached with
  `use_existing_course=True`, which is how cohort classes are created. The visible
  result was a cohort detail page reading "No event" on every row under a red
  "Create 5 missing events" button — the repair prompt shown as though it were
  the normal state.
- **The Create Training Session wizard shifted its own date/time fields on every
  render.** `DateTimeQuarterHour` emits a local wall-clock string, but the value
  bindings sent it back out through `formatForDateTimeInput()`, which parses a
  bare string as an _instant_ and re-renders it in the organization's timezone.
  The field lost the org's UTC offset **once per interaction, compounding**:
  setting 15 September 9:00 AM and then adjusting the hour, minute and meridiem in
  turn left 14 September 9:00 PM behind.
- **The event detail page leaked scheduler bookkeeping to members.**
  `custom_fields` was dumped verbatim under "Event Details", excluding only the
  training keys the block above renders — and that column is also where the
  scheduled tasks record what they have already sent. Any member opening an event
  the scheduler had touched was shown "Validation Notification Sent: true" beside
  the description. The three bookkeeping keys are filtered out, and the card is
  gated on there being something visible left.
- **Guest check-in switched itself off on any other edit.** `_build_event_response`
  names each field it passes rather than validating from the ORM row, and it named
  neither guest flag. The column held 1, every read said false, and because the
  edit form loads from that endpoint, opening an event with guest check-in on and
  saving any other change wrote the false back. `recurrence_exceptions` and
  `rolling_recurrence` were missing the same way. **A completeness test now
  asserts the builder names every field the schema declares**, minus the
  per-request aggregates callers supply — a per-field test would not have caught
  the next one.
- **The room display drew its headings with a hard-coded `text-white` over a
  theme gradient whose middle stop is light.** The event name — the one thing a
  kiosk exists to show — was white on white for any department that had not
  switched the display to dark.
- **The Send Log marked in-app notifications "Not delivered"** — a red mark and an
  error tooltip — for notifications the member had already opened and read.
  `NotificationLog.delivered` defaults to False and six write sites that create
  in-app rows never set it; there is no send step for the in-app channel, because
  **the row is the delivery**. The default is now a callable returning True for
  the in-app channel, while an explicit `delivered=` still wins, which is what
  email needs for a bounce.
- **`?tab=` addressed one of the four notification tabs.** `?tab=log`,
  `?tab=templates` and `?tab=rules` all fell through to the rules tab, and
  switching tabs deleted the parameter rather than updating it — so the Send Log,
  the one screen anyone has cause to send a colleague a link to, could not be
  linked at all. All four now round-trip, still gated on the permission that shows
  them.
- **The member audit history's Event Type dropdown was inert.** It speaks a
  coarser vocabulary than the stored event types — "Profile Updates" covers
  `user_profile_updated`, `user_updated` and the two photo events — but the
  endpoint compared the dropdown's value for **equality** against the stored type.
  Every option except "All Events" emptied the page and then advised the reader to
  clear the filter, as though the member had no such history. An unrecognised
  value still falls through to an exact match so a caller can name a stored type
  directly. **"Logins" is gone from the dropdown**: this endpoint returns
  member-management events only, so that option could never match anything however
  the filter was wired. Logins live in the security audit log.
- **Expanding an audit entry showed two raw UUIDs** — the member's id and the
  editor's id, 36 characters each, both for people the row already names. Those
  keys are filtered out, and an entry left with nothing else to show no longer
  offers a details toggle at all.
- **Three finance detail pages showed breadcrumbs only while loading.**
  `<Breadcrumbs />` was rendered in the loading-skeleton and not-found branches of
  `ExpenseReportDetailPage`, `PurchaseRequestDetailPage` and `BudgetDetailPage`
  and **not** in the branch that renders the record, so the one state nobody looks
  at was the only state with navigation. The test asserts against the source
  rather than a render — the defect is a missing line in the last of three sibling
  branches, and a render test would only exercise whichever branch its mocks
  produced. It walks every `*DetailPage.tsx` in the folder, and found
  `BudgetDetailPage` on its first run.
- **The Dashboard's Open Shifts panel rendered every open shift in the next 30
  days.** Its siblings are all capped; this one mapped the whole fetch. On a
  22-member department that is 48 rows, which turned the member dashboard into a
  6,930px page with events, activity, ID card and equipment pushed off the bottom
  — while carrying a "View Schedule" link that is the affordance for seeing them
  all. Capped at five with a line saying how many more there are.
- **The facility inspection's inspecting organization was collected, searchable,
  and rendered nowhere.** `inspector_organization` is a form field and one of the
  four fields the search matches, so you could find a record by typing
  "Commonwealth Mutual" and then read a row that named that firm nowhere. Both
  list surfaces now print it beside the inspector.
- **A cancelled skills test offered a way back in.** The "Tap to start / Tap to
  resume" affordance and the `/active` route were gated on `completed_at`, and a
  cancelled test has no completion date either — so it read as unfinished and
  routed the officer to the scoring screen for an evaluation that is closed. Gated
  on status now, positively.
- **The skills-testing criterion type was a free string.** The scorer and the
  examiner screen each recognise five values; anything else fell through to a
  fallback that rendered plausibly and **carried no points**, so a scorecard
  reported "No percentage could be calculated" with every section marked as not
  counting, on a sheet that looked fully scored. The schema validates the type on
  the way in and names the accepted values.
- **Reloading a skills test reset which section you were on.** `loadTest` wrote
  `activeSectionIndex: 0` unconditionally, and a second in-flight load resolved
  after the scoring screen had jumped to the first section with blank steps and
  undid it — so a half-scored evaluation reopened at section 1 with no clue why.
  Only a _different_ test starts at the top now.
- **The prospect drawer's Linked Events badge read "public Education".** The badge
  is an inline span butted against the date before it, so `capitalize` saw
  "AMpublic education" as one word. `inline-block` gives it its own line-box start.
- **The course preview card rendered the raw enum — "Type: skills_practice".**
  Two divergent copies of a `TRAINING_TYPE_LABELS` map already existed (one saying
  "Skills practice", the other "Skills Practice") while this third site had none.
  One map now lives in `constants/enums.ts`.
- **`create_report` overwrote the officer's call count whenever a shift was
  linked.** The field is editable, pre-filled from the run log, badged "(auto)",
  and the guide tells officers they may correct it — and the correction never
  survived the request. It now fills a blank and leaves a supplied value alone,
  distinguishing "omitted" from "zero". The batch path passes `None` explicitly
  and keeps deriving per trainee: its form collects one count for the shift, not
  per crew member, so fanning it out would credit every rider with every run.
- **Both monthly shift-report charts drew nothing.** The bars size by percentage
  inside a column with no height, so they collapsed and left a month label under
  empty space.
- **`apply_placeholders` stamped images into the wrong section.** It trusted its
  line hint whenever that line held any placeholder, without checking the anchor
  agreed — so a prose edit above one pushed it down, the stale number landed on
  its neighbour, and a review modal was published under a caption about
  re-review buttons, **reported as a successful replacement**.

**Known, recorded rather than changed**

- **The Review Queue and Flagged views render only while review is required**, so
  a flagged shift report becomes unreachable if that setting is later turned off.
- **An event carrying both a `location_id` and a free-text `location` opens in
  "Other" and loses its link on save.** The form treats free text as proof the
  event is off-site. Only an API client can produce that pair.
- **A prospect's "Attended: `<event>`" referral stamp is reachable only from an
  export or the API** — nothing renders it. The provenance is visible by another
  route, in the drawer's Linked Events panel.
- **Auto-progressed training requirements are stored but never rendered.**
- **The Scheduling Compliance report's Total Members card sums per-requirement
  cohorts**, so a member counted under three requirements counts three times. The
  Compliant and Non-Compliant cards sum the same way: the values are
  member-requirement pairs, the labels claim members. The payload carries no
  distinct-member count, so correcting it means relabelling the cards or adding an
  API field — a product decision, not a screenshot one.

---

### Scheduling: four defects the crew board and dashboard were showing (2026-08-10)

**Fixed**

- **A designated shift officer held no seat.** `_sync_officer_assignment` decided
  whether the board had an "officer" position by reading `BasicApparatus.positions`
  alone, while the response builder resolves the same list differently — the
  apparatus's riding positions when it has them, the shift's own otherwise — and
  the panel renders from that. The two disagreed on **exactly the departments
  running the full Apparatus module**, which deliberately does not model riding
  positions: there the sync returned before seating anybody while the board
  rendered happily from the shift's own positions. The panel named a Shift Officer
  who appeared on no roster and counted toward no staffing total. The sync now
  resolves seats the same way the response does.
- **Today's shift read as yesterday's.** `shift_date` is a calendar date — no
  time, no timezone. Padding it to `"2026-08-10T00:00:00"` and handing it to a
  timezone-aware formatter parses local midnight and re-renders it in the
  department's zone, so "My Upcoming Shifts" showed Aug 10 as "Sun, Aug 9" for any
  viewer west of the browser's offset. Adds **`formatCalendarDate`**, which anchors
  and formats in UTC so the day written in the string is the day shown, and uses it
  for shift dates and leave-of-absence ranges.
- **Two filter controls painted over their neighbours.** `form-input` carries
  `w-full`; pinned with `sm:flex-none` and no width of its own, that resolves
  against the whole row rather than the space left beside the icon and label
  preceding it. The Open Shifts date filter overflowed by exactly that width and
  covered the Refresh button; the Requests status filter spilled past the page's
  right edge. Both now declare a desktop width.
- **"1 calls".** Pluralised on the report card and in the review modal.

---

### Dependencies (2026-08-10 → 2026-08-11)

**Changed**

- **Backend** — `starlette` 1.3.1 → 1.4.1, `uvicorn` 0.52.0 → 0.52.1,
  `pydantic-settings` 2.14.2 → 2.15.0, `alembic` 1.18.5 → 1.19.0, `hiredis`
  3.4.0 → 3.4.1, `pywebpush` 2.0.3 → 2.4.0, `boto3` 1.43.61 → 1.43.67,
  `google-auth` 2.56.2 → 2.56.3, `hypothesis` 6.164.0 → 6.165.2,
  `redis` 5.2.1 → **8.1.0**, `websockets` 14.2 → **17.0.1**,
  `google-cloud-storage` 2.19.0 → **3.13.1**, `tzdata` → 2026.3.
- **Frontend** — `eslint` 9.39.3 → **10.8.0**, `@eslint/js` 9.39.3 → **10.0.1**,
  `@vitejs/plugin-react` 5.1.4 → **6.0.5**, `concurrently` 8.2.2 → **10.0.4**,
  plus the npm minor/patch group (11 of 12).

**Fixed**

- **`@eslint/js` 10 ships an updated `eslint:recommended`**, whose two new rules
  flagged three real defects: `LinkifiedText` pushed its trailing text fragment
  with `key={key++}`, an increment nothing reads (`no-useless-assignment`); and
  `reportsStore` and `storefrontStore` rethrew a normalized message with
  `new Error(message)`, discarding the axios error behind it
  (`preserve-caught-error`). Both now pass it as `cause`, which needs the ES2022
  Error overload — `ES2022.Error` was added to tsconfig `lib` **on top of** ES2020
  rather than replacing it, since Error cause is a runtime API and needs no change
  to `target`.
- **The npm-minor-patch group could not install at all.** The lockfile was missing
  the `@rolldown/*` platform bindings the bumped Vite pulls in, so `npm ci` failed
  before any job could run. Regenerating it also surfaced that **npm keeps a
  per-workspace copy of each declared range inside the lock and trusts it over the
  manifest** — that copy had gone stale for `lucide-react`, so npm believed
  `^1.30.0` was already met by 1.28.0 and silently refused to re-resolve: `npm ls`
  reported the tree as invalid while `npm ci` still exited 0.
- **The root `overrides` block pinned `vite` at `^7.3.1` and `esbuild` at
  `^0.27.0`** while the frontend pins vite 8 and esbuild `^0.28.1`. `plugin-react`
  6 imports `vite/internal`, which resolved to the root's vite 7 and failed with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`; and with vite hoisted to the root and esbuild
  left nested under `frontend/`, vite could not resolve esbuild at all. **Both must
  hoist together.** They now track the frontend's own pins.

**Known**

- **`typescript-eslint` is deliberately held at `^8.65.0`** rather than the
  group's `^8.66.0`. Bumping it forces npm to re-resolve the package, and no
  `typescript-eslint` release accepts the TypeScript 7.0.2 this repo pins — every
  version caps its peer at `<6.1.0`. The tree only resolves today because the
  lockfile carries a second TypeScript (5.9.3) at the root for the linter's own
  use, **so ESLint and `tsc` are running different TypeScript versions.** Neither
  an explicit root `typescript` pin nor `--legacy-peer-deps` fixes that honestly.
  Pulling that thread needs its own change.
- **The lockfile must be regenerated with npm 11**, the version
  `frontend/package.json` requires and both Dockerfile stages install. npm 10 and
  npm 11 hoist this tree differently, so a lock built by npm 10 installs a
  different tree under the npm 11 that actually runs in CI and in the image — which
  is what failed the Docker frontend production build. Worth knowing independently:
  regenerating the lockfile with npm 11 resolves the frontend to vite 7.3.6 against
  its own 8.2.1 pin; npm 10's hoisting is the only thing hiding that.

---

### Events: visitors can sign themselves in at an open house (2026-08-09)

**Added**

- **A guest QR code on the room display, for people who have no account.** A
  room display previously showed one QR code, pointing at
  `/events/{id}/check-in` — a member route behind authentication. A visitor at a
  volunteer interest night who scanned it was sent to the login page, so their
  attendance was recorded by hand or not at all.

  An event can now opt in to a **second, guest-specific** QR code. The two codes
  sit side by side on the display and stay separate: the member flow, including
  check-out, is untouched, and check-out is meaningless for a walk-in.

  Two switches on the event, both off by default, under **Check-In Settings**:

  | Setting                                         | Effect                                                                             |
  | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
  | **Allow guest check-in**                        | Shows the guest QR code and opens the public sign-in page for this event           |
  | **Create a prospective member from each guest** | Additionally opens a pipeline record for every guest who supplies an email address |

  Off by default is deliberate: turning the first one on exposes an
  **unauthenticated write path**. It belongs on outreach events — interest
  nights, open houses — and should stay off for business meetings and training
  sessions, whose attendance drives records that only apply to members.

  The guest fills in first and last name (required), and optionally email, phone,
  the organization they are with, and why they came. Nothing more: a walk-in
  should be asked for the minimum needed to follow up, not for a membership
  application. The real application form is what the follow-up email links to.

  **How it is protected.** The public endpoints live under
  `/api/public/v1/display/{code}/events/{id}/...`. The department is resolved
  from the **room's display code**, never from anything in the request, and the
  event must actually be held in that room. They carry the same defences as the
  public forms API: per-IP rate limiting, a per-event daily ceiling
  (`GUEST_CHECK_IN_DAILY_LIMIT`, default 300 — sized for an open house, not a
  stadium; `0` disables it), and a honeypot field that answers a bot with a
  plausible success rather than an error it can adapt to.

  **Edge cases worth knowing:**
  - **Guests get the organizer's check-in window, minus the early-arrival
    grace.** A member may check in before a flexible window opens because a
    member checking in early is identifiable and correctable. An anonymous early
    write is neither, so for guests the gate stays shut until the window the
    organizer actually chose.
  - **Tapping the QR code twice does not create two rows.** A repeat sign-in is
    matched on email when one was given, and on name when it was not. Name
    matching is the weaker fallback — two different Chris Smiths at one open
    house collapse into a single row — but a duplicate on every double-tap is
    the far more common problem at a kiosk.
  - **A guest pre-registered by staff keeps what staff entered.** A sign-in fills
    the blanks on an existing record rather than overwriting fields somebody
    deliberately typed.
  - **A pipeline failure never costs a guest their attendance.** If the prospect
    cannot be opened, the error is logged, the attendance is still recorded, and
    the confirmation still says they are signed in.
  - **A guest already in the pipeline is reused, not duplicated** — the existing
    active prospect is linked to the event instead.
  - **Purging a prospect does not erase the attendance.**
    `event_external_attendees.prospect_id` is `SET NULL`: who was in the room is
    the event's history, not the prospect's.

**Data**

- `events.allow_guest_check_in`, `events.guest_check_in_creates_prospect` —
  both `NOT NULL DEFAULT 0`.
- `event_external_attendees.prospect_id` → `prospective_members.id`
  (`ON DELETE SET NULL`, nullable, indexed).
- Guest-created rows carry `source = 'kiosk_qr'`, which distinguishes a
  self-recorded kiosk sign-in from one a staff member typed in.
- Prospects opened this way are linked to the event through
  `prospect_event_links`, with `referral_source = "Attended: {event title}"`.

---

### Saving: emptying a field and saving it now actually clears the value (2026-08-09)

**Fixed**

- **A cleared field came back after a reload, with a success toast in between.**
  Both ends of the request dropped the clear, independently:
  - **Backend.** Every update method guarded its writes with
    `if value is not None: setattr(...)`. Update payloads are `exclude_unset`
    dumps, so a null arriving at the service is an _explicit_ null — the user
    emptied the box — and skipping it acknowledged the write with a `200` while
    leaving the old value in the database. The finance endpoints compounded it by
    dumping with `exclude_none`, stripping the nulls a layer earlier.
  - **Frontend.** The `|| undefined` idiom is right on **create**, where it keeps
    `""` away from Pydantic validators, but on **update** it omits the key
    entirely — which reads as "leave this alone". The clear never left the
    browser.

  Three cases are now distinct everywhere: **absent** means leave alone, **null**
  means clear, and a null against a `NOT NULL` column is a `400` rather than a
  silent no-op. An update naming a field the model does not have is reported
  rather than dropped.

  Covers 10 finance and 3 storefront update methods, plus 12 more across member
  leave, membership pipeline, training enhancement, training module config,
  training program and training submission.

- **A requirement switched from hours to shifts went on grading against its old
  hours target.** The requirement forms omitted the targets that no longer
  applied, the service read the omission as "leave alone", and the stale
  `required_hours` stayed in place and kept being evaluated. Every target is now
  sent on every save, as an explicit null where it does not apply. This is a
  behaviour fix, not plumbing.

- **`include_current_month: null` — the "inherit the department default" choice
  on a training requirement — had never once taken effect.** It was being sent
  correctly and dropped on arrival.

- **A pipeline description and an election package's notes and statement could
  not be emptied**, for the same reason.

- **`training_program` carried the tell.** Someone had hit this with the
  freshness window and patched exactly that one field
  (`clearable_fields = {"recency_days"}`), leaving every other nullable column
  silently undroppable. The hand-list is gone.

- **A purchase-request edit failed silently.** It called the service directly
  rather than through the store, so nothing was surfacing its failure.

- **Clearing a member's leave end date now propagates to the linked training
  waiver.** Newly reachable now that the clear itself works: without it, an
  open-ended leave would leave the waiver expiring on a date the leave no longer
  has.

**Developer note**

- `apply_updates` (`backend/app/utils/model_updates.py`) and `blankToNull` /
  `numberOrNull` (`frontend/src/utils/formValues.ts`) are how this is expressed.
  Protected columns — tenancy and identity — are passed as `apply_updates`'
  `skip` set rather than guarded field by field. The election package still
  _merges_ a partial `package_config` rather than replacing it.

---

### Interface: native browser confirms and prompts are gone (2026-08-09)

**Fixed**

- **A browser may suppress `window.prompt` and `window.confirm`, and a
  suppressed dialog is indistinguishable from Cancel.** Chrome suppresses
  repeated dialogs and dialogs inside cross-origin frames; iOS and Firefox offer
  the user a "prevent this page from creating further dialogs" checkbox. Both
  return the same value as pressing Cancel, so the action silently did nothing —
  no error, no clue.

  All 33 `window.confirm` call sites across 23 files, and all four
  `window.prompt` call sites, now use in-app dialogs. Notably:
  - **Voiding a paper-ballot batch** also dropped any reason shorter than three
    characters the same silent way — a secretary who typed "PM" got no batch
    voided and no message.
  - **Issuing a check** against an approved request, **cloning an equipment-check
    template**, and **cancelling a skills test** were the other three.

- **What the dialogs say has changed too.** Buttons name the decision rather than
  reading OK/Cancel — "Keep it" / "Delete", "Stay here" / "Discard changes",
  "Leave it running" / "End session" — and several messages now state the
  consequence a native one-liner had no room for: that deactivating an
  admin-hours category leaves already-logged hours alone, that force-ending a
  session moves the entry to pending review rather than discarding it, that
  leaving a checklist keeps a draft.

**Developer note**

- `useConfirm()` is promise-based and keeps the shape of the call it replaces
  (`if (!(await confirm({ message: 'Delete this?' }))) return;`), which is why
  each conversion is a one-line change. The dialog is rendered **once** by
  `ConfirmProvider` at the app root, above the router so public pages get one
  too — there is nothing for a consumer to render and so nothing to forget.
  Without a provider the hook **throws**: `true` would carry out a deletion
  nobody agreed to and `false` would swallow the action without a word, so a
  wiring mistake fails loudly at the call rather than quietly at the consequence.
  `PromptDialog` (`components/ux`) covers the single-value case, with validation
  shown rather than swallowed and the field reset on each open.

---

### Background saves: a failure is shown instead of written to the console

(2026-08-09)

**Fixed**

- **The scheduling notification presets slid back and said nothing.** The preset
  toggles caught their failure into `console.warn` while the four settings
  handlers beside them all raised a toast. Because the switch only moves when the
  save succeeds, a failed save was indistinguishable from a dead control.
  Failures now toast; success stays quiet, because the switch moving is the
  confirmation.
- **A failed _load_ of those rules was worse than confusing.** With no rules
  loaded every switch read as off, so an already-enabled notification looked
  disabled — and toggling it posted a **second rule with the same name** instead
  of flipping the one that existed. The panel now says the settings could not be
  loaded and hides the switches rather than showing six lies.
- **The preset toggles had no accessible name** — a bare button wrapping a knob.
  They are now labelled switches.
- **`useAutoSave` swallowed its failure into `console.error`.** A background save
  has no promise to await and no click to answer, so the error had nowhere else
  to go: an examiner kept scoring into a form they believed was saving. The hook
  now returns `status`, `error`, `lastSavedAt` and `failureCount`. Retry
  behaviour is unchanged — a failed snapshot is not marked saved, so the next
  tick tries again and nothing is lost while the tab is open.

---

### Skills testing: the examiner screen is safe to use in the field (2026-08-09)

**Fixed**

- **A stopwatch reading was lost by moving to the next step.** The time was only
  recorded when **Stop** was pressed, and the section unmounts on Prev/Next — so
  timing an evolution and moving on lost the reading entirely, on the step whose
  time limit _is_ the pass/fail criterion. The value is now committed when the
  step is torn down, and starting a stopwatch starts the test clock.
- **Back from the live scoring screen always went to Training Admin**, an
  officer-only page, so a member examiner hit a permission wall leaving their own
  evaluation. Both **Back** and the footer **Back to Tests** now go to the
  member-facing list.
- **An unscored step displayed a red "0/N"**, which reads as a fail the examiner
  never recorded. It now reads "—/N" in neutral type until a score exists.
- **Section counters included statement criteria**, which mark themselves — so a
  section showed progress before it was touched and could read "3 / 3" with a
  real step still blank. Statements are now excluded from every count, and they
  no longer rewrite their mark (and trigger an autosave) on every revisit.
- **A checklist step could not record "the candidate did none of it."** It only
  counted as scored once a box was ticked, so the case an examiner most needs to
  record was indistinguishable from a step they forgot. There is now an explicit
  **Candidate did none of these**, and a **Clear this step** to undo. An empty
  checklist no longer passes itself.
- **A mis-tap could only be corrected by recording the opposite verdict.** A
  pass, a fail, or a score can now be cleared by tapping it again — a mis-tapped
  `0` and a deliberate `0` score the same but mean very different things on a
  critical step.
- **A cancelled test rendered as a live evaluation** — editable criteria, a
  running clock, and a **Finish** button the API answers with a `400`. It now
  renders read-only and states that nothing was decided rather than showing a
  pass or a fail. The officer panel no longer tells an officer that an abandoned
  test "counts toward the candidate's record".
- **Autosave is now genuinely suspended once a concurrent edit is detected**, as
  the conflict banner already claimed. Every retry could only `409` again.
- **Resuming an interrupted evaluation opened at section 1**, so the examiner had
  to hunt for the step they had reached. It now opens at the first section with
  blank steps.

**Changed**

- **10px progress dots** — unhittable with a glove, and silent about what was
  left — are replaced by **44px section chips** that show their own state, plus a
  running "scored / total" count and a save-status line.
- **The candidate's name is on the scoring screen.** Nothing there previously
  confirmed the examiner had the right person open.
- **The primary bottom-bar button is Next**, not Finish. Previously the biggest,
  reddest button on every section ended the evaluation while moving on was a
  small grey one.
- **Finishing with blanks left** opens a dialog naming the count and stating that
  an unscored critical step scores the same as a fail — which is what the backend
  does. The review screen repeats it with a button back to the first unfinished
  section.
- **"Add note" gets a 44px target, a label and a placeholder.** It was a 12px
  text link, for the one control that explains a mark to whoever reads the
  scorecard later, on a screen used outdoors in gloves.
- An unfinished test in the officer's Test Records tab now says **Tap to resume**
  and opens on the scoring screen; finished tests still open on their scorecard.
- Publishing and archiving a template say what actually happens — that a
  published template can be started from and that each test keeps its own copy,
  and that archiving hides it from new tests without deleting anything.
- Wording throughout is "scored" rather than "evaluated" / "criteria".
- A template with no steps explains itself instead of rendering blank under a
  live timer.
- `SkillTestResponse` now carries `template_require_all_critical`, so the
  examiner screen can state the critical-step rule accurately.

---

### Training: checklist requirements are signed off step by step, and an

enrollment can finally expire (2026-08-09)

**Fixed**

- **Checklists were invisible to everyone.** A checklist requirement stores the
  exact list of what a member has to do — the built-in sample templates define
  eight of them — and nothing rendered it. The recruit saw "Station Orientation
  Checklist · Work through the checklist with your officer" and had to guess what
  was on it; the officer signing it off saw "8 items" and not the items.
- **It was also all-or-nothing** — one tick for the whole thing, so a member
  could work through six of eight steps and watch their progress bar sit at zero.
  Steps are now signed off one at a time, both parties can read them, and the
  percentage is ticked/total so the requirement fills up as the work happens.
- **A step can be kept off the member's view** — background check returned,
  references called — with the eye toggle in the editor. Hidden steps still count
  toward the denominator, because excluding them would let a requirement read
  100% while the background check was outstanding. The member is told "+2 more
  steps your officer records" rather than shown a total that does not match their
  screen.
- **Nothing ever expired.** `EnrollmentStatus.EXPIRED` was read — recert treats it
  as a renewable state — but never written. A member past
  `target_completion_date` stayed ACTIVE indefinitely: the sweep warned them at
  30, 14 and 7 days, the date arrived, and then nothing. Their page read "42 days
  overdue" against a status claiming otherwise, and no officer view could filter
  for it.

  Overdue enrollments now expire **on read** (so an enrollment nobody has swept
  reports its true state the moment someone opens it) and in a **daily** sweep.
  Both the member and the training officers are told.

- **EXPIRED needed a way out**, or it would just be a new dead end. Officers get a
  **reopen** action with an optional new deadline. Progress rows are untouched —
  the member keeps everything they finished — and the rollup runs on reopen, so
  someone who quietly completed the work while expired is marked complete rather
  than waiting for the next edit.

**Changed**

- **Expiry is its own daily task** (`enrollment_expiry`, 05:15, alongside the
  existing daily `recert_resets` at 05:00). It had been folded into the weekly
  `enrollment_deadline_warnings`, which left up to six days where an enrollment
  nobody had opened still read "active, N days overdue" — the exact state the
  work was meant to eliminate — and put a member-visible state change on the
  cadence of a reminder. The warning sweep goes back to sending warnings.

**Data**

- `checklist_items` held bare strings; it now holds
  `{id, text, member_visible}`. The `id` is what makes a tick survive a step
  being reordered or a neighbour reworded. **Legacy string rows normalize on
  read** rather than through a migration — it costs no lock on a JSON column, and
  every write goes through one helper (`backend/app/utils/checklist.py`), so the
  rest of the codebase sees a single shape.

---

### Training: three pipeline settings that were stored but never acted on

(2026-08-09)

**Fixed**

- **Phase prerequisites (`prerequisite_phase_ids`) were a 500, not a feature.**
  The column is JSON but the schema parsed the ids as UUIDs, so `json.dumps`
  raised `TypeError` at commit — setting the field at all failed, which is why
  nothing downstream had ever seen a value.

  Ids are coerced to strings on every write, and the field is now validated
  (same-program, non-self, acyclic) and **enforced** on both manual and automatic
  advancement, with force still overriding. Export/import carries them by phase
  number so they survive the trip into another department.

  > **Phase order and phase prerequisites answer different questions.**
  > `phase_number` is the order phases are walked in; `prerequisite_phase_ids` is
  > what must be finished first. They diverge as soon as a program has an
  > optional or parallel track, or when someone was force-advanced past a phase.

  Edge cases: deleting a phase strips it from the siblings that referenced it,
  and a prerequisite pointing at a phase that no longer exists is **ignored**
  rather than stranding the member.

- **Requirement prerequisites (`is_prerequisite`) gated nothing, and could not be
  set in the UI at all.** A link flagged as a prerequisite now gates the other
  requirements in its scope — its phase, or the program-level pool. Officer
  sign-off on a gated requirement is refused with the blocker named, and the
  member's page greys the step out with the same wording instead of hiding it.
  The pipeline detail page now toggles the flag per requirement.

  Edge cases: a requirement linked into several scopes is locked only when
  **every** one of its links is locked. Credit that flows in automatically from
  logged training is deliberately **not** blocked — the hours happened, and
  discarding them would be worse than crediting them early.

- **A department that configured a 90-day deadline warning got one at 30.** The
  sweep used a hardcoded `[30, 14, 7]` and read neither `reminder_conditions` nor
  `warning_days_before`. Both are honoured per program now:
  `days_before_deadline` sets the schedule (defaulting to `warning_days_before`
  plus 14- and 7-day follow-ups), and `send_if_below_percentage` suppresses the
  warning for members already on track. `reminder_conditions` was also absent
  from the create/update schema, so it could only be set by import — it is
  accepted on both now, and editable in the pipeline editor.

  `milestone_threshold` is deliberately **not** implemented: `ProgramMilestone`
  rows already fire progress-based notifications, and two mechanisms for one job
  is how the two drift apart. Old values validate and are ignored.

- **`target_roles` had the same UUID-into-a-JSON-column defect** and is fixed with
  it.

---

### Training: the pipeline progress rollup never ran (2026-08-09)

**Fixed**

- **Every real progress update, phase advance, requirement add/remove and recert
  reset `500`'d after writing.** `_recalculate_enrollment_progress` and
  `_is_phase_complete` both issued
  `select(RequirementProgress).join(ProgramRequirement)`. There is no foreign key
  between those tables, so SQLAlchemy cannot infer an `ON` clause and raises
  `InvalidRequestError` — at _compile_ time, which is why the mocked-session
  tests passed while production failed. Both now resolve the required requirement
  ids first and filter progress by that set, scoped to the program so a
  requirement shared with another program cannot skew the average.

  The fake sessions in five test modules now compile each statement, so this
  class of bug fails the suite instead of production.

- **A requirement linked to two phases produced two progress rows per
  enrollment** (deduped at enroll and on backfill, and defended against in the
  average), and **unlinking one of those two links deleted the progress for
  both**.
- **Milestones did nothing.** They were created, stored, duplicated and exported,
  but nothing ever compared progress to a threshold — `notification_message` was
  dead code. Crossing a threshold now notifies the member once, on the band
  `(previous, new]`.
- **Every training notification linked to a 404.** All eight `action_url`s pointed
  at `/training/programs/{id}/progress` or `.../enrollments`; neither route
  exists, so the router's catch-all bounced the member to the dashboard. They now
  point at `/training/my-progress/{enrollment}` and `?tab=enrollments`.
- **"3/5 complete · 100%".** The progress endpoint counted only the literal
  `completed` status (not verified or waived) over _all_ requirements (including
  optional ones), while the percentage averaged the required ones. Both now use
  the percentage's definition.
- **A one-list program could not be built.** Requirements hung only off phases in
  the wizard, the build payload and the detail page, so choosing Flexible left an
  officer with no way to add a single requirement — and program-level
  requirements, which import/duplicate can create, were invisible. All three now
  carry them.
- The wizard now **names the phase and the field** for an unnamed phase, an
  unnamed requirement, or an hours/shifts/calls target left blank, each of which
  the server had been rejecting with an unattributable `422`.

**Changed**

- **"Sequential" is retired from the structure pickers.** Nothing ever enforced an
  order, so it behaved exactly like Flexible while saying otherwise. The two
  remaining choices are named for what they do, and picking a single list skips
  the Phases step rather than showing a step to leave empty.
- **Enroll is behind `training.manage`**, like the other officer actions.
- `knowledge_test` has a badge; "Shift Hours" no longer labels a shift count.

---

### Scheduling: a tab click opens the tab, and settings match the rest of the app

(2026-08-09)

**Fixed**

- **Clicking any tab on `/scheduling` snapped straight back to Schedule**, so
  Equipment Checks — and every other tab — could only be reached by deep link.
  The tab button set React state but never the URL; the effect that syncs state
  from `?tab=` listed `activeTab` in its dependencies, so the click's own state
  change re-ran it, found no `?tab=`, read the default `schedule`, and reset.
  Tab clicks now mirror the choice into `?tab=` (removing it for Schedule, so the
  default URL stays clean), and the sync effect ignores a missing param instead of
  treating it as a request to reset.

  > The existing test asserted only that the tab's **label** was still on screen,
  > which is true either way. The new tests assert on the tab's content and on
  > the URL.

- **Scheduling settings offered a Save button on four sections it never saved.**
  The footer was shown on all seven while only writing three, so Notifications and
  Shift Reports flashed "Settings saved" without touching their values. It now
  appears only on the sections it writes (General, Apparatus, Equipment); every
  other section owns its own save control.
- **A scheduling settings section could not be linked to, refreshed into, or
  reached with the back button.** The page read `?tab=` on mount but never wrote
  it. It now writes it, as the other settings screens do.
- **A deep link to Platoons no longer dumps you on a blank section** when the
  department has that feature switched off — it falls back to General by
  derivation rather than by resetting state, so the link still lands once the
  feature flag loads.

**Changed**

- **All three settings screens now share one layout.** Organization Settings and
  Event Settings already shared a design — section sidebar with descriptions on
  desktop, scrollable tab strip on phones, content in a surface card — but by
  copy-paste, in two places. Scheduling settings used a third design: a
  pill/segmented tab bar in an unlabelled div, content capped at `max-w-3xl`
  inside a `max-w-7xl` shell, under two stacked titles ("Scheduling Settings"
  from the page, then "Shift Settings" from the panel).

  The shared shell is extracted as `SettingsLayout`. The two existing screens are
  a like-for-like swap; scheduling gains the sidebar, labelled nav landmarks,
  `aria-current` on the active section, and a single header. Its seven sections
  are **General, Apparatus, Platoons, Eligibility, Notifications, Equipment,
  Shift Reports**.

---

### Interface: 283 hand-rolled form controls now use the shared utilities

(2026-08-10)

**Changed**

- **169 distinct class strings for what is one control.** 283 inputs, selects and
  checkboxes across 103 files spelled out their own box instead of using
  `form-input`, `form-input-sm` or `form-checkbox` — already the app's standard at
  490 other call sites. These were the holdouts, and they had drifted apart.

  Normalised rather than preserved: the dominant hand-rolled box was
  `px-3 py-2 rounded-md`, so ~175 controls move to the utility's
  `px-4 py-2 rounded-lg`, gain the **44px minimum height below `md`** for touch,
  and pick up the themed focus ring in place of a raw palette colour. Checkboxes
  normalise from `h-3`/`h-3.5`/`h-4`/`h-5` to `h-4 w-4`, and from
  red/blue to the utility's checked colour. 23 local
  `inputClass`/`labelClass`/`checkboxClass` constants now point at the utilities.

  The three scheduling modals (`PatternFormModal`, `TemplateFormModal`,
  `GenerateShiftsModal`) went the same way — 19 fields and 24 labels — picking up
  `px-4` over `px-3`, a 2px focus ring over 1px, the placeholder colour and the
  focus transition.

  **Deliberately untouched:** template-literal classNames, which carry the
  conditional validation borders this sweep must not flatten; one radio, which
  `form-checkbox` would square off; two `px-1.5 py-0.5` micro-controls in a dense
  row, the only two at that density in the app; and 68 non-control elements that
  use the input background as a surface. Widths, icon padding, alignment,
  responsive sizes, disabled states and shadows are kept at the call site — their
  standalone rules are emitted after the composite utility, so they still win.

  > **One visible difference:** the ~50 inputs that carried `block w-full` are now
  > inline-block via the utility's `w-full`. No existing `form-input` call site
  > pairs with `block`, so this matches all 490 of them.

- **Two new utilities, three adopted.** `settings-nav-item` / `-active` (the
  settings section buttons, inlined at the call site when `SettingsLayout` was
  extracted) and `toggle-track` / `-sm` / `-md` join the stylesheet:
  `styles/index.css` defined `toggle-knob` but no matching track, so all 15
  switches were hand-assembled and had drifted into four class strings — some
  carrying the disabled treatment, some not, some missing the focus classes the
  app's other controls state. `ShiftSettingsPanel` and `ShiftReportsSettingsPanel`
  also move to `form-checkbox` / `form-input-sm`, replacing re-typed box classes
  whose `focus:ring-violet-500` bypassed the theme focus-ring token.

  Behaviour is unchanged except where the drift **was** the inconsistency:
  switches that lacked the disabled treatment now have it.

---

### Migrations: two migrations claimed the same revision (2026-08-09)

**Fixed**

- **The training pipeline's `owns_requirement` migration and the
  shift-equipment-check FK drop both claimed `20260808_0002` off
  `20260808_0001`**, leaving Alembic with two heads and a startup that stales one
  of them at random. The FK drop is renumbered to `20260808_0003`; the head is
  linear again. `docs/KNOWN_LIMITATIONS.md` records how to repair a database that
  applied one head and skipped the other.
- **The medical-screening PHI migration was re-pointed onto main's head** after
  the branch rebase renumbered around it.

---

### Demo seeder: every member was flagged with an unrecognised rank (2026-08-09)

**Fixed (tooling)**

- **`User.rank` holds a rank _code_, not a display name.** The screenshot
  seeder wrote labels ("Lieutenant", "Firefighter/EMT", "Paramedic"), so
  Settings → Ranks — which validates every active member against the
  configured codes — bannered the demo department with "21 active members with
  unrecognised ranks", listing its own seed data. Members now seed with the
  eight codes an organization is created with, the three recruits start at
  `emt` so the seeded promotions remain real rank changes, and the recruits the
  training programs enrol are named explicitly rather than derived from a
  "probationary" rank that no organization has.
- **The seeder raced the admin password-reset limiter instead of pacing under
  it.** That route allows 5 requests per 5 minutes and answers the sixth with a
  **15-minute lockout**, so a run needing several member sessions spent over an
  hour asleep in backoff. Resets are now spaced to stay below the ceiling. The
  429 handling stays for the case where another client shares the IP.
- **`dev_env.sh` hardcoded `backend/.venv/bin/python`**, which is exactly what a
  container reclaim removes — the situation the script exists for. It now
  prefers the virtualenv where one exists and falls back to the system
  interpreter, and imports the app before backgrounding it so a missing
  dependency is reported immediately instead of surfacing as a seven-minute
  readiness timeout.

**Fixed (documentation)**

- **A "Registry Code" field on a training-category edit form.** The column and
  its API exist; the screen does not — no page in the application creates or
  edits training categories. The guide now describes how registry codes
  actually arrive: attached to requirements imported from a standards registry.
- **Scheduling settings, four corrections.** Shift Reports is a section
  navigator of eight sections, not a page of three cards, and the section is
  labelled **Form Sections**. Apparatus skills are chosen from a pill selector,
  one type at a time, not an accordion. The rating scale is a two-button
  toggle whose per-level labels appear only under **Labeled Bubbles**. The
  notification panels have no CC-address field.
- **Two different eligibility screens were conflated.** Per-rank shift-position
  eligibility is set on **Settings → Ranks**; **Scheduling → Settings →
  Eligibility** governs which _membership types_ may self-sign-up. The guide
  described the first and pointed at the second.
- **Manual entry settings look empty when the feature is off** — everything
  below the enable checkbox is conditional on it. Now stated, so a
  single-checkbox panel is not read as a broken page.

---

### Documentation: the prospective-members bulk actions are pictured, and the list of them corrected (2026-08-09)

**Fixed (documentation)**

- **The bulk-actions list named a `Delete` button that does not exist.**
  Applicants are withdrawn, rejected, or purged by the inactivity policy —
  there is no bulk delete anywhere in the module. The list also omitted **Print
  Badges**, and did not say that **Reactivate** appears on the Inactive
  Applications tab rather than alongside the others.

**Known cosmetic issue, now documented**

- **Table view shows two selection bars.** The page renders one (Print Badges /
  Advance All / Reject All) and the table component renders its own (Advance /
  Hold / Reject), so selecting an applicant produces two bars reading
  "_N_ selected". Both work. The guide's screenshot shows them as they are
  rather than cropping to one, since that is what a reader will see.

---

### Prospective members: adding an applicant who is already on file returned a server error (2026-08-09)

**Fixed**

- **`POST /prospective-members/prospects` answered `500` for a duplicate
  email.** Creating an applicant whose address is already on file is not meant
  to fail: the module notifies the applicant, logs the collision, and returns
  the **existing** record so the coordinator can see who it is — which is what
  the guide describes and what the duplicate-detection warning in the UI is
  built on.

  The lookup that finds the existing applicant did not eager-load
  `current_step` or `step_progress`, and the prospect response reads both — so
  serializing the reply triggered a lazy load from the async response path,
  which raises `MissingGreenlet` rather than merely being slow. The feature
  worked right up to the moment it tried to answer.

  It now loads the same relationships the ordinary fetch does. This is the same
  failure mode as the kanban endpoint's, in the one path that had been missed.

**Added**

- **`seed_demo_data.py --bulk-prospects [N]`** pads the demo pipeline out past
  the kanban board's 200-card ceiling (247 by default) so the truncation notice
  can be screenshotted. Opt-in: a few hundred filler applicants would otherwise
  bury the named ones the other prospective-member screenshots are composed
  around. It tops up rather than duplicating on a re-run, and advances a slice
  of the filler so the later columns are not empty.

---

### Skills testing: the validation queue was empty for the officers it exists for (2026-08-09)

**Fixed**

- **`GET /tests?pending_validation=true` returned nothing while the dashboard
  said results were waiting.** Skills testing has two checks for "is this user
  an officer": one gates what they may _do_, the other what they may _see_. The
  write-side check asks the real permission resolver; the read-side one only
  recognised a legacy `user.role` string or a literal `user.permissions` list —
  and a training officer normally holds `training.manage` through a **position**,
  which neither of those sees.

  So the same officer read as an officer to `GET /summary`, which counted the
  results awaiting validation, and as an ordinary member to `GET /tests`, which
  filtered every one of them away as somebody else's test. The **Needs
  Validation** card showed a number, the queue behind it was empty, and the
  officer had no route to the results it was counting. The org-wide test list
  was truncated to the officer's own tests for the same reason.

  Both checks now resolve the real permission. The older role-name heuristics
  are kept — this widened the check rather than swapping it — and a test pins
  the two to agree, since their disagreeing is the whole defect.

> **Found by building the demo data for the documentation screenshots**, which
> is the first time anything exercised the queue as a real officer rather than
> as a fixture holding a literal permission list.

---

### Fixed

- **Medical screening: saving a record with an unrecognized screening type or
  status now shows a clear validation error instead of failing with a server
  error (2026-08-09).** The medical-screening create/update forms already send
  valid values, so this only affects malformed API requests, but those now return
  a 422 with the list of allowed values rather than a 500.

- **Meetings & minutes: saving a meeting, minutes, or template with an
  unrecognized meeting type now returns a clear validation error instead of a
  server error (2026-08-09).** Same class as the medical-screening fix; the forms
  already send valid types, so only malformed API requests are affected. Valid
  minutes types (including executive-session minutes) are unchanged.

- **Meetings: updating a meeting's or an action item's status with an
  unrecognized value now returns a clear validation error instead of a server
  error (or silently storing a blank status) (2026-08-09).** Same class as the
  fixes above; the meeting screens already send valid statuses, so only malformed
  API requests are affected.

- **Membership pipeline: saving a pipeline step or prospect status with an
  unrecognized type/status now returns a clear validation error instead of a
  server error (2026-08-09).** Same class as the fixes above — the pipeline
  builder and applicant forms already send valid values, so only malformed API
  requests are affected.

- **Notification rules: saving a rule with an unrecognized trigger, category, or
  channel now returns a clear validation error instead of a server error
  (2026-08-09).** Same class as the fixes above; the rule editor already sends
  valid values, so only malformed API requests are affected.

- **Forms: saving a form, field, or integration with an unrecognized category,
  status, field type, or target now returns a clear validation error instead of a
  server error (2026-08-09).** Same class as the fixes above; the form builder
  already sends valid values, so only malformed API requests are affected.

- **Events: saving an event, template, or RSVP with an unrecognized event type,
  check-in window, recurrence pattern, or RSVP status now returns a clear
  validation error instead of a server error (2026-08-09).** Same class as the
  fixes above; the event forms already send valid values, so only malformed API
  requests are affected.

- **Finance: saving an approval-chain step, purchase-request priority, dues
  frequency, expense type, or export mapping with an unrecognized value now returns
  a clear validation error instead of a server error (2026-08-09).** Same class as
  the fixes above — input validation only; amounts and money handling are unchanged.
  The finance forms already send valid values, so only malformed API requests are
  affected.

### Security: event-request scheduling can't reference another department's location (2026-08-09)

**Security**

- When an outreach event request is scheduled, the location assigned to it is now
  verified to belong to your own department before it is saved, and the location
  name shown on the request is looked up within your department only. Previously a
  hand-crafted API request could attach another department's location id (when no
  calendar event was created), and its name would then appear on the request. No
  change for normal use — the scheduling screen only offers your own department's
  locations.

### Security: external-training credentials fail closed on a decryption error (2026-08-09)

**Security**

- API credentials for an external training provider (e.g. Vector Solutions) are
  stored encrypted and decrypted just before the platform contacts the provider.
  If decryption now fails because the stored value has been tampered with or the
  encryption key is wrong, the sync is stopped instead of sending the unverified
  value to the provider. Legitimate credentials, and older values saved before
  encryption was added, are unaffected.

### Security: membership-pipeline references are scoped to your department (2026-08-09)

**Security**

- Setting up a membership pipeline now verifies that the department stays inside
  its own data. A pipeline step's email template, and the step a prospect's
  uploaded document is filed under, are checked to belong to your department (and
  the prospect's own pipeline) before they are saved — previously a hand-crafted
  API request could attach another department's template or an unrelated step id.
  No change for normal use; the pipeline builder already offers only your own
  department's templates and steps. Saving a pipeline or step with an invalid
  reference now returns a clear validation error instead of a server error.

### Security: Web Push can no longer be aimed at an internal server (2026-08-09)

**Security**

- Browser push notifications are delivered by the server POSTing to a URL the
  browser supplied when the device subscribed. That URL was screened at
  subscribe time, but a public address could later be re-pointed at an internal
  host (a DNS-rebinding trick) to make the server issue a request to an internal
  target. The server now re-checks the destination immediately before each push
  in production and staging, and skips any that resolves to a private/internal
  address. No effect on real push delivery; this only closes an internal-request
  vector.

### Security: inventory records can no longer reference another department's data (2026-08-09)

**Security**

- Creating or editing inventory records — items, categories, maintenance records,
  reorder and return requests, write-offs, size-variant batches, and equipment
  kits — accepts several optional references (a parent category, a location, a
  storage area, a variant group, an assigned member, the person who performed
  maintenance, the assignment/issuance/checkout a return is against, etc.). These
  references are now verified to belong to your own department before they are
  saved. Previously a hand-crafted API request could attach the id of another
  department's record; that record was never exposed in a response, but the stray
  reference is now rejected outright with a clear error. No change for normal use —
  the app already offers only your own department's records in these pickers.

### Security: medical-screening health information is now encrypted at rest (2026-08-09)

**Security**

- Medical screening records store protected health information — the examining
  provider's name, the result summary, structured results (scores/measurements),
  and reviewer notes. These fields were previously held in the database as plain
  text; they are now encrypted at rest with AES-256-GCM, matching how shift-report
  narratives are already protected. Decryption is transparent, so the screening
  screens behave exactly as before — nothing changes for users, but a database or
  backup file no longer exposes the underlying health details.
- Applied by a database migration that converts existing records in place. As with
  any encryption-at-rest change, take a database backup before upgrading; the
  migration is safe to re-run.

### Money: you can no longer approve/record and pay out the same item yourself (2026-08-09)

**Security**

- **Separation of duties now covers the payout step.** A finance manager can no
  longer mark their own purchase request or expense report paid, issue a check for
  their own request, or waive their own dues; a store manager can no longer mark
  their own order paid, waive its balance, or refund it. The action is refused with
  a message asking for a second authorized person — matching how approvals already
  worked. Automatic payment reconciliation (from the payment provider) is unaffected.

- **Self-reported training that earns a certification can no longer auto-approve.**
  A member submitting their own training toward a certification or a tracked
  requirement (a certification course, a submission carrying a certification
  number/expiration, or one linked to a training category) is now always routed to
  an officer for review, even where the department had auto-approve turned on.
  Auto-approve still applies to plain logged hours and skills practice, so nobody
  can grant themselves a credential without a second person signing off.

- **Emailing a compliance report to someone outside the department is now
  recorded.** You can still send reports to any address (an outside auditor, a
  state office), but each send to a recipient who isn't a member of your
  organization is written to the audit log — who sent it, when, and to which
  external addresses — so there's a trail whenever member/compliance data leaves
  the department. Sending to fellow members is unaffected and creates no such entry.

- **Reading personal data now needs the matching permission, not just report
  access.** Three places where sensitive records sat behind a broad grant are
  tightened: the member-roster and applicant-pipeline reports now require member /
  prospective-member viewing access on top of report access (aggregate reports are
  unchanged, and reports you can't run no longer appear in the list); expense-report
  reimbursements are now visible only to their submitter unless you're a finance
  manager; and an integration's configuration now requires integrations-admin access
  to view. Features that only need to know whether an integration is _connected_
  (such as meeting setup) keep working through a new status-only view that carries no
  configuration.

### Dashboard: action items are now shown only to members allowed to see them (2026-08-08)

**Security**

- **The dashboard's combined action-items list didn't check permissions**, so any
  signed-in member could see the descriptions of meeting and minutes action items —
  including items tied to executive-session minutes (disciplinary or legal matters).
  Each half of the list is now gated the same way its own module is: meeting items
  require meeting or minutes viewing access, and minutes items require minutes
  viewing access.

### Kiosk: check-in no longer shows as active before the window actually opens (2026-08-09)

**Fixed**

- **A location wall-display could show an event's check-in as "active" (with a
  scannable QR) up to an hour before check-in actually opened**, and the scan would
  then be rejected. The kiosk now shows check-in as active only during each event's
  real check-in window (which varies by event).

### Property return: the total value owed is now calculated precisely (2026-08-08)

**Fixed**

- **The "total assessed value" on a member's property-return letter and overdue
  reminder was summed using floating-point math**, which can drift by fractions of a
  cent. Because that figure is a charge a departing member can be billed for, it is
  now computed with exact decimal math (matching how the clearance summary already
  worked).

### Scheduled jobs: one department's error no longer stops the rest (2026-08-08)

**Fixed**

- **Several nightly jobs (shift auto-checkout, compliance reports, officer-directory
  refresh, certification alerts) processed every department in one shared database
  transaction.** If one department hit an error partway through, it could cause the
  remaining departments to fail too — and shift auto-checkout could even discard the
  work already done for earlier departments. Each department's work is now saved and
  isolated, so one failure no longer cascades.

### Emails: department names and member names with an apostrophe or "&" render correctly (2026-08-08)

**Fixed**

- **On the built-in fallback email layout, a subject line or plain-text body could
  show a name like "O'Brien" as "O&#x27;Brien" or "Fire & Rescue" as "Fire &amp;
  Rescue."** The fallback path now matches the main templates, which already rendered
  these correctly.

### Storefront: a payment in the wrong currency is no longer auto-applied (2026-08-08)

**Fixed**

- **A PayPal payment made in a different currency could be automatically matched to
  an order** when its number happened to equal the order's balance — for example a
  50 CAD payment settling a $50 order, recording the wrong amount collected. Such
  payments are now held for a person to review instead of being applied
  automatically; same-currency payments are unaffected.

### Security: sensitive list data is no longer briefly cached in the browser (2026-08-08)

**Security**

- **Several sensitive list views were being held in the app's short-lived in-memory
  cache** — the member roster, private messages, the document list, integration
  settings, error logs, and your notifications. Because of how the cache exclusions
  were matched, the top-level lists slipped through even though their detail pages
  were correctly excluded. All are now excluded (as are the meeting list and event
  requests, which carry attendee/contact details), so this data is always fetched
  fresh and never cached.

### Onboarding: completed setup can no longer be replayed to add stations or apparatus (2026-08-08)

**Security**

- **After setup was finished, a still-valid setup session could still be used to add
  stations or apparatus** to the organization, skipping the normal permission
  checks. Those two setup steps now refuse to run once onboarding is complete, like
  the other setup steps already did.

### Compliance & skills: no self-scoring on evaluations; reports count risk correctly (2026-08-08)

**Fixed**

- **A member could score and complete their own official skills evaluation.** The
  rule that an examiner can't test themselves was enforced when a test was created
  but not when it was scored — so an officer named as the candidate on their own
  test could enter their own results and mark it complete. Scoring and completing a
  test now blocks the candidate from doing it to their own official evaluation
  (practice drills are unaffected).
- **The annual compliance report and its email always showed 0 at-risk and 0
  non-compliant members**, even when members were behind. The report now reports the
  correct counts.

### Scheduling: looking up an apparatus's active shift no longer errors (2026-08-08)

**Fixed**

- **Checking the active/next shift for an apparatus returned a server error**
  whenever that apparatus actually had a shift. The lookup now returns the shift
  details as intended.

### Members: setting a rank can no longer grant permissions beyond your own (2026-08-08)

**Security**

- **A member's rank grants permissions, but assigning a rank wasn't held to the
  same limit as assigning a role.** Anyone allowed to edit ranks (for example, a
  secretary with member-management access) could set a member — or themselves — to
  a chief-level rank and quietly gain administrator powers like managing settings
  and security. Rank assignment is now capped the same way role assignment is: you
  can only assign a rank whose permissions are within your own, and a blocked
  attempt is logged as a security alert.

### Training: closed cross-department leaks in category reports and exports (2026-08-08)

**Security**

- **A training category from another department could show up in a member's
  category-hours report.** The report now only resolves categories belonging to
  your own department, and a training record can no longer be saved with a category
  that isn't yours.
- **An individual training PDF export could show another department's member name
  in its title.** The export now scopes the member lookup to your department.

### Events: ending an event now works, and drafts stay off public calendars (2026-08-08)

**Fixed**

- **Ending an in-progress event early returned a server error.** The event was
  actually ended (members checked out, end time recorded), but the response failed
  with a 500, making it look like the action didn't work. Ending an event now
  completes cleanly.
- **Unpublished draft events could appear on the public event calendar and the
  public portal.** Draft events (community education, fundraisers, etc.) are meant
  to stay hidden until published — they are now excluded from both public feeds.
- **Recurring events now reject an invalid meeting location** instead of silently
  saving the series with a location that doesn't belong to your department.

### Admin hours: bulk approval can no longer be used to approve your own hours (2026-08-08)

**Fixed**

- **The "approve selected" action skipped the no-self-approval rule.** Approving a
  single pending entry already blocked an officer from approving their own logged
  hours (someone else has to sign off). The bulk "approve selected" action didn't
  apply that rule, so an officer could approve their own hours in a batch. Bulk
  approval now leaves your own entries pending for another approver and only
  approves other members' entries.

### Grants: awarding a grant or completing a compliance task no longer errors (2026-08-08)

**Fixed**

- **Marking a grant application "awarded" could fail with a server error** when the
  reporting frequency was set in the same save — the automatic performance-report
  tasks are generated at that moment and hit the error before saving cleanly. This
  now completes and generates the reports as intended.
- **Completing a grant compliance task could fail with a server error** when the
  task type was changed in the same save. Completing a task now works reliably.

### Prospective members: the applicant detail view now shows the pipeline name (2026-08-06)

**Fixed**

- **An applicant's detail/interview view never showed which pipeline they're in.**
  The "Pipeline:" label is meant to show the applicant's pipeline name, but it was
  only filled in on the applicant _list_ — on the detail and interview views it was
  blank, so the line didn't appear. It now shows on those views too.

### Notifications: the notification log list no longer errors when a rule-triggered entry is present (2026-08-06)

**Fixed**

- **The notification history could fail to load once automated rules had fired.**
  A log entry created by a notification rule could cause the notifications log
  (and the personal notifications list) to error out while loading. Those lists
  now load reliably regardless of how each entry was generated.

### Meetings: the meetings list now shows who created each meeting (2026-08-06)

**Fixed**

- **The meetings list never displayed the "Created by" name.** The list is meant
  to show who created each meeting, but the creator's name was never filled in, so
  that line stayed blank. It now shows the creator.

### Documents: the "Uploaded by" attribution now shows on the documents list (2026-08-06)

**Fixed**

- **Documents never displayed who uploaded them.** The documents list is designed
  to show "Uploaded by <name>" under each file, but the uploader's name was never
  filled in, so that line stayed blank. The uploader (and the document's folder
  name) are now populated.

### Minutes: executive-session minutes can no longer be published as a shared document (2026-08-06)

**Fixed**

- **Publishing an executive-session set of minutes to the Meeting Minutes
  document folder is now blocked.** Executive-session minutes are visible only to
  members who can manage minutes; publishing them created a copy in the shared
  documents area that anyone with document access could read, sidestepping that
  restriction. The publish action now returns an error for executive-session
  minutes. (Regular business/other minutes publish exactly as before.)

### Wiki: 28 pages existed but were never published (2026-08-08)

**Fixed**

- **The wiki published 11 pages out of 41, and its own sidebar linked to 28 of
  the missing ones.** `setup-wiki.sh` copied a hand-maintained array of
  filenames. Nobody updated it when a page was added, so Module-Training,
  API-Reference, Database-Schema, every `Security-*` and `Integration-*` page
  and twenty-three others sat in the repository, were linked from the published
  `_Sidebar.md`, and **404'd for anyone who clicked them**. Editing one of those
  pages changed nothing a reader could see.

  This is the same failure the generated Troubleshooting page was introduced to
  stop, one level up: a second place that has to be updated by hand will
  eventually disagree with the first. The publish list is now a **glob over
  `wiki/*.md`**, which cannot fall behind. `README.md` (maintainer instructions
  for the directory, not a page) and `Troubleshooting.md` (generated at publish
  time) are excluded, and a hand-created `wiki/Troubleshooting.md` now fails the
  script rather than being silently overwritten.

**Added**

- **`scripts/check_docs_links.py`**, run in CI as **Docs Link Check**. It
  verifies in-page anchors, relative file links, cross-file anchors, and the
  extensionless page links GitHub Wikis use. Renaming a heading silently breaks
  every link to it — Markdown renders a dead anchor as ordinary text with no
  error — and nothing else in CI opens a Markdown file.

  It found the 28 dead sidebar links above plus **six** broken links across the
  tree, including a table-of-contents entry that broke when its heading gained a
  date suffix. External URLs are deliberately out of scope, so a third-party
  outage cannot fail the build.

- **`scripts/check_endpoint_permissions.py`**, run in CI as part of **Backend
  Lint**. It compares every documented route handler's docstring against the
  `require_permission(...)` dependency it actually carries.

  An endpoint docstring is rendered into `/docs` and is what the wiki's API
  reference and the module guides are written from, so a docstring that
  disagrees with its own dependency seeds the error into every document
  downstream — and that is discovered months later in a documentation pass
  rather than at the commit that caused it.

  It fails on a docstring naming **different** permissions than the code
  enforces, or claiming one the route does not require at all. Across 1,312
  handlers there were **no** routes of the second, dangerous kind. Routes that
  merely under-document (code enforces a permission, the docstring says only
  "Authentication required") are reported as warnings — there are 189 — and
  `--strict` promotes them to errors once that backlog is cleared.

**Changed**

- **38 prospective-members endpoints advertised one of the two permissions they
  accept.** Every one of them takes `members.manage` **or**
  `prospective_members.manage` (respectively `prospective_members.view` or
  `.manage`), while the docstring named only the first — so `/docs` understated
  who could call them, and a coordinator holding only the pipeline permission
  would read the API reference and conclude they could not.

---

### Skills testing: any member can examine, and an officer decides the result stands (2026-08-08)

**Added**

- **Examining is open to every member.** Every skills-testing route was gated on
  `training.manage`, so a member could neither drill alone nor examine a
  colleague. That does not match how departments run these — a senior member is
  often the one holding the clipboard. Starting, scoring and completing a test
  no longer needs the permission; **template authoring still does**.
- **`POST /training/skills-testing/tests/{id}/validate`** is where the
  officer's authority moved to. Until a test is validated it is a
  **submission, not a record**: it credits no pipeline requirement, spends no
  attempt against the requirement's `max_attempts` cap, and stays out of the
  department's pass rate and average score. The candidate sees it listed as
  **awaiting validation** with the outcome withheld, because nobody has yet
  decided that it stands.

  Requires `training.manage`, and is **idempotent** — validating an
  already-validated result returns it unchanged. Rejection is the existing
  `/void` path, which keeps the submission and the reason it was refused
  rather than deleting an evaluation someone sat for.

- **An officer completing a test validates it in the same step**, so the
  existing officer workflow is unchanged and no queue of self-approvals
  appears. `validated_at` is `NULL` only while a peer-run test awaits review.
- **`GET /training/skills-testing/tests?pending_validation=true`** is the
  officer review queue, and `GET /summary` gained a `pending_validation` count
  to badge it. The count is `0` for readers who cannot validate — it is an
  org-wide tally of other people's evaluations.
- **`GET /training/skills-testing/candidates?q=`** — a name lookup for the
  start-test picker, returning **id and display name only**. It exists because
  examining is open to every member while `GET /users` requires `users.view`,
  which the baseline member position does not carry; widening that permission
  would have exposed the whole member admin payload, contact details included.

  It is deliberately a **lookup, not a listing**: `q` is required (minimum 2
  characters), so no request returns the roster. `LIKE` wildcards are escaped —
  a bare `%` would otherwise match every row and turn the search-only rule
  straight back into a listing — whitespace-only queries are refused before the
  query runs, and results are capped at 15 so a broad two-character fragment
  cannot be widened into a bulk export. Gated on `training.view` **or**
  `training.manage`: a member whose position carries no training access has no
  business looking up test candidates.

- **A per-template result-disclosure editor.** The template builder now exposes
  the override the API has accepted since the disclosure work landed — what the
  person tested sees, when they see it, and which corporate positions may see
  it besides them. Every field defaults to **Inherit**, and the inherit option
  names what it resolves to ("Inherit — Scores only (pass/fail and points, no
  written notes)") read from the department's training configuration, so an
  officer can tell what leaving a template alone actually does without opening
  another page. The release question disappears when disclosure is set to
  **Nothing**, since there is then nothing to time.
- **A named-viewer panel on the test screen.** Granting one person sight of a
  single test's result — a preceptor, an FTO, a mentor — is the relationship
  the candidate and position rules cannot express. Named **per test** rather
  than per template, because the relationship is to the person tested, not to
  the skill: a trainee's FTO changes, and a standing template-wide grant would
  quietly follow the skill onto every other candidate's results. A grantee sees
  the result at the same disclosure level the candidate does, never more, and
  the panel says so.

**Changed**

- **Separation of duties holds at both ends.** A member cannot examine
  themselves officially, and **an officer cannot validate a test they are the
  candidate in** — which would otherwise launder a peer-run self-pass into a
  certification. Both refusals are `400`.
- **Practice runs default to the member's own name**, built from the signed-in
  user rather than a roster lookup, so drilling alone is one tap and costs no
  request.
- **Tapping a test on the Skills Testing page carries it through** to the Start
  Skill Test page instead of landing on an empty picker.
- **The picker searches server-side with a debounce** instead of filtering a
  cached roster, and holds the selected candidate separately so the choice
  survives the results being replaced.
- **Existing completed official results backfill as validated by their
  examiner.** Under the old rules only officers could run them, so every one
  already carries the sign-off the new column records — without the backfill
  the whole history would re-appear in the review queue.

**Fixed**

- **A completed practice test could become permanently un-finishable.** The
  pre-submit save on the review screen sends `elapsed_seconds`, which
  `update_test` refuses on a completed test — so if a completion landed
  server-side but its response never reached the phone, every retry failed
  forever on a test that had in fact gone through. Both finalize paths now show
  the existing results instead, and report the server's own message rather than
  a fixed string that hid what went wrong.
- **The two "Change" buttons on the start-test screen now carry distinct
  `aria-label`s.** They were indistinguishable to a screen reader.

**Data model**

- `skill_tests` gains `validated_at` (`DATETIME`, nullable) and `validated_by`
  (`VARCHAR(36)` → `users.id` **`ON DELETE SET NULL`**, nullable — a validated
  result must not revert to pending because the officer who signed it later
  left), plus index `idx_skill_test_org_validation`
  (`organization_id`, `is_practice`, `validated_at`) for the review-queue scan.
  Migration `20260808_0001`, which no-ops on deployments where `create_all()`
  already materialized the columns.

---

### Prospective members: the board shows everyone, bulk actions are one request, and a leak is closed (2026-08-08)

**Fixed**

- **The kanban board silently showed only part of the pipeline.** It grouped
  applicants into stage columns client-side from the same paginated list the
  table uses, at `DEFAULT_PAGE_SIZE` (25) — so a department with more than 25
  active applicants saw a board assembled from a fraction of them, with cards
  simply missing from columns, column counts to match, and nothing on screen
  saying so. Switching from the table also carried whatever page the table had
  been left on. The board now requests the whole set (`KANBAN_PAGE_SIZE` = 200,
  the ceiling the list endpoint accepts), switching views refetches rather than
  inheriting the other view's page, and past that ceiling it **says plainly how
  many applicants it is not showing**.
- **The kanban endpoint leaked prospect fields.** It returned a bare `dict`, so
  FastAPI serialized every column of `ProspectiveMember` — putting
  **`status_token`**, the credential behind the public application-status page,
  along with coordinator notes, date of birth and home address into a board
  view held by anyone with `prospective_members.view`. It now declares a
  `KanbanBoardResponse` whose cards carry the same projection as the prospect
  list and nothing more. The list and kanban endpoints share one mapper, so the
  two cannot diverge and neither can fall back to serializing the raw model.
- **`referred_by` was stored straight from the request** on both prospect
  create and update — the one client-supplied foreign key these paths accept.
  It matters more than a dangling reference, because conversion copies the
  value onto the new member as `User.referred_by_user_id`: an id from another
  organization did not stay on the application, it landed in the `users` table
  and outlived it. Both paths now validate through the shared `assert_in_org`,
  which fails closed and returns a deliberately generic message so the endpoint
  is not a cross-tenant existence oracle — a real id from another org and an
  invented one are indistinguishable. Conversion additionally **drops** an
  out-of-org referrer rather than copying it, for records written before this
  validation existed: legacy data must not block a member being elected.
- **"Advance" reported success when nothing moved.** `advance_prospect`
  returned the untouched prospect when there was nowhere to advance to —
  already at the final stage, or no current stage at all — so the endpoint
  answered `200`, the drawer said "Advanced" with nothing changed, and a
  `membership_pipeline.prospect_advanced` **audit entry was written for a
  movement that never occurred**. The audit log exists to reconstruct who moved
  whom through membership, so a fabricated entry in it was the worst part. Both
  no-op cases now raise, the endpoint answers **`409`**, and the audit event is
  written only after a real advance.
- **A bulk rejection silently overwrote coordinator notes.** The client-side
  bulk path sent the reason through the update endpoint as `notes`. Bulk status
  changes now record their reason in the **activity log** and never touch the
  notes column.
- **Prospect create and update translate `ValueError` into `400`.** They
  previously let it reach the catch-all as a `500`, which also mistranslated
  the existing "Invalid pipeline" rejection.

**Added**

- **`POST /membership-pipeline/prospects/bulk-advance`** and
  **`POST /membership-pipeline/prospects/bulk-status`**. Bulk actions had no
  endpoint at all: the UI looped client-side, one request per applicant,
  sequentially, discarding every error. Thirty selected applicants meant thirty
  round trips, each committing, sending stage email and auto-linking events,
  and a partial failure surfaced as a bare count naming nobody.

  Both **itemize the outcome per applicant** (`succeeded_count`,
  `failed_count`, and a `results` array carrying each prospect's id, name,
  success flag and error), so the caller can name who was skipped and why. One
  failure never aborts the rest. Capped at **200 ids** per request — a
  guardrail against an unbounded request body, not a UI page size.

  Bulk ids arrive in the request body, where the router's path-parameter
  privacy guard cannot see them, so both endpoints **filter the caller's own
  prospect record explicitly** and report it as "not found" — indistinguishable
  from an id that does not exist.

**Changed (performance)**

- **Inactivity processing is batched**, and the kanban query is bounded. The
  kanban query also now eager-loads the pipeline and step-progress
  relationships the shared mapper reads — a lazy load from the async response
  path raises `MissingGreenlet` rather than merely being slow.

---

### Interface: phone-sized controls, readable text, and public pages that respect dark mode (2026-08-08)

**Fixed**

- **Public pages rendered unusable in dark mode.** The dark-mode surface tokens
  are translucent white by design, meant to composite over `AppLayout`'s
  gradient — which only protected routes render. The public form page
  (`/f/:slug`), ballot voting and the application-status page sit outside
  `AppLayout`, so those tokens composited over the browser's bare white canvas:
  a white page with white-on-white labels and slate-800 inputs. `body` now
  carries the themed gradient so no route can render over the browser's default
  canvas, and the three public pages use the same gradient utility as the login
  page. Print styles already force a white body background, so printed output
  is unaffected.
- **Undersized tap targets are gone — every route now measures zero.** The
  backlog went 212 → 78 → 0, and almost all of it came from five shared
  utilities rather than a page-by-page sweep: `form-input` / `form-input-sm`
  (which rendered ~41px for an input and ~37px for a select), `form-checkbox`,
  the `btn-*` family, `btn-icon-sm`, and the header logo and skip-to-main
  links. Every rule sits inside a `max-width: 767px` query, so **desktop
  density is unchanged** — a mouse pointer does not need the target a fingertip
  does. The checkbox keeps its 16px box so layouts do not move, growing the hit
  area with outline padding and a matching negative margin.
- **No ordinary UI text renders below 12px on a phone.** Nearly every instance
  came from four sources repeated on every page — the bottom navigation labels,
  the footer tagline, the notification count badge, and relative timestamps.
  One was a genuine mistake: dashboard timestamps read `text-[11px] sm:text-xs`,
  making the text _smaller_ on the smaller screen. The floor is applied
  centrally by overriding `text-[10px]` and `text-[11px]` below `md`, rather
  than editing 186 call sites.

  **`text-[9px]` and below are deliberately exempt**: chart axis labels, day
  cells in the pattern builder's month grid, and the simulated barcode on the
  label-print preview are dense fixed-size layouts where 12px would break the
  grid rather than help anyone read it. The exemption is documented at both the
  CSS rule and the spec.

  This is a readability change aimed at the actual audience — volunteer members
  across a wide age range, the same reason the theme ships a high-contrast mode.

- Both budgets in `mobile-presentation.spec.ts` are now **0 everywhere**, so
  they are hard rules rather than budgets: no new control below the touch
  minimum, and no ordinary UI text below 12px.

---

### Notifications: the documented VAPID keygen command did not run (2026-08-08)

**Fixed**

- **The VAPID keypair command in the docs was not executable.** All three
  copies called `Vapid01.public_key_urlsafe_base64()` /
  `private_key_urlsafe_base64()`, which do not exist. They are replaced with
  **`backend/scripts/generate_vapid_keys.py`**, so the command runs and cannot
  drift again.

  The two encodings are **not interchangeable** and neither consumer tolerates
  the wrong one: `pywebpush` reads any private key whose decoded length is not
  32 bytes as DER, and `pushManager.subscribe()` rejects any
  `applicationServerKey` that is not the 65-octet uncompressed point. Both
  failures surface as a **silent 401 from the push service**, long after the
  browser accepted the subscription. The script prints both lines ready to
  paste, in the exact encoding each consumer requires.

- **A push-service outage logged a full traceback per device per
  notification.** `pywebpush` does not wrap transport errors in
  `WebPushException`, so a raw `requests` exception fell to the catch-all. It
  is now a single WARNING line: the condition is transient and, for a
  best-effort delivery path, non-fatal by design.

**Testing**

- The push path is now exercised against a real MariaDB and a real HTTP push
  service rather than mocks — `pywebpush` really encrypts to a generated P-256
  client key, the local service returns `410` for one endpoint so the pruning
  path runs for real, and the assertions read the wire: `aes128gcm` encoding, a
  verifying ES256 signature, `k=` equal to the configured public key, `aud`
  equal to the push origin, and a body that does not contain the plaintext.

---

### Tooling: finding and repairing training requirements that point at typed-in course names (2026-08-08)

**Added**

- **`backend/scripts/find_unlinked_course_requirements.py`** (read-only)
  reports `training_requirements.required_courses` entries that do not resolve
  to a course in the organization's library. That column holds **course ids**,
  and every compliance evaluator asks the same question — "is this member's
  record for one of these ids?" — so an entry that is not an id can never
  match, and the requirement can never be completed. Requirements created
  before the course picker landed still carry typed-in **names**.

  Each unresolved entry is classified as `name` (not a UUID at all — typed-in
  text, reported with the closest library match) or `dangling` (a well-formed
  UUID absent from this org's library). Severity depends on requirement type:
  a `courses` requirement needs _every_ linked course, so any unresolved entry
  caps it below 100%; a `certification` requirement falls back to matching by
  name, training type and registry code, so it may still work. Archived
  courses are soft-deleted rather than dropped, so a resolvable-but-archived
  course is reported as OK-with-a-note.

- **`backend/scripts/apply_course_link_suggestions.py`** writes the repairs,
  and holds a stricter bar than the report because nothing here is judged by a
  human. An entry is relinked only when **exactly one** library course matches
  at the `exact` or `contains-name` tier — not "the best match", _the only
  match_. The `fragment` and `fuzzy` tiers are reported and never applied: a
  verbose stored value naming a short course is evidence, but a short stored
  value sitting inside a long course name is a coincidence waiting to happen,
  and similarity scoring is fine for a human-reviewed suggestion and not for an
  unattended write. Dangling UUIDs are never touched — there is no name to
  match on, and the right answer may be to delete rather than remap.

  **Dry run by default** (nothing is written without `--apply`), matching is
  per-organization so a course from another tenant can never be selected,
  `--apply` writes a rollback file that `--restore FILE` puts back, every
  change lands in the normal tamper-evident audit chain, and partial fixes are
  kept — a requirement with three resolvable names and one ambiguous one gets
  the three and is reported as still needing attention.

**Changed**

- `format:backend` now formats `alembic/`, matching what `lint:backend` already
  checked.
- The screenshot-capture spec is skipped in E2E runs — it is a documentation
  tool, not a test.

---

### Equipment checks: submitting one works again, and shifts accept either apparatus inventory (2026-08-08)

**Fixed**

- **Submitting an equipment check returned a server error on any shift with an
  apparatus assigned** — in practice, on any real shift. The submission wrote the
  shift's apparatus reference into a column whose foreign key points at the full
  apparatus table, but for a department that set its apparatus up during
  onboarding that reference names a _lightweight_ apparatus record instead. The
  constraint failed and the whole check was lost. Nothing was ever saved, so
  there are no partial checks to clean up.
- **Equipment-check templates never resolved for those same departments.** The
  checklist came back empty because template lookup searched the full apparatus
  table using an id that only exists in the lightweight one — so a member opening
  their checklist saw nothing to fill in, with no error to explain it.
- **A department running the full Apparatus module could not assign an apparatus
  to a shift at all.** Shift creation validated the apparatus against the
  lightweight table only, so it rejected the very ids the shift form had just
  offered it, with "Apparatus not found". This is the mirror image of the first
  defect and had the same root cause.
- **Shift lists showed blank apparatus names and lost the understaffing badge**
  for full-Apparatus departments, because apparatus details and minimum staffing
  were loaded from the lightweight table only.
- **A latent crash in the apparatus-type template fallback.** That branch read a
  `type` attribute the apparatus model does not have; it was unreachable only
  because the id never matched, so fixing the id alone would have turned a silent
  failure into a 500.
- **Two apparatus lookups had no organization filter**, so an id from another
  tenant could have been read back (XC-1). Resolution is now org-scoped
  throughout, and an out-of-org id resolves to nothing rather than being stored.

**Changed**

- **`shifts.apparatus_id` is now understood to be polymorphic**, which it always
  was in practice: `GET /scheduling/apparatus-options` serves full-`Apparatus`
  ids when that module has records and `BasicApparatus` ids otherwise, so the
  same column means different things in different deployments. That was
  deliberate; what was missing was anywhere that said so. A new
  `app/utils/apparatus_ref.py` classifies the id against both tables, and every
  consumer now asks it instead of assuming.

  Neither of the two "obvious" fixes was correct — making the column a real
  foreign key, or consolidating the tables, would each have broken one of the two
  department types. Resolving at the boundary requires **no migration and no
  schema change**.

- **An equipment check on a lightweight-apparatus shift stores no apparatus
  reference** (`NULL`), which is accurate rather than lossy: that department has
  no full apparatus record for the vehicle. The check still links to its shift,
  which carries the reference, and the column is nullable with `SET NULL`
  precisely because a check need not be attributable to one.

**Known gap (unchanged)**

- **Deficiency flags remain a full-Apparatus-module feature.** A failed check
  cannot raise a deficiency badge for a department on the lightweight table,
  because that safety state lives on the full apparatus record. Closing it means
  adding the state to the lightweight table, which is a product decision. See
  `docs/KNOWN_LIMITATIONS.md`.

### Deployment: an update could break the build on a compose file the pull never touched (2026-08-08)

**Fixed**

- **Updating an existing install could fail the frontend build with
  `"/frontend/nginx.conf": not found`.** Moving the frontend build context to
  the repository root (so `npm ci` could reach the workspace lockfile) made
  every path the Dockerfile copies root-relative. Any deployment whose compose
  file still named `./frontend` as the context started failing the build after
  pulling that commit — and a `git pull` cannot repair it for the installs most
  likely to hit it, because a deployment carrying its own compose file (custom
  volume paths, service names, pinned image tags) does not run the file the
  repository updated, and overwriting it with the shipped template would
  destroy those local settings.
- **Nothing caught it before the build.** `docker compose config --quiet` — the
  only validation in the repo — checks YAML and interpolation and never opens
  the Dockerfile, so a context that no longer holds what the build copies
  passes every check and then fails minutes into a rebuild, with the stack
  already down.

**Added**

- **`scripts/sync-compose-build-context.sh`** reads each Dockerfile's
  `COPY`/`ADD` sources, confirms they resolve inside the declared context, and
  with `--fix` walks up to a context that does satisfy them and rewrites
  `context:` / `dockerfile:` in place, preserving everything else in the file.
  Sources behind `--from=` are skipped (they come from an earlier stage, not
  the context), and a trailing-slash source is checked as a directory, since
  `compgen -G` reports success for any pattern ending in `/` whether it matches
  anything or not. A rewrite that leaves the file unparseable is rolled back
  from a timestamped backup — but only when the file parsed beforehand, so an
  unrelated failure such as an unset required variable cannot silently undo a
  correct repair.
- Wired in at the two points that would have caught the original break:
  `unraid/update.sh` runs it in `--fix` mode between the pull and the rebuild,
  where a failure still costs nothing because the stack has not been touched;
  and `scripts/verify-docker-build.sh` checks every shipped compose file, so a
  future Dockerfile change that outgrows its context fails review rather than
  a deployment. The Unraid templates are checked against the repository root,
  because they are copied there before use rather than run from `./unraid`.

> **Self-hosting with your own compose file?** Run
> `./scripts/sync-compose-build-context.sh --fix -f docker-compose.yml` between
> "pull" and "build". The manual update paths in the Unraid and Docker
> deployment guides now include this step.

### Documentation: the Member Lifecycle page was documented but never built (2026-08-08)

**Fixed (documentation)**

- **`docs/training/01-membership.md` described a "Member Lifecycle Management"
  page with four tabs — Archived Members, Overdue Returns, Leave of Absence, and
  Tier Configuration. No such page exists**, and it appears never to have.
  `/members/admin` has exactly three tabs: Member Management, Add Member, Import
  Members. Every navigation instruction pointing at the phantom page has been
  corrected across the membership, training, events, inventory and troubleshooting
  guides.
- **A correction to the 2026-08-07 entry for this**, which claimed membership
  tiers "are configured under organization settings." That was taken from a commit
  message rather than from the code and is wrong. Tiers are _stored_ in
  `Organization.settings["membership_tiers"]`, but **no screen reads or writes
  them** — `getTierConfig`, `updateTierConfig` and `advanceMembershipTiers` exist
  in the frontend service layer with zero callers.
- **Screenshot `01-22-member-lifecycle.png` was mislabelled.** It was captured at
  `/members/admin` and applied under a "Member Lifecycle Management page" caption,
  so a correct screenshot of the Members Admin hub read as evidence that the
  lifecycle page existed. Caption and manifest `alt` corrected; the image itself
  was always fine.

**Known gaps this surfaced** (product, not documentation — endpoints,
permissions and service methods all exist and are tested; only the screens are
missing). Full inventory with the API surface for each is in
`docs/KNOWN_LIMITATIONS.md`:

- **Archiving a member is a one-way door in the UI.** You archive from the member
  profile; reactivating is API-only.
- **A leave of absence cannot be edited or cancelled from any screen.** Creating
  one works (from Waiver Management, which is where it actually lives). A leave
  pro-rates hours, shift and call requirements, so a wrong end date quietly
  changes someone's compliance with no way to put it right.
- **Membership tier configuration has no UI at all.** With no tiers configured, a
  tier change accepts _any_ value — validation only engages once tiers exist, so
  the unconfigured state is also the unvalidated one.
- **Tier auto-advancement has no trigger.** No button and no scheduled task calls
  `POST /users/advance-membership-tiers`, so advancement never runs on its own.
- **Overdue member property returns have no screen.** (The Inventory module's
  "Overdue Returns" figure counts checkouts, a different thing — plausibly why
  this was assumed to exist.)

### Skills testing: the member can see their own results, and a scorecard can no longer drift (2026-08-08)

**Added**

- **A member can now see their own skills-test results.** Every skills-testing
  route was gated on `training.manage`, so a result lived on the examiner's
  device and had to be read over their shoulder. **My Training** now carries a
  **Skills Tests** section listing that member's own official and practice
  results, with a read-only detail page at `/training/my-skill-tests/:testId`.
  The API scopes non-officers to tests they are party to, so nobody can reach
  anyone else's scorecard.
- **A department decides how much of a result the person tested may see.** A
  new **Skills-Test Results** group in the training configuration editor sets
  the department default on three axes, each of which a single template — or a
  single test — may override:
  - **What** (`result_disclosure`): `full` (every mark, point and written
    note), `scores` (marks and points, no written commentary), or `none`.
  - **When** (`result_release`): `on_completion`, or `on_release` — a finished
    result stays invisible until an officer releases it, so a chief can review
    it, or deliver a failure in person, first. Mirrors the shift-report review
    workflow.
  - **Who**: the candidate; anyone named on the test (a preceptor, an FTO —
    `skill_test_viewers`); and holders of listed corporate positions
    (`result_viewer_positions`).

  Defaults are `full` / `on_completion` — exactly what members saw before — so
  nobody silently loses sight of a result they can read today.

- **`POST /training/skills-testing/tests/{id}/release`** releases a withheld
  result. Officers get a **Release** action beside **Void** in the records tab;
  it is idempotent and refuses tests whose results are never shown, so an
  officer does not have to work out which mode a template inherits first.
- **`POST /training/skills-testing/tests/{id}/void`** withdraws an official
  result. Official results are no longer deletable — `DELETE` refuses them.
  Voiding keeps the row with a required reason and its author, drops it from
  totals, pass rate and average score, and releases any training-pipeline
  requirement the pass had credited. The member sees the reason on their own
  result.
- **`POST /training/skills-testing/tests/{id}/cancel`** closes out an
  evaluation abandoned mid-session, keeping partial results. `cancelled` was
  previously a filter option and a badge that nothing ever set. The records tab
  now offers **delete** for practice, **void** for scored, **cancel** for
  unscored.
- **Any member can run a practice test on a peer** without `training.manage`;
  official tests still require it. Practice attempts are the candidate's own
  drill notes — discardable by the candidate, the examiner or an officer, never
  recorded or credited, and purged after a year via a new `practice_skill_tests`
  retention class. Official results share the table and are excluded by a row
  filter. Practice creation follows the template's own visibility rule, so an
  `officers_only` template is not leaked through it.
- **Autosave on the active test screen.** Scoring persisted only on an explicit
  **Save** or on entering review, on a screen used one-handed outdoors — a
  locked phone or a killed tab lost every criterion scored since the last save.
  Saving is now automatic and silent while the evaluation is live.

**Changed**

- **Each test freezes the template it was scored against.** Criterion identity
  is positional, and editing a published template rewrote the one stored
  structure — so inserting a criterion shifted recorded pass/fail marks onto
  their neighbours, deleting one dropped its result off the scorecard, and
  raising the passing percentage could turn a recorded pass into a fail. Every
  test now carries a `template_snapshot` (structure plus scoring rules) written
  at creation and used for scoring, for the API response and for the emailed
  scorecard. Tests predating the column fall back to the live template; the
  migration backfills them from it, which changes nothing visible and freezes
  them against future edits.
- **The examiner's stopwatch is trusted.** Completing a test overwrote the
  measured time with `completed_at - started_at`. `started_at` is stamped once,
  when the test first goes in progress, so a test begun at 09:00 and finished
  after lunch recorded seven hours — and time limits are pass/fail criteria
  here. Wall clock is now only a fallback for tests completed without a
  measured value, and reopening an in-progress test restores the timer instead
  of restarting it at 00:00.
- **Emailing results obeys the same disclosure policy**, resolved for the
  recipient rather than for the officer sending it. Otherwise "email results"
  is a one-click bypass of the department's decision to withhold or redact
  them.
- **A viewer never sees more of a result than its subject**, and a withheld
  result reads as absent, not forbidden — every refusal is a `404`, and a
  withheld test is dropped from the list rather than shown as an entry that
  cannot be opened.
- **Passing Points is now shown only on critical criteria.** A non-critical
  criterion contributes its points to the overall score and cannot fail the
  test on its own, so the field was asking for a number the scorer ignored. The
  "passing score cannot exceed max score" validation moved with it, so a value
  left behind from before a criterion was un-marked critical no longer blocks
  saving over a field the editor does not show. The stored value is kept rather
  than cleared, since the threshold defaults to 0 when absent and an accidental
  toggle would otherwise leave the criterion passing at any score.

**Fixed**

- **`max_attempts` is now enforced by skills testing.** A passing test
  completes its linked pipeline requirement, but nothing stopped a candidate
  capped at two attempts being tested a third time and having the pass
  credited — only the officer-entered knowledge-test path enforced the cap. The
  guard runs both when an official test is created (so an examiner is refused
  before running an evaluation that could not count) and when one is completed
  (since several can be started before any is submitted). An attempt is a
  completed, official, non-voided test against that requirement, pass or fail.
  Voided results and practice attempts do not consume a chance, and a
  requirement already completed, verified or waived is exempt so recertification
  testing stays possible.
- **Concurrent edits are detected instead of silently lost.** Two examiners on
  one test — or an officer editing the scorecard while a phone held unsaved
  criteria — lost one side's work, and the losing side got a success response.
  Tests now carry a version counter, and an update sent against a stale version
  is refused with `409`. Clients that send no version keep the old behavior. The
  test screen suspends autosave on conflict and says so, rather than retrying a
  doomed write every 30 seconds and leaving the examiner believing their scoring
  is still being saved.
- **The examiner's "View Results" button did nothing.** Both `/test/:id/active`
  and `/test/:id` render the same page, so the router swapped the URL without
  remounting and the review flag survived, re-rendering the identical review
  screen.
- **A retake no longer inherits the previous attempt's review notes**, and
  opening a test from the bottom of a list no longer lands the examiner below
  the questions (pages kept the previous page's scroll offset).

### Members: every CSV row is checked before anything is created (2026-08-07)

**Added**

- **Full pre-flight validation.** Validation used to run inside the import loop
  and stop at the first problem in a row, so a row with three bad cells took
  three upload-fix-upload cycles, and row 21's problem surfaced only after rows
  1–20 had already been created. Every data row is now judged before a single
  member is created; rows that pass are imported, rows that fail are reported
  and skipped, and each row reports **all** of its problems at once, naming the
  column and the offending value: required fields, email shape, date format,
  field lengths, the 3-character username minimum (including a username derived
  from a short email local part — a column the file never had), partial
  emergency contacts, role names matching nothing under Roles, and values
  repeated inside the file, naming the line the value was first used on.
- **A downloadable rejected-rows CSV.** The original row, unchanged, with the
  reasons in a leading `errorReason` column. It holds only the failures, so the
  corrected file cannot collide with the members that did import.
- **Welcome emails are now a choice, off by default for imports.** Creating a
  member queues a password-setup link immediately, so loading a roster for
  staging — or from a list with stale addresses — put unrecallable mail in front
  of every one of them. The review step now carries a checkbox; left off, the
  roster loads quietly and credentials are issued afterwards from Member
  Management. **Add Member**, which creates one member deliberately, is
  unchanged.
- **Collisions with the existing roster are caught up front.** The roster is
  loaded once when the file is selected, and a row whose email, username or
  membership number is taken is reported before the import runs, naming who owns
  it. If that request fails the check is skipped rather than blocking the
  upload, since the server still rejects a genuine duplicate. Where the
  organization hides contact information, emails are absent from the response
  and that dimension simply goes unchecked.
- **Progress and a Stop button.** An import gave no sign of progress and could
  not be stopped: 50 sequential requests behind a spinner reading
  "Importing…". It now shows the count and can be stopped; rows not reached are
  listed in the error report as stopped, so the downloaded file is exactly the
  work left and can be uploaded to finish.

**Fixed**

- **A shifted row is now rejected instead of guessed at.** Nothing compared a
  row's value count to the header's column count, so an unquoted comma shifted
  every later column in silence and a phone number could land in the email
  field. Row width is now checked (naming both counts), email columns are
  shape-checked, and a value with seven or more digits and no `@` is called out
  as a probable phone number in a shifted row.
- **Errors name a findable line.** A quoted newline puts record 12 well below
  line 13, so records now carry the line they started on. The file is also
  parsed once rather than separately for preview and for import, removing the
  chance of the two disagreeing.
- **The template's own example row is rejected.** The template ships a
  filled-in example so its columns explain themselves, but leaving it in created
  a John Doe with a live password-setup link. First name, last name and email
  must all match, so a real John Doe is unaffected.
- **Two silent data losses are now reported when the file is selected.** A
  `status` column is dropped (the create endpoint has no status field and every
  member is created Active), as is any column outside the template; and role
  names are now resolved at upload time, so a roster whose role column holds
  assignments ("Engine Operator", "EMT") rather than configured role names is
  known to import no roles before Import is pressed rather than after.
- **Validation errors read as English again.** The server rewrites Pydantic's
  `{loc, msg, type}` entries into `{field, message}`, but the shared error
  handler read only the Pydantic spelling and fell back to the literal string
  "Invalid value" for every failed field — a member import reported 50 rows of
  "Invalid value. Invalid value". The same response now reads
  `date_of_birth: Invalid date format. emergency_contacts.0.email: Invalid
value.` Both spellings are accepted, since a 422 raised outside that handler
  still arrives in the original form. **This affected every 422 in the
  application, not just the import**; the onboarding module's own copy of the
  assumption is fixed alongside it.
- **The Add Member button on `/members/admin` went to the dashboard.** It linked
  to a path that matches no route, and the catch-all turned the failure into a
  silent redirect. It now selects the admin hub's existing Add Member tab. A new
  route-integrity test walks the source and checks every literal navigation
  target against the declared routes, so the next dead link fails a test instead
  of a user. The same sweep found two more, both in Grants — **Record Donation**
  and **Add Opportunity** point at create screens that were never built; they
  are recorded in `KNOWN_MISSING_ROUTES` with a test that fails if either route
  appears, so the allowance cannot outlive the gap.

### Notifications: Web Push reaches an installed app on the lock screen (2026-08-07)

**Added**

- **Web Push.** The notification system had a rules engine plus in-app and email
  channels, but nothing that reached a member with the app closed — which is
  what an installed PWA is for. Delivery hooks into the notification service
  rather than the dozen call sites that produce notifications, so **every
  existing source** — event reminders, training expiry, schedule changes,
  maintenance due, elections — reaches a phone with no further change. It fires
  only for in-app rows, after the row is committed, and swallows every error: the
  notification is already durably recorded and a push-service outage must not
  fail the action that produced it.
- **Subscriptions are per device, not per user**, so a member with the app on
  both a phone and a station tablet is reached on both. Rows are pruned when the
  push service answers 404/410 on send — the only signal that an app was
  uninstalled or its site data cleared.
- **iOS 16.4+ is covered** for home-screen PWAs. The push API only exists once
  the PWA is installed, so Safari browsing correctly shows no toggle rather than
  offering something that fails on tap.

**Changed**

- Push is **off by default**. `PUSH_ENABLED` defaults to `false` and `pywebpush`
  is imported behind a guard, so deployments that do not want push need not
  install it; the service reports itself unconfigured and the UI hides the
  toggle. Enabling it also needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
  `VAPID_SUBJECT`.

### Error Monitoring: the platform now reports its own failures (2026-08-07)

**Added**

- **Client and server failures reach the Error Monitoring page.** Most failures
  were visible only to the member who hit them — an API 500 became a toast, an
  unhandled rejection became a console line, and an administrator investigating
  "the site is broken for Dave" had nothing to look at. The page only ever
  received explicit `logError` calls, of which the app made exactly one.
  - **Server:** 5xx responses are now persisted. The unhandled-exception handler
    resolved the caller's organization from the `Authorization` header, but
    browsers authenticate by the httpOnly cookie, so the organization was always
    unknown and the row was skipped every time — identity now resolves from the
    cookie first. A new handler also persists the 5xx raised through the
    established `HTTPException` pattern, which converts a failure into a normal
    response the unhandled-exception handler never sees. 4xx is deliberately not
    persisted.
  - **Client:** failed API requests are reported from the shared axios
    interceptors that every module client funnels through (5xx, transport
    failures and timeouts, and 403 — 401, 404 and validation failures are not,
    so real failures are not buried), along with uncaught exceptions and
    unhandled rejections, which previously reached nothing at all.
  - Chunk-load failures are reported under their own type: they mean a
    deployment landed mid-session, which is resolved differently.
- **A Source column, the technical message beside the user-facing one, and
  method/path/status** for any error carrying request context.

**Changed**

- **Reports survive the failures they report.** A report was one request: if it
  failed, it was gone — and the failures most worth recording are the ones that
  break their own delivery. Reports are now queued and retried (4 attempts, 2s
  / 8s / 30s) and delivered serially so a queue draining on reconnect does not
  stampede a recovering server; flushed on page hide with `keepalive`, so a
  member who hit an error and closed the tab still reports it; and held rather
  than dropped when raised without a session, then delivered on the next login —
  errors on the login screen are exactly what administrators get asked about.
- **Repeats are counted rather than collapsed into silence.** "One error" and
  "one error that happened 400 times in a minute" no longer look identical, and
  the page shows the count. What the rate cap and the queue bound discard is
  itself reported as a `REPORTING_THROTTLED` row carrying the counts, so a burst
  reads as truncated rather than quiet.
- **Error text is scrubbed before it leaves the browser** — emails, phone
  numbers, SSNs, bearer tokens and JWTs. Error messages quote user input and API
  payloads, and these rows are readable by every `audit.view` holder and
  downloadable as an export.
- **The table is bounded.** `error_logs` is registered with the retention service
  (180 days default, 30-day floor), and ingest is rate-limited per user
  (120/min) — per user rather than per IP, since a department's members share one
  public address and an IP bucket would let one failing tab silence the whole
  station's reports.

### Mobile & PWA: an installed app that behaves like one (2026-08-07)

**Added**

- **A bottom tab bar on phones.** Every destination previously sat behind a
  hamburger drawer anchored to the top-left — two taps to reach anything, from
  the corner hardest to reach one-handed, across 59 nav entries. Four
  destinations plus **More** now sit within thumb reach below `md`; at wider
  widths the side or top navigation is already visible. Tabs are chosen from a
  priority list and filtered by the organization's enabled modules, so a
  department with scheduling switched off gets Members promoted into the freed
  slot rather than a gap. The bar hides while the on-screen keyboard is up.
- **iOS launch screens.** iOS does not derive one from the manifest, so the
  installed app flashed blank white on every cold start. 14
  `apple-touch-startup-image` variants now cover iPhone SE through 16 Pro Max
  and the iPad sizes; `npm run generate:pwa-assets` rebuilds them.
- **Manifest screenshots**, so Android shows the richer install dialog instead of
  the minimal card. Regenerate with `npm run generate:screenshots`.

**Changed**

- **The app launches at the dashboard.** `start_url` pointed at `/`, the
  onboarding Welcome splash — it reached the dashboard only by mounting, reading
  the session flag and redirecting, and a logged-out offline launch fell through
  to the "Get Started" screen, which reads as though the department was never set
  up. Now `/dashboard`, behind the route guard, so an unauthenticated launch goes
  to login. The "Dashboard" manifest shortcut had the same wrong target.
- **The precache went from 275 entries / 6.1 MB to 15 / 1.8 MB.** Installing the
  app used to download admin surfaces — finance, grants, elections, onboarding —
  that a given member will never open, over the rural cellular connections this
  gets used on. The shell is precached; other route chunks are cached on first
  visit. Barcode scanning stays precached so it works on a cold offline start.
  The trade-off is that a page never visited online is no longer available
  offline.

**Fixed**

- **Safe-area insets were applied to `<body>`**, but a fixed element's containing
  block is the viewport — so the padding did nothing for the fixed mobile header
  and nav drawer (which rendered under the status bar) while still making every
  full-height page overflow by the inset height. Insets now live on the elements
  that need them. The top route-progress bar, the last fixed element without one,
  rendered entirely underneath the status bar on notched devices, so route
  transitions gave no loading feedback at all.
- **Action bars stayed behind the software keyboard on iOS**, which shrinks the
  visual viewport but leaves the layout viewport alone — the Save button in the
  equipment-check and skill-test flows among them. The viewport delta is now
  published as a CSS variable that the bottom-bar utilities add to their padding.
  Android and desktop resize the layout viewport instead, so nothing moves there.
- **The barcode scanner never released the camera when the page was
  backgrounded.** Switching apps or locking the screen mid-scan left the capture
  track held; iOS suspends it without resuming, so the user returned to a
  permanently frozen preview with the OS camera indicator still lit.
- **Pull-to-refresh hijacked scrolling inside modals and side panels**, gated only
  on window scroll position, so a downward drag inside an already-scrolled
  container refreshed the page and discarded whatever was in the open dialog. It
  now yields to a scrolled scrollable ancestor, and never arms while body scroll
  is locked.
- **The "new version available" banner was invisible on a phone**, painted over by
  the fixed mobile header. For an installed PWA that stays open for weeks that is
  the primary update channel; it is now pinned to the bottom of the viewport
  below `md`.
- **iOS autocorrect rewrote values that must be taken literally.** 54 inputs
  across 47 files now opt out of autocapitalize and autocorrect: identifiers
  (username, VIN, serial, asset tag, license plate, SKU, barcode, membership
  number) and every search box, where autocorrect was mangling member surnames
  mid-query. Login is included — autocorrect substitution is not case-related and
  would break a login outright.
- **Grids that stayed multi-column at phone width.** The notification log's
  12-column grid had gutters alone exceeding a 360px viewport; 11 form grids
  (city/state/zip, first/middle/last name, moved-by/seconded-by,
  rotation/days-on/days-off) put text inputs at ~104px, narrower than their own
  labels; shift-report stat tiles went 4-up. The calendar's seven columns are
  left alone — seven columns is what a week is.
- **Hover-only controls never appeared on touch**, including a drag handle that
  made reordering undiscoverable on a phone and an actionable button in the
  equipment-check builder. The skills-testing tab bar now scrolls rather than
  overflows.
- **Icon-only tap targets below 44px**, measured from rendered geometry rather
  than read from source: the list/calendar view toggles on Events rendered 28×28
  and the dashboard's notification dismiss button 32×32. Raised below `md` only,
  so desktop density is unchanged. Wide text buttons in the 30–36px range remain
  and are recorded rather than pushed through in bulk.

### Reliability: an unexpected response no longer takes a whole page down (2026-08-07)

**Fixed**

- **166 service methods across 20 files now verify the array they promise.**
  `api.get<T[]>` asserts the wire format without checking it, and ~190 methods
  handed that straight to callers that spread, `.map`, `.filter` or read
  `.length` off it — so one unexpected body took a whole page down to the error
  boundary instead of rendering empty. This matters more on a phone than a
  desktop: a captive portal on station Wi-Fi, or a carrier interception page,
  answers 200 with an HTML body. Driving 13 routes at 390px found six pages
  crashing this way; after the sweep, none do.
- **Envelope reads, where the array sits one level below the response body and
  the service-level guard cannot reach**, are guarded at the four consumers that
  had them: the apparatus list, the minutes page's meetings, the inventory items
  list (including the append-on-scroll path), and Documents.
- **Two crashes of a different shape** — reading a property off an undefined
  object rather than a non-array: `SubmitTrainingPage` indexed a per-field config
  that a response might omit entirely, and `AdminHoursPage` read `.length` off a
  value set from an envelope.
- **Events and Scheduling** each replaced a defaulted list with whatever the
  settings or templates endpoint returned; a payload missing the field made it
  undefined and the next call killed the page.
- **A standing guard:** `src/e2e/mobile-resilience.spec.ts` walks all 29
  authenticated routes at 390px and asserts none reaches the error boundary and
  none scrolls horizontally, against a mock that answers unmatched endpoints
  permissively — exactly the degraded-payload case these crashes came from.

### Training: requirements point at real courses, and can demand a recent one (2026-08-07)

**Added**

- **Course and certification requirements now pick from the course library**
  instead of expecting an id list nobody could supply. A recruit-school phase can
  point its "CPR" requirement straight at the CPR course in the catalog — the
  same course the department-wide requirement uses — so one completion satisfies
  both. The picker is shared by all three places a requirement is defined: the
  create-pipeline wizard, the pipeline requirement modal, and the department
  requirements page.
- **A freshness window (`recency_days`).** A requirement can now demand that the
  completion itself be recent — "CPR taken within the last 180 days" —
  configurable next to the course picker in all three of those places. Off by
  default, so nothing changes for existing requirements.

  This is the case a `one_time` requirement could not express: its frequency
  window is unbounded, so a member who took CPR three years ago read as satisfied
  forever. It is deliberately distinct from `rolling_period_months`, which sets a
  recurring obligation ("redo it every N months"); this is a validity window on
  an individual completion, so a department's one-time CPR requirement and a
  recruit pipeline's 180-day one can point at the same course and disagree about
  the same record. The window narrows the record pool _before_ the frequency
  window in every evaluator, so it can only ever remove records.

**Fixed**

- **A department requirement built from typed-in course names could never be
  completed.** The department requirements page collected `required_courses` as
  free-text course names, one per line, but every evaluator compares that column
  against a record's course id — so a typed name never matched and the
  requirement read as permanently incomplete. Picking from the library stores
  real ids. The NIMS/ICS starter template seeded four such names and now names
  them in its description for the officer to link, since library ids are
  per-department and a template cannot know them.
- **The officer apply-training-record path now respects the freshness window.**
  That path is an explicit sign-off and bypasses the external-credit flag by
  design, but crediting a three-year-old record to a "within 180 days"
  requirement would quietly defeat the rule the officer set. A record with no
  completion date fails the check rather than slipping through.
- **A freshness window can be lifted again** — `recency_days` is in the update
  path's clearable set, where the shared loop would otherwise treat "unset" as
  "leave alone" and make the setting one-way.
- **Switching a requirement away from the course/certification types clears its
  links**, since a leftover course id silently narrows the hours evaluator to only
  that course's records.
- Certification requirements gain the course link as an **additional, exact**
  match on top of the existing name / training-type / registry-code heuristics,
  which must keep working for requirements created before the link existed.

### Apparatus: sixteen unreachable endpoints, and a fuel tab that crashed (2026-08-07)

**Fixed**

- **Sixteen `GET` endpoints were unreachable.** Routes match in declaration
  order, and a single-segment `/{id}` declared above the literal paths swallows
  all of them — `GET /apparatus/maintenance-types` resolved as an apparatus id
  and 404'd "Apparatus not found", taking maintenance, fuel logs, equipment,
  operators, NFPA compliance, components, component notes, service providers,
  report configs, custom fields and EVOC levels with it. That is the whole
  apparatus detail read API. The by-id handlers now sit below the literal routes;
  `documents/my-folder`, `event-requests/email-templates` and
  `minutes/templates` move above theirs. A scan of every endpoint module confirms
  none are left.
- **Creating an apparatus maintenance record always returned a server error.**
  The response reaches into the maintenance type, which the create path did not
  load, so serialization triggered a lazy load in async context and raised
  _after_ the row was written — the record existed but the caller saw an error.
  Create and update now re-read through the getter that loads it.
- **The Fuel Logs tab crashed for any apparatus with a fuel log.** `gallons` is a
  SQL numeric, which serializes as the JSON string `"33.000"`; the response type
  declared a number and the component called `.toFixed(2)` on it. The type now
  says what the API sends, both render sites coerce, and the currency formatter
  accepts the string form so the next field of this shape does not repeat it.

### Prospective members: an applicant cannot read their own file (2026-08-07)

**Added**

- **A prospective-membership record is not the applicant's copy of their
  application.** It carries interview notes, recommendations, reference checks,
  election-package commentary and coordinator notes written in confidence by
  other members, and it stays sensitive after the applicant is elected — at which
  point they may hold `prospective_members.view` in their own right and, until
  now, could read the file that decided their own membership vote.

  A member is now matched to their own record by the transferred-user back-link,
  by an email address they own (department or personal), or by full name paired
  with a matching date of birth. Matching is deliberately conservative — name
  alone collides (two J. Smiths in one department is routine) and a false
  positive would hide a real applicant from a coordinator.

  The guard is registered on the whole prospective-members router rather than per
  endpoint, so all 20 `{prospect_id}` routes — and any added later — inherit it.
  It answers `404`; a `403` would confirm what the caller must not learn anything
  about. Collection surfaces filter instead, so the caller simply never sees the
  row: prospect list (and its total), kanban board, pipeline stats, the
  election-package list, and label generation — a prospect label encodes the
  public status-check token.

**Fixed**

- **Prospect search now matches a full name.** The search box matched the raw
  query against first name, last name and email individually, so "John Smith" —
  the thing a coordinator actually types — matched no column and returned
  nothing, while "John" alone worked. Every whitespace-separated term must now hit
  some field, which also makes "smith john" find the same person.
- **Pipeline stats went from ~20 queries to two.** A 12-stage pipeline was
  costing one count query per status plus one per step to render a single stat
  header.

### Communications: categorised email templates and officer signature variables (2026-08-07)

**Added**

- **The email template catalogue is grouped into collapsible categories** —
  Members & Accounts, Events & Scheduling, Training, Elections, Inventory,
  Department Store, Other — with per-category counts. It had grown past three
  dozen entries rendered as one flat scroll. An active search expands every group
  so a hit is never hidden behind a collapsed header, and the category holding
  the selected template is force-expanded.
- **A department office directory.** A notice sent by a member-services clerk, or
  by a nightly scheduled task, had no way to be signed by the officer whose name
  belongs on it. Each office — President, Vice President, Chief, Deputy/Assistant
  Chief, Secretary, Assistant Secretary, Treasurer, Safety Officer, Training
  Officer, Quartermaster — resolves to a holder and exposes `{{<office>_name}}`,
  `{{<office>_title}}`, `{{<office>_email}}` and `{{<office>_phone}}` to **every**
  template.

  A holder is resolved by, in order: an admin override on the office; the member
  the office is linked to (so the values track that member's profile); or
  auto-detection from members carrying the matching position slug — so a
  department that never opens the new **Officers** tab still signs its notices
  correctly. Values are refreshed on every office write, when the Officers tab is
  loaded, and nightly, which catches changes made to the member behind an office
  rather than to the assignment. Only catalogued variable names are injected.

**Fixed**

- **Inventory change emails silently dropped every `{{organization_*}}`
  variable** — the notification service passed no organization to the renderer.

### Members: hard delete, and role saves that quietly stripped positions (2026-08-07)

**Fixed**

- **Saving a member's roles silently wiped their positions.** The endpoint loaded
  the member with their roles, ran a hand-written `DELETE` over every assignment,
  then reassigned the collection — so the ORM diffed against a stale collection,
  positions present in both the old and new set looked unchanged and were never
  re-inserted, and dropping one raised a stale-data error. Both raw deletes are
  gone; the collection assignment does the whole job.
- **Permanently deleting a member returned a server error.** The same pattern:
  the continuity guard that runs first loads every active member _with_ their
  positions, so the raw delete removed rows behind the ORM's back and the flush
  aborted the transaction. Deleting the member is itself what removes those rows.
- **A member who had ever created a record could not be deleted at all.** Only
  165 of the ~280 foreign keys into members declare SET NULL and 41 CASCADE; 74
  attribution columns (`created_by`, `approved_by`, `issued_by`, …) were never
  given a delete rule, so the database treats them as RESTRICT. Deletion now
  clears the 62 nullable ones first, matching the SET NULL intent the rest of the
  schema declares. The 12 that are NOT NULL (budgets, purchase requests, expense
  reports, IP exceptions and friends) cannot be cleared without falsifying who
  requested or filed the record, so the request is **refused with a `409` naming
  them**, pointing at deactivate + anonymize — which strips personal information
  while leaving those records owned. Both lists are derived from the schema at
  delete time, so tables added later are covered without editing the service.
- **The admin page discarded the server's explanation** and always showed "Unable
  to permanently delete the member", so the `409` never reached the admin.
- **The deletion-impact modal declared a documents count it never computed**
  (always 0). It now counts documents by uploader, and no longer claims documents
  are deleted — they are kept with the uploader cleared.

### Security: role sabotage, transport TLS, and storefront search (2026-08-07)

**Fixed**

- **A `roles.edit` holder could destroy a role more powerful than their own
  (ORU-7).** The existing grant ceiling only inspects the permission list being
  _written_, and returns early when that list is empty — so an admin without full
  access could save the organization's only System Owner role with no permissions
  and wipe it, or with a small in-ceiling set and downgrade it, locking the tenant
  out of its own administration. Checking the new values could never catch this,
  because it is sabotage rather than escalation. Modifying a role now requires that
  your own access already covers everything that role **currently** holds. Blocked
  attempts raise a CRITICAL security alert, matching the grant ceiling.
- **Storefront search treated `%` and `_` as wildcards (SF-1).** Product and order
  search built the pattern with no escaping, so searching `%` returned the whole
  catalog — and the whole order list, every member's name and email, to a
  `storefront.manage` holder. The escape transform had been copy-pasted into seven
  services and is now a shared utility with unit tests, taking the explicit route
  rather than relying on the server's implicit default escape character.
- **`/store/` was missing from the API response cache exclusion list (SF-2).**
  Store order data is the same class of personal information the cache already
  excludes for finance and inventory charges: member names, shipping addresses,
  payment references and outstanding balances. There was no live exposure — the
  storefront's client does not install the cache interceptor — but this closes the
  gap before any storefront call is routed through the cached global client.
- **A variant group could be created against another organization's category
  (XC-1).** `category_id` arrived from the client with no organization check on
  create, and update reached it through a blind attribute write. Both are now
  validated.

**Added**

- **`SECURITY_REQUIRE_TLS`** promotes unset `DB_SSL`/`REDIS_SSL` in production
  from a boot warning to a CRITICAL finding, which the application already refuses
  to start on in production and staging. Without it, protected health information,
  sessions and cached queries cross the network in cleartext and nothing blocks
  the deployment. It **defaults to `false`**, so upgrading cannot refuse to boot an
  existing deployment that terminates TLS elsewhere — turning it on is the
  deployment owner's call. The distinct "TLS on but peer unverified" case stays
  CRITICAL regardless.

**Changed**

- The storefront module has been audited end to end (`docs/module-audit/storefront.md`) —
  it was added after the audit table was written and never got a row, so the newest
  module, and the only one that moves money, was unreviewed while the tracker read
  "complete". All 47 endpoints are authed, no unscoped by-id queries, exports use the
  safe CSV writer, and the money path prices every line from the catalog, locks
  products before counting limits, refuses to let self-reported payment move the paid
  amount, and requires an exact balance match on inbound captures.
- `docs/KNOWN_LIMITATIONS.md`: six MED rows described code that had since been fixed
  (the CSRF no-cookie branch, ORU-7's grant ceiling and last-admin guard, FIN-4, the
  self-certification half of CS-8, FE-6/FE-7, and the Black pin). Corrected, with the
  date each was verified against the code.

### Interface: colors that follow the theme, everywhere (2026-08-07)

**Fixed**

- **An app-wide scan for Tailwind color tokens with no counterpart for the other
  theme** surfaced 76 unpaired tokens; each was checked against the background it
  actually renders on, since a pale token on a fixed saturated surface is correct.
  The ones that genuinely rendered illegibly are fixed: pale text on theme-tinted
  panels (Reports, Forgot Password, Reset Password), white row dividers and page
  spinners on light surfaces (Apparatus list and form, My Training, Meeting
  Attendance), hover borders that gave no feedback in light mode (Minutes,
  Authentication Choice) and a selected-swatch halo that vanished into the surface,
  disabled buttons that washed out to unreadable (Documents, Scheduling, Shift
  Report settings) — now signalling disabled state with opacity, matching the
  button utilities — the check-in QR print page's URL, rendered at 10px in light
  gray on white and not reliably legible on paper or on the kiosk display, and the
  star-rating hover shade.
- **The CSV import page** carried several colors picked for a dark background:
  the instruction list and the per-row error list — the very messages a failed
  import needs read — were effectively invisible in light mode, the preview
  table's row separators vanished, the "Remove file" link had no hover feedback,
  and the validating spinner washed out on white.
- **The info/success/danger panels now take their colors from the stylesheet's
  alert tokens** rather than from per-page classes, so retuning an alert color is
  a one-line change instead of a sweep through the pages. This also picks up the
  tuned high-contrast values: a hardcoded dark-theme red was legible under
  high-contrast only because that theme also sets the dark class.

### Tooling, build and CI (2026-08-07 → 2026-08-08)

**Fixed**

- **`pypdf` bumped to 6.15.0** for CVE-2026-71852 and CVE-2026-71870, which were
  failing the Backend Security Scan on every pull request.
- **Two duplicate Alembic revision ids** (`20260807_0001`, then `20260807_0002`)
  from same-day pull requests merged without being rebased onto each other. A
  revision id is what Alembic writes to the version table, so a duplicate leaves
  the graph unresolvable rather than merely forked — the application cannot build
  the revision map at all, which crashes startup and so breaks deploys from
  `main`, not just tests. Renumbered and merged to a single head, with a new
  single-head assertion added to the migration-chain guard: the existing tests
  catch duplicate ids, dangling parents and multiple roots, but a fork passes all
  three while still leaving `upgrade head` ambiguous.
- **The push-subscriptions table could not be created on a fresh install.** The
  migration named a character set without a collation, so the table took the
  server's default collation rather than the database's, and a foreign key
  requires both sides to agree on collation as well as type.
- **The frontend image now installs from the lockfile.** It copied only
  `frontend/package.json` and re-resolved 604 unpinned packages from the registry
  on every build, so production shipped dependency versions no test had ever run
  against — and nothing pinned what landed in the image. The build context is now
  the repository root, which puts the single root lockfile in reach; every compose
  file and documented build command that named `./frontend` as the context is
  updated, including the two Unraid files.
- **The frontend container has been reporting unhealthy in production as well as
  CI.** nginx binds IPv4 only, the container resolves `localhost` to both
  families, and musl returns the IPv6 address first — so the healthcheck was
  refused. Both the image's healthcheck and the test now name `127.0.0.1`.
- **The pre-commit hook had never fired for anyone.** There was no `prepare`
  script, so the hooks path was never set — which is how a lint violation reached
  `main` and broke Backend Lint on every open pull request. Three further faults
  would have kept it from working once installed (a removed v8 idiom, repo-root
  paths passed to tools run from `backend/`, and every tool's stderr discarded).
  It now delegates to the lint-staged config that was already declared, and runs
  ESLint from `frontend/`, where the flat config lives — previously every commit
  touching a TypeScript file aborted with "couldn't find an eslint.config".
- **Backend Lint stopped at the first failing tool**, so for the two days a
  violation sat on `main`, no pull request verified formatting or import order at
  all. The three checks now run independently. Repo-root Python (`scripts/`,
  `generate_registry.py`) was linted by nothing and is now in scope; `alembic/` is
  now covered by both `lint:backend` and CI, which previously disagreed with the
  pre-commit hook about which files exist.
- **The test suite ran against the developer's own working database**, since that
  is what `.env` points at. The per-test transaction is rolled back so nothing is
  written, but tests still _read_ it, and several assert on an empty slate — 37 of
  46 apparent "pre-existing failures" were this. `pytest` now points at
  `intranet_test` and creates it if absent, so it stays a single command on a
  fresh checkout; CI can still name the database by exporting `DB_NAME`.
- **Node floor corrected to >= 22.** The root install builds the frontend
  workspace, so the frontend's floor is the real floor; the old `>= 18` / npm
  `>= 9` range understated it.

**Changed**

- **Documentation screenshots are quantized at capture** rather than stored in Git
  LFS, which this environment's network policy blocks — pointers would commit fine
  and then be unresolvable for anyone cloning. A typical capture drops from ~500 KB
  to ~125 KB with no visible difference on flat UI screenshots; the existing 123
  images went from 42 MB to 12 MB. The capture tool now also detects an error-boundary
  page and fails the shot, after one crash was applied into a guide as though it
  were the feature.
- **`./dev_env.sh`** starts the database, cache, API and dev server and blocks until
  they answer, and the demo seeder is now self-healing over repeated runs.

**Known issue**

- **Submitting a shift equipment check fails** for any shift with an apparatus
  assigned. `shifts.apparatus_id` is an unconstrained string carrying a scheduling
  apparatus id, while the equipment-check table's column is a real foreign key to the
  apparatus table, and the create path copies one straight into the other. Every route
  to a fix means picking a side in a two-apparatus-tables inconsistency, which is a
  design decision rather than a patch, so it is reported rather than guessed at. See
  `docs/KNOWN_LIMITATIONS.md`.

### Medical screening: the Records list now shows the member's name (2026-08-06)

**Fixed**

- **Every row on the medical-screening Records tab showed "Unknown" instead of a
  name.** The record list and detail responses left the member/prospect, reviewer,
  and requirement names blank, so the screen fell back to "Unknown" for each entry.
  Those names are now filled in (matching the expiring-screenings and compliance
  views, which already showed them).

### Error messages: structured server errors now read correctly (2026-08-06)

**Fixed**

- **Some error notifications showed "[object Object]" instead of the real
  message.** When the server returned a structured error (for example, the
  "a previously archived member matches this prospect" conflict), the shared error
  handler couldn't read it and displayed a placeholder. It now surfaces the actual
  message across every screen that uses it.

### Roles: an admin can no longer edit a role more powerful than their own (2026-08-06)

**Fixed**

- **A privileged-but-not-top-level admin can no longer weaken the highest role.**
  Previously the check that stops you granting permissions above your own level
  didn't stop you from _editing_ a role that already held them — so an admin
  without full access could blank out or downgrade the "System Owner" role,
  disrupting who can administer the department. Editing a role now requires that
  your own access already covers everything that role currently holds.

### Events: RSVP guards and a template-email crash fix (2026-08-06)

**Fixed**

- **You can no longer RSVP to an unpublished (draft) or already-ended event.**
  RSVPs were blocked for cancelled events and past the RSVP deadline, but a draft
  event (before it's published) or an event that had already ended with no
  deadline set would still accept an RSVP. Both are now rejected.
- **Sending a template email no longer errors when a field is blank.** A missing
  value (e.g. an event request with no contact name) could cause the "send
  template email" action to fail; blank values are now handled cleanly.

### Reports: two training/overview figures now read correctly (2026-08-06)

**Fixed**

- **The training-summary completion rate is no longer skewed low.** The rate
  counted only current members' completed courses in the numerator but divided by
  every training record (including departed and exempt members'), understating the
  true completion rate. It now divides by the records that belong to the members
  being reported on.
- **The department overview's check-in count now respects the report period.**
  Total check-ins were counted for all time even though the rest of the report
  (events, training) is limited to the selected date range; check-ins are now
  counted only for events within the period.

### Forms: stricter required fields and no internal errors leaked on public forms (2026-08-06)

**Fixed**

- **A required form field left blank is now correctly rejected.** Previously a
  required field could be satisfied by an empty or whitespace-only value (or, for
  multi-select, nothing chosen); it now requires a real answer. Number and
  checkbox fields answered with `0` or "unchecked" still count as answered.
- **Public form submissions no longer surface internal error details.** If a
  submission hit an unexpected server error, the raw message could be returned to
  the (unauthenticated) submitter; it now returns a generic message while the full
  error is logged server-side.

### Integrations: editing one setting no longer resets the others (2026-08-06)

**Fixed**

- **Updating a single field of an integration's configuration silently reverted
  the rest to their defaults.** Because a partial save re-applied every
  unspecified field at its default value, changing (for example) a Salesforce
  integration's sync direction would quietly reset its member-matching strategy,
  auto-sync, and other options. Saves now change only the fields you actually
  edited and leave everything else untouched.

### Prospective members: applicant privacy and a clearer duplicate warning (2026-08-06)

**Fixed**

- **Editing an applicant no longer records their date of birth or home address
  in the activity log.** The change history shown on an applicant's activity tab
  previously stored the exact old and new values of every edited field — so
  changing a date of birth or street address wrote those values into a log
  visible to anyone who can view prospective members. Sensitive fields (date of
  birth and address) now record only that the field changed, keeping the "who
  changed what, and when" trail without exposing the value.
- **The "this applicant matches an archived member" warning now reads
  correctly.** Adding an applicant who matches a previously-archived member
  showed a broken notification (it rendered as raw placeholder text). It now
  shows a clear message naming the member so leadership can reactivate them
  instead of creating a duplicate. The member's internal record id is no longer
  included in that response.

### Minutes management shows for the right role, and can't reference another org's data (2026-08-06)

**Fixed**

- **Users who could manage minutes saw no management controls, while users who
  couldn't saw controls that failed.** The minutes pages decided whether to show
  edit/approve controls from the `meetings.manage` permission, but the backend
  gates every minutes write on `minutes.manage`. So a member granted
  `minutes.manage` saw a read-only page, and a member with only `meetings.manage`
  saw buttons that returned "forbidden" on click. Both pages now check
  `minutes.manage`, matching the API.
- **Meeting and minutes records validated their links.** Creating minutes, a
  meeting, or an action item stored a client-supplied event or assignee id
  without checking it belonged to your organization; those ids are now validated
  in-org. A related error-handling gap meant an invalid template on minutes
  creation returned a 500 instead of a clear 400 — now corrected.

### Inventory: maintenance records, kit issuing, and reorder search hardened (2026-08-06)

**Fixed**

- **A "completed" maintenance record could silently update nothing.** Creating a
  maintenance record didn't verify the item belonged to your organization, and
  when marked completed against an item the caller couldn't see, the condition
  and inspection-date update was skipped while the create still reported
  success — so an NFPA inspection could record as done without advancing the
  item's next-due date. The item is now validated in-org before the record is
  written.
- **Issuing an equipment kit could fail with a confusing error.** The kit-issue
  path read an `optional` flag that no longer exists on the kit-item model, which
  raised on any kit with a missing item or a failed line, surfacing as a generic
  "failed to issue kit". Every kit item is now treated as required (the intended
  behavior) without crashing; making items genuinely optional is tracked as a
  follow-up.
- **Reorder-request search treated a literal % or \_ as a wildcard.** The reorder
  search now escapes LIKE wildcards like every other inventory search.

### Apparatus photos and documents can't be filed against another org's apparatus (2026-08-06)

**Fixed**

- **Uploading an apparatus photo or document didn't verify the apparatus was
  yours.** Both endpoints took the apparatus id from the URL and stored the row
  without checking it belonged to the caller's organization, so a request naming
  another department's apparatus id created a record pointing at it. Both now
  validate the apparatus is in-org before writing, closing the last two create
  paths in this module that lacked the check.

### Medical-screening: names show on the dashboard, and screenings can't be mis-filed cross-tenant (2026-08-06)

**Fixed**

- **The expiring-screenings dashboard showed "Unknown" for every member.** The
  compliance and expiring-soon responses never populated the member, prospect or
  requirement names, so the UI — which renders the member name or falls back to
  "Unknown" — always fell back. Names are now resolved server-side in a single
  org-scoped batch query per type.
- **A screening record could be filed against another organization's member.**
  Creating a record stored the supplied member/prospect/requirement ids without
  checking they belong to the caller's organization. Because the record holds
  protected health information, a wrong id mis-attributes a medical result to the
  wrong person. The ids are now validated in-org before the record is written.

### The room kiosk shows department time, and a stale check-in window is corrected (2026-08-05)

**Fixed**

- **The room kiosk rendered every time in the tablet's own timezone.** The
  kiosk page is deliberately public (a wall-mounted tablet cannot hold a
  session), so the hook that supplies the department timezone had no user
  profile to read and always fell through to the device's zone. A display left
  on its factory default — commonly UTC — showed event times and check-in
  windows shifted by hours. The public display response now carries the
  organization's timezone and the kiosk renders in it, keeping the browser zone
  only as a fallback.
- **`GET /locations/{id}/display` reported a check-in window that could not
  happen.** It computed "one hour before the event starts", but the real window
  is per-event configurable — the flexible default is 30 minutes, and a strict
  window opens at the event's actual start time. It now uses the same
  calculation the check-in endpoint enforces, which the public kiosk endpoint
  already did.

### Executive-session action items are no longer visible on the dashboard (2026-08-05)

**Fixed**

- **The unified dashboard action-item feed re-exposed restricted minutes.**
  `GET /dashboard/action-items` merges action items from the Meetings and
  Minutes modules and is available to any authenticated member. The minutes half
  filtered on organization only — so a member could read the description,
  assignee and due date of action items belonging to **unapproved drafts and
  closed executive-session minutes**, which is where personnel discipline,
  terminations and legal matters are recorded. The minutes module's own reads
  already restricted these to `minutes.manage` holders; the dashboard was a side
  door into the same rows. It now applies the same gate, keyed on the same
  permission, with a carve-out so a member still sees an action item assigned to
  them.

### Email subjects read correctly, and a scheduled email can't borrow another org's template (2026-08-05)

**Fixed**

- **Subject lines and plain-text email bodies were HTML-escaped.** The renderer
  applied one escaping path to all three of its outputs, but only the HTML body
  is markup. A department called "Falls Church Fire & Rescue" went out as
  "Falls Church Fire &amp;amp; Rescue" and a member named O'Brien as
  "O&amp;#x27;Brien" — in the **subject line**, and throughout the `text/plain`
  alternative that many clients and all screen readers use. The subject also
  reached the HTML wrapper already escaped and was escaped a second time into
  `<title>`. Escaping now applies only to the HTML body; the XSS boundary is
  unchanged (verified against an `onerror=` payload), and the subject is safe
  unescaped because CR/LF/NUL are already stripped from headers at the send
  layer.
- **A scheduled email could render another organization's template.**
  `POST /email-templates/schedule` stored a client-supplied `template_id`
  without checking it belonged to the caller's organization, and the send task
  then loaded it with no organization filter while eager-loading its uploaded
  attachments. An admin could schedule an email naming another department's
  template and have its body and files rendered and mailed to recipients they
  chose in the same request. Now validated at write time via `assert_in_org` and
  org-scoped at send time, which also neutralizes any row already stored.

### Consent is now enforced, client IPs are real, and the migration chain has one head (2026-08-05)

**Fixed**

- **The migration chain had two heads and a duplicate revision id.** Two
  branches merged the same day each claimed `20260805_0010` off parent
  `20260805_0009` — `drop_onboarding_checklist_table` and
  `reconcile_index_set`. Alembic cannot resolve a duplicate id, so
  `alembic upgrade head` (and therefore `npm run db:migrate`) **failed on every
  deployment**, and four migration-chain tests had been failing. The index
  reconciliation is renumbered to `20260805_0011` and sequenced after the drop;
  the two touch disjoint tables, so only the label and parent pointer moved. It
  is the same collision `20260805_0101` documents escaping, recreated within the
  hour — the renumbered file now records that.
- **Client IPs were the reverse-proxy's address in 39 places across 8 files.**
  `request.client.host` was used instead of `get_client_ip(request)`, so behind
  the production nginx every session row, audit event, security alert and vote
  recorded one identical internal IP. Three consequences worth naming: ballot
  fraud detection (`suspicious_ips` / `unique_ip_count`, documented in
  `BALLOT_FORENSICS_GUIDE.md`) was inverted into a permanent false positive
  rather than merely weakened; the IP-security module's own request/approval
  audit carried no attribution; and the **public-portal rate limiter was keyed
  on the proxy**, so all anonymous visitors shared one bucket and a single
  caller could lock out every visitor. Corrected going forward — rows already
  written still hold proxy addresses.

**Changed**

- **Member consent is enforced instead of merely recorded.**
  `ConsentService.has_consent` previously had **zero callers**: members could
  refuse photo use, public-roster listing, or SMS, and the choice was stored,
  audit-logged, and ignored. SMS is now gated on the recorded consent in both
  send paths (department-message escalation and the inventory low-stock alert),
  via a new bulk `granted_user_ids` helper that fails closed — never asked
  counts as refused. US TCPA requires express consent for text messaging.
- **Email is now the channel of record and is unconditional.** Every department
  message is emailed — not only urgent or acknowledgment-required ones — and
  email is no longer filtered by the `email_notifications` preference. This is
  what makes consent enforcement safe: consent may suppress a member's _text_,
  but never the notice itself, so nobody can be left able to say they were never
  told. The preference still governs the reminder and alert flows, and the
  settings-page wording was updated to say so.
- Note: `PHOTO_USE` and `PUBLIC_ROSTER_LISTING` consents are collected but have
  **no consumer to gate** — the app has no public roster and publishes no member
  photos today. Whoever builds either must gate on `has_consent`; the
  requirement is recorded in the `consent_service` docstring.

### Training: a course can carry a syllabus, and a cohort runs it (2026-08-05)

**Added**

- **A course now has classes.** `course_classes` (migration `20260805_0001`) is
  the syllabus of a multi-class course — the fifteen subjects that make up a
  recruit school. Each row links to a catalog course (`class_course_id`, NOT
  NULL: that link is what carries the class's credit hours, certification
  settings and category tagging) and is timed _relative to the course start_ —
  `day_offset` plus a local `start_time` — rather than pinned to a calendar
  date. That is the whole point: the same outline schedules a spring and a fall
  intake without being retyped. Unique on (`course_id`, `sequence`).
- **A cohort is one run of that course.** `course_cohorts` +
  `course_cohort_classes` + `course_cohort_members`. Generating a cohort walks
  the syllabus, resolves every offset into a real UTC datetime, and creates
  **one Event and one linked TrainingSession per class** — not one session for
  the whole course. That is deliberate: attendance, sign-in/out, credit hours
  and pipeline progress in this platform all hang off a single event, so a
  fifteen-class school has to be fifteen events for a student to check into
  class 7 and be credited for class 7. Generation runs in one transaction
  (`create_training_session` gained `commit=False`), so a failure part-way
  cannot leave seven of fifteen classes on the department calendar with no
  cohort to manage them.
- **The cohort class row is the stable identity**, not the event. The Event and
  TrainingSession are its current realization. That separation is what lets a
  class be rescheduled or cancelled without losing the cohort's record of it,
  and what makes regeneration idempotent — `uq_cohort_class_source` on
  (`cohort_id`, `course_class_id`) means re-running generation can never
  duplicate a class, and `event_id` is `SET NULL` (not `CASCADE`) so an event
  deleted through the events UI leaves a repairable gap rather than erasing the
  class.
- **Endpoints** — `/api/v1/training/courses/{course_id}/classes` (list, add,
  patch, delete, `/reorder`, `/autofill`) and `/api/v1/training/cohorts`
  (`/preview`, create, list, `/mine`, detail, `/regenerate`, `/shift`,
  `/cancel`, per-class reschedule/cancel, `/members`). All `training.manage`
  except the syllabus read and a roster member's view of their own cohort.
  Deliberately **not** `events.manage`: generating events is incidental to
  running a course, and the rest of the training module gates on
  `training.manage`, so requiring the events scope would lock training officers
  out of their own feature.
- **Preview before anything exists.** `POST /training/cohorts/preview` is
  read-only and returns every computed date with per-class warnings — a date
  moved off a weekend or blackout day, an archived catalog course, a room
  already booked. Generating drops N events onto the department calendar and
  RSVPs the whole roster to each, which is not an action to discover the
  problems with afterwards.
- **Officer-facing UI** — a syllabus builder inside the Course Library (with
  inline catalog-course creation, since a class _must_ link to one), a
  five-step cohort wizard whose preview step is editable per class, a "Course
  Cohorts" tab under Training → Records, and a cohort detail page carrying the
  operations a live recruit school needs: reschedule one class (the event moves
  with it), cancel one (the event is cancelled, not deleted, so anyone signed
  up sees the change), add an ad-hoc make-up class, or shift everything still
  to come by N days. Routes `/training/cohorts` and
  `/training/cohorts/:cohortId`.

**Changed**

- `TrainingSessionCreate` accepts `instructor_id`. The column existed on
  `TrainingSession` but no request could set it, so every session carried only
  the legacy free-text instructor name.
- `ProgramBuildRequirementInput` accepts `required_courses`, so a generated
  pipeline can express "did this member complete SCBA Operations?" and be
  measured by the existing course-completion evaluator rather than needing
  bespoke logic.
- `training_courses` gained a nullable `program_id`. The first cohort that
  builds a pipeline records it there, so later cohorts of the same course reuse
  that pipeline instead of building a duplicate.

> **Class times are local wall clock, resolved against the organization
> timezone at generation** — not a stored UTC offset. A recruit school running
> from September into December crosses a DST boundary; storing the offset would
> silently move the last third of the course by an hour.

### Storefront: an optional department store, and PayPal reconciliation (2026-08-05)

**Added**

- **Department Storefront module** (`/store`, `/store/orders`, `/store/admin`),
  optional per organization. A catalog with variants and per-variant stock,
  ordering windows, per-member limits, name embroidery, uploaded product
  photos, an order timeline, and payment tracking. Permissions:
  `storefront.view`, `storefront.order`, `storefront.manage`. Ten `store_*`
  tables. See [STOREFRONT_MODULE.md](docs/STOREFRONT_MODULE.md) and [training
  guide 18](docs/training/18-storefront.md).
- **The platform still never takes a payment.** There is no checkout and no
  money passes through the application; the store records what is owed and
  makes settling it fast to record. That is a deliberate scope boundary — a
  volunteer department generally cannot become a card processor, and holding
  card data would pull the whole deployment into PCI scope to sell forty job
  shirts a year.
- **Payment buttons for every configured method**, not only the one chosen at
  checkout. Venmo, PayPal and Cash App get prefilled deep links; Zelle gets the
  handle to copy. A member reading this on a phone may not have the app they
  picked a week ago, and from the department's side the money only has to
  arrive. Orders placed on a method the department later stops accepting keep
  their button — somebody who still owes on a Venmo order has to be able to pay
  it.
  - **Zelle deliberately has no link.** It runs inside each bank's own app and
    publishes no web or deep-link scheme, so a `zelle.com` URL would send
    members to a page that cannot pay anybody.
  - Cash App has a link but no note field, so the order number is displayed to
    type; Venmo carries it through, so it is not repeated there. The reference
    is what lets a treasurer match a payment, so it is never hidden — including
    when no method is configured at all.
  - A method with nothing configured is **hidden**, not rendered as a dead
    button. A link that goes nowhere tells a member the money moved when it did
    not.
- **PayPal integration** in the connections list (category _Payments_).
  Connecting a department's own PayPal **Business** account lets PayPal report
  what it received, and matching orders settle themselves. Signature
  verification is delegated to PayPal's own
  `/v1/notifications/verify-webhook-signature` endpoint rather than validating
  the certificate chain locally — the vendor-supported path cannot be fooled by
  a forged `PAYPAL-CERT-URL` header the way a hand-rolled verifier can. An
  integration with no webhook ID rejects every delivery rather than trusting
  it; Test Connection reports that as a warning instead of a bare success. See
  [STOREFRONT_PAYPAL.md](docs/STOREFRONT_PAYPAL.md).
- **A payment only auto-applies on an exact match**: the reference must name
  exactly one order number in `ORD-YYYY-NNNN` form _and_ the amount must equal
  that order's balance exactly. Fuzzy matching on payer name or amount alone
  was considered and rejected — two members can easily owe the same amount in
  the same window, and crediting the wrong member's order is worse than a short
  wait in a queue. Everything else lands in a review queue
  (**Store Admin → Payments**) with apply and dismiss actions.
- **Every inbound payment is recorded whether or not it matched.** The
  unmatchable ones are the point: the money has already left the member's
  account, so discarding the notification would leave them chasing an order
  that still reads unpaid.
- **Cash App and Zelle** joined Venmo and PayPal as store payment methods, with
  handle validation at save time. A typo'd `$cashtag` would otherwise make the
  button silently vanish with nothing telling the administrator why.
- **A contract test** comparing every storefront response schema's serialized
  field names against the matching TypeScript interface, in both directions.
  This class of drift is invisible by construction — Pydantic serializes
  whatever it has and TypeScript ignores response fields it does not know
  about, so a field added on one side and forgotten on the other produces no
  error anywhere and surfaces as a blank cell in front of a user.

- **A payment policy per department**, because the right answer to "what
  happens to somebody who ordered and hasn't paid" genuinely differs. _No
  payment gate_ (the default, and what the store did before) orders their item
  and lets them collect it. _Payment before pickup_ orders it like everyone
  else's but will not hand it over. _Payment before the vendor order_ holds
  them out of the purchase order entirely. Held-back orders are reported on the
  tally rather than dropped — the quartermaster has to see who is being left
  out, and chase them, before the order goes in. Bulk-fulfilling a window
  advances the settled orders and returns the rest by order number with the
  balance owed. Waiving a balance releases an order exactly as paying does, so
  a comp or a replacement clears the gate. Under the strictest rule an unpaid
  order also cannot be marked _ordered_, since the record would otherwise claim
  the vendor was told about an item deliberately left off the sheet. The
  setting is presented as a side-by-side comparison of all three rules — it is
  chosen before a catalog exists, so the consequences have to be readable
  without the manual — and changing it governs future transitions only, never
  rolling back a step already taken. The CSV export keeps every order, since it
  doubles as the treasurer's record, but gained a **Held From Vendor Order**
  column: without it the file read as a vendor sheet that quietly undid the
  policy the on-screen tally was enforcing.

- **The quartermaster's loop is complete end to end.** Orders can be filtered
  by the payment method actually used — each app settles as its own payout, so
  "show me the Zelle orders" is the question you have in front of a bank
  statement. Recording a payment now takes the method that was really used
  rather than the one the member picked at checkout: they chose Venmo and
  handed over cash at drill, and leaving it as Venmo makes the treasurer's
  reconciliation come up short with nothing to explain it.
- **The vendor order is recorded against the window** — who it went to, their
  reference, when, and the expected delivery date — in one action that also
  advances every eligible order to _ordered_ and emails the members that it has
  gone in. That email is the one members chase: between "ordering closed" and
  "come pick it up" there can be six quiet weeks. Orders the payment rule holds
  back are skipped rather than advanced, and come back named, since they were
  never on the sheet the vendor received.

- **A new store starts on cash alone.** It used to seed Venmo, PayPal, cash
  and check all ticked — but only cash works with nothing configured, so the
  settings screen showed a quartermaster three methods that were switched on
  and did nothing while members saw only one. Cash is the honest floor: no
  setup, and it works. Everything else is ticked as it is configured, and
  un-ticking everything normalizes back to cash rather than leaving a store
  nobody can pay.

- **Every notice the store sends now has its own switch.** The module sends
  nine emails and only four of them were behind a setting; the rest went out
  whenever the calling code happened to pass `notify_members=True`, so a
  department that did not want the "ordering is open" blast had no way to say
  so. Added `send_payment_receipts`, `send_window_opened`,
  `send_window_closing_reminder`, `send_window_closed` and
  `send_vendor_order_updates`, all defaulting on so nothing a department
  receives today stops arriving. Settings → Notifications now lists all nine
  grouped as order and window notices, each naming who receives it and when —
  including the two that surprise people, since _status changes_ also covers
  the cancellation email and _payment receipts_ covers waivers and refunds as
  well as payments.
  - A switch is a **ceiling, not a duplicate**. The per-send "email members"
    box still skips an individual send and a window can still decline to
    announce itself, but neither can send a notice the department switched
    off. A note a quartermaster types on an order and presses send on is not
    behind a switch — that is a message, not a notice the module raised.
  - These bodies stay composed in code rather than joining the admin-editable
    Email Templates screen: each is a rendered table of order lines and pay
    buttons, not prose. What a department words itself is settings —
    payment instructions, per-method notes, the receipt footer, a window's
    pickup instructions, and the free-text message each announcement takes.

- **Every notice can be previewed before it is switched on.** A **Preview**
  button on each row of Settings → Notifications opens the real email —
  subject, layout, logo and pay buttons — rendered against a sample job shirt
  order and a sample window and shown in a sandboxed iframe at desktop or
  phone width. It is the fastest way to answer the questions that actually
  bite: is the cashtag right, does the Zelle handle read properly, is a method
  ticked that was never configured. `GET
/store/settings/notifications/{notice}/preview`, permission
  `storefront.manage`.
  - **The preview runs the real `send_*` method.** The notification service
    takes a capture list that diverts the composed message instead of
    delivering it, so what is shown is byte-for-byte what would be sent. A
    separately-built approximation drifts from the email, and the
    quartermaster who approved the preview would have approved something else.
  - **The order and window are invented; the settings are real** — payment
    handles, instructions, receipt footer, currency, store name and branding
    all come from the department's own saved configuration, since checking
    those is the point. Nothing is written and no member address is resolved,
    so a brand-new store with no members and no orders previews fine.
  - A switched-off notice still previews, since otherwise you could not look
    before deciding to turn it on, and the panel says it is off.

- **A quartermaster can mail themselves any of the nine.** _Send this to me_
  inside the preview delivers the same composed message to the requesting
  user's own inbox. An iframe is not an inbox — Gmail and Outlook rewrite email
  HTML, and whether the Venmo button taps through on a phone is a question only
  a real message answers. `POST
/store/settings/notifications/{notice}/test`, permission `storefront.manage`,
  so it needs no org-admin rights (the existing Communications test-email does,
  and could only send a generic message or a stored template — never one of
  these).
  - **Only ever to the caller's own address.** There is no recipient parameter,
    so this cannot become a way to mail the department from the settings
    screen; the window notices do not resolve the roster either.
  - **Marked as a test in both bodies** — `[TEST]` subject prefix and a banner
    — because the sample announces "Order ORD-2026-0042 received", and an
    unmarked copy in an inbox is a message somebody acts on three weeks later.
  - Email not being configured is reported (`delivered: false`) rather than
    raised: that is a setup gap, not a failure of the notice under test.
  - Logged to `message_history` under the notice's own `storefront_*` type and
    audited as `store_notification_test_sent`.

- **The storefront's notices are now editable in Communications → Email
  Templates**, as ten `EmailTemplateType.STOREFRONT_*` entries with shipped
  defaults, variable catalogues and sample data. They were the only emails on
  the platform a department could switch on and off but not word.
  - **Ten templates, nine switches.** The cancellation notice gets its own
    rather than sharing the order-update row — rewording "your order is ready"
    must not silently change what a cancelled member reads. It still rides the
    status-updates switch.
  - **A department that never opens the editor sees no change.** Each `send_*`
    builds both the message it has always composed and a context of variables;
    the template is used only when a row exists and is active, and the coded
    body is the fallback rather than a stub. Deactivating a template undoes an
    edit without losing it, and _Reset to default_ restores the shipped body.
  - **Computed parts arrive as variables**, since the template system
    substitutes `{{name}}` with no loops and a table of order lines cannot be
    written in a body: `items_table_html`, `payment_block_html`,
    `receipt_footer_html`, `member_notes_html`, `payment_summary_html`,
    `balance_notice_html`, `cancellation_reason_html`, `refund_notice_html`,
    and the three window chunks — the same `_RAW_HTML_VARIABLES` arrangement
    property return reminders use for `items_list_html`. Removing one from a
    body does what it looks like: drop `{{payment_block_html}}` and members
    stop being told how to pay.
  - The Notifications panel's **Preview** and **Send this to me** render
    whichever version is in force, so an edit can be checked where it will be
    read. Template lookups are cached per service instance — a reminder run
    walks up to 200 orders and would otherwise re-read one row 200 times.
  - Widens the `template_type` enum on `email_templates` and
    `scheduled_emails`. Note for anyone reading a send log: cancellations
    previously recorded as `storefront_order_update` and now record as
    `storefront_order_cancelled`.
  - **Storefront notices are excluded from the Schedule Email picker.** Each
    reads entirely from an order or window that does not exist when one is
    scheduled by hand — the recipient would get "Order&nbsp;&nbsp;received"
    over an empty table. They are raised by the store, and now editable, but
    never scheduled.
  - The template cache is keyed by `(organization_id, template_type)`. Every
    caller builds one service per org, so the notice alone would be enough
    today — but a cache that is only correct because of how it happens to be
    called is one refactor away from mailing one department's wording to
    another's members.
  - Behaviour at the awkward edges, all pinned by tests: a blank subject or an
    empty text body falls back to the built-in one rather than sending a
    subject-less or blank-bodied email; a misspelled variable renders as
    nothing rather than reaching a member as `{{ordr_number}}`; deleting a
    template restores the shipped default on the next visit to the editor,
    while marking it inactive is the reversible undo; and editing a template
    never switches its notice on — the switch still gates it.

**Fixed**

- **A held order could be marked ready for pickup.** Under _payment required
  before the vendor order_ the item was never bought, so the shelf is empty —
  and "ready for pickup" is worse than merely inaccurate, because it emails the
  member to come and collect something that does not exist. That transition is
  now gated alongside _ordered_ and _fulfilled_.
- **Window rollups truncated at one page.** Order counts and sales totals were
  summed in Python over a paged query, so any window larger than 200 orders
  silently under-reported. Now computed in SQL.
- **Stock could go negative under concurrency.** Two members ordering the last
  item on a Sunday night could both pass an availability check. Orders touching
  tracked stock now take `SELECT … FOR UPDATE` in a stable id order, which also
  avoids deadlocking them against each other.
- **`StoreSettings`, `StoreOrder`, `StoreProduct` and `StoreOrderWindow`**
  omitted `createdAt`/`updatedAt` in their TypeScript interfaces while the
  backend had always sent them. Found by the new contract test.
- **Shift-completion tests failed on MariaDB.** They built datetimes as
  TZ-offset string literals, a MySQL 8.0.19+ syntax MariaDB rejects with error 1292. Since `docker-compose.arm.yml` ships MariaDB 10.11, that is a supported
  target, not an environment quirk.

**Changed**

- **CI runs backend integration and contract tests against both MySQL 8.0 and
  MariaDB 10.11** via a service-container matrix, so a dialect difference fails
  in CI rather than on somebody's ARM deployment.
- **The backend lint gate covers `tests/` as well as `app/`**, and
  `lint:backend` now runs isort alongside flake8 and black. `tests/` being out
  of scope is how 85 flake8 violations accumulated unseen — lint-staged only
  lints _staged_ files, so a test file's problems surfaced to whoever next
  touched it rather than whoever introduced them. All 85 are cleared: 60
  compound assertions split (a compound assert reports the whole expression on
  failure, so it tells you the line failed but not which half), 8 bare
  `pytest.raises` given `match=` parameters (each could previously have passed
  on an unrelated error raised earlier in the call), plus PT004/PT012/PT019.
- **Frontend ESLint is at zero warnings.** Two test files reached through
  `.parentElement` and `querySelectorAll` and now fire on the child and query
  by role; `CourseLibraryRoute` moved out of the training module's `routes.tsx`
  into its own file so that file exports only its route factory and Fast
  Refresh works for the module again.

### Security: date of birth and emergency contacts are leadership-only (2026-08-04)

**Security**

- **The last two ORU-8 disclosure gaps are closed.** Each was a call site that
  did not consult a policy the codebase already expressed.
  - `GET /users/{id}/with-roles` returned the raw user record while its sibling
    `GET /users/with-roles` redacted against the organization's
    `contact_info_visibility` setting. Both need only `users.view`, so the
    setting was advisory — anything the roster withheld was one request to the
    detail URL away, plus `personal_email` and the full home address, which the
    roster never exposes at any setting. Both endpoints now share
    `_clear_hidden_contact_fields` and `_load_contact_visibility` (which fails
    closed when the settings row cannot be read) so they cannot drift again.
    `members.manage` holders **and the subject** are exempt: the settings page
    loads a member's own profile through that endpoint and writes the fields
    back, so redacting for self would have blanked their own address and phone
    on the next save.
  - `without_infrastructure()` stripped mail host, S3 bucket, SSO issuer and
    OAuth client IDs from `GET /organization/settings` but not `it_team`, so
    every authenticated member still received the names, direct email and phone
    of whoever administers the deployment — plus `backup_access`, an
    unstructured dict holding whatever an admin wrote about break-glass access.
    Now emptied (rather than nulled, so the settings UI still renders the
    section) for callers without `settings.manage`.
- **Date of birth and emergency contacts are restricted to leadership.** Both
  were served to any `users.view` holder by the two with-roles endpoints, and
  `MemberProfilePage` rendered the emergency-contacts section to any viewer —
  `canEdit` gated editing, not viewing. They are now cleared for everyone
  except `members.manage` holders and the member themselves. They are handled
  separately from the contact block because they are a different category:
  `contact_info_visibility` deliberately has no flag for them, so **no
  organization setting can publish them**. Emergency contacts are also PII
  belonging to people who are not members of the department at all — a member's
  spouse or parent, by name and phone — who never consented to appear in a
  roster and hold no account to remove themselves.
- **Disclosure is recorded, not just access.** The existing `user_viewed` audit
  event now carries `restricted_pii_disclosed`, so the trail answers who saw
  another member's date of birth and family contacts rather than merely who
  opened a profile.

**Changed**

- The member profile **hides** the emergency-contacts section from viewers who
  may not see it rather than rendering it empty — an empty section reads as
  "none on file", which is a different and wrong statement about the member.

### Finance: dues payments are a ledger, not a running total (FIN-6) (2026-08-04)

**Fixed**

- **Recording a payment silently reversed a waiver.** A payment against a
  `WAIVED` record recomputed `status` to `PAID`/`PARTIAL` while leaving
  `waived_by`, `waived_at` and `waive_reason` populated — a row that
  contradicted itself. Because the dues summary derives `total_waived` from
  `status == WAIVED`, the waived amount silently moved into collections with
  nothing recording that it had ever been waived. Payments against `WAIVED` and
  `EXEMPT` records are now refused with an explanatory error.
- **Every payment erased the previous payment's detail.** `payment_method`,
  `transaction_reference` and `notes` were each assigned from
  `kwargs.get(...)`, and the endpoint passes `**data.model_dump()`, which
  materializes every omitted optional field as `None` — so a second partial
  payment that did not re-send `notes` destroyed the first payment's,
  unrecoverably. Fields are now assigned only when supplied.
- **A retried payment double-credited collections.** `amount_paid` accumulated
  on every call with nothing consulting `transaction_reference`, so a
  double-clicked Save or a replayed request charged the member twice.

**Added**

- **`dues_payments` ledger** (migration `20260802_0001`) — one row per payment,
  with `recorded_by` (`SET NULL`, nullable: the ledger must outlive the
  treasurer who entered it). The columns on `member_dues` became a projection
  of it: `amount_paid` is **re-derived** as the sum of the ledger by
  `_apply_payment_totals` rather than added to a running figure, and
  `payment_method` / `transaction_reference` / `notes` project the newest row.
  A double-credit would require a duplicate ledger row, which the uniqueness
  constraint on `(member_dues_id, transaction_reference)` refuses — the bug
  class stops being representable instead of being guarded against. Payments
  with no reference — cash at a meeting — are never deduplicated, because two
  identical cash amounts are two payments and collapsing them would lose money.
  The migration backfills one row per already-paid record, without which a
  derived total would recompute an existing balance to zero.
- **`GET /finance/dues/{id}/payments`** (`finance.view`) — the ledger, oldest
  first. The dues record carries only the derived total and the newest
  payment's detail, so this is the only place earlier payments can be read
  back; a history nobody can read would be half a fix.
- **`POST /finance/dues/{id}/unwaive`** (`finance.manage`, reason required) —
  payments against waived dues are refused and `PUT /dues/{id}` _is_ the
  payment route, so `WAIVED` had no exit: a department that waived by mistake
  and then received the money had no in-app remedy. The gap predates the guard
  but was masked, because recording a payment used to clear the status as a
  side effect of the bug. Reversal restores whatever the ledger says — PENDING
  when nothing was paid, PARTIAL or PAID when something was. The waive reason
  is cleared rather than left on an un-waived record (the same contradictory
  row FIN-6 was about) and carried into a `finance.dues_waiver_reversed` audit
  event alongside the reason for the reversal.

> **Backend only.** `DuesManagementPage` is read-only and no frontend code calls
> the payment, waive, unwaive or ledger endpoints, so these behaviors are
> reachable through the API alone until the dues management UI is built. The
> gap predates this work and is recorded in `docs/KNOWN_LIMITATIONS.md`.

### Tooling: CI restored, lint pins aligned, dependency bumps (2026-08-04)

**Fixed**

- **No backend test had been running on main.** `backend/requirements.txt` was
  unresolvable — `isort==8.0.1` against `pylint==3.3.4`, which requires
  `isort<7` — so `pip install` exited `ResolutionImpossible` and Backend Unit
  Tests and Backend Security Scan both died at their install step, which in
  turn skipped Backend Integration Tests, Backend API Contract Tests and the
  Docker image build. pylint 4.x widens the cap to `isort<9`, so the pin moves
  up rather than holding isort back.
- **Backend Lint was green against a toolchain nobody ran.** CI's "Install
  linting tools" step claimed to mirror `requirements.txt` but installed flake8
  7.2.0 / isort 5.13.2 against 7.3.0 / 8.0.1 there, and omitted
  `flake8-pytest-style` entirely. Aligning them surfaced two real
  disagreements: isort 8 wraps a from-import differently once a sibling `as`
  alias has split it (three files reformatted), and PT028 fires on any function
  named `test_*`, catching two FastAPI "test connection" route handlers whose
  `Depends()` defaults the framework requires (added as documented per-file
  ignores rather than changing the endpoints).
- **`npm ci` failed on main** with "Missing: vite@8.2.0 from lock file" and 37
  other entries; the lockfile was regenerated on top of main.

**Changed**

- **Dependency bumps**: `jsdom` 26 → 30, `@testing-library/jest-dom` 6 → 7,
  `@hookform/resolvers` 3 → 5, `lint-staged` 15 → 17, `react-hook-form` 7.84.0,
  `@playwright/test` 1.62.1, `vitest` 4.1.10, `typescript-eslint` 8.65,
  node 25 → 26-alpine in the frontend image; backend `black` 26.5.1,
  `mypy` 2.3.0, `faker` 40.36.0, `aiofiles` 25.1.0, `boto3` 1.43.61;
  `aquasecurity/trivy-action` 0.36.0.
- **New `utils/displayValue.ts`.** typescript-eslint 8.65's
  `no-unnecessary-type-assertion` sees through `'x' in value` narrowing and
  flagged 105 assertions across 54 files. Where an assertion was the only thing
  keeping `String()` off an `unknown` report value, removing it exposed
  `no-base-to-string` — those sites now use `toDisplayString()`, which
  JSON-encodes objects rather than rendering `[object Object]`. The assertions
  had been asserting a shape the API never guaranteed.
- Test assertions that used `toHaveBeenCalledOnce()` now assert their real
  arguments (`@vitest/eslint-plugin` 1.6.24 flags it). The autofix would have
  written a bare `toHaveBeenCalledExactlyOnceWith()`, which asserts _zero_
  arguments — banned by Pitfall #13 and wrong for the sites in question.

### Members: CSV import template matches what the API accepts (2026-08-04)

**Fixed**

- **`pip install -r backend/requirements.txt` could not resolve.** `isort==8.0.1`
  against `pylint==3.3.4`, which caps `isort<7`. pip exited
  `ResolutionImpossible`, so Backend Unit Tests and Backend Security Scan died
  at their install step and took Backend Integration Tests, API Contract Tests
  and the Docker image build down with them — **no backend test had been running
  on `main`.** pylint moved to 4.x, which widens the cap, rather than holding
  isort back.
- **CI lint pins had drifted from `requirements.txt`.** The workflow claimed to
  mirror it but installed flake8 7.2.0 / isort 5.13.2 against 7.3.0 / 8.0.1, and
  omitted `flake8-pytest-style` entirely, so Backend Lint was green against a
  toolchain nobody actually ran. Aligning them surfaced an isort 5-vs-8
  disagreement on wrapping from-imports split by an `as` alias (three files
  reformatted) and two PT028 false positives on FastAPI "test connection" route
  handlers (documented per-file-ignores).
- **`npm ci` could not install.** The lockfile was missing `vite@8.2.0` and 37
  other entries, breaking every frontend CI job. Regenerated, and the
  `npm-minor-patch` group bump (21 packages) applied on top.
- **`tsc --noEmit` failed on `main`.** The `IntersectionObserver` test mock was
  missing `scrollMargin`, required by TypeScript 7's `lib.dom`.
- **Report cells could render `[object Object]`.** Removing type assertions the
  upgraded `typescript-eslint` flagged exposed that report renderers were
  asserting a shape the API never guaranteed; a new `toDisplayString()` util
  JSON-encodes objects instead.
- **`toHaveNoViolations()` silently lost its type.** vitest 4.1 stopped hoisting
  `@vitest/expect`, so the `vitest-axe` matcher augmentation targeting that
  module specifier no longer resolved. Now augments `vitest`.

**Security**

- **Member contact details could be read past the visibility setting (ORU-8).**
  `GET /users/{id}/with-roles` returned the raw member record while its sibling
  roster endpoint redacted against `contact_info_visibility`. Both need only
  `users.view`, so anything withheld on the roster — including home address and
  personal email, which the roster never exposes at any setting — was one
  request to the profile URL away. Both now redact through shared, fail-closed
  helpers. Members-managers and **the member themselves** are exempt; the
  settings page loads a member's own profile through that endpoint and writes
  the fields back, so redacting for self would have blanked their own address on
  the next save.
- **Date of birth and emergency contacts are now leadership-only.** Restricted
  to `members.manage` holders and the member themselves, with no organization
  setting able to publish them. Emergency contacts name people outside the
  department — a spouse, a parent — who never consented to appear in it and hold
  no account to remove themselves. Disclosure is recorded on the `user_viewed`
  audit event, and the profile page hides the section entirely rather than
  rendering it empty, which would read as "none on file".
- **Organization settings still exposed the IT team block (ORU-8).** The
  infrastructure strip covered mail host, S3 bucket, SSO issuer and OAuth client
  IDs but missed `it_team` — the names, direct email and phone of whoever
  administers the deployment, plus `backup_access`, free text describing
  break-glass procedures. Now emptied for callers without `settings.manage`.

**Changed**

- **Member dues are now a payment ledger rather than a running total (FIN-6).**
  `MemberDues` was the only record of payment: one `amount_paid` figure plus one
  set of method/reference/notes columns, overwritten by whichever payment was
  entered last. Three defects followed from that single design fact — a retried
  submission double-credited because nothing consulted `transaction_reference`;
  a second instalment that didn't resend `notes` destroyed the first payment's,
  unrecoverably; and recording against a `WAIVED` record cancelled the waiver
  while leaving its reason attached, moving the waived amount into collection
  figures.

  Each payment is now a row in `dues_payments`, and `amount_paid` is **re-derived
  as the sum of that ledger** rather than accumulated. Double-crediting would
  require a duplicate ledger row, which a uniqueness constraint on
  `(member_dues_id, transaction_reference)` refuses — the failure stops being
  representable rather than being guarded against. Payments without a reference
  are never deduplicated, because two identical cash amounts are two payments.

  Migration `20260802_0001` **backfills one row per already-paid record**; without
  it, derived totals would recompute every existing balance to zero.

  `GET /finance/dues/{id}/payments` exposes the ledger, and
  `POST /finance/dues/{id}/unwaive` reverses a waiver — necessary because
  refusing payments on waived dues would otherwise leave no way out of `WAIVED`.

### Security & correctness follow-up (2026-08-01)

**Fixed**

- **Offline queues shared one database at two versions.** `offlineQueue.ts`
  opened `logbook-offline` at version 1 while `shiftReportOfflineQueue.ts`
  opened the same database at version 2. IndexedDB rejects an open below the
  stored version, so the first queued shift report permanently broke
  equipment-check queueing on that browser profile. Name, version and upgrade
  path now live in one shared module.
- **A blocked IndexedDB open never settled.** `open()` fires `blocked` — and
  neither `success` nor `error` — when another tab holds the database during
  an upgrade, so the promise hung forever. Logout awaits the shared-device
  purge, so this could strand a member signed in on a station computer. Opens
  now reject on `blocked` and on timeout, close a handle that arrives late,
  and set `onversionchange` so an open tab stops blocking other tabs.
- **Queued shift reports were never purged at logout** — the densest PII of
  any offline store (crew rosters, trainee evaluations, narratives).
- **The dashboard could white-screen.** `progress?.requirement_progress
.filter()` guarded the object but not the array, so an enrollment whose
  progress payload omitted the key threw during render and the ErrorBoundary
  replaced the whole page.
- **Notification rows nested a `<button>` inside a `<button>`**, which is
  invalid HTML — the browser closes the outer element early and assistive
  technology receives a broken tree.
- **`/training/category-hours/` was cacheable** by the client SWR cache
  despite being per-member training data; added to `UNCACHEABLE_PREFIXES`.
- **Four documented frontend env vars did nothing.** `VITE_WS_URL`,
  `VITE_ENV`, `VITE_ENABLE_PWA` and `VITE_ENABLE_ANALYTICS` were declared and
  documented but read by no code. Two were actively misleading: the inventory
  socket derives its URL from the page origin (which is what makes it work
  behind a reverse proxy), and the PWA plugin is registered unconditionally,
  so setting `VITE_ENABLE_PWA=false` still shipped the service worker whose
  `NetworkOnly` rule for `/api/` is part of the HIPAA caching posture.
  Removed from the type declaration and from every doc that listed them.

**Security**

- **Administrator lockout guard (ORU-7).** Nothing counted how many
  administrators an organization had left, so a sole administrator could lock
  out a whole department in one request — `PATCH` their own status to
  `inactive` and authentication rejects them on the next call. Recovery
  required direct database access. Guarded on role assignment and removal,
  member delete, status change, archive, and position edit/delete.
- **Separation of duties on approvals** (ISO/IEC 27001 A.5.3). A treasurer
  could raise a check request and approve it; an instructor could examine
  themselves and record a pass that satisfied a certification requirement; an
  officer could approve their own administrative hours. Approval now requires
  a second person on all three. Practice skills tests stay self-serve, and
  rejection is never blocked — withdrawing your own request is not a conflict.
- **Unverified TLS fails closed.** `DB_SSL`/`REDIS_SSL` without a CA gives an
  encrypted channel whose peer is never authenticated, which is worse than
  honest plaintext because it is indistinguishable from a correct setup. Now
  blocks startup in production/staging; `SECURITY_ALLOW_UNVERIFIED_TLS` waives
  it and logs the acceptance on every boot.
- **PBKDF2 raised to 600,000 iterations** for the data-encryption key, with
  100k retained so existing ciphertext stays readable. New values carry a
  `$gcm2$` marker; the existing key-rotation tooling rewrites `$gcm1$` values
  onto the new factor.
- **Two endpoints over-shared (ORU-8).** `GET /users/with-roles` returned
  every column on the user model while `GET /users` filtered contact details
  against the organization's visibility setting — both need only `users.view`,
  so the setting was bypassable by choosing the other URL. And
  `GET /organization/settings`, open to every authenticated member, redacted
  credentials but not the infrastructure they authenticate to (mail host, S3
  bucket and endpoint, SharePoint site, SSO issuer, OAuth tenant and client
  IDs). Both now redact for callers without the relevant admin permission.

**Changed — scheduling response fields say which measure they are**

Shift counts and hours came from three tables, and two shipped under the
_same field name_ with incompatible meanings — `GET /scheduling/summary`
returned three counts of _scheduled_ shifts beside a sum of _worked_
attendance minutes, all named as though they were the same kind of number. A
member comparing that screen against a completion report saw a discrepancy
that looked like a bug.

**Breaking (API response fields):**

| Endpoint                                  | Was                                                     | Now                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /scheduling/summary`                 | `total_shifts`, `shifts_this_week`, `shifts_this_month` | `shifts_scheduled`, `shifts_scheduled_this_week`, `shifts_scheduled_this_month`                                      |
| `GET /scheduling/summary`                 | `total_hours_this_month`                                | `hours_worked_this_month`                                                                                            |
| `GET /scheduling/reports/member-hours`    | `shift_count`, `total_minutes`, `total_hours`           | `shifts_attended`, `worked_minutes`, `worked_hours`, plus `shifts_scheduled`, `scheduled_minutes`, `scheduled_hours` |
| `GET /training/module-config/my-training` | `shift_stats.total_shifts`, `.total_hours`              | `.shifts_completed`, `.hours_reported`                                                                               |

**Member hours now come from attendance.** An assignment is a plan, not a
measurement — a shift can run short or long, or be assigned and never worked —
so the member-hours report is sourced from `ShiftAttendance` check-in/check-out
rather than assignment durations. Anything that credits or pays a member uses
the measured figure. The scheduled totals stay alongside with a Difference
column so plan-vs-actual is visible rather than something a reader has to know
to ask about, and a member who worked a shift they were never rostered for now
appears in the report (the two aggregates are merged on member, not joined).

**Fixed — the dashboard's "Total Hours" summed incompatible periods.** The card
is labelled "This month", but only standby hours were month-scoped: training
and administrative hours were _lifetime_ totals, so the headline figure added
two all-time numbers to one monthly one and meant nothing. All three are now
month-to-date (in the organization's timezone, not UTC), and every card says
what it counts — "Completed courses, this month", "Shifts worked, this month",
"Clocked in, this month", and "This month: training + standby + admin" on the
total. `GET /training/module-config/my-training` gained
`hours_summary.hours_this_month` for this; its `total_hours` stays lifetime,
which is the right reading for "my training record".

**Testing & CI**

- **Playwright E2E and container tests now run in CI.** Neither had ever run.
  Repairing the E2E suite is what surfaced the two dashboard defects above;
  the container job is the first thing in CI to build a production image. The
  container job supplies the six secrets `docker-compose.yml` declares with
  `${VAR:?}` required-variable syntax — without them `docker compose config`
  exits non-zero on a checkout with no `.env`, which would have failed the job
  on its first run.
- **API contract tests unblocked, then made to pass, and wired into CI.**
  They could never finish — schemathesis's ASGI transport re-ran the app's
  whole lifespan per generated case, blocking forever without a database. Now
  ~55 seconds, 17/17 green, running as `backend-test-contract`.

**Fixed — API contract**

The unblocked suite immediately showed the published OpenAPI disagreeing with
what the app returns. Anyone generating a client from `/openapi.json` got the
wrong types.

- **Every 422 was documented wrong.** `main.py`'s validation handler returns
  `{"detail": [{"field", "message"}]}`, but FastAPI advertised its own
  `loc`/`msg`/`type` model — a shape no endpoint has ever returned. The app
  now overrides the two component schemas, correcting the single most common
  error response across the whole API at once.
- **Public routes declared only 200/422** while returning 401 for a missing
  API key, 404 for an unknown token/slug/code, 400 for a malformed one, and
  429 when rate limited. Declared per router at `include_router`, so a new
  route in an existing public router inherits the right set.
- **Token path params were unconstrained strings** despite the handlers
  enforcing length bounds, so a generated client had no way to know what a
  usable token looks like. The bounds are now in the schema.
- **An unknown finance-approval token returned 404 on `GET` but 400 on
  `POST`** — the same condition, two answers. Both are 404 now; genuine state
  errors (already acted on, expired) stay 400.
- **`RATE_LIMIT_ENABLED` was read by nothing.** It existed in config and was
  documented, but every limiter ignored it, so an operator who set it false
  got rate limiting anyway and no warning. It now works, and production and
  staging refuse to start with it disabled.

`/organization/info` and `/organization/stats` turned out **not** to be a bug:
they sit under `/api/public/` but are API-key authenticated, so their 401 is
correct — it was simply undeclared.

**Documentation**

The wiki, training guides, video scripts, module docs, runbooks and
`.env.example.full` were brought in line with the changes above — the renamed
scheduling fields and where hours come from, the approval second-person rule,
the last-administrator guard, contact-detail redaction, the TLS and
rate-limiting startup guards, the PBKDF2 work-factor bump, and the new CI
jobs. Several of the corrections were documentation _defects_ rather than
catch-up:

- **`PUBLIC_API_DOCUMENTATION.md` documented an error shape the API has never
  returned** — `{error, message, details}`, where every endpoint returns
  `{"detail": "..."}` (an array of `{field, message}` for 422). Anyone who
  wrote error handling from that page had it wrong from the start.
- **`SECURITY.md` still described the pre-cookie auth model**, stating that
  tokens are "stored as `access_token` in localStorage with separate
  `refresh_token`" — the exact thing the current design exists to avoid.
  Tokens have been httpOnly-cookie-only since the auth rework; only a
  `has_session` flag is in localStorage. A security policy document that
  misstates the security model is worse than one that says nothing.
- **`CONTRIBUTING.md` (and its wiki mirror) documented a module system that
  does not exist** — a `modules/my-module/{controllers,validators,config}`
  tree with a `module.config.ts` manifest. There is no plugin loader and no
  manifest: a module is a `frontend/src/modules/<name>/` directory, backend
  endpoints registered in `api/v1/api.py`, and entries in the two module
  registries, with availability decided per organization at runtime. Rewritten
  to describe the real thing.
- **The mobile guide contradicted itself** — it stated "the app does not queue
  actions for later" a few sections above a walkthrough of exactly that
  queueing behaviour.
- **Four dangling links** pointed at files that have never existed
  (`CODE_OF_CONDUCT.md`, `FILE_STRUCTURE.md`, `docs/development/creating-modules.md`,
  `ELECTION_SECURITY_AUDIT.md`) and one anchor had drifted when its heading
  gained a date suffix. Every relative link and anchor across `docs/`, `wiki/`
  and the root Markdown files now resolves.

`docs/COMPLIANCE.md` and the Statement of Applicability gained control-inventory
rows for segregation of duties, administrator continuity, need-to-know
redaction, TLS verification enforcement, and the contract/E2E/container CI
jobs, each linked to its evidence.

## [1.0.0] - 2026-02-06

### Initial Release

- Full onboarding flow (10 steps)
- Organization setup with comprehensive fields
- Admin user creation
- Module selection system
- Role-based permission system
- Training module
- Events & RSVP module
- Elections & voting module
- Inventory management
- And more...

---

## Release Notes Format

Each release includes:

- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Vulnerability patches

For full details on any release, see the commit history in the Git repository.
