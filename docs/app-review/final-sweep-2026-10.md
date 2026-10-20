# Final Page Sweep — 2026-10-20

A pre-deployment, page-by-page pass over the whole frontend, driven in a real
browser against a real backend rather than from mocked responses. This file
records what was run, what it found, what was fixed, and what is left for the
owner to decide.

## Method

- **Stack.** MariaDB, Redis, the FastAPI backend and the Vite dev server, with a
  demo department bootstrapped through the onboarding API
  (`scripts/screenshots/bootstrap_demo.py`) and partly populated by
  `seed_demo_data.py`. Seeding was cut off at its time limit, so lists are short
  (22 members, 23 events) but every module has rows.
- **Routes.** Every route in `APPLICATION_PAGES.md`: 249 with a fixed path, plus
  35 detail pages (`/:id`) opened on real records. Public routes were also
  opened signed out.
- **Viewports.** Phone 390×844 (touch), tablet 820×1180 (touch), desktop
  1280×800.
- **Per page and viewport:** horizontal overflow (`scrollWidth` against
  `clientWidth`), console errors, failed `/api/` calls, React error boundaries,
  and axe-core with the WCAG 2.0 / 2.1 / 2.2 A and AA rule sets. Colour contrast
  was run separately, sequentially and with a longer settle, in both the light
  and dark themes.
- **Roles.** Administrator for the full crawl; a plain member for a second full
  crawl and for a member-versus-administrator diff of every parameterless `GET`
  endpoint (486).
- **Baselines before any change:** `npm run typecheck`, `npm run lint` and
  `flake8` were all clean.

### Why a live pass found things the existing suite did not

`frontend/src/e2e` fulfils every `/api/v1/**` call from fixtures. That keeps it
fast and hermetic, but it can only measure the states the fixtures render. Nearly
everything below needed real data: a long subtitle, a category with a green
colour, a record that is awaiting approval, an item with an assignee. The
mocked suite stays the right gate; this pass is the complement, not a
replacement.

A measurement caveat worth knowing (it cost this pass several false leads): an early run reported 188 colour-contrast
findings. Almost all were not reproducible when each page was re-run alone —
three crawlers were sharing one CPU and axe was sampling mid-transition. The
numbers below come from the sequential re-run. Do not trust a contrast figure
taken while another crawler is running, or an overflow or axe figure taken
less than about a second after navigation on a page that loads data. A saved
browser session also goes stale once the app rotates its refresh token, so a
long crawl must log in fresh for each viewport; a probe that quietly lands on the
sign-in page reports "clean".

## Fixed

