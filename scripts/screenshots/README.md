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
4. Capture with `--only <id-prefix>`, look at the PNG, then apply.

Ids are the filename and the applier's key, so keep them stable once a shot has
been applied — renaming one orphans the image already referenced in the guide.
