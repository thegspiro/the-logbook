# Meeting Minutes Module

> The full engineering reference is [docs/MEETING_MINUTES_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/MEETING_MINUTES_MODULE.md).

The official record of the department's meetings: the roll and quorum, the
order of business, motions and votes, action items, closed sessions and
election results — circulated to members for review, adopted, signed, and
published to the document library and, if the department chooses, to a public
page.

**On by default.** It is one of the standard modules.

## Enabling it

**Organization Settings → Modules → Standard Modules → Meeting Minutes** (needs
`settings.manage`). Turning it off hides the pages, closes the meetings and
minutes API and takes the public minutes page down; no data is deleted.

The pages are under **Governance** in the navigation: **Minutes** (`/minutes`)
and **Action Items** (`/action-items`).

## Meetings and minutes are two records

- A **meeting** is the event itself: date, time, type, attendees, agenda.
  **Record Minutes** on the Minutes page creates one. An event page's **Create
  Meeting** action does the same from a business meeting event, taking the
  attendees from its check-ins.
- **Minutes** are the written record of a meeting. The book icon on a meeting's
  card creates minutes from it — date, time, type, location and attendees carried
  over — or, if it already has some, opens them. Each meeting's minutes are
  listed beneath its card with their state.

Eight meeting types: business, special, committee, board, trustee, executive,
annual and other. **Executive** minutes are never shown to members without
`minutes.manage`, never announced, and published only if the department allows
it (see [Publishing](#publishing)).

## Permissions

| Permission        | Grants                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `minutes.view`    | Read circulated and adopted minutes (not executive sessions), their files and PDF; suggest changes; sign where a signature slot allows |
| `minutes.manage`  | Everything else: write, circulate, adopt, return, reopen, publish; outlines; the settings page (read-only)                             |
| `meetings.view`   | The meeting records                                                                                                                    |
| `meetings.manage` | Create and edit meetings and their agendas; the **Attendance** dashboard                                                               |
| `settings.manage` | Change the department-wide choices on **Minutes → Settings**                                                                           |

Seeded holders:

- `minutes.manage` and `meetings.manage` — Chief, Deputy Chief, Assistant
  Chief, President, Vice President, Secretary and Assistant Secretary.
- `minutes.view` — every member, through the Member position.
- `settings.manage` — Chief and President.
- The IT Manager holds `*`.

See [Role System](Role-System).

**Who sees what.** Without `minutes.manage`, a member sees minutes that have
been **circulated** or **adopted**, never drafts and never executive sessions —
in the list, the search, the files and the PDF alike. Anything else answers as
not found.

## The life of a set of minutes

The screens use **Circulated for review** and **Adopted**; the API's statuses
are `submitted` and `approved`.

```
Draft ──Circulate for Review──> Circulated ──Adopt Minutes──> Adopted ──Reopen for Correction──> Draft
  ^                                 |   |
  └────────── Recall to Draft ──────┘   └──Return for Changes──> Returned (edit to make it a draft again)
```

1. **Write.** Fill in the roll, the sections, motions, action items, closed
   sessions and attachments. Use **Record now** on Call to Order and
   Adjournment to stamp the start and end times.
2. **Circulate for Review.** Sections an outline marks _required_ must have text
   first. Every active member is emailed a link (an optional email kind, on by
   default; executive minutes are never announced).
3. **Members suggest changes.** On circulated minutes, each section has
   **Suggest a change**: the member edits a copy of the section's text. The
   secretary sees the edit as tracked changes and accepts or rejects each one —
   which requires **Recall to Draft** first, since only a draft can change.
4. **Adopt Minutes** — normally at the next meeting. Record the date, the meeting
   it was adopted at, whether as amended, and who moved and seconded. **The
   officer who circulated the minutes cannot adopt them**; they may still
   return them. If the next meeting passed the motion to accept them, the dialog
   opens already filled in from it.
5. **Sign.** The people named under **Minutes → Settings → Signatures** sign the
   adopted version by typing their name and confirming their password. A
   single-sign-on account with no password cannot sign.
6. **Publish to Documents** files a copy in the library's **Meeting Minutes**
   folder, and a public copy if allowed.

**Adopted minutes are locked**, including the quorum settings. The one thing
that still changes is action-item progress: an assignee updates their own item's
status and completion notes. To correct adopted minutes, use **Reopen for
Correction** with a reason (audit-logged); they return to draft, must be
circulated and adopted again, and a published copy is marked "Being corrected"
until the corrected version is published over it.

Every adoption seals an **approved version** — a snapshot with a SHA-256 hash.
The approved-versions panel checks the live record against it and says "Needs
attention" if they differ. Signatures belong to the version they were given on:
reopening keeps them on file and the corrected version starts unsigned.

## Roll call and quorum

Each person on the roll is **present**, **late**, **left early**, **excused**,
**absent** or a **guest**. Present, late and left early count toward quorum;
the others do not. The roll can start from a suggestion: the linked event's
check-ins (guests included), or the active member list with everyone absent.

What the minutes **print** can be narrower than what they record — all statuses,
present and excused, or present only — set under **Minutes → Settings →
Attendance** and overridable per set of minutes. The roll is always recorded in
full.

## Motions and votes

- An outline section can be marked **Needs a motion and a second** (by default,
  Approval of Previous Minutes and Adjournment). Such a section gets a prepared
  motion with its wording; the secretary picks the mover and seconder from those
  present, or types a name for someone else, and records the result. A prepared
  motion nobody acted on is not part of the record.
- The motion to accept the previous minutes names them ("Motion to accept the
  minutes of the September 3, 2026 business meeting") and records whether they
  were accepted as submitted or as revised.
- A vote is entered as **totals** (for, against, abstain, recused) or as a **roll
  call** of those present, from which the totals are counted. Each motion carries
  its threshold — majority of votes cast, majority of members present, or two
  thirds — and the screen shows the result the counts suggest. The secretary's
  recorded result stands.
- **How each member voted is never printed or published** — the PDF and the
  published copies show totals and the result only.
- A motion can link to the election and ballot item that decided it.

## Election results

A closed election held at a meeting files its certified result with that
meeting's minutes **automatically** — when it closes, or when the minutes are
created afterwards — unless **Minutes → Settings → Elections** turns that off.
**File an election result** files one by hand. The copy is frozen: later edits
to the election do not change it. A result filed after the minutes were
circulated or adopted is a permanent, labelled **addendum** outside the sealed
version. See [Elections](Module-Elections).

## Agendas and outlines

- An **outline** is the department's standard order of business per meeting
  type, edited at **Minutes → Outlines** (`/minutes/outlines`). Each section has
  a title, optional starting text, and can be marked required or as needing a
  motion. New minutes start from the default outline for their type, or a
  built-in order of business if there is none. **Apply outline** lays one over a
  draft without losing written sections.
- A meeting can carry a structured **agenda** (the clipboard icon on its card,
  `meetings.manage`): items with a presenter, notes, motion wording and linked
  library documents. Minutes drafted from that meeting take the agenda items as
  their sections instead of the outline's. If the agenda changes afterwards,
  **Sync from agenda** shows the differences and applies the ones chosen —
  without touching text already written.
- An agenda item the meeting did not reach can be ticked "The meeting did not
  take this up", so it stays in the record rather than vanishing.

## Action items

- Each item has an assignee (an active member), a due date and a status. When
  minutes are adopted, every assignee is emailed their items.
- **Action Items** (`/action-items`) lists items from meetings and minutes;
  assignees update their own there.
- **Carry forward open items** copies open items from earlier adopted minutes of
  the same type into a draft, so each item is open in exactly one place.
- **Reminders** (**Minutes → Settings → Reminders**): an email to the assignee
  3 days before the due date, the day after it, and every 7 days while overdue
  (each configurable); items more than 90 days overdue are no longer emailed.
  Members who manage minutes get a weekly list of every open item. Both are on
  by default and run daily from the `minutes_action_item_reminders` task.

## Publishing

**Minutes → Settings → Publishing** holds three switches, all **off by
default**:

| Switch                       | Effect                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| Public posting               | Publishing also posts a public copy at `/public/minutes`, readable without sign-in |
| Executive library publishing | Executive minutes may be published, to a separate leadership-only folder           |
| Executive public posting     | Executive minutes may also be posted publicly (needs both switches above)          |

- **Publishing again replaces** the library and public copies in place, with a
  note naming the version it replaced.
- The **public copy is narrower than the PDF**: attendance as counts plus the
  officers present, sections, motions with mover, seconder and result, action
  items, closed sessions as reason and times only, election counts, and the
  adoption line. It leaves out the roll, individual votes, discussion notes,
  attachments and library links.
- The public copy can be taken down without touching the library copy.
- The public page answers only on a deployment that hosts **exactly one**
  organization.

## Other record keeping

- **Closed sessions** — reason, legal basis, start and end, who was in the
  room (with when they joined and left), and a summary.
- **Attachments** — reports, handouts, agendas, correspondence and the scanned
  **signed copy**, up to 25 MB each, malware-scanned and encrypted at rest. They
  are not filed in the shared library, so an executive session's files stay with
  its minutes. A signed copy can be filed on adopted minutes and never removed.
- **Rich text** — sections can use bold, italic, underline, headings, lists,
  quotes and links; nothing else is kept.
- **Download PDF** — the printable minutes, with signature lines and, once
  adopted, the version and its hash.
- **Search** — the Minutes page's search box also finds words inside the minutes
  (sections, motions, action items), across the newest 500 sets the viewer may
  see; a quoted phrase must match as typed.

## Minutes settings

**Minutes → Settings** (`/minutes/settings`) has five sections: **Attendance**,
**Signatures** (up to six signers, each optionally tied to a position; by
default a Recording Secretary and a Presiding Officer), **Reminders**,
**Publishing** and **Elections**. Anyone with `minutes.manage` can read them;
only `settings.manage` can change them.

## For developers

- **API:** `/api/v1/minutes-records/*` (`endpoints/minutes.py` and
  `endpoints/minutes_records.py`, same prefix), meetings at
  `/api/v1/meetings/*`, both gated on the `minutes` module. The public page
  reads `/api/public/v1/minutes`. Minutes responses are snake_case.
- **Models:** `app/models/minute.py` (`MeetingMinutes`, `MinutesTemplate` —
  stored outlines — motions, action items, revisions, attachments, election
  results), `app/models/meeting.py`.
- **Services and helpers:** `minute_service.py` (including
  `member_visible_conditions()`, the one rule for what a member may read),
  `minutes_record_service.py`, `minutes_notifications.py`,
  `minutes_election_filing.py`, `template_service.py`; `app/utils/`
  `minutes_settings.py`, `minutes_attendance.py`, `minutes_snapshot.py`,
  `minutes_pdf.py`, `minutes_public.py`, `motion_votes.py`, `rich_text.py`.
- **Frontend:** `frontend/src/modules/minutes/`.
- **Scheduled tasks:** `minutes_action_item_reminders` (email, daily) beside the
  older `action_item_reminders` (in-app).
- **Notable migrations:** `8efc77d4c0c3` (record keeping), `f2c5e55e7dda`
  (adoption, suggestions, closed sessions), `48f403b2631f` (tracked changes),
  `9ce470b513ae` (vote detail), `bb60bd43bede` and `751a14709cc4` (motions on
  sections, prepared motions), `f236c56b1b49` (signatures), `38a57d984653`
  (agenda items), `89723c04ae94` (public copies), `6dc58d6997df` (attendance
  listing), `2cfc5a75105e` (all eight types on meeting records).

## Related

- [Elections](Module-Elections)
- [Governance — Legal Documents](Module-Governance-Legal)
- [Events](Module-Events)
- [Role System](Role-System)
- [Troubleshooting: Meeting Minutes](Troubleshooting#meeting-minutes-module-issues)
- [Engineering reference: docs/MEETING_MINUTES_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/MEETING_MINUTES_MODULE.md)
