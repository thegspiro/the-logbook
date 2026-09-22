# Upgrading

Read this before pulling a new version into a running deployment.

## Check the configuration before you restart

A configuration problem is normally discovered when the container refuses to
boot — which means finding it by losing the service. Ask first:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  run --rm --build backend python -m app.preflight
```

Exit `0` means the configuration starts, `1` means it does not and the
blocking items are listed, `2` means a value is malformed.

Two details of that command are load-bearing:

- **`--build`.** `run` uses the image that already exists; it does not build
  first. Without this you are checking the version you are replacing rather
  than the one you are deploying — and before the first upgrade that carries
  this tool, the old image has no `app.preflight` module at all.
- **The same `-f` files the deployment uses.** Compose merges values from
  every file given, so a bare `docker compose run` evaluates only the base
  development configuration: different `SECURITY_ENFORCE_HTTPS`, different
  `ENABLE_DOCS`, and an answer about a configuration nobody runs. Pass the
  identical `-f` set you bring the stack up with (or none, if the deployment
  uses a single file).

Blocking checks only run for `production` and `staging`, so a run in
development reports nothing regardless of how broken a production
configuration is. To test production values from elsewhere, add
`--as production`.

### "I set it in .env and nothing changed"

A Docker Compose `environment:` block is a **whitelist**. A variable missing
from it cannot be set from `.env` at all — Compose does not warn, and the
application sees only its built-in default. When a blocking check fires,
preflight and the startup log both report whether each setting actually
reached the process:

```
SECURITY_REQUIRE_TLS   NOT PRESENT — using built-in default True
```

That line means the value is not arriving. Add the name to the backend
service's `environment:` block and confirm it lands:

```bash
docker compose config | grep SECURITY_REQUIRE_TLS
```

This applies to any hand-maintained compose file — including one managed by
Unraid's Compose Manager plugin, which keeps its own file under
`/boot/config/plugins/compose.manager/projects/<name>/`. Such a file does not
receive changes made to the compose files in this repository, so a setting
added upstream has to be added there by hand.

## Find the gaps before an upgrade gates on them

Rather than waiting for a boot to fail, ask which settings the compose file
cannot pass through at all:

```bash
docker compose run --rm --build \
  -v "$PWD/compose.yaml:/tmp/compose.yaml:ro" \
  backend python -m app.preflight --compose /tmp/compose.yaml
```

The path is read **inside** the container, so a host file has to be mounted;
point the `-v` source at whichever compose file the deployment actually uses.
It reports every setting that can block a boot and is absent from that file:

```
12 of 21 settings that can block a boot are absent from this file:
  ...
  SECURITY_REQUIRE_TLS
```

None of those are a problem on the day you run it. Each becomes one the
moment an upgrade starts gating on it, and the failure then looks like an
unexplained crash loop rather than a missing line. Add them to the backend
service's `environment:` block as `NAME: ${NAME:-<default>}`, keeping the
application's own default so nothing changes until you set it.

### Unraid (Compose Manager)

The plugin keeps its compose file and `.env` on the flash drive, and they are
the only copies — back them up before editing:

```bash
cd /boot/config/plugins/compose.manager/projects/<project>
cp compose.yaml compose.yaml.bak && cp .env .env.bak

docker compose run --rm --build \
  -v "$PWD/compose.yaml:/tmp/compose.yaml:ro" \
  backend python -m app.preflight --compose /tmp/compose.yaml
