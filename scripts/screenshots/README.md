# Documentation screenshot pipeline

The training guides in `docs/training/` carry hundreds of screenshot
placeholders. This directory automates filling them: it stands up a demo
department, drives the real application with Playwright, and rewrites the
placeholders into markdown image tags.

Everything is generated from the running application, so re-running the pipeline
after a UI change refreshes the images rather than leaving stale ones behind.

## Pieces

| File                    | Role                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap_demo.py`     | Runs the onboarding API end to end, creating the demo organization and its administrator                                                                                                                                                                        |
| `seed_demo_data.py`     | Populates every module through the public API — members, stations, apparatus, shifts, events and RSVPs, training records and programs, skills tests, inventory, documents, forms, elections, prospects, grants, medical screening, storefront, finance and dues |
| `manifest.mjs`          | Declares each screenshot: which placeholder it fills, which route to visit, and any interaction needed                                                                                                                                                          |
| `capture.mjs`           | Logs in, walks the manifest, writes PNGs to `docs/training/images/`, and records the result in `capture-report.json`                                                                                                                                            |
| `apply_placeholders.py` | Rewrites the placeholder blocks in `docs/training/*.md` into `![alt](./images/....png)`                                                                                                                                                                         |
| `status_report.py`      | Regenerates `docs/training/SCREENSHOT_STATUS.md`                                                                                                                                                                                                                |

## Running it

Bring up a backend on `:3001` and the frontend dev server on `:3000` (see
`docs/DEPLOYMENT.md`, or run MySQL/MariaDB + Redis locally and start
`uvicorn main:app --port 3001` and `npm run dev`). The backend creates its own
schema on first start, so an empty database is the expected starting point.

```bash
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

| Field   | Values                                   | Notes                                                              |
| ------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `auth`  | `admin` (default), `member`, `anonymous` | `member` signs in as `DEMO_MEMBER_CREDENTIALS` — no officer rights |
| `theme` | light (default), `dark`                  | Drives the context's `colorScheme`; the app's theme follows system |

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
5. Capture with `--only <id-prefix>`, **look at the PNG**, then apply.

> **Look at the image, every time.** A capture that exits `+` proves only that
> Playwright reached a page and wrote a file. It does not prove the page is the
> one the placeholder describes: a collapsed accordion, an unapplied filter, or
> a route that now renders a different audience's view all capture cleanly.
> Every one of those happened while these shots were being written.

Two waiting pitfalls worth knowing, both of which cost a debugging round here:

- **Native `<option>` elements are never "visible"** to Playwright. Waiting on
  text that also appears in a closed `<select>` hangs until it times out — scope
  the wait to the element you actually mean (`span:text-is("Needs validation")`).
- **`fullPage` duplicates fixed elements** down a tall page, so a sidebar can
  appear twice in one image. Prefer `selector` when the subject is one panel.

Ids are the filename and the applier's key, so keep them stable once a shot has
been applied — renaming one orphans the image already referenced in the guide.