| Area                                               | Finding                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operations page header (6 pages)                   | Title block pinned with `sm:shrink-0`; a long subtitle held the row wider than a tablet                                                                                                                                                 | Title and actions both shrink and wrap                                                                                                                                                 |
| Admin hours → categories                           | Card had no `min-w-0`; truncated text sized the grid track, 588px sideways scroll on a phone                                                                                                                                            | `min-w-0`, wrapping meta row                                                                                                                                                           |
| Members                                            | Action bar could not wrap at `md`; Add Member fell off a tablet. Import CSV used a hand-rolled purple fill                                                                                                                              | Wrapping bar; Import uses `btn-secondary`                                                                                                                                              |
| Attendance Trends                                  | Date range picker overflowed at tablet width                                                                                                                                                                                            | Header stacks below `lg`                                                                                                                                                               |
| Pipeline wizard, `ProgressSteps`                   | Step labels / descriptions appeared before there was room                                                                                                                                                                               | Labels from `lg`, descriptions from `xl`                                                                                                                                               |
| Scheduling reports                                 | Page rendered inside another page's padded container, leaving a ~405px column on a tablet where a 4-up grid crushed its cards to a few px of text                                                                                       | Dropped the nested wrapper; 4-up starts at `lg`                                                                                                                                        |
| Pool items, Notifications                          | Search field and rule rows lacked `min-w-0` / `shrink-0`; Notifications pushed the fixed header and bottom nav 6px                                                                                                                      | Added                                                                                                                                                                                  |
| Compliance print sheet                             | 26-column matrix forced the whole page sideways on a phone; on screen in the dark theme every `<th>` was white on `#f5f5f5` (1.09:1)                                                                                                    | Scrolling wrapper released for print; header cell sets its own colour; footer greys darkened                                                                                           |
| Election detail, ballot builder, finance approvals | Stepper descriptions, template buttons and override buttons overflowed a phone or tablet                                                                                                                                                | Descriptions from `lg`; wrap; row goes horizontal at `lg`                                                                                                                              |
| Unlabeled controls                                 | Selects and inputs with no accessible name (16 on the training session form, the two filters on campaigns, the filter on error monitoring)                                                                                              | `htmlFor` / `id` or `aria-label`                                                                                                                                                       |
| Progress bar, skill template builder               | `role="progressbar"` with no name; three icon buttons with no name                                                                                                                                                                      | `aria-label`; 44px touch targets                                                                                                                                                       |
| Inventory members                                  | Each row was `role="button"` wrapping a profile link and three action buttons (nested interactive)                                                                                                                                      | The chevron is the button; the row click stays as a pointer convenience                                                                                                                |
| Audit log                                          | `aria-expanded` on a `<tr>`, rows operable only by mouse; scrolling table not focusable                                                                                                                                                 | Button in the first cell; focusable labelled region                                                                                                                                    |
| QR codes                                           | QR `role="img"` with no name (clock-in QR, member ID card)                                                                                                                                                                              | `title` prop                                                                                                                                                                           |
| Admin hours QR page                                | Category name painted in the category's own colour — 2.25:1 for a green                                                                                                                                                                 | Theme text colour; the swatch beside it still shows the colour                                                                                                                         |
| Item detail                                        | Assignment buttons sat inside a `<dl>`                                                                                                                                                                                                  | `Card` gains an `actions` slot outside the list                                                                                                                                        |
| Colour contrast, orange                            | `text-orange-700` on `bg-orange-500/10` is 4.48:1                                                                                                                                                                                       | `orange-800` in the 36 class strings that pair them                                                                                                                                    |
| Colour contrast, emerald (dark)                    | `dark:text-emerald-400` on `bg-emerald-500/20` is 4.36:1                                                                                                                                                                                | `emerald-300` in the 8 strings that pair them                                                                                                                                          |
| Onboarding warning text                            | Text used the amber icon token (2.9:1)                                                                                                                                                                                                  | `alert-warning-title`                                                                                                                                                                  |
| `GET /health/detailed`                             | Took no dependency: on `staging` / `development` anyone could read version, environment, CPU / memory / disk and the `debug` / `enable_docs` flags; `cpu_percent(interval=1)` stalled the event loop for a second per anonymous request | Requires `settings.manage` (approved by the owner); the CPU sample runs on a worker thread. `/health` is unchanged                                                                     |
| Scrolling tables and charts (16)                   | A wrapper with `overflow-x-auto` and nothing focusable inside gave a keyboard user no way to reach the columns past the edge                                                                                                            | Each is a focusable, named `role="region"`: finance lists and reports, donations, my training, platform analytics, scheduling and equipment-check reports, the compliance print matrix |
| Training session form, inventory mobile sort       | Location and Location Details fields, and the mobile Sort select, had a visible label that was not associated with the control                                                                                                          | `htmlFor` / `id`                                                                                                                                                                       |
| Prospective members, pipeline detail               | Hand-styled 13px bulk-select checkboxes; Required / Do-this-first pills 20px tall in a row that could not wrap (they overlapped the requirement name on a phone)                                                                        | `form-checkbox`, 24px on touch; wrapping row, `min-h-6` pills                                                                                                                          |
| Status badges (297 class strings)                  | `text-X-700` on a `bg-X-500/10–20` tint measured 4.1–4.4:1 for green, emerald, yellow, amber, red, cyan, pink, lime, teal                                                                                                               | All 700/tint pairings were measured against Tailwind's palette; the 23 that miss 4.5:1 move to the 800 shade (light mode only)                                                         |
| Dead code                                          | `DashboardCardHeader`, `scheduling/ShiftCard` — no importers                                                                                                                                                                            | Removed                                                                                                                                                                                |