```

This file is written by hand and never updated by pulling this repository, so
it is the deployment most likely to fall behind a newly added gate. Run the
check before each upgrade.

## Changes that can stop an existing deployment from starting

Newest first. Every entry here is a change that was safe on a fresh install
and refused to boot an existing one.

### `SECURITY_REQUIRE_TLS` defaults to `true` (2026-08-13)

Absent transport TLS was previously a warning. It is now a **blocking**
critical in production and staging, so a deployment whose MySQL and Redis
speak plaintext stops booting on the next restart after this upgrade — which
may be long after the upgrade itself, making the connection easy to miss.

Choose one:

- **The data services have TLS:** set `DB_SSL=true` and `REDIS_SSL=true`, plus
  `DB_SSL_CA` / `REDIS_SSL_CA` pointing at the CA **inside the container**
  (`/etc/ssl/logbook/...`; put the PEM in `./infrastructure/certs`). Enabling
  TLS without a CA is itself blocking — an encrypted channel that authenticates
  nobody is indistinguishable from a correct one.
- **They do not, and the network protects that traffic** (the bundled MySQL and
  Redis on a private Docker network are this case): set
  `SECURITY_REQUIRE_TLS=false` as an explicit risk acceptance.

`SECURITY_ENFORCE_HTTPS` must also be `true` in production. It has no waiver
flag. It currently gates no behaviour — nothing emits HSTS and nothing
redirects HTTP — so setting it true cannot cause a redirect loop behind a
reverse proxy or CDN. To control the `Secure` flag on auth cookies, use
`COOKIE_SECURE`.

### `RATE_LIMIT_ENABLED` is enforced (2026-08-01)

The flag previously gated nothing. Production and staging now refuse to start
with it disabled, since turning it off removes brute-force protection from
every authentication and public endpoint at once.

## Changes you will notice after an upgrade

Newest first. Nothing here blocks a restart — these are changes an operator
should not have to discover by being surprised.

### The installed app now carries the department's own logo (2026-09-17)

A member who installs The Logbook from their browser — "Add to Home Screen" on
a phone, the install button in Chrome or Edge on a desktop — used to get the
stock Logbook mark as the icon. It is now the department's own logo, the same
one uploaded under Settings → Organization → Profile, rendered by the server
into each size a browser asks for. The iOS home-screen icon and the launch
screen an installed app shows while it starts are branded the same way.

**Nothing to do, and nothing to configure**, as long as the department has a
logo uploaded. A department that has not uploaded one keeps the shipped icon,
and so does an installation whose logo is stored as a link to an image
elsewhere rather than as an uploaded file — the server renders only uploaded
images, because fetching a URL out of the database on an unauthenticated
request is a door worth leaving shut.

**Members who already installed the app keep the old icon.** An icon is chosen
once, when the app is installed, and neither Android nor iOS revisits it.
Anyone who wants the new one removes the app from their home screen and adds it
again. New installs get it immediately, as does anyone who installs after a
logo is changed.

**Only if you run your own reverse proxy in front of the stack.** The icons are
served at the URLs they always had — `/pwa-192x192.png`, `/apple-touch-icon.png`,
`/apple-splash-*.png` and the new `/pwa-maskable-512x512.png` — and the
frontend container's own nginx asks the backend for them before falling back to
the file it ships. A proxy that passes these paths through to the frontend
container, which is what the bundled configurations do, needs no change. A
proxy that serves the frontend's built files directly off disk will keep
serving the stock icons, because the branded ones do not exist on disk: point
those paths at the frontend container instead.

### A meeting stage advances on finalized attendance, not on the check-in (2026-09-16)

Follows the entry below, which made a meeting stage that names an event an
attendance requirement. This changes **when** that requirement is met.

**A sign-in at the door is no longer enough.** The applicant must be checked in
**and** that event's attendance must be **finalized** — the organizer running
End Event, recording an actual end time, or pressing Finalize Attendance. Until
then the stage holds them, by hand and automatically alike.

**Why.** Checking a guest in records that they were at the door, which is not
the department's word on who attended: a guest can be signed in and struck off
ten minutes later, and until the event is closed out the roster is still being
decided. Finalizing is the act that settles it, and it is already the act that
derives the durations and lands the hours. The advance used to fire at the
sign-in, so an applicant moved on a number nobody had stood behind yet.

**What replaces the old trigger.** Finalizing an event now advances every
checked-in applicant it clears, in one pass. That covers all three routes at
once, since End Event and recording an actual end time both finalize.

**An event nobody finalizes still settles on its own.** Finalizing is a human
act that routinely never happens — the nightly post-event task only _prompts_
the organizer — so attendance also counts as settled once
`PIPELINE_ATTENDANCE_SETTLE_DAYS` (default **7**) have passed since the event
ended. A nightly `prospect_attendance_advance` task re-asks the question, since
nothing else would notice the day an unfinalized event aged into being good
enough. Set the window in `.env`; `0` settles it at the event's end.

**What you will see.** An applicant who signed in this evening no longer jumps
to the next stage during the meeting. They advance when you close the event
out, along with everyone else who was there — or, if nobody closes it out, a
week later. Trying to advance one by hand in between names the event and says
what is missing:

> This applicant is checked in at 'Recruitment Night', but that event's
> attendance has not been finalized, so 'Chief Interview' is not ready yet. A
> sign-in at the door is not the final roster — finalize the event (End Event,
> record its actual end time, or Finalize Attendance) and they advance on their
> own.

**The stage checkbox was relabelled** from "Auto-advance when attendance is
recorded" to "Auto-advance when the event's attendance is finalized". The
setting itself is unchanged — no stage needs editing.

**One wrinkle worth knowing.** Once an event is finalized, adding a missed
attendee is refused until somebody with `events.reopen_attendance` reopens it.
So if you finalize and _then_ discover an applicant's attendance was never
recorded, reopen the event, check them in, and finalize again — re-finalizing
re-runs the advance and skips anyone already moved.

### A meeting stage that names its event now requires attendance (2026-09-16)

This supersedes the 2026-09-15 entry below, which narrowed the same gate to
**Bulk Advance** only. Two changes, both to meeting stages.

**Which stages are enforced is now decided by the stage, not by who is
advancing.** A meeting stage covers two unlike things. "Meet with the Chief" is
an arrangement between two people that nothing will ever record, so the
coordinator's word is the only evidence there can be. "Attend a business
meeting" names an event you run, and check-in produces a record of who was
there. Reading the caller instead meant the same coordinator, the same
applicant and the same stage were refused in a bulk advance and allowed one
card at a time — so the way past an unattended meeting was to advance the cards
singly, which is not a decision anybody made on purpose.

A stage that names its event — it has an **Auto-Link Event Type**, or was
pinned to a specific event — is now an attendance requirement on every path:
**Advance**, a drag across the board, Bulk Advance and every automated advance
alike. A stage that names no event is unchanged and still takes the
coordinator's word, on every path.

**Attendance from before the application was opened no longer counts.**
Attendance is recorded per person and is unbounded in time, so a check-in from
years ago graded exactly like one from last week. That bit hardest in the flow
this module is built around: when a kiosk sign-in opens a prospect record at a
business meeting, that applicant carries a matching business-meeting attendance
from the moment they exist — and a later "attend a business meeting" stage was
satisfied by the sign-in that created them, without their ever attending a
second one. The cut-off is the event's check-in window closing, so the meeting
that opened the record still counts and genuinely old attendance does not.

**What you will see.** On a stage that names its event, an applicant with no
attendance recorded since their application was opened can no longer be
advanced, and the refusal names what to do:

> No attendance has been recorded for 'Chief Interview' since this application
> was opened. This stage names the event its applicants must attend, so it
> advances once they are checked in there. Add them to that event's attendees
> and check them in if they attended and it was not recorded; otherwise un-tick
> Required on the stage to skip it, or clear its Auto-Link Event Type.

Those are the three ways out, in the order to reach for them. Recording the
attendance is the one to prefer — it is how the applicant is meant to clear the
stage, and it leaves the attendance record true rather than working around it.
You can add someone to an event's attendees and check them in after the fact
from the event itself.

**Who this affects.** Only stages with an Auto-Link Event Type or a pinned
event. The stage builder leaves both empty by default, so a meeting stage
nobody configured that way behaves exactly as it does today. If you do have
such a stage with applicants parked on it who attended without it being
recorded, they will be refused until you record it — worth a look at who is
sitting on that stage before you upgrade.

**Amended on 2026-09-16** — see the entry above. Being checked in is necessary
but no longer sufficient: the event's attendance must also be finalized, and
the refusal's wording changed to say so.

### Bulk Advance is held to the meeting-attendance gate (2026-09-15)

A meeting stage set to auto-advance refuses an automated advance when no
attendance is recorded. A coordinator's single **Advance** is deliberately
exempt — they may have watched the applicant arrive and found no record of it.
**Bulk Advance** inherited that exemption and should not have.

**Why.** The exemption is written for one applicant at a time. The board lets
cards be ticked across every column, so a bulk selection routinely spans stages
and nobody formed a view about any single one of them. Every other stage gate —
checklist, interview, references, documents, medical screening, the election
vote — already refused per item on this path and named the refusal in the
result. The meeting gate was the only one a bulk advance walked straight
through, which made it the easiest way to move an applicant past an interview
they had not attended, and the way that gave the coordinator no sign it had
happened.

**What you will see.** A bulk advance now reports anyone on a meeting stage
with no recorded attendance among its skipped items, naming the stage:
"Advanced 27, skipped 3: Dana Reed (No attendance has been recorded for 'Chief
Interview' yet)…". The rest of the selection still advances — one refusal has
never stopped the others. Advancing that applicant singly still works and is
still ungated, which is the intended way to handle attendance nobody wrote
down.

**Superseded on 2026-09-16** — see the entry above. The single **Advance** is
no longer exempt on a stage that names its event, and the refusal's wording has
changed; the exemption now survives only on a stage that names no event.

Nothing else changes: the flag this uses is read only by the meeting gate, so
every other stage type behaves on a bulk advance exactly as before.

### A membership form submission no longer moves the wrong applicant (2026-09-15)

Three changes to how a submitted form affects a **Form Submission** pipeline
stage. The first is a fix with no setting attached; the second is a setting
that now does something; the third changes nothing for a stage you have not
edited.

**A submission only affects the stage the applicant is currently on.** It used
to find the stage by matching the _form_, complete it wherever the applicant
had actually got to, and advance them to the stage after it — pulling people
**backward**. An applicant at the membership vote landed back on the welcome
email. A guard normally hid this, but it tested for one status only, so a
stage a coordinator had **skipped** fell straight through: hand an applicant a
paper form, un-tick Required, Skip the stage, and any later submission of that
form for their email dragged them back. The public form endpoint runs the same
path, so this did not require an account. Duplicate detection only ever matches
an **active** application, so held, rejected and withdrawn applicants were
never reachable.

**The advance now goes through the same path as every other.** It previously
wrote the progress row by hand and moved the applicant directly, which skipped
the status guard, the stage gates, the row lock and the activity log — the one
advance in the system that moved somebody leaving no audit trail. A held
applicant is no longer advanced by a submission, and every form advance now
appears in the applicant's history.

**"Auto-advance when form is submitted" now decides something.** The box was
inert in both directions: ticked or un-ticked, a submission advanced the
applicant. Un-tick it and they stay on the stage with their answers recorded
for you to review.

**What you will see.** Nothing, unless you want to. A stage that carries no
auto-advance setting — which includes every stage in the seeded pipelines and
any stage where nobody touched the box — keeps advancing exactly as it does
today; absence means on, not off. The box now renders ticked by default to
match. If you had deliberately left it un-ticked expecting it to hold
applicants, it will now do that, which is a change from what you have been
getting.

### Two prospective-member stages now hold applicants where they should (2026-09-13)

Both changes are to the membership pipeline and neither touches an existing
record. **They are not gated the same way**, which matters if you are deciding
what to check after upgrading: the Election Vote gate refuses a coordinator's
**Advance** as well as an automatic one, because a vote the department has
already held is a result rather than a judgement call. The Meeting gate
withholds only the _automatic_ advance and leaves **Advance** to the
coordinator.

**An Election Vote stage now waits for the ballot.** A stage of that type
refuses **Advance** while the applicant's election package reads _Added to
Ballot_, and refuses it outright when the package comes back _Not Elected_.

**Why.** The package status was already the authoritative record of the vote —
the Elections module writes it when a package is put on a ballot and again
when the closed ballot is tallied — and nothing consulted it when moving an
applicant. An applicant the department had voted _down_ advanced on a click,
beside a panel reading "This applicant was not elected by the membership
vote"; on a pipeline with **Auto-transfer on approval** and the vote as its
final stage, that click made them a member.

**What you will see.** If your department holds its vote at a meeting and
records the result by hand, nothing changes: a stage with no package, or one
still _Draft_ or _Ready_, advances exactly as before. Only a package that
actually reached a ballot is held. If a ballot closed but the result was never
synced, the applicant stays put — un-tick **Required** on the stage and use
**Skip**, which stays audited, or record the result.

**The gate reached the Convert button on 2026-09-14.** It originally ran inside
`complete_step` alone, and **Convert** — the button shown whenever an applicant
is on the pipeline's last stage, and the documented way to finish one — calls
the transfer path directly without going through it. So for one day an
applicant the vote had rejected could still be converted to a full member by
that button. Both paths carry the gate now, with the same wording and the same
escape hatch.

**A Meeting stage that names no event no longer auto-advances at all.** The
stage builder's **Auto-Link Event Type** is what tells a meeting stage which
event counts. A stage that named none used to accept attendance at _any_ event
in the department; it now accepts none, and the stage builder refuses to save
an auto-advancing meeting stage until a type is chosen.

**Why.** Guest check-in is department-wide and is usually enabled on public
events — open houses, fundraisers, public education — which is exactly where a
prospective member turns up casually. So a stage reading "Meeting with the Fire
Chief" advanced an applicant who signed in at a pancake breakfast. **Meeting
Type** does not stand in for the event type: that field names the stage's
purpose for whoever reads it and is read by nothing.

**What you will see.** Check your meeting stages: any with _Auto-advance when
attendance is recorded_ ticked and **Auto-Link Event Type** set to _None_ will
stop advancing on their own after this upgrade. Set the event type and they
resume; the coordinator can advance by hand meanwhile. Stages that
self-schedule through **Cal.com** are unaffected — they advance when Cal.com
reports the meeting ended, not off an attendance record, so they need no
linked event.

### An email configuration that cannot send is now refused when you save it (2026-09-13, completed 2026-09-15)

Settings → Email would save an **enabled** section green that had no chance of
delivering a message. Two shapes did this: **Cloudflare** with no account ID or
API token, and the platform left at **Other**, which stores nothing at all.
(That button is now labelled **Not configured**.) Both now name the missing
field on the write, and the settings screen says so inline rather than leaving
Save to explain it. A present-but-misshapen Cloudflare account ID is rejected
too — it must be the 32-character hexadecimal value from your Cloudflare
dashboard, not the account name.

**Why this matters more than a validation message.** An enabled section short-
circuits the deployment-wide `SMTP_*` settings: `_get_smtp_config` returns early
once the organization's own section is enabled, so a hollow section did not just
fail to send on its own, **it stopped whatever server-level SMTP the deployment
had from being used.** A department that had been sending mail perfectly well
through the deployment's SMTP server and then half-filled an email section
stopped sending, with a green toast and no error anywhere.

**What to do.** If your department's mail stopped and you cannot explain it,
open Settings → Email. Either complete the section or **turn it off** — a
disabled section hands sending back to the deployment's own SMTP configuration.

**Four more things changed on the same screen.** Three are additive; the first
changes what two buttons are called.

- **Two platform buttons were renamed.** **Self-Hosted SMTP** is now **SMTP
  (any provider)**, and **Other** is now **Not configured**. Nothing beneath
  either button changed and no stored value moved — but every screenshot,
  recording and SOP that names the old labels is now wrong about them, and an
  operator following one will look for a button that is not there. The rename is
  part of the fix above rather than a separate tidy-up: both old names pointed
  departments at the one option that cannot send.
- **Twelve SMTP quick-fill presets.** Yahoo, iCloud, Zoho, Fastmail, AOL, GMX,
  SendGrid, Amazon SES, Mailgun, Postmark, Brevo and Mailjet each fill in the
  host, port and encryption the provider documents, along with what its Username
  and password fields expect — most of them require an app password generated in
  the provider's own settings once two-factor sign-in is on, which is the
  commonest reason a correct host and port still fails to authenticate. **The
  stored shape is unchanged**: still a self-hosted SMTP configuration with the
  same fields, so nothing about an existing one moves. This is a labelling fix.
  A department running on Yahoo read "Self-Hosted SMTP — your own mail server",
  reasonably concluded it was not supported, and picked "Other", which cannot
  send. Both of those names are what the rename above replaced.
- **Cloudflare departments can send ballot email.** The election ballot fan-out
  is the one batch sender, and it handed the Cloudflare path raw MIME, which
  that API does not accept — so it warned about falling back to SMTP and fell
  back to a host those organizations do not have.
- **A stored `email_service: null` no longer breaks sending.** The settings API
  accepts an explicit null and stored it, after which every read inside the
  sender raised — while the settings screen itself displayed normally, because
  the read path already guarded.

**Also fixed on 2026-09-15**, from a review of the above: an organization with
its own enabled email section is no longer overridden by a deployment-wide
Cloudflare account (that account is a default for organizations that have not
chosen, not an override for ones that have), the Cloudflare paths now carry the
`List-Unsubscribe` headers the SMTP path always did, and a partial save that
omits the platform field no longer fails with "Email cannot be enabled without
an email platform" while naming a perfectly good SMTP host.

### A click outside a dialog no longer closes it (2026-09-13)

Clicking in the margin around an open dialog used to close it. Where the dialog
held a form, that discarded the form — with no draft, no confirmation and no
undo. The case this was reported for is adding a uniform to inventory, where a
name, category, room, storage area and a set of sizes and garment style axes are
chosen before anything is saved; one click in the gutter threw all of it away
and reopened the dialog blank.

**Escape and the X in the dialog's header still close everything**, so nothing
is harder to get out of — there is just no longer a way to lose a form by
missing.

**Five surfaces deliberately keep click-away**, because none of them holds
anything you could lose: the command palette, the two equipment-check jump
sheets, the checklist picker and the "before publishing" blocker sheet. Menus
and dropdowns are unaffected — closing on an outside click is how a menu is
supposed to behave.

**Nothing to do.** This is here because it changes a habit rather than a
setting, and because a department that trains new members on video will find
that take no longer matches the application.

### Completing a repair no longer moves an inspection deadline (2026-09-13)

**This is the one item in this window that may have left bad data behind, so
read the last paragraph.**

Marking any maintenance record complete used to write the item's **last
inspection date** — a repair, a cleaning, a decontamination, anything — and
recalculate the next inspection due date from it. A structural coat inspected in
April and repaired in August had its annual NFPA 1851 inspection silently
rescheduled from the following April to the following August, and the department
read as compliant for four months longer than it actually was. Nothing raised
and nothing was logged; the only visible sign was two dates on the item page
that did not agree.

Only an **inspection** now moves that clock — routine, advanced or independent.
The type is read off the record after the update applies, so a record that is
completed and has its type corrected in the same action is judged on what it
ends up being.

⚠️ **The fix is forward-only. Items whose inspection date already slid keep the
date they hold.** If your department tracks gear on an inspection interval and
has been completing repair or cleaning records against it, **spot-check the last
inspection date on that gear against your paper records** before trusting the
next-due figure. There is no migration for this: the application cannot tell a
date that slid from one a quartermaster entered deliberately.

### The Open Shifts board no longer lists shifts you cannot take (2026-09-13)

A member picking their position off the Open Shifts board could be refused with
**"Position was filled after this request was submitted"** — a message about a
race, for a seat that had been taken for days. Two checks were answering
different questions: one asked whether the _shift_ still needed somebody, the
other whether the _member_ was cleared for anything on it, and nothing
intersected them. A shift with an empty driver's seat and a full firefighter
seat was offered to a firefighter, whose signup was then refused.

**A member's board now lists a shift only when one of its unclaimed seats is a
position they are cleared for**, so the board will be shorter than it was — and
what it drops is what the system would have refused anyway. Two related
improvements come with it: the signup picker offers only seats the server will
grant, and a shift where every seat you are cleared for is taken now says so,
instead of "you are not eligible", which was sending members to a scheduling
admin about qualifications that were fine.

**A holder of `scheduling.manage` sees no change.** That tab is also how a
scheduling admin finds the department's staffing gaps, so it keeps the
department-wide view. The short-staffed metric on the administration hub, the
MCP tool and outreach sheets are all unchanged for the same reason.

**Nothing to do**, but expect the question: a member who used to see eight open
shifts and now sees three has not lost access to anything.

### A skills test can no longer be filed with unmarked steps (2026-09-12)

Completing a skills evaluation now requires a result against every step on the
sheet. `POST /api/v1/skills-testing/tests/{id}/complete` returns **400** when
any step is still blank, listing them in `detail.unresolved_criteria`, and the
examiner screen will not offer Submit until they are resolved.

**Why.** A blank step was never neutral. A point-carrying one enlarged the
denominator and earned nothing, so it silently cost the candidate full marks,
and under `require_all_critical` a blank critical step already scored exactly
like a failure. Neither was visible anywhere on the filed result — and the two
rules pointed opposite ways, because an unmarked _deduct_ step has always been
charged nothing on the grounds that the examiner made no judgement. There was
no way to tell, reading a finished scorecard, which of those had happened.

**The way out for a step nobody could watch:** the review screen lists every
blank step and offers **Not observed** on each, which records a required reason
and takes the step out of the point pool in both directions — it credits and
penalises nothing. A **critical** step cannot be waived: that is a skill the
candidate must demonstrate, so "did not apply" is never the right answer, and
the API rejects it. This takes nothing away from an examiner, since a blank
critical step already scored as a failure.

**What you will see:** nothing changes for a test that was already fully
marked, and no stored result is re-scored. An evaluation left part-marked when
you upgrade is not stranded — reopen it, and the review screen names the steps
that still need a call.

**If you drive the API directly** (a kiosk, an import, a script), a completion
posted with blanks will now be rejected rather than filed. Send a mark for
every non-statement step, or a `{"waived": true, "waive_reason": "..."}` on the
ones that could not be observed. Statements are exempt — they are read aloud
and mark themselves.

**Also in this release, and worth knowing if you author sheets by API:** a
criterion whose `passing_score` exceeds its `max_score`, and a `score`-type
criterion with no `max_score`, are now rejected at the write. The template
builder has always refused both in the browser; a sheet posted by a script
could previously save either, and both are silent at scoring time — the first
is a step nobody can pass, the second a step that appears scored out of
something and carries no points. Existing stored templates are untouched.

### A setup wizard stuck on a 500 is fixed by this upgrade (2026-09-12)

Only relevant if you have an installation whose **first-run setup never
finished**, returning a 500 from the setup screen with no way past it. If your
department is already set up, this changes nothing you will notice.

`onboarding_status` is meant to hold exactly one row and nothing enforced it.
Two concurrent first-run requests — which the wizard's own page load issues in
parallel — could each create one, and the reader then raised on finding two, so
`GET /api/v1/onboarding/status` returned 500 **permanently**. Recovery needed
direct database access at the one moment no account exists to sign in with.

Migration `6ab7d903fae5` **collapses the duplicate rows and adds a unique
index** so they cannot recur. The surviving row is the completed one if there
is one, otherwise the furthest-progressed — so setup resumes where it actually
got to, not where an accidental twin did. Duplicate rows are deleted; they were
partial copies of a singleton, and the survivor carries the progress.

**What to do:** nothing. If setup was stuck, reload it after upgrading and it
will continue.

### Navigation layout became a department setting (2026-09-11)

Setup has always asked whether a department wants navigation across the top or
down the side. Until now the answer reached only the browser that gave it: the
wizard wrote `localStorage`, which is where the app read it, and the copy sent
to the server was stored on the onboarding session and read by nothing. So the
officer who ran setup saw their choice and every other member saw the default,
with no screen anywhere to change it.

The answer is now stored on the organization and applies to everyone.

**What you will see on the first load after upgrading:** an existing
installation has no stored layout, so every member — including the officer
whose browser held `top` — gets the `left` default. The old value lived in one
browser's local storage and was not reachable from the server, so there was
nothing to migrate.

**What to do:** if the department wants the top bar, set it once at
**Settings → General → Profile → Navigation Layout**. It applies to every
member from their next page load. Departments already on the default need do
nothing.

### Published event-request forms keep working (2026-09-09)

`events.request_pipeline.accept_public_requests` shipped read by exactly one of
the two intake paths. `POST /api/v1/event-requests/public` honoured it; the
**Forms** path — the one your own "Generate Event Request Form" button
produces, and the one the settings screen tells you to publish — never looked
at it. The same release makes the Forms path honour it too.

Left alone, that would have silently stopped community requests arriving at
every installation with a published request form, **with the toggle already
showing off and no error anywhere**.

Migration `d19b2c2ae9b9` writes down what was already true: every organization
with a **published, public** form that would actually create a request today is
recorded as accepting public event requests. It sets the flag unconditionally
for those organizations rather than only where the key is absent — a stored
`false` on such an organization cannot have meant "do not take requests from my
published form", because the toggle never controlled that form.

**Organizations with no such form are untouched** and keep the shipped default
of `false`.

**What to check:** if you publish an event-request form and do _not_ want
public submissions, the toggle now genuinely controls it — turn it off at
**Events → Settings → Pipeline**.

### Property-return reports are no longer readable department-wide (2026-09-07)

`PropertyReturnService.save_as_document` filed each generated property-return
report into the `Reports` system folder, which carries the default
`organization` visibility. Every holder of plain `documents.view` could read a
report that names a departed member, quotes the reason for the separation —
involuntary ones included — and prints their home address so the letter can be
posted.

Reports now file into a `member-separations` folder with
`FolderVisibility.LEADERSHIP`. Migration `b1e7c3a92f45` creates that folder for
organizations whose system folders were already initialised (the service's own
`initialize_system_folders` returns early for them) and moves the reports
already written into `Reports`.

**No action needed.** This is listed so you know what was exposed, and to whom,
before the upgrade.

**The downgrade restores the disclosure.** It moves the reports back to
`Reports` and drops the folders the revision created, restoring the prior state
exactly — which is correct for a schema rollback and wrong as a decision.

### Your Treasurer can now approve purchase requests (2026-09-06)

`finance.approve` and `finance.configure_approvals` are both defined and both
gate real endpoints, but **no seeded position held either**. Only `it_manager`
could reach them, and only through its `*` wildcard — the IT administrator
rather than a finance role.

**What that cost a department.** With no chain configured,
`submit_purchase_request` skips approval entirely, so requests quietly bypass
the workflow rather than failing visibly. Configure a chain _without_ also
granting `finance.approve`, and every submitted request lands in
`PENDING_APPROVAL` with nobody able to action it. The half-configured state is
the one that strands records, and the settings screen that produces it was
itself unreachable.

Migration `ee7390dcdf47` grants both to the Treasurer position.

**What you will see after upgrading:** the Treasurer can action the approval
chain. This does **not** enable self-approval — `FinanceService.approve_step`
calls `assert_different_person` and refuses it whoever holds the permission.
Denial is left unguarded on purpose: withdrawing your own request is not a
conflict.

**What to check.** The grant is **gated**, not unconditional: it applies only
where the position's finance grants are exactly
`{finance.view, finance.manage}` — what the registry seeded. A row already
holding either new grant, or any other finance shape, is left alone. **If you
deliberately curated your Treasurer to exactly view + manage, meaning "no
approval powers", review that position after upgrading** — nothing in the
stored row distinguishes that decision from the untouched seed.

## When adding a change that can block startup

Anything that can stop an existing deployment from booting — a new critical, a
default flipped toward fail-closed, a newly enforced flag — needs an entry in
this file naming the setting and both ways out. A fresh install passing is not
evidence: these failures only ever appear on installations that already
existed.

This file is the operator-facing record and is **not** covered by the changelog
freeze: it is per-change prose that concurrent branches rarely land on at the
same offset, and an operator upgrading has nowhere else to read it.
