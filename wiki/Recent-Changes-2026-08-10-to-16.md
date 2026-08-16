# Recent changes: August 10–16, 2026

This is the six-day handoff, written to be usable without the repository `docs/`
tree. It is the wider frame around
**[Recent changes: August 12–14](Recent-Changes-2026-08-12-to-14)**, which stays
authoritative for the middle of the window and carries the per-area connection
map. Read this page for the days on either side of it, for the routes and
storage views that a three-day frame could not show, and for the August 15–16
changes that appear nowhere else.

The engineering audit lives in the source repository at
[`docs/CHANGE_AUDIT_2026-08-10_TO_16.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-10_TO_16.md).

**Window:** 504 non-merge commits · 1,517 changed paths · 28 Alembic revisions ·
5 new routes · 3 new models · 37 new endpoint handlers.

## What changed, by sub-window

| Days          | Character                                                                                                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Aug 10–11** | The supply loop (shelf ↔ truck arithmetic), the email footer library, the Learning Center, skills-testing printing and return-for-correction, and a phone-width sweep across every page |
| **Aug 12–14** | Security, permissions, elections, the dashboard personal/organization split, storefront, QR, scheduling settings — see [that page](Recent-Changes-2026-08-12-to-14)                     |
| **Aug 15–16** | Onboarding session hardening and one global style ownership move. **No backend, schema, route, or permission change**, so no upgrade step                                               |

## New pages and their permissions

Five routes went live in this window. Three are authenticated-only on purpose —
in two of those the real access control is **server-side redaction**, not the
route gate.

| Page                        | URL                                        | Who can open it                                                                                         |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Learning Center             | `/learning`                                | Any signed-in member                                                                                    |
| Check-In QR Codes           | `/locations/qr-codes`                      | `locations.manage` **or** `facilities.manage`                                                           |
| Apparatus Inventory         | `/scheduling/apparatus-inventory`          | `equipment_check.submit`, `equipment_check.view`, **or** `inventory.view`                               |
| Blank skill sheet (print)   | `/training/skills-testing/print/template`  | Any signed-in member — it is the empty form and carries no member data                                  |
| Completed scorecard (print) | `/training/skills-testing/print/scorecard` | Any signed-in member — the server redacts the result to the reader's disclosure level before sending it |

**Two of these gates are deliberate and easy to get wrong when documenting them.**
Apparatus Inventory is crew-level because recording what you just used off a
truck is the whole point — putting it behind a manage permission is what leaves
the gap it was built to close. The scorecard print is _not_ gated on
`training.manage` because that would stop a member printing a result they are
already allowed to read, while withholding nothing from anyone else.

The Check-In QR Codes directory is the opposite case: a kiosk display code is a check-in
credential, so a bulk directory of every room's code is a different object from
any single room's QR, and it is restricted. Regenerating a code invalidates the
previous sign.

## August 15–16 in detail

### Onboarding now runs in one tab, one sitting

The onboarding session identifier moved from `localStorage` to `sessionStorage`.
It is a bearer credential — sent as `X-Session-ID`, it authorizes the setup
requests that create the organization, its stations and apparatus, the IT team,
and the first System Owner. In `localStorage` it survived browser restarts
indefinitely and was readable from every tab on the origin. On a shared or
station-kiosk machine that is a standing invitation to finish somebody else's
installation.

**What an installer will notice:**

- A **second tab does not inherit the wizard.** It starts a new server session,
  and the first step that needs an established one returns
  `ONBD_SESSION_INVALID`.
- **Closing the browser mid-setup ends the run.** So does 30 minutes of
  inactivity — the server session expires on a 30-minute sliding timer, and
  always did.
- **The wizard can look resumable when it is not.** The answers already typed
  live in a separate, longer-lived store, so reopening the wizard repaints them.
  The failure appears at the next step that saves something, not at the repaint.
  **The recovery is to restart the wizard, not to re-type into a dead session.**
- **"Onboarding has already been completed" is something else entirely.** That
  message means an organization already exists — the install finished, and the
  operator should sign in rather than start setup again.

Identifiers left behind by the previous build are deleted the first time the new
build loads. Nothing about permissions, endpoints, or stored department data
changed.

### Dark mode: the strip down the right edge is gone

The themed background gradient moved from the page body to the root element.
The dark-mode surface colours are translucent by design — they are built to
composite over that gradient — and the browser's stable scrollbar gutter sits
_outside_ the body, so it was showing the browser's default white. In dark mode
that read as a bright seam down the right edge of every page.

This affects **every screen, signed-in and public**, which is why it matters for
documentation: 39 captured training images show the old seam. Only one is a
dark-mode page — the other 38 are **light-mode captures of modal dialogs**, where
the overlay darkens the page but leaves the gutter white behind it. Do not assume
a light-mode screenshot is safe because this began as a dark-mode symptom.

**This caused two problems, both already fixed** (2026-08-16). Moving the
background to the root element stopped the page body's background from reaching
the window, and two things were quietly relying on it:

1. **Printing with "Background graphics" enabled, in light mode** could put the
   themed background behind a scorecard, skill sheet, label or QR sign.
2. **The six print-preview screens** (skill sheet, scorecard, member training
   record, program, compliance, shift report) showed the themed background
   framing the grey backdrop behind the sheet — cosmetic, and printed output was
   never affected.

Both are fixed, with a regression test so the next change to the page background
cannot repeat them. If you see either, you are running a build from between
August 15 and 16.

## Database upgrade route

Back up the database and encryption keys **separately**. Require exactly one
result from `alembic heads` — **`20260814_0004`** at the close of this
window, and **`20260816_0001`** once the facility-room-nesting change landed
later the same day — then run
`alembic upgrade head`. Never downgrade to repair a fork.

**Before upgrading**, run the active-prospect duplicate check: group active
prospects by organization plus `LOWER(TRIM(email))` and require every group to
have one row. If any group has more, stop; review the linked applications, keep
the earliest `created_at` (then the lowest `id`), mark the rest inactive, and
re-run until zero rows come back. The unique-index revision runs _before_ the
reconciliation revision, so a collision fails the upgrade rather than being
repaired by it.

Across the six days the chain adds: the deployed-lot and on-truck stock columns,
the restock report, the found-expiration write-back, email-template footers,
optional kit items, the skill-test return trail and resume counter, saved ballot
templates and their settings, active-prospect uniqueness and reconciliation,
public-portal key/timestamp hardening, shift-template vehicle fields and
apparatus crew positions, training result-visibility defaults, the
sensitive-facility permission and its Captain revocation, manual paper-ballot
counts, per-organization scheduling settings, event mandatory membership types
and reminder targets, and the store-open banner. Inspect migration logs before
and after rollout.

August 15–16 adds **no migration**.

## Documentation and media actions

**Screenshots still needed** — the August 12–14 queue is unchanged (saved-ballot
settings and paper count, station board and admin-hours categories, store
counts/filters/banner/payment method, Room QR download/print/rotation,
rank-backed crew seats, event outreach forms, training-session linkage and skill
scoring, notification auto-archive, redacted Salesforce readiness). New this
pass:

- The onboarding **session-expired** state, so the guide can show an installer
  what "start over" looks like instead of describing it.
- A **public page in dark mode** at full window width, as standing proof the
  canvas covers routes outside the app shell.

**Images to replace:** everything on the August 12–14 list, plus **any
full-window dark-mode capture taken before August 15** that shows the unpainted
gutter. Triage those by looking at the right edge of the image — light-mode
captures and captures cropped inside the content column are unaffected. Re-check
changed mobile headers, cards and actions at 375px.

**YouTube scripts to update before recording:** the August 12–14 list (**01/03**
TLS and migrations, **04/06** dashboard, **07** messages and notification
cleanup, **08** Room QR, **12** elections, **13** store, **14/15/16** training and
skills), plus:

- **02 — First-Time Setup & Onboarding**: add the spoken caution that onboarding
  runs in one tab and one sitting, and re-check any B-roll that shows the
  presenter leaving the wizard and returning.
- **01 / 03**: the same caution wherever the install walkthrough hands off
  between screens.
- Any script with full-screen dark-mode B-roll shot before August 15 — an edit
  decision per clip, not a re-record.

Recalculate every later timestamp after inserting a chapter.