## Verified good (no change)

- **Signed out:** every protected route (`/dashboard`, `/members`,
  `/admin/audit-log`, an unknown path) redirects to the sign-in page. Login,
  forgot-password, privacy, terms, ballot, public minutes, display, form,
  event-request and application-status pages: no overflow, no axe violations, at
  all three widths.
- **Plain member:** every administrative page checked renders "Access Denied";
  only member-facing pages (including Finance → Next year's budget, which is
  open to a position owner by design) render content.
- **Tokens and headers:** the sign-in response carries no token in its body;
  `access_token` / `refresh_token` are `HttpOnly`; `Strict-Transport-Security`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, a CSP
  without `unsafe-inline` for scripts, and `Cache-Control: no-store` are present.
- **`GET /organization/settings` as a member:** secrets are redacted and
  infrastructure identifiers (mail host, bucket, SSO issuer) are removed.
- **`GET /users` as a member:** `email`, `phone` and `mobile` come back null while
  contact-information visibility is off.
- **No error boundary, uncaught page error or 5xx** on any of the 284 routes at
  any width.
- **Source scan:** no `console.log`, no `TODO` / `FIXME`, no
  `window.confirm/alert/prompt`; every `dangerouslySetInnerHTML` is fed by
  DOMPurify.

## Open — needs an owner decision

These are recorded in [`KNOWN_LIMITATIONS.md`](../KNOWN_LIMITATIONS.md) under
"Final page sweep (2026-10-20)". Neither was changed, because each alters an
auth-adjacent flow or what a stale link does.

1. **`/onboarding/*` is reachable on a configured installation.** A visitor who
   deep-links to `/onboarding/start` sees the whole Organization Setup form and
   only learns setup is closed when the submit returns `LB-ONBD-001` (400). The
   backend refuses correctly, so this is a confusing screen, not an exposure.
   **Proposed:** a guard that reads `GET /onboarding/status` and redirects to
   `/login` once `is_completed`, leaving `/onboarding/complete` reachable for the
   final step.
2. **An unknown URL silently redirects to the dashboard.**
   `<Route path="*" element={<Navigate to="/" replace />}>`. A bookmark to a page
   that was removed (`/scheduling/templates`, `/nfc-tags`) lands on the home
   screen with no explanation. **Proposed:** a "Page not found" screen. It needs
   no new registry entry (it is a catch-all), but it changes what a stale link does.

## Observations, not defects

- `GET /training/sessions/by-event/{id}` answers 404 for an event with no
  training session, and the browser console logs a red line for each event
  opened. The service maps 404 to "none" deliberately, so the page is correct;
  an endpoint that answered 200 with `null` would stop the noise.
- `GET /users` gives any member `hire_date`, `member_class` and
  `compliance_exempt` for every other member. That may be intended for a
  directory; it is worth a conscious yes.
- The frontend has two TypeScripts on purpose (see `CLAUDE.md`); nothing here
  touched that.

## Not covered

- Pages needing a state the demo data did not reach: a populated election
  result, a processed payment, an open ballot, the NFC / kiosk flows.
- Real devices. Touch emulation and viewport size stand in for a phone and a
  tablet; Safari and Firefox were not run.
- Dark-theme and high-contrast layouts for overflow (contrast was checked in
  dark, not high-contrast).
- Language and copy were reviewed only where a page title or an error string
  stood out; there was no line-by-line read of user-facing text.
