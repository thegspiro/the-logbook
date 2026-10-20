# Learning Center screenshot plan

Where the in-app Learning Center ([`learningPaths.ts`](../../frontend/src/pages/learning/learningPaths.ts))
needs pictures, which existing guide images already show the same screen, and
what has to be captured fresh. Nothing in this file has been captured or wired
into the app yet; it is the plan, written after the lessons were brought back in
line with the screens (see the pull request that added it).

## Where things stand

The six lessons (Getting Started, Phone, Events, Training, Scheduling, Gear) are
data in `learningPaths.ts` and carry **no images**. That was deliberate: the
frontend image copies only `frontend/`, so the guide library and its 766 images
are not in the build, and the service worker precaches only `css`, `html` and
`js`. A lesson therefore works with no signal and no picture. Any screenshot
added is an enhancement over text that already teaches the task; the lesson must
still read correctly with every image missing.

## What earns a screenshot

A picture belongs where a member has to **find** a control or **recognise** a
state, and a sentence is a poor way to say it. A picture does not belong on a
step whose whole content is "read this screen" (the lesson page is already next
to the screen via **Open the screen**), and not on every step of a lesson — one
or two per lesson is the aim, and the step the member is most likely to get
stuck on gets it first.

## Per-step plan

Priority **1** is the step a new member is most likely to stall on. "Guide
image" names an existing capture in [`images/`](./images/) of the same screen;
its currency is tracked in [SCREENSHOT_CURRENCY.md](./SCREENSHOT_CURRENCY.md).
Re-confirm each against the current build before reusing it.

### Getting Started

| Step                    | Screen and viewer                                                    | Show                                                                                                         | Guide image                                                 | Pri | Needs a new capture?                                                                                      |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------- |
| `dashboard`             | `/dashboard`, ordinary member, desktop                               | **Needs you** card with an expiring certification, **Next 30 Days**, **My Updates**; the three quick actions | `00-20-member-dashboard` (re-check), `00-04`                | 1   | Yes: the **Needs you** card is not pictured. Seed an expiring certification and an unacknowledged message |
| `account`               | `/account?tab=account` and `?tab=security`, member                   | Phone and Mobile fields; the Security tab's two-factor card                                                  | `00-17-account-settings`, `00-31-mfa-recovery-codes`        | 2   | No                                                                                                        |
| `notifications`         | `/account?tab=notifications`, member, scrolled to the email switches | **Email Notifications**, **Emails you can turn off**, **Always emailed to you**, **Save Preferences**        | none                                                        | 1   | Yes. The Save Preferences step is the one the lesson was missing, so it is the one to picture             |
| `notifications` (inbox) | `/notifications?tab=inbox`                                           | **My Notifications** with one unread item                                                                    | `00-22-notification-card-expanded`, `00-29`                 | 3   | No                                                                                                        |
| `directory`             | `/members` as a member, then `/account?tab=privacy`                  | Directory with the Rank column; **Profile visibility** switches                                              | `01-40-member-directory-member`, `01-41-profile-visibility` | 2   | `01-41` is marked **REPLACE** in the currency file, so re-shoot it first                                  |

### Phone

| Step      | Screen and viewer                                            | Show                                                                                        | Guide image                            | Pri | Needs a new capture?                                                                                      |
| --------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------- | --- | --------------------------------------------------------------------------------------------------------- |
| `install` | `/dashboard` at 390px, banner showing                        | **Install The Logbook** banner, Android form (Install button) and iPhone form (Share steps) | `10-22-installed-app-icon` (icon only) | 1   | Yes, two shots. The banner needs `beforeinstallprompt` mocked, or `needsManualInstall` for the iPhone one |
| `offline` | Phone menu with the pill; top bar on desktop                 | **Offline · 2 pending** and **2 pending sync**                                              | `10-28-held-offline-notice`            | 1   | Yes. The pill itself is not pictured; `10-28` is the held-items notice, a different surface               |
| `offline` | `/account?tab=app`                                           | **Check for updates**                                                                       | none                                   | 3   | Yes, cheap                                                                                                |
| `push`    | `/account?tab=notifications` in a browser that supports push | **Push Notifications on This Device** switch and **Urgent Text Messages**                   | none                                   | 2   | Yes. The push switch renders only where push is supported and VAPID keys exist; mock `push.supported`     |

### Events

| Step             | Screen and viewer                                               | Show                                                                                               | Guide image                                                   | Pri | Needs a new capture?                                               |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --- | ------------------------------------------------------------------ |
| `rsvp`           | `/events`, member, desktop                                      | The **Needs You** band; a card with **Going** / **Not Going**; a full event with **Join Waitlist** | `04-01-events-list` (marked **CHECK**)                        | 1   | Probably. Seed one capped, full event so **Join Waitlist** appears |
| `rsvp` (detail)  | `/events/:id`, RSVP dialog open                                 | **Your Response**, **Submit RSVP**                                                                 | `00-18-rsvp-modal`, `04-09-rsvp-modal`                        | 2   | No                                                                 |
| `checkin`        | `/events/:id/check-in` after tapping **Check In to This Event** | **You’re Checked In**; then the **Check Out of This Event** state                                  | `04-54-training-check-in-confirmation`, `04-04-event-qr-code` | 1   | The check-out state is not pictured                                |
| `missed-checkin` | `/events/:id` for an event whose check-in closed, no check-in   | **I was there**; the pending state with **Withdraw request**                                       | `04-52-attendance-request-prompt`                             | 1   | No for the prompt; the pending-with-Withdraw state is worth adding |

### Training

