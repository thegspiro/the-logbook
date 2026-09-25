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

### Advisory items

Below any blocking items, preflight lists an **"Advisory, does not prevent
startup"** section. These are printed in the startup log too, and the service
boots with them — but each one names something that works worse than intended.

A localhost `FRONTEND_URL` used to be listed here. Since 2026-09-25 it
blocks startup instead — see
[`FRONTEND_URL` must be a public address](#frontend_url-must-be-a-public-address-2026-09-25).

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

## Before every upgrade: back up, and do not downgrade to fix a fork

The backend applies database migrations itself when it starts, so the restart
_is_ the upgrade. Before it:

- **Back up the database, and separately back up `ENCRYPTION_KEY` and
  `ENCRYPTION_SALT`.** Sensitive fields are encrypted with them, so a restored
  database is unreadable without the keys that were in use when it was written.
- **If you apply migrations by hand** (`cd backend && alembic upgrade head`),
  run `alembic heads` first. It must print exactly one revision; two means the
  release itself has a fork, and it should be reported rather than repaired
  locally.
- **Never downgrade to "repair" a migration fork.** Several migrations
  deliberately do not reverse, and one loses data on the way down — the entries
  below name them.

## Changes that can stop an existing deployment from starting

Newest first. Every entry here is a change that was safe on a fresh install
and refused to boot an existing one.

### `FRONTEND_URL` must be a public address (2026-09-25)

A production backend now **refuses to start** while `FRONTEND_URL` points at
the machine itself. Until this release that was an advisory warning, and the
shipped default is `http://localhost:3000`, so any production install that
never set it stops booting on the first restart after the upgrade:

```
CRITICAL: FRONTEND_URL is 'http://localhost:3000', which points at this machine. ...
```

Every link in an outgoing email — password resets, ballots, approvals,
reminders, applicant status — is built from `FRONTEND_URL`, never from the
address a request arrived on. A loopback value mails every recipient a link
to their own computer, and nothing else reports it: the send succeeds, the
link does not open. The check covers a host of `localhost`, a `*.localhost`
name, a loopback address (`127.x.x.x`, `::1`), `0.0.0.0`, or a value with no
parseable host. It runs in `production` only; staging and development are
unaffected.

**The fix:** set `FRONTEND_URL` in `.env` to the address members open the site
at — `https://logbook.yourdept.org`, or a LAN address such as
`http://192.168.1.50:7880` for an install nobody reaches from outside — then
confirm it reaches the container and restart:

```bash
docker compose config | grep FRONTEND_URL
```

There is no waiver flag: a deployment that sends email with unusable links
is not a configuration anyone should run. For a trial on a single machine,
run with `ENVIRONMENT=development` instead of production.

**Links already sent keep the old address.** Fixing the setting does not
reach mail already delivered: members request a fresh password reset, and the
secretary re-sends any open ballots.

**The installers now require the address too.** `install.sh` asks for it and
no longer offers "set it later", and without a terminal to ask from it
stops before installing anything. `scripts/universal-install.sh` stops unless
it is given `--public-url <url>` (or `LOGBOOK_PUBLIC_URL`) — so
`curl ... | bash` becomes `curl ... | bash -s -- --public-url <url>`. Both
accept a re-run without the flag when the existing `.env` already names a
public `FRONTEND_URL`, and both refuse a `localhost` address.
`unraid/unraid-setup.sh` refuses a `localhost` HTTPS origin, and its update
path stops, before restarting anything, when the kept `.env` would not boot.

### The production compose file needs Docker Compose v2.24.4 or later (2026-08-16)

`docker-compose.prod.yml` uses `volumes: !override` to throw away the
development bind mounts it inherits from `docker-compose.yml`, so production
runs the built image rather than a source tree mounted over it. Compose older
than v2.24.4 does not understand the tag and will not bring the stack up.

Check with `docker compose version`. **Upgrade Compose; do not delete the
tag** — without it, production mounts the development source over the image.
The Unraid compose files in `unraid/` do not use the tag, and neither does a
compose file of your own unless you copied it in.

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

### Duplicate active applicants stop the migration (2026-08-12)

Migration `20260812_0003` restores the rule that a department has at most one
**active** prospective member per email address, and builds a unique index to
hold it. A later step (`20260814_0003`) reconciles duplicates — but the index
is built first, so a database that already holds two active applicants with the
same email fails the upgrade at that index, before the reconciliation can run.

Run this before upgrading an installation older than 2026-08-12:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

**Any row it returns is a hard stop.** For each group, keep the record with the
earliest `created_at` (then the lowest `id`), review the applications linked to
the others, and set those others to `inactive`. Do not delete them. Re-run the
query until it returns nothing, then upgrade, and read the migration log
afterwards for anything the reconciliation merged. The full procedure is in the
[August 12–14 change audit](./CHANGE_AUDIT_2026-08-12_TO_14.md#alembic-route-upgrade-data-path).

### `RATE_LIMIT_ENABLED` is enforced (2026-08-01)

The flag previously gated nothing. Production and staging now refuse to start
with it disabled, since turning it off removes brute-force protection from
every authentication and public endpoint at once.

## Changes you will notice after an upgrade

Newest first. Nothing here blocks a restart — these are changes an operator
should not have to discover by being surprised.

### Every inventory item starts out "Needs a label" (2026-09-23)

Inventory items now record when their barcode label was printed. Migration
`5a70c5dcd138` adds two nullable columns to `inventory_items`
(`label_printed_at`, `label_printed_by`) and an index; it is additive and
reverses cleanly, losing only the print history.

**There is no backfill**, because nothing recorded which items were labelled
before. So on the first load after upgrading, **every item reads "Needs a
label"** on its detail page and matches the items list's new **Needs a Label**
filter. Nothing is wrong with your data; the department simply has no history
yet.

**If your stock is already labelled** and you want the filter to mean
something from day one, catch the records up without printing: filter the
items list to **Needs a Label**, tick one row, choose **Select all N
matching** (up to 500 at a time), press **Print Labels**, **cancel** the
browser's print dialog, and answer **Mark N items as labelled**. Repeat per
category or storage room. Only confirm for items whose labels really are on
the gear — that answer is the whole record.

After that, a mark clears itself whenever the value the label encodes changes
(barcode, else asset tag, else serial number), so an item whose barcode is
edited goes back to needing a label. Details in
[`training/05-inventory.md`](./training/05-inventory.md#knowing-which-items-still-need-a-label-2026-09-23).

### Suggestion boxes, and a new permission on five seeded positions (2026-09-23)

A new **Suggestions** item appears in every member's sidebar, and a
**Suggestion Boxes** screen under **Administration → Forms & Comms**. Nothing
is live until someone creates a box: with none, the page tells members "No suggestion boxes yet — Your department has not opened any suggestion boxes."

**Three migrations** (`80e2004cd691`, `394600cbfae2`, `9cb132ad83dc`). Two add
tables. The middle one **adds a grant**: `suggestions.manage` is written onto
the system **Fire Chief, Deputy Chief, Assistant Chief, President** and
**Communications Officer** positions, where absent. It only touches seeded
(`is_system`) positions — a position your department created is left alone —
and it is safe to run unconditionally because the permission did not exist
before, so no department can have removed it on purpose.

**What that grant does and does not do.** It lets the holder create boxes and
choose their reviewers. **It does not let them read any submission** — only
the reviewers named on a box can. That is deliberate: it is what lets a
department run a complaints box that its own administrators cannot open. It
also makes the **Administration** section visible to anyone holding it, which
for these five positions changes nothing.

**Suggestion boxes are not tied to the Communications module switch**, which
ships off. A department that has never enabled Communications still gets the
sidebar item; that is intended, since gating it on a switch nobody turns on
would hide it everywhere.

**Downgrade warning.** Reversing `80e2004cd691` drops the tables and with them
**every suggestion, attachment record and reply**; uploaded screenshots are left
on disk under `uploads/suggestions`. Reversing `394600cbfae2` removes the grant
from the same five seeded positions, including one your department added by
hand after upgrading — nothing distinguishes the two. Reversing `9cb132ad83dc`
drops **every forward** (a suggestion a reviewer passed to a member or position);
the suggestions themselves are untouched. Back up first if you might roll back.

**Decide who reviews a box before you announce it.** A box's reviewers are the
only people who will ever read it, so choose them with the box's purpose in
mind: a complaints box reviewed by the people most likely to be complained about
will not be used. Reviewers are emailed a link when something arrives, never the
content.

**Anonymity has limits worth telling members about.** An anonymous submission
stores no author and no exact time, but whoever administers the **server** could
correlate its arrival with access logs and mail records. The application does
not expose that to any user. See
[`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) before promising anonymity to
anyone on a department's behalf.

### A form no longer demands, or keeps, answers to hidden questions (2026-09-23)

Form fields with **conditional visibility** — "Previous EMT experience", shown
only when Membership Type is EMT — were hidden on screen but not on the
server. Two consequences, both fixed:

- **A required question the submitter could not see made the form impossible
  to submit.** The applicant who chose Administrative was refused with an
  **LB-API-400** "Required field … is missing" for a question they were never
  shown. If applicants have been reporting that they cannot submit an interest
  or application form, this is the likely cause, and nothing needs changing on
  the form itself.
- **An answer typed into a question that was later hidden was stored.** It is
  now discarded at submission.

**Older submissions may still hold hidden answers.** A one-off script clears
them, and it is careful about it: it only removes an answer whose rule — applied
to that submission's own answers — hid it, **and** only when neither the
question nor the question controlling it has been edited since the submission
came in (no history of rule changes is kept, so anything newer is listed for a
person instead). It is a dry run by default:

```bash
# See what it would remove — writes nothing:
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py

# Remove (the backup file is required and must not already exist):
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \
    --apply --backup-file /tmp/hidden-answers-backup.json

# Undo:
docker exec -it intranet-backend python scripts/clear_hidden_form_answers.py \
    --restore /tmp/hidden-answers-backup.json
```

The backup holds applicants' answers; it is written readable by its owner only.
Delete it once you no longer need the undo. Running the script is optional — the
stale answers do no harm beyond sitting in the record — and it does not touch
records other features already built from those submissions. Full options in
[`backend/scripts/README.md`](../backend/scripts/README.md#clear_hidden_form_answerspy).

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

### Direct label printing needs an approved network (2026-09-14)

The backend opens a network connection to a registered label printer, so the
addresses it may reach are now an **operator** decision rather than something
a department administrator types in. `LABEL_PRINTER_ALLOWED_NETWORKS` takes a
comma-separated list of printer IP addresses or CIDR ranges, and it is **empty
by default, which turns direct printing off**. A printer outside the list is
refused with "… does not resolve to an operator-approved label-printer
network."

A department that registered printers before this upgrade loses direct
printing until the setting is made. Add the printers' subnet to `.env`, for
example `LABEL_PRINTER_ALLOWED_NETWORKS=192.168.10.0/24`. The shipped
`docker-compose.yml` passes it through. **The Unraid compose files in `unraid/`
do not**, and neither does a compose file of your own: add
`LABEL_PRINTER_ALLOWED_NETWORKS: ${LABEL_PRINTER_ALLOWED_NETWORKS:-}` to the
backend's `environment:` block, or the value in `.env` never reaches the
container. Loopback, link-local and
reserved addresses are refused whatever the list says.

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

### Off-list event-request preferences are settled, and it does not reverse (2026-09-10)

An event request's **date flexibility**, **venue preference** and **preferred
time of day** are fixed vocabularies that the coordinator's board and the
public status page are written against. A department could rename its own
form's option values, so stored requests could carry something else and render
as a raw slug, or as nothing. Migration `0533644945cd` settles those rows the
way intake now does: trimmed and lower-cased first, and replaced with the
fallback value only when genuinely unrecognised.

**Only values outside the vocabulary are touched.** A request whose flexibility
says "specific dates" without naming one is left alone, and **outreach types
are not touched at all**, because a type missing from today's list may be one
your department genuinely offered and has since retired.

**It does not reverse.** The original off-list text is not recorded anywhere,
so the downgrade is a no-op; the settled values are valid under the older code
too.

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

### Applicant pipeline stages are renumbered (2026-09-08)

A stage's position is not only its column on the applicant board: **Advance**
moves an applicant to the next stage in that order. Two stages could end up
sharing a position — adding a stage numbered it from the count of stages, and
deleting a middle stage left a gap — and then both the column order and where
Advance went depended on how the tie happened to break.

Migration `a3f61c8d27b4` renumbers every pipeline's stages densely, keeping the
order a coordinator currently sees and breaking a tie toward the stage created
first. Nothing is added, dropped or deleted.

**What to check:** open the applicant board. Where two stages were tied, the
column order may settle differently from what you were used to — that is the
tie being broken deliberately rather than at random. If it is not the order you
want, reorder the stages in the pipeline settings.

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

**Nothing to configure.** This is listed so you know what was exposed, and to
whom, before the upgrade — and so you can **tell whoever handles separations**
that new reports are filed in the leadership-only **member-separations** folder,
not Reports.

**The downgrade restores the disclosure.** It moves the reports back to
`Reports` and drops the folders the revision created, restoring the prior state
exactly — which is correct for a schema rollback and wrong as a decision.

### Your Treasurer can now approve purchase requests (2026-09-06)

`finance.approve` and `finance.configure_approvals` are both defined and both
gate real endpoints, but **no seeded position held either**. Only `it_manager`
could reach them, and only through its `*` wildcard — the IT administrator
rather than a finance role.

**What that cost a department.** Configure a chain _without_ also granting
`finance.approve`, and every submitted request lands in `PENDING_APPROVAL` with
nobody able to action it — and the settings screen that produces that state was
itself unreachable. (With no chain configured at all, `submit_purchase_request`
also sets `PENDING_APPROVAL`, creating no approval records, for manual
approval.)

_Corrected 2026-09-25: this entry previously said that with no chain configured
a request skips approval entirely. It does not — see the `else` branch in
`FinanceService.submit_purchase_request`._

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

**Then look for a backlog.** If you built a chain that nobody could action,
requests may be sitting in _Pending Approval_; the Treasurer can now work
through them.

### A call type your department named "unclassified" is renamed (2026-09-05)

`unclassified` is the slug of the synthetic bucket a call with **no** type falls
into. A department-configured type sharing it was indistinguishable from that
remainder: the call-volume report merged its calls with the untyped ones and
labelled the total "Not categorised", and the type's own name vanished from
every screen. Migration `c9f4a2b71d38` renames such a slug, deriving the new one
from your own label, and moves the calls and filed reports that point at it.

**Nothing to do** unless you had such a type — then expect its calls to reappear
under its own name.

### The Membership Coordinator rename, and two other repairs, finally run (2026-09-05)

Four earlier migrations named the `positions` table at a point in the chain
where it was still called `roles`, and an existence guard turned the resulting
crash into a silent no-op. On every department that upgraded:

- the **Membership Committee Chair** position was never renamed to **Membership
  Coordinator**;
- role-targeted department messages were never converted from position names to
  ids;
- the default **Member** position never received the equipment-check submit
  grant, **so those members lost the checklist on upgrade**.

Migration `e8a1c04f6b27` performs all three. It skips a department that already
has a Membership Coordinator, leaves a position the department created alone,
and converts message targeting **before** renaming, so a message addressed to
the old name still resolves. A message targeting a name two positions share is
left as-is, rather than silently dropping one position's members.

### Scheduling administration moved, and six addresses stop working (2026-09-05)

Everything an officer administers about the schedule is at `/scheduling/admin`,
gated by `scheduling.manage`. These addresses stop resolving, **with no
redirect** — they land on the dashboard:

| Old address                  | New address                                                      |
| ---------------------------- | ---------------------------------------------------------------- |
| `/scheduling/settings`       | `/scheduling/admin/settings/general` (and five sibling sections) |
| `/scheduling/templates`      | `/scheduling/admin/planning/templates`                           |
| `/scheduling/patterns`       | `/scheduling/admin/planning/patterns`                            |
| `/scheduling/reports`        | `/scheduling/admin/reports`                                      |
| `/scheduling/platoons`       | `/scheduling/admin/platoons`                                     |
| `/scheduling/qualifications` | `/scheduling/admin/positions`                                    |

`/scheduling/admin/settings?tab=…` still forwards to the section it names.

**The position roster was narrowed to `scheduling.manage`.** It used to accept
the training grants too, so a training officer could open
`/scheduling/admin/positions`; the page and the API behind it
(`GET /scheduling/eligibility/roster`) now both require `scheduling.manage`
alone. Grant it if that officer needs the roster.

**Update station SOPs, pinned tabs and saved links** to these addresses, and to
the eight equipment-checklist addresses retired on 2026-08-31 (below).

### Compliance percentages may rise (2026-09-05)

Two grading defects were fixed, both in the favourable direction:

- a member exempt from a requirement could never reach 100%, because the
  percentage divided by every active requirement while counting only the ones
  that applied to that member;
- a certification that is valid today but expiring soon read as a failure.

**Expect some members' percentages to go up** after upgrading. Nothing to
configure. The Compliance Matrix's **Notify** and **Assign** buttons are gone:
they had no endpoint behind them.

### Six upgrade steps take permissions away (2026-09-05)

The old onboarding position editor saved a heuristic's checkbox defaults over
the seeded position rows, and a user's permissions are the union of every
position they hold, so the difference became live grants on every department
that finished setup. Migrations `c9a5e21f7b04`, `d1c7f4a92e63`, `f3b8d0c26a17`,
`a2e9f6b04c71`, `b6e4a0d17c93` and `d5f2b8c04a19` remove them:

| Grant                                                                                   | Comes off                                                                                                                   | What those members lose                                                                                     |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `reports.view`                                                                          | Member, Firefighter                                                                                                         | Administration → Reports, and with it the Administration section itself for anyone who had nothing else     |
| `apparatus.view`                                                                        | The rank-and-file, including the membership-standing positions (Probationary, Junior, Life, Administrative, Social, Exempt) | The fleet maintenance and compliance record                                                                 |
| `integrations.view`, `medical_supplies.view`, `mobile.view`, `prospective_members.view` | Member, Firefighter, Engineer, EMT                                                                                          | Those four workspaces                                                                                       |
| `positions.view`, `reports.view`, `settings.view`, and the `apparatus.*` wildcard       | Engineer                                                                                                                    | Engineer keeps `apparatus.view` and `apparatus.maintenance`, which is what a driver/operator is seeded with |

Two steps go the other way (`f7b3c8d2e569`, `b4d1c8e37f52`): four grants are
restored on EMT positions (seeing the department's own information, its
locations and its meetings, and asking to swap a shift), and the store-order
and equipment-check-submit grants on Member.

**⚠️ The revocation is unconditional, including where you granted it on
purpose.** Nothing in a stored position row distinguishes a deliberate grant
from the setup screen's mistake — earlier attempts to tell them apart missed
every department that had switched those modules off during setup. Because
these grants expose other members' aggregated hours, training and roster data,
they are removed wherever they are found. A position your department created
itself is never touched.

**What to do:** if your department deliberately gave members Reports, or wants
them to see the fleet, **grant it again on the positions screen after
upgrading.** The lightweight `/apparatus-basic` page, shown when the Apparatus
module is off, stays open to everyone.

### Gmail and Microsoft 365 email never sent; stored OAuth fields are deleted (2026-09-03)

The settings form saved these platforms' credentials under keys the sender never
read, so every message failed with "SMTP host and from_email are required" —
after a green "Email settings saved" toast, and **in preference to** a working
server-wide SMTP configuration, because the organization's own section wins
whenever it is enabled. Both platforms now resolve host, port, encryption and
login from a fixed preset shared by the sender and the connection test.

**What to do:** re-open **Settings → Email**, confirm the From address and app
password, and press **Test Connection**, which signs in to the provider without
saving.

**Migration `e3a9c1d5b7f2` deletes the stored Gmail and Microsoft OAuth Client
ID / Client Secret values, and does not reverse.** Nothing ever read them — no
refresh token was obtained and no send path existed.

**Microsoft 365 has a deadline.** Exchange Online is retiring Basic
authentication for SMTP submission: unchanged through December 2026, disabled by
default for existing tenants at the end of it, unavailable to tenants created
after, and removed in the second half of 2027. An App Password _is_ Basic auth.
Settings → Email offers **App registration (OAuth)** alongside it; an existing
App Password configuration keeps working, and keeps its method, until you
choose to move.

### Equipment checklists moved to Inventory; eight addresses and three permissions renamed (2026-08-31)

These addresses stop resolving with no redirect. Seven land on the dashboard;
`/scheduling?tab=equipment-checks` opens Scheduling on its **Schedule** tab,
because that page still exists and ignores the removed tab:

| Old address                               | New address                                 |
| ----------------------------------------- | ------------------------------------------- |
| `/scheduling/equipment-check-templates/…` | `/inventory/admin/checklists/templates/…`   |
| `/scheduling/equipment-check-reports`     | `/inventory/admin/checklists/reports`       |
| `/scheduling/supply/expiring`             | `/inventory/admin/checklists/supply`        |
| `/scheduling/equipment`                   | `/inventory/checklists`                     |
| `/scheduling/equipment/checks`            | `/inventory/checklists/log`                 |
| `/scheduling/equipment/{id}`              | `/inventory/checklists/apparatus/{id}`      |
| `/scheduling/apparatus-inventory`         | `/inventory/checklists/apparatus-inventory` |
| `/scheduling?tab=equipment-checks`        | `/inventory/checklists/my`                  |

**Tell your crews:** members find their checks at **Operations → My
Checklists**, and officers at **Fleet Readiness** beside it. End-of-shift
reminders **already in members' bells** carry the old address; new ones point
at the right place, and the old ones age out within a few days.

**Permissions.** Migration `ff8076f4987a` renames `equipment_check.view` /
`.manage` / `.submit` to `inventory.check_view` / `.check_manage` /
`.check_submit` on every stored position, so every position keeps exactly the
authority it had. **⚠️ A position holding the `inventory.*` wildcard now also
authors and submits equipment checklists.** No seeded position holds
`inventory.*`, so this reaches only positions your department built — typically
a quartermaster. If that is wider than you intend, replace the wildcard with the
specific `inventory.` grants you want.

### Re-check four things after the August 24–31 upgrade (2026-08-31)

- **Compliance percentages.** Clearing a compliance setting and saving used to
  keep the old value, and a compliance profile with every requirement unchecked
  was graded against every department-wide requirement. Both are fixed, so a
  percentage can move — a lot, for any group meant to have no required
  certifications.
- **Any grant or fundraising report whose range ended on the day it was run.**
  It left out that day's later records; run it again.
- **Your quartermaster.** "Checkout batch" is now **Item Distribution**
  (labels only — the data is unchanged), and stock received through the reorder
  workflow can be issued, which it could not before.
- **Empty is correct here.** Member qualifications, the organizational chart and
  testing runs all start empty after the upgrade; nothing is inferred from
  ranks, positions or members.

### The Testing Checklist is a module, and it starts switched off (2026-08-27)

`/testing` stops resolving because the checklist became a module of its own and
is off unless a department enables it: **Settings → Modules → Testing
Checklist**. Marks already on the server come back when it is on. Marks kept in
the **browser** by builds older than the server-side checklist (under
`logbook.testing-checklist.v1`) have no import path — **export that run before
you upgrade**.

### Administrative members lose their operational rank, and it does not come back (2026-08-27)

Migration `a7c4e9b13f58` clears the operational rank of every member whose
class is **administrative**. A rank carries chain-of-command permissions, so an
administrative member holding one held grants that class is outside of. The
downgrade does not restore the ranks: nothing recorded which were cleared, and
putting them back would also restore ranks an officer had cleared on purpose.

**You cannot simply set the rank again** — the API refuses an administrative
member with a rank, and the edit screen disables the control. If the rank is
right for that person, change their class first.

### Four upgrade steps take permissions away from seeded positions (2026-08-27)

Each rewrites only the positions the system seeded; nothing grants the
permission back.

| Migration      | Removes              | From                                  |
| -------------- | -------------------- | ------------------------------------- |
| `31e2816df7c3` | `compliance.view`    | Member and Firefighter                |
| `a1f7c34e9b02` | `notifications.view` | Member, Firefighter and Engineer      |
| `e4f5a6b7c8d9` | `facilities.view`    | Member, Firefighter, EMT and Engineer |
| `c7e2b9a41f83` | `facilities.view`    | the chiefs, Captain and Lieutenant    |

`compliance.view` let any member read another member's admin-hours compliance,
and `notifications.view` let any member read the Send Log of every notification
the department had sent. Facilities became a leadership and facility-manager
workspace. If someone still needs one of these, grant it in Role Management.

The chiefs keep `facilities.manage`, so they lose no access.

Two steps **add** grants, again only to seeded rows. `e3b7c25f9a41` gives
`training.configure` to the Membership Coordinator, and to the seeded chief,
officer, president, safety-officer and training-officer positions that still
hold `training.manage`. `c4a91b7e2f08` gives `users.view_consents` (the
photo-use consent roster) to the Historian and Public Outreach positions, but
only where their permissions still match the shipped default — a position your
department edited is left alone.

**Facility files uploaded before this upgrade stay readable department-wide.**
Migration `a9c4e7b2f631` gates the facility document folders on the facilities
permissions, and new uploads are filed into them, but a file already stored
outside those folders is not moved. Re-attach or re-file anything sensitive —
insurance policies, leases, capital project files.

### Who receives a ballot changes (2026-08-26)

A member's single "membership type" became two facts, a **class** and a
**status**. Two ballot categories reach a different set of members:

- A **life** member now receives a `regular` ballot, which they could not
  before.
- An **administrative** member with regular standing **no longer** receives
  ballots restricted to active or life members.

The `operational` category is unchanged: it still requires the operational
class and regular standing. Check the recipient list of your next ballot; to
include administrative voters, use an override or an explicit voter list.

### Three upgrade steps do not reverse (2026-08-26)

None loses data on the way up, and each downgrade is a deliberate no-op,
because putting the old values back would do more damage than leaving them:

- `c3d4e5f6a7b8` recovers members' class and status from the membership
  "positions" onboarding used to create (Probationary, Life and so on). Nothing
  records which members it reclassified, so undoing it would also flatten
  standings a department set by hand. The positions themselves are kept.
- `d7a4e9c31b60` and `e2c8f5a71d40` settle stored crew-seat names onto one
  spelling (`EMT` becomes `ems`, which fixes EMT seats nobody could sign up
  for). Nothing records which spelling a row had.
- `b8d5f0c24a69` adds the administrative-access flag to stored crew seats.
  Older versions read the extra field without complaint.

### Rolling back past the org chart loses every additional holder (2026-08-25)

> **⚠️ This downgrade destroys data.** `a7c93f21d5b8` lets one seat on the
> organizational chart hold several people. Its downgrade restores the
> single-holder shape by keeping **each seat's first holder only**, then drops
> the holders table: every other holder is lost, and a seat whose holders came
> only from a linked position comes back **empty**. If your department has drawn
> its chart and you may roll back, write the holders down first.

### Equipment-check item types collapse from nine to four, and it does not reverse (2026-08-23)

Migration `c3f81a4d5e72` turns the old check types into four — **Level**,
**Function**, **Count** and **Expiry** (Pass/Fail, Present and Functional all
become Function; Reading joins Level). Headings and free text are untouched. It
also writes default instructions into items that had none, and leaves any
description an author wrote alone.

The downgrade leaves the types collapsed. Nothing records which of three old
names a Function item started as, and **a wrong guess renders the wrong control
on a safety checklist.** No data is lost either way.

### ID cards, label printers and the new columns start empty (2026-08-23)

- **NFC ID cards are off** until turned on at **Settings → Integrations → NFC ID
  Cards**. Grant `members.manage_id_cards` to whoever issues cards and
  `members.check_in` to whoever runs a check-in station; the upgrade grants
  neither.
- **Register your label printers** before anyone tries to print, and set
  `LABEL_PRINTER_ALLOWED_NETWORKS` — see
  [Direct label printing needs an approved network](#direct-label-printing-needs-an-approved-network-2026-09-14).
- **Several new columns deliberately start empty**, and an empty value is not a
  failed upgrade: no compartment is sealed, no earlier check-in has an
  early-arrival figure, earlier QR check-ins stay recorded as `qr_scan`,
  training submitted before this has no start time, existing email templates
  keep their own colours, no standing shift claims are inferred from anyone's
  assignments, and a department with no metric preferences gets the built-in
  metrics on each administration page.

### Two access rules tighten for officers (2026-08-23)

- **Screening compliance needs `medical_screening.view`.** Officers who saw
  medical-screening compliance on the Members administration page through
  `members.manage` alone now see it reading _unknown_, with an empty queue,
  until they hold it.
- **Schedulers are held to position eligibility.** Assigning a member to a seat
  their rank is not cleared for is refused, with the missing qualification
  named — the same rule members already met when claiming a seat.

### Seat lists and equipment checks: two steps that do not reverse (2026-08-22)

Neither loses data:

- `1eeb053d59b7` rewrites every stored seat list into one shape, expanding a
  legacy crew **count** into that many seats. Its downgrade is a no-op: the
  original count cannot be recovered from the seats, and both old and new code
  read the new shape.
- `a17c4e9d2b61` allows one equipment check per shift per template. Historical
  duplicates are detached from their shift, not deleted, and their item
  snapshots are kept. The downgrade cannot re-attach them.

**Do not downgrade past both `d6f4a13c9e20` and `4c8d7e2a91b3`.** Both widen
`shift_equipment_check_items.compartment_name` to `TEXT`; downgrading past the
second narrows it back and truncates deep compartment paths (SCHEMA-1 in
[Known Limitations](./KNOWN_LIMITATIONS.md)).

Three further migrations in this window (`7ed8593bc904`, `5c2f6a8b1d34`,
`9f6d1c2a4b70`) repair databases that were stamped as having run work they
never ran, after earlier revisions were renumbered. On a healthy database they
do nothing.

### Legal Documents and swap approval change who can do what (2026-08-20)

- **Governance → Legal Documents** needs `legal.propose` to draft and
  `legal.publish` to publish. Migration `06adc68a8b84` grants `legal.propose` to
  every position holding `settings.view` and `legal.publish` to every position
  holding `settings.manage`. Review who that reaches before anyone drafts.
- **Nobody can review a swap or time-off request they are part of**, even with
  `scheduling.manage`. If exactly one person holds `scheduling.manage` and they
  also request swaps, their own requests will wait — grant a second person.

### Rooms can nest, storage areas get barcodes, and suppliers become vendors (2026-08-16)

- `20260816_0001` lets a facility room sit inside another. Existing rooms stay
  top-level.
- `20260816_0002` gives every storage area without a barcode the next code in
  the department's `SA-` series. Codes already in use, including on retired
  areas, are skipped.
- `20260816_0003` creates one inventory vendor for every distinct free-text
  supplier name (ignoring case) and links the items and reorders that named it.
  `Galls` and `Galls Inc.` become two vendors; merge them by hand if they are
  one.

## When adding a change that can block startup

Anything that can stop an existing deployment from booting — a new critical, a
default flipped toward fail-closed, a newly enforced flag — needs an entry in
this file naming the setting and both ways out. A fresh install passing is not
evidence: these failures only ever appear on installations that already
existed.

This file is the operator-facing record and is **not** covered by the changelog
freeze: it is per-change prose that concurrent branches rarely land on at the
same offset, and an operator upgrading has nowhere else to read it.
