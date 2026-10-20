# Learning Center screenshot plan

Where the in-app Learning Center ([`learningPaths.ts`](../../frontend/src/pages/learning/learningPaths.ts))
needs pictures, which existing guide images already show the same screen, and
what has been captured. The lessons were brought back in line with the screens
first; eleven screenshots have since been captured and attached (see
[Captured](#captured)), and the rest of this file records what is still open.

## Where things stand

The six lessons (Getting Started, Phone, Events, Training, Scheduling, Gear) are
data in `learningPaths.ts` and were written with **no images**, deliberately: the
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

## Captured

Eleven images in `frontend/public/lesson-images/`, taken as the ordinary demo
member by [`scripts/screenshots/learning-center.mjs`](../../scripts/screenshots/learning-center.mjs)
and attached to a step through its optional `screenshot` field:

| Step                            | File                                |
| ------------------------------- | ----------------------------------- |
| `getting-started.dashboard`     | `getting-started-dashboard.png`     |
| `getting-started.notifications` | `getting-started-notifications.png` |
| `getting-started.directory`     | `getting-started-directory.png`     |
| `mobile.offline`                | `mobile-offline.png`                |
| `events.checkin`                | `events-checkin.png`                |
| `training.submit`               | `training-submit.png`               |
| `training.verify`               | `training-verify.png`               |
| `scheduling.my-shifts`          | `scheduling-my-shifts.png`          |
| `scheduling.open-shifts`        | `scheduling-open-shifts.png`        |
| `scheduling.requests`           | `scheduling-requests.png`           |
| `gear.issued`                   | `gear-issued.png`                   |

Still to capture, because the demo cannot reach the state without mocking or
extra seed data: the **Needs you** card, the phone install banner, the push
switch, the check-out state, **Join Waitlist**, the pending-with-**Withdraw**
attendance request, the not-eligible sign-up dialog, the Requests list with
**Pick up**, **My Sizes** and **My Requests**. The `account`, `install`, `push`,
`rsvp`, `missed-checkin`, `history`, `sizes` and `request` steps therefore have
no image yet.

## How an image ships

Decided: **local copies, not precached.** Files live in `frontend/public/lesson-images/`
and are served by the app itself, so a self-hosted install with no route to GitHub
still shows them. The service worker precaches only `css`, `html` and `js`, so
offline the picture is absent and the lesson text still teaches the task; nothing in
a step may depend on the image being visible. Images are cropped to the part of
the screen the step is about, quantised to 128 colours, and total about 450 KB.
Precaching them (full offline pictures) is a one-line `globPatterns` change if that
is ever wanted, at the cost of putting every image in first install.

`learningPaths.test.ts` fails if a step names a file that does not exist or gives
it fewer than 20 characters of alt text.

## Capture mechanics

`scripts/screenshots/capture.mjs` is keyed to guide placeholders, and a lesson
step has none, so lesson shots have their own small script,
`learning-center.mjs`, which reuses the demo member credentials from `manifest.mjs`.
Everything else — `dev_env.sh`, the demo seeder, the stack — is reused as it is.
Each shot is a locator plus an optional `crop`, because a lesson column is about
700px wide and a full-length page shrinks its text past reading. Run
`seed_demo_data.py` first; a full seed takes over an hour because the login
limiter paces its member sign-ins, and a capture run straight after it can be
throttled for several minutes. See
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