| Step      | Screen and viewer                                  | Show                                                                                 | Guide image                                           | Pri | Needs a new capture?                                     |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- | --- | -------------------------------------------------------- |
| `history` | `/training/my-training`, member                    | **Required Training** tile, **Upcoming Expirations & Due Dates**, a requirement card | `02-01-my-training`, `02-107-my-training-history-tab` | 2   | No                                                       |
| `submit`  | `/training/submit`, member                         | **The Class** / **When** / **Details**, **Save Draft**, **Submit Training**          | `02-03-submit-training`                               | 1   | No                                                       |
| `verify`  | `/training/submit` with a submission needing edits | **Recent Submissions** with the **Needs Edits** badge and the revision notice        | `02-110-returned-submission`                          | 1   | No. Confirm it still matches the **Needs Edits** wording |

### Scheduling

| Step          | Screen and viewer                                          | Show                                                                                               | Guide image                                                      | Pri | Needs a new capture?                                                                                            |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------- |
| `my-shifts`   | `/scheduling?tab=my-shifts`, member with an Assigned shift | **Assigned** badge with **Confirm** and **Decline**; **Swap**; **Request Time Off**                | `03-04-my-shifts`                                                | 1   | Only if no seeded shift is in the Assigned state                                                                |
| `open-shifts` | `/scheduling?tab=open-shifts`, then the sign-up dialog     | **Sign Up** (**Join** at phone width), **Position**, **Confirm Sign Up**; the not-eligible message | `03-100-open-shifts-member`, `03-59-open-shifts-signup`          | 1   | The not-eligible dialog is not pictured; own sign-up now saves confirmed, so re-check the "after sign-up" shots |
| `requests`    | `/scheduling?tab=requests`                                 | **Swap Requests** / **Time Off** sub-tabs, the **Pending** filter, an open swap with **Pick up**   | `03-115-requests-nothing-pending`, `03-43-time-off-request-form` | 2   | No image shows the Requests list with an open swap and **Pick up**; that one is new                             |

### Gear

| Step      | Screen and viewer                                       | Show                                          | Guide image                                                | Pri | Needs a new capture?                  |
| --------- | ------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | --- | ------------------------------------- |
| `issued`  | `/inventory/my-equipment`, member holding gear          | Header, the three tiles, the issued list      | `05-66-my-equipment`                                       | 2   | No (re-shot 2026-10-17)               |
| `sizes`   | **My Sizes** dialog                                     | The sizes form and **Save Sizes**             | `05-46-size-preferences`                                   | 2   | Marked **CHECK** in the currency file |
| `request` | **Request Equipment** dialog, then **My Requests** open | The request form; **My Requests** with states | `05-86-gear-request-products`, `05-101-my-requests-states` | 1   | No                                    |

### The Learning Center itself

Three shots nobody has taken, and the ones most useful to the documentation:
the `/learning` index with some progress at 1440px and at 390px, and one open
lesson step showing **Open the screen** and **Mark complete**. These belong in
guide 00 (Getting Started) and the dashboard's orientation prompt, not in the
lessons themselves.

## The decision that has to come first: how an image ships

This is not settled and should not be guessed. Three options, and the offline
property is what separates them:

| Option                                                       | Offline                                                    | Cost                                                                                                                                                              |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Link to the guide image on GitHub**                     | No; fails on a self-hosted install with no route to GitHub | Zero bundle weight, but the "Read the full reference guide" link already makes this assumption and a lesson that depends on it contradicts its own header comment |
| **B. Serve from `frontend/public/learning/`, not precached** | Images absent offline; alt text and the lesson text remain | A few hundred KB of static files in the image; `globPatterns` already excludes `png`/`webp`, so the service worker is untouched                                   |
| **C. Precache them**                                         | Full                                                       | Adds every image to first install on every phone; needs a size budget                                                                                             |

**Recommendation: B**, with images resized to the 720px lesson column, WebP or
`pngquant`-reduced, `loading="lazy"`, and non-empty alt text required. It keeps
the offline promise honest — the text teaches, the picture helps when there is
signal — and needs no service-worker change.

If B is chosen, the code change is small: an optional
`screenshot?: { src: string; alt: string }` on `LearningStep`, rendered by
`LearningPathPage`, plus a test that every `src` exists under `public/learning/`
and every `alt` is non-empty, in the style of the existing label test in
`learningPaths.test.ts`.

## Capture mechanics

`scripts/screenshots/` is built around guide placeholders: each manifest entry
names a placeholder, and `apply_placeholders.py` rewrites the markdown. Lesson
shots have no placeholder, so reusing the pipeline needs two small additions
rather than a second tool: an output directory option on `capture.mjs`, and a
manifest id prefix (for example `LC-`) that `apply_placeholders.py` ignores.
Everything else — `dev_env.sh`, the demo seeder, the member and
second-member sessions, route mocks — is reused as it is. Shoot as the ordinary
demo member, at 1440×900 and 390×844, per
[`scripts/screenshots/README.md`](../../scripts/screenshots/README.md).

Demo states the seeder may need, none of which are made by default:

- an expiring certification and an unacknowledged department message (**Needs you**);
- one capped, full event (**Join Waitlist**);
- a shift assigned to the demo member and not yet confirmed (**Confirm**);
- a training submission in `revision_requested` with a reviewer note;
- items in the offline queue, written into IndexedDB as `10-28` does.

## What a capture must not do

Take no shot with malware scanning off (the banner appears on every admin page),
never from the administrator account for a member lesson, and never leave
persisted state behind — the manifest's `cleanup` hook exists for exactly that.
