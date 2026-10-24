# Documentation screenshot pipeline

The training guides in `docs/training/` carry hundreds of screenshot
placeholders. This directory automates filling them: it stands up a demo
department, drives the real application with Playwright, and rewrites the
placeholders into markdown image tags.

Everything is generated from the running application, so re-running the pipeline
after a UI change refreshes the images rather than leaving stale ones behind.

## Pieces

| File                                         | Role                                                                                                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap_demo.py`                          | Runs the onboarding API end to end, creating the demo organization and its administrator                                                                                                                                                                        |
| `seed_demo_data.py`                          | Populates every module through the public API — members, stations, apparatus, shifts, events and RSVPs, training records and programs, skills tests, inventory, documents, forms, elections, prospects, grants, medical screening, storefront, finance and dues |
| `manifest.mjs`                               | Declares each screenshot: which placeholder it fills, which route to visit, and any interaction needed                                                                                                                                                          |
| `capture.mjs`                                | Logs in, walks the manifest, writes PNGs to `docs/training/images/`, and records the result in `capture-report.json`                                                                                                                                            |
| `totp.mjs`                                   | Generates the administrator's authenticator codes for `capture.mjs` (see "The administrator's two-factor secret")                                                                                                                                               |
| `apply_placeholders.py`                      | Rewrites the placeholder blocks in `docs/training/*.md` into `![alt](./images/....png)`                                                                                                                                                                         |
| `status_report.py`                           | Regenerates `docs/training/SCREENSHOT_STATUS.md` (filled counts). Staleness of already-captured images is tracked by hand in `docs/training/SCREENSHOT_CURRENCY.md`                                                                                             |
| `inventory-setup.mjs`                        | Captures the inventory setup workflow without a database, from fixtures (see "Shots a seeded department cannot produce")                                                                                                                                        |
| `wizard-extra.mjs`                           | Photographs the IT contacts and apparatus steps of the setup wizard, which only serve on an empty database. Creates the organization and administrator first, so run it against a throwaway database and backend (`RATE_LIMIT_ENABLED=false`)                   |
| `render_supply_email.py` + `email-shots.mjs` | The weekly Supplies to Replace email is built by a scheduled task, so no screen previews it. The first writes the message the demo would send to disk (nothing is mailed); the second photographs it at phone width                                             |

## Running it

Bring up a backend on `:3001` and the frontend dev server on `:3000` (see
`docs/DEPLOYMENT.md`, or run MySQL/MariaDB + Redis locally and start
`uvicorn main:app --port 3001` and `npm run dev`). The backend creates its own
schema on first start, so an empty database is the expected starting point.

`scripts/screenshots/dev_env.sh` does all of that in one command and waits
until the stack answers. Two things it supplies when nothing else does:

- **Encryption keys.** Onboarding refuses to finish without `ENCRYPTION_KEY`
  and `ENCRYPTION_SALT`, and it fails _after_ creating the organization and
  administrator, which leaves a database that cannot be onboarded again. When
  neither the environment nor `.env` sets them, the script generates a pair
  once into `${XDG_STATE_HOME:-~/.local/state}/logbook-screenshots/demo-keys.env`
  (mode 600, outside the repository) and reuses it on every run, because data
  written under one key is unreadable under another. Delete that file only
  together with the database it seeded.
- **Malware scanning.** Uploads fail closed when no ClamAV daemon answers, so
  every seeded document and attachment would be refused with a 503. If
  `clamd` and its signatures are installed, the script starts it on
  `127.0.0.1:3310` and points the backend at it. Otherwise, when
  `CLAMAV_ENABLED` is not set, the demo backend runs with scanning off and a
  warning is printed.

  **Do not commit admin screenshots captured with scanning off.** The backend
  then shows administrators a non-dismissible "Uploaded files are not being
  scanned for malware" banner on every page, and it appears in every shot. To
  get scanning on, install ClamAV and fetch its signatures once:

  ```bash
  sudo apt-get install clamav-daemon   # or your platform's package
  sudo freshclam                       # downloads ~110 MB of signatures
  ```

  Behind an HTTPS proxy, `freshclam` needs `HTTPProxyServer` / `HTTPProxyPort`
  in its config, and a CA bundle readable by the `clamav` user, which it drops
  to before downloading.

```bash
# Use a unique password for this disposable environment. It is consumed by all
# three commands and is never stored in the repository.
# The "-Aa1" suffix is not decoration: the backend requires a special
# character, an upper- and lower-case letter and a digit, and a bare
# token_urlsafe(24) contains no "-" or "_" roughly a third of the time, which
# fails bootstrap at the administrator step with the organization already made.
export SCREENSHOT_ADMIN_PASSWORD="$(python -c 'import secrets; print(secrets.token_urlsafe(24) + "-Aa1")')"

# 1. Create the demo organization and administrator (once per database)
python scripts/screenshots/bootstrap_demo.py

# 2. Populate it — safe to re-run, existing records are skipped
python scripts/screenshots/seed_demo_data.py

# 3. Capture — always after step 2, which refreshes the time-sensitive records.
#    PLAYWRIGHT_CHROMIUM_PATH is only needed where a Chromium is pre-installed
#    at a path Playwright does not look in.
node scripts/screenshots/capture.mjs
node scripts/screenshots/capture.mjs --only 04-      # one guide
node scripts/screenshots/capture.mjs --headed        # watch it run

# 4. Rewrite the placeholders, then refresh the tracker
python scripts/screenshots/apply_placeholders.py --dry-run
python scripts/screenshots/apply_placeholders.py
python scripts/screenshots/status_report.py
```

**Run the seeder before every capture.** Some of what the guides picture is
time-sensitive — the check-in monitor needs an event that is in progress _right
now_, and the seeded drill has ended by the next run. Seeding slides it forward;
capturing without seeding first fails that shot outright.

The seeder is safe to re-run: each step lists what exists and skips it. It gives
the demo member accounts a password, because several things the guides picture
(event RSVPs) have no admin "on behalf of" endpoint and can only be produced by
acting as the member.

`SCREENSHOT_BASE_URL` overrides the frontend origin (default
`http://localhost:3000`).

The backend scripts refuse non-loopback `--base-url` values by default, which
prevents accidentally creating this privileged demo account on a reachable
environment. For an intentionally isolated remote demo, pass `--allow-remote`
to both scripts and keep `SCREENSHOT_ADMIN_PASSWORD` secret. The administrator
username defaults to `chief`; `SCREENSHOT_ADMIN_USERNAME` can override it.

### The administrator's two-factor secret

The application requires members with administrative rights to use two-factor
authentication, and asks them to confirm their identity again before sensitive
actions such as granting a role. The pipeline signs in the way a real
administrator does rather than working around either:

- **Enrolment.** The first seeder run enrols the demo administrator in TOTP and
  stores the secret in
  `${XDG_STATE_HOME:-~/.local/state}/logbook-screenshots/admin-totp.env` (mode
  600, outside the repository, beside the demo encryption keys). The file is
  written before the enrolment is confirmed, so an interrupted run cannot leave
  an enrolled account whose secret exists nowhere. Later runs find the account
  enrolled and leave it alone.
- **Signing in.** The seeder completes the authentication-code step with a code
  generated from that secret, and `capture.mjs` types one into the login page's
  code step for every administrator context. Member accounts sign in with a
  password as before.
- **Confirming identity.** When an action answers `403` with
  `X-Stepup-Required` (`LB-AUTH-013`), the seeder re-verifies with a fresh code
  and retries that request once. A confirmation lasts ten minutes by default
  (`STEPUP_WINDOW_MINUTES`), so a long run does this several times.

The server accepts each 30-second code once per account, so a sign-in and the
confirmation straight after it cannot share one: the scripts wait for the next
code rather than resubmit a spent one. A code refused because another run spent
it moments earlier is retried once with the next.

`SCREENSHOT_ADMIN_TOTP_SECRET` overrides the file, for a demo whose secret is
managed elsewhere. The seeder will not enrol the administrator while it is set,
because the server chooses the secret at enrolment and it could not be the one
in the variable.

The secret is a credential for a privileged account: never print it or commit
it. Like `demo-keys.env`, it belongs to the database it was created against —
delete it only together with that database. If the secret is lost or no longer
matches, the seeder stops and says so. Recover by having another member with
`members.manage` use **Reset MFA** on the administrator's row at
`/members/admin` (administrators cannot reset their own there), then re-run the
seeder, which enrols the account again and stores the new secret — or start
over on a fresh database.

## Shots a seeded department cannot produce

Some screens only exist for a department that has _not_ finished setting up.
The inventory setup workflow is the clearest case: its prompt on the admin hub
disappears once rooms, storage areas, categories and items all exist, and the
demo department is seeded with all four. No amount of seeding produces that
picture — the state it describes is the absence of seed data.

`inventory-setup.mjs` covers those by running the built frontend under
`vite preview` and answering every `/api/v1` request from fixtures. It writes
`05-72-setup-prompt`, `05-73-setup-rooms` and `05-93-empty-items` (the
items list of a department with no items) at the same framing capture.mjs uses (1440x900
desktop, 414x896 phone, 1x, pngquant), so the outputs are interchangeable and
`capture.mjs` remains the pipeline of record for everything it _can_ reach.

```bash
cd frontend && npm run build && npx vite preview --port 4173 &
node scripts/screenshots/inventory-setup.mjs            # -> docs/training/images
CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/screenshots/inventory-setup.mjs
```

It also walks all five steps at phone width and fails the run on horizontal
overflow, which is the one layout fault a screenshot cannot show you — a
full-page capture silently widens to the document, so a sideways-scrolling page
photographs as a well-composed one. `capture.mjs` reports the same check across
every shot it takes, without failing on it.

## Empty states are held back

A page whose module has no records renders an empty state rather than the
populated view the guides describe. `capture.mjs` detects that and flags the
shot; `apply_placeholders.py` then leaves the placeholder alone, because
replacing an accurate description with a misleading picture is worse than
leaving the description in place. The fix is to extend `seed_demo_data.py` for
that module and re-run, not to force the image in.

Where an empty phrase is incidental — an empty "My Upcoming Shifts" panel on an
otherwise-populated dashboard, or an error monitor correctly reporting no
errors — the manifest entry sets `allowEmptyState: true`.

## Who the shot is taken as, and in which theme

Several routes render a **different page** depending on who is signed in.
`/training/skills-testing` is the clearest case: an officer gets the skill-sheet
library, a member gets Available Tests and My Results. A placeholder describing
what a member sees therefore cannot be filled from the administrator's session,
and a shot that looks fine can quietly picture the wrong screen.

| Field   | Values                                                                                                                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth`  | `admin` (default), `member`, `secretary`, `forwardee`, `treasurer`, `compliance`, `gearless`, `trainingofficer`, `second-member`, `anonymous` | `member` signs in as `DEMO_MEMBER_CREDENTIALS` — no officer rights. `secretary` reviews every seeded suggestion box. `forwardee` reviews none and has one suggestion forwarded to them. `treasurer` runs the approval chains and raised none of the seeded requests. `compliance` is the Compliance Officer, the only reviewer of the default Compliance box. `gearless` holds, borrows and has requested nothing. `trainingofficer` holds the Training Officer position, which new training submissions prompt. `second-member` is another ordinary member with no shift reports and nothing pending in Requests |
| `theme` | light (default), `dark`                                                                                                                       | Drives the context's `colorScheme`; the app's theme follows system                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Each `auth` + `theme` combination gets its own browser context, built on first
use — cookies are per-context, so swapping users by clearing them mid-run would
invalidate every later shot, and `colorScheme` is fixed at context creation.
A run that needs no member session never pays for that login.

A signed-out shot that still needs an id or slug the seeder minted can borrow an
authenticated session: `prepare` receives a second argument with
`lookupPage()`, which resolves to a signed-in page. `10-11-public-form-dark`
uses it to find the published form's `public_slug` before navigating the
anonymous page to `/f/{slug}`.

## States the seeder has to manufacture

Some pictured states cannot be produced by the administrator the seeder runs as,
and the seeder makes them explicitly:

- **A result awaiting validation.** An officer's own completion validates in the
  same step, so every test the seeder creates lands already signed off. It signs
  in as one ordinary member and has them examine a second one, which is the only
  way to leave a result in the queue.
- **A named viewer.** Granted on a _completed_ test — the panel renders only on
  the review view of a finished official test, so a grant on a draft is a row no
  screen ever shows.
- **A published public form.** `/f/{slug}` serves published forms only; a draft
  renders as "not found", which is what the public-form shots would otherwise
  capture.

### `--bulk-prospects` — a pipeline past the board's ceiling

```bash
python scripts/screenshots/seed_demo_data.py --bulk-prospects        # 247
python scripts/screenshots/seed_demo_data.py --bulk-prospects 300    # explicit
```

The kanban groups applicants into columns client-side, so it fetches 200 and
says plainly when there are more — the notice `15-02-board-truncated` pictures.
Producing that needs a genuinely oversized pipeline, which is **not** wanted in
the ordinary demo data: 200+ filler applicants bury the twelve named ones the
other prospective-member screenshots are composed around, and cost a few hundred
requests on every seed. Hence opt-in.

It tops the pipeline **up to** the target and is safe to re-run — the filler
uses deterministic `applicant.NNNN@intake.example.org` addresses, so a second
run adds only what is missing. Every fourth one is advanced a stage or two:
without that the board is three empty columns under a notice about having too
many applicants, because the newest 200 are all sitting at intake.

To get back to a small pipeline, drop the filler by email prefix — or reseed
onto an empty database, which is the cleaner reset.

It also parks the two most recently created applicants at the **final** stage.
The table lists newest first, so those land on page one and make a select-all
there a genuinely mixed batch — most advance, those two cannot. That partial
failure is the subject of `15-09-bulk-action-result`, and without it a bulk
advance from page one succeeds uniformly and pictures nothing.

> **`15-09` changes the data it pictures.** It runs a real bulk advance, so the
> applicants on page one move a stage. That is why it sits last among the `15-*`
> shots. Re-running the seeder restores a mixed page, so the shot is repeatable
> — it is just not idempotent on its own.

> **Capture the two bulk shots narrowly.** A bulk-seeded pipeline is visible in
> every other prospective-member shot — the board fills with `Applicant 0284`
> cards and the stat card reads 320 rather than the handful of named applicants
> the guide walks through. So run the bulk seed, capture with
> `--only 15-02` and `--only 15-09`, and leave the rest of the `15-*` images
> alone. Re-capturing the whole guide against filler data replaces good
> screenshots with worse ones, and nothing in the harness flags that: filler
> applicants are real records, so the shots pass every check and simply read
> badly.

## What a placeholder looks like

A placeholder is an HTML comment, so members reading a guide on GitHub never see
a request meant for whoever takes the screenshots:

```markdown
<!-- Screenshot needed:
[Who is signed in, which page, and exactly what state the screen must be in]
-->
```

`status_report.py` counts these and `apply_placeholders.py` replaces them. Both
still recognise the older blockquote form (`> **Screenshot needed:**`), so a
branch written before the comment form is counted and filled the same way, but
new placeholders use the comment. Never put `--` inside the description: it is
not allowed in an HTML comment, and `-->` would end the comment early and show
the rest of the request to readers.

## How a shot finds its placeholder

Each entry records the placeholder's `line`, but that is only a hint: applying
one shot deletes several lines, so every line number below it shifts. The
durable key is `anchor` — the opening words of the placeholder's own
description. When the line hint misses, the applier searches for the anchor, and
declines to guess if two placeholders match it.

## Adding a screenshot

1. Find the placeholder in the guide. Note its line number and the first dozen
   words of its description.
2. Add an entry to `SHOTS` in `manifest.mjs` with a stable `id`, the `doc`,
   `line`, `anchor`, alt text, and the route.
3. If the shot pictures a modal, a specific tab, or an expanded panel, give it a
   `prepare(page)` that drives the UI there. For a detail page, use
   `openFirstFromApi()` rather than hard-coding an id — ids change every seed.
4. If it pictures what a **member** sees, or a **dark-mode** page, set `auth` /
   `theme` rather than reaching for the administrator's session.
5. Give it an **`expect`** — text (or `{ selector }`) that proves this is the
   screen the placeholder describes. Required for a new shot;
   `scripts/test_screenshot_landing_assertion.py` fails without one.
6. Capture with `--only <id-prefix>`, **look at the PNG**, then apply.

> **Look at the image, every time.** A capture that exits `+` proves only that
> Playwright reached a page and wrote a file. It does not prove the page is the
> one the placeholder describes: a collapsed accordion, an unapplied filter, or
> a route that now renders a different audience's view all capture cleanly.
> Every one of those happened while these shots were being written.

### `expect` — the assertion that the shot landed where it says

`expect` is checked at capture time, and it checks two things at once, because
both have shipped a wrong image:

- **The right screen.** `03-25` photographed the Schedule tab and was captioned
  "Equipment checks tab" (#2341). It had no `prepare`, so nothing looked at the
  page — and nothing could have, from the URL: measured against this build,
  `/scheduling?tab=totally-bogus` **keeps the bogus parameter in the address
  bar** and renders the schedule underneath it. The URL is not evidence of the
  screen. Only content is.
- **The subject actually in the picture.** `03-69` satisfied its own wait — the
  catalog matches were in the DOM — and framed every one of them off the bottom
  of a 390px page (#2449). So `expect` is asserted _visible and inside the
  captured frame_: the element's own box for a `selector` shot, the document for
  `fullPage`, the viewport otherwise.

```js
expect: "Equipment & Readiness",        // text on that screen and no other
expect: { selector: "#seal-drug-bag" }, // or an element
```

Pick something that would be **absent from the screen you'd land on by
mistake** — a heading, not a nav label that appears on every page.

`capture.mjs` separately fails any shot whose **pathname** changed on arrival
(a not-found route redirects to `/dashboard`, a lost session to `/login`). A
route that redirects by design declares where it ends up with `landsOn`.

509 shots predate this rule and are listed in `landing_assertion_baseline.txt`.
That list is a ratchet: a new shot cannot join it, and adding an `expect` means
deleting the line, so it only shrinks.

Two waiting pitfalls worth knowing, both of which cost a debugging round here:

- **Native `<option>` elements are never "visible"** to Playwright. Waiting on
  text that also appears in a closed `<select>` hangs until it times out — scope
  the wait to the element you actually mean (`span:text-is("Needs validation")`).
- **`fullPage` duplicates fixed elements** down a tall page, so a sidebar can
  appear twice in one image. Prefer `selector` when the subject is one panel.

Ids are the filename and the applier's key, so keep them stable once a shot has
been applied — renaming one orphans the image already referenced in the guide.

## When something outside the guides invalidates a shot

Everything above assumes staleness arrives through a guide: a placeholder moves,
a caption changes, a screen gains a control. **A global stylesheet change
invalidates images without touching a guide, a placeholder, or this manifest**,
so nothing prompts anyone to look.

That happened on 2026-08-15. The themed canvas moved from `body` to `html` so it
would also cover the browser's stable scrollbar gutter; before the fix that
gutter showed the browser's default white. It changed no guide and no manifest
entry, and it altered 39 captured images.

`audit_images.py` exists for this class of defect:

```bash
python3 scripts/screenshots/audit_images.py            # all checks
python3 scripts/screenshots/audit_images.py --check edges
```

It reports a severity so a long list can be triaged without opening every file.
Add a check to it whenever a global change turns out to have moved pixels — the
checks are cheap, and the alternative is asking a human to compare hundreds of
images.

**CI runs it against a baseline**, in the Docs Link Check job:

```bash
python3 scripts/screenshots/audit_images.py \
    --baseline scripts/screenshots/audit_baseline.txt
```

`audit_baseline.txt` records the images already known to be flagged — the 39 the
canvas move left behind — so only **new** findings fail the build. Without that,
the check could not be turned on at all against an existing backlog.

Two things about the baseline are deliberate:

- **Re-capture an image, then delete its line.** A baselined image that no longer
  flags _fails_ the build. That costs one deleted line and keeps the list
  shrinking; tolerating stale entries would let the baseline quietly suppress
  real regressions on those exact files forever.
- **Do not add a line to silence a new finding without saying why.** A new
  finding means something changed that nobody looked at, which is the whole
  point of the check.

### Measure before you assign a sweep

The first response to the gutter change was to write "check every image in every
guide" into `SCREENSHOT_CURRENCY.md`. Running a check instead took about a second
and produced a list of 39, of which exactly **one** was worth re-shooting on its
own account.

This matters beyond saving time: a reviewer asked to eyeball 429 images for a
15px strip stops seeing it somewhere around the fortieth, so the sweep both costs
more _and_ finds less than the script. If you are about to write "audit all of
these" into a tracker, try to write the check instead.

### …and be careful what you filter on

The first version of that check pre-filtered on **whole-image** brightness, on
the assumption that only dark-mode captures could be affected. It reported three.

The real number was 39. Most affected shots are **light-mode pages under a dark
modal overlay** — bright overall, dark exactly at the right edge, because the
overlay dims the viewport but sits inside `body` while the gutter is reserved on
`html`. They were filtered out before the real comparison ran.

**A filter that encodes the assumption you are testing will confirm it.** Compare
the thing you care about with what sits next to it, not with the frame average.

### Two more things that quietly decide whether a shot is right

- **Name the page by its on-screen heading, not its component file.** The
  directory page at `/locations/qr-codes` renders `RoomQRCodesPage.tsx` and is
  headed **"Check-In QR Codes"**. Alt text and captions that use the filename
  send a reader looking for a heading that does not exist.
- **Check the API before writing a caption that implies data.** A caption asking
  for per-phase counts on the training program detail could never be satisfied:
  `GET /training/programs/programs/{id}` returns phases with no requirements at
  all, so those numbers belong to a member's enrolment view. A caption can
  describe something the screen is structurally unable to show, and no amount of
  re-shooting will fix it.
