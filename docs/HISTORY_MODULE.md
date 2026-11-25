# History Module

The department archive. Phase 1 (2026-11-03) delivers the module switch, the
past-members roster, the managed title list, family links, the Honor Roll, the
change history and the department clearance list. Phase 2 (2026-11-13) adds
roster import and person merge. Phase 3 (2026-11-13) adds photos, audio and
video, with albums, a managed source list and tags on past-member records.
Phase 4 (2026-11-14) adds documents: letters, minutes, clippings and other
papers, kept in a protected History folder in Documents. Phase 5 (2026-11-21)
adds events, historical apparatus, the department timeline and "Today in
history" inside the app, with managed lists of stations, apparatus types and
event types. Phase 6 (2026-11-23) adds articles, with PDF and Word export.
Phase 7 (2026-11-24) publishes outward: the department's website reads History
through the Public Portal, and a "Today in history" widget can be framed on it.

Decisions the owner made are recorded in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md#history--decisions-the-module-ships-with-2026-11-03).

---

## Who sees what

The server builds a different response per caller; the screen hiding a field
is never the protection.

| Caller                                                | Receives                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history.view`, `history.manage` or `history.publish` | Every record and every field, drafts included (`HistoricalMemberFullView`)                                                                                                                                                                      |
| Any other signed-in member                            | Records published to members or the public (`HistoricalMemberMemberView`) — a model with no restricted fields at all, memorial fields only where each one's visibility is `members` or `public`, family links only to people they can also read |
| A clearance reviewer                                  | The member view of the record under review, through `GET /history/clearance/requests/{id}` — a reviewer has to read a draft to clear it                                                                                                         |
| The public (phase 7)                                  | The `public_snapshot` only: the last cleared version, with every field below `public` removed                                                                                                                                                   |

Restricted fields — birth date, addresses, verification sources, research
notes — are encrypted at rest and never leave the keepers' view.

| Permission        | Purpose                                                   | Seeded to |
| ----------------- | --------------------------------------------------------- | --------- |
| `history.view`    | Read unpublished records, research and the change history | Historian |
| `history.manage`  | Create and edit records, titles and the clearance list    | Historian |
| `history.publish` | Publish to members and to the public                      | Historian |

Migration `02c94bb742d6` grants all three to each department's system
Historian position, adding each only where absent.

## Records

- **Past member** (`historical_members`): name parts (last name alone is
  required), badge number (may repeat — reuse is warned about, never
  refused), an optional link to a current or archived account, birth date,
  Markdown biography, the restricted research fields, memorial and
  line-of-duty flags, and death date / circumstances / resting place each with
  its own visibility. The record keeps its own copy of the person's identity.
- **Service periods**: several per person, each with partial start and end
  dates (day, month or year, plus "approximate"), an ongoing flag for
  "1998–present", notes, and the titles held.
- **Titles** (`history_titles`): one list per department, pre-filled once from
  current ranks and positions (not "Member"). Records point at an entry, so a
  rename corrects every record; a new title is added deliberately; a title is
  retired, never deleted, except by merging it into another.
- **Family links**: stored once from one side (A `parent_of` B) and shown from
  both. Duplicate links between two people are refused.

## Change history and publication

Every edit writes a revision (`history_revisions`) with an encrypted snapshot,
the editor's note and their choice of **minor** or **substantial**.

- Publishing to members: `history.publish`, directly.
- Publishing to the public: `history.publish`, once the record's latest
  substantial revision has cleared the department's clearance list. With no
  list, directly.
- A **substantial** edit to a public record leaves the public copy as it was
  ("Changes awaiting public clearance") and withdraws any review still open.
- A **minor** edit reaches the public copy at once, unless substantial changes
  are already waiting.
- Only a draft can be deleted.

The full view reports `clearance_required` and `cleared_for_public`, so the
screen shows what the server decided rather than re-deriving it.

## Clearance list

An ordered list of steps per department, each naming a position; any one
active member holding it clears the step. Edited by `history.manage` or
`settings.manage`; every change is audit-logged and emailed to the
department's administrators.

- A request freezes the list as it stood at submission.
- Holders of the current step are emailed and get a bell entry
  (`EmailKind.HISTORY_DUTIES`, optional, on by default; never SMS).
- Returning a record requires a note and closes the request.
- A member may clear their own submission; the decision is labelled "by the
  author".
- A step whose position has since been deleted blocks with a message rather
  than being skipped.
- Internal material may be sent through the list for review by choice.

## Roster import

`/history/import`, `history.manage`. A CSV of up to 5,000 people (5 MB)
becomes a draft; nothing reaches the archive until the Historian imports it.

**Columns** (template from `GET /imports/template`): First Name, Middle Name,
Last Name (required; a single Name column is split instead when there is no
Last Name column), Suffix, Nickname, Badge Number, Joined, Left, Titles
(`;`-separated), Birth Date, Death Date, Line of Duty Death (yes/no), Notes
(stored as research notes). Other spellings of each header are recognized
(`Surname`, `DOB`, `Date Joined`, `LODD`, `Rank`, …).

**Dates** are read the way historians write them: `1952`, `1952-06`,
`June 1952`, `6/1952`, `1952-06-14`, `6/14/1952`, `June 14, 1952`. A leading
`c.`, `ca.`, `circa`, `about` or `~` marks one approximate. `present` in Left
makes the period ongoing; a blank Left is unknown.

**Each row becomes**, by the Historian's decision:

| Decision    | What the commit writes                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Match       | Adds the row's service period to an existing record and fills only its empty fields                |
| Map         | A new draft record linked to an existing member account (never a new account)                      |
| Create      | A new, unlinked draft record                                                                       |
| Same person | Adds the row's period to whatever another line of the file becomes (someone who left and rejoined) |
| Skip        | Nothing                                                                                            |

The server suggests each row's decision (`history_import_engine.suggest`):
the same last name and a compatible first name with the same badge is a
strong match; with overlapping or unknown years a weak one; an account with
the same name is suggested to map, or, if it already has a record, to match
that record. Two candidates are both offered and neither is chosen.
**Accept clear suggestions** decides every undecided row with exactly one
suggestion and makes a new record of every row with none.

**Titles** the department's list does not hold are answered once each — an
existing title, a new title, or dropped — and the answer is remembered for
later imports (`history_import_title_mappings`); a title merge carries it.

**Commit** locks the draft and requires it still to be a draft, so a retried
request is refused (409) rather than importing twice. It is refused while a
row is undecided, a decided row has a problem, or a title is unanswered. New
records start as drafts; a match is a substantial edit, so a public record
keeps its last cleared version.

**Privacy.** The rows' cells and corrections are encrypted at rest and deleted
on commit, on discard, and by `history_import_expiry` 30 days after the draft
was last worked on. Audit entries carry ids and counts, never names.

**Remove this import's records** deletes the records the import created that
are still drafts with no edits, reviews, publication, family links or merges
since, and names every record it kept and why.

## Merging two records

`/history/people/:personId/merge`, `history.manage`. The record the page opens
on is kept. `GET /people/{id}/merge-preview?other_id=` lists each field as
the same, blank on one side (filled in automatically), or different (the
Historian chooses; research text may keep both). The merge
(`POST /people/{id}/merge`):

- locks both rows (in id order, so two opposite merges cannot deadlock);
- refuses the same record, another department's, or two records linked to
  different member accounts;
- combines service periods (an identical one folds in, keeping both sets of
  titles), moves family links (dropping a link to itself or a repeat), moves
  the change history and any import row waiting on the removed record;
- deletes the removed record's clearance requests (see KNOWN_LIMITATIONS);
- writes a forward from the removed id to the kept one, re-pointing older
  forwards so none chain; `GET /people/{old id}` returns the kept record with
  `redirected_from`, and the person page moves to the kept address;
- records the merge as a substantial edit of the kept record.

## Photos and media

`/history/media`. One item is one photo, recording or video, with a catalogue:
title, description, a partial date (year, month or day, optionally "circa"),
place, creator, source or donor (from the managed list), rights note,
accession number, where the physical original is kept, and research notes
(encrypted, the archive's keepers only). Items use the same publication model
as people — draft, members, public; the clearance list; minor and substantial
revisions, recorded with `record_type` `media`. A change to the title,
description or date, or to who is tagged, is always substantial.

**What is stored.** One `history_media_files` row per stored file, under
`<org>/history-media/<media id>/`, encrypted at rest like every other upload
and malware-scanned before it is written (`store_media_upload`):

| Role        | Photo                                                    | Audio or video                                                   |
| ----------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `original`  | the upload, byte for byte (SHA-256 recorded)             | the upload, byte for byte                                        |
| `display`   | WebP, longest side 2048 px, rotated upright, no EXIF/GPS | same container, streams copied, every tag and data track dropped |
| `thumbnail` | WebP, longest side 400 px, same stripping                | a video's poster frame (WebP, 400 px); none for audio            |

Photos are JPEG, PNG or WebP up to 20 MB and 25 megapixels. TIFF is refused,
as everywhere else on the platform; scans are converted to JPEG or PNG first.
Audio is MP3, M4A, WAV or FLAC and video MP4 or WebM, up to 55 MB, under the
60 MB proxy limit. The type is read from the bytes (libmagic) and must agree
with the extension. A photo Pillow cannot open, or a recording ffmpeg cannot
read, is refused rather than stored without copies.

**Recordings and ffmpeg.** `history_media_files.make_av_copies` runs ffmpeg and
ffprobe (installed in `backend/Dockerfile`) on the scanned upload in a private
temporary directory. The members' copy is a stream copy (`-c copy`, no
re-encoding) with `-map_metadata -1`, chapters, subtitles and data tracks
dropped, so a phone's recording location, device name and title tags do not
reach readers; an audio file keeps only its sound, so an MP3's embedded cover
picture goes too. ffprobe gives the length (`duration_seconds`) and a video's
size; a video's poster frame is taken about a second in. Every call names the
input's demuxer and allows only the `file` protocol, so a file shaped like a
playlist cannot point ffmpeg at anything else on the server. On a host without
ffmpeg, an audio or video upload is refused with 503 before anything is
scanned or written; photos are unaffected.

**Who gets which file.** Everyone who may read the item gets the display copy
(`/view`) and thumbnail. `/view` is never the original. Only `history.manage`
downloads the original (`/original`, as an attachment). `/view` honours a
single `Range` (206 / 416), so a long recording seeks without downloading the
whole file.

**Tags** point at past-member records only. Each tag shows the Historian that
person's photo-use answer from the consent records — granted, declined, not
answered, or no account — on the item page and in a confirmation before
publishing. A warning never blocks publishing (owner decision). A member reads
the tags of a published item; the public snapshot lists only people who are
themselves public. A person page lists the items they are tagged in, and a
merge moves the removed record's tags to the kept one.

**Upload** (`/history/media/upload`, `history.manage`) takes up to 25 files
at once with one catalogue and one set of tags. Each file is its own request,
sent one after another under a shared `batch_id`, so a refused file is marked
and the rest carry on. Every file becomes a draft.

**Albums** (`/history/albums`) are named, ordered lists of photos and
documents in one order, at draft or members level; an album lists only the
entries its reader may see. **Sources** are managed in History settings and
shared by photos and documents; two sources for one donor can be merged.

**Deleting** an item is allowed only while it is a draft. Its files are removed
after the delete commits, so a failed commit never leaves a row pointing at a
missing file.

## Documents

`/history/documents`. A document is a row in the Documents module, filed in
the protected **History** system folder (`required_permissions =
["history.manage"]`), with its catalogue beside it, one-to-one, in
`history_documents` (phase 1 decision). The `documents` row holds the original;
its `source_type` is `history_document`, which the Documents module treats as
read-only: it may be downloaded there by anyone who can open the folder, but a
rename, move or delete is refused with 409 (and `DocumentsService.delete_document`
refuses it whichever path calls it). Nothing is uploaded or moved into the
History folder from Documents: it would sit there uncatalogued and unstripped.

**The catalogue** is the photo catalogue's fields (title, description, a
partial date, place, source or donor, rights note, accession number, where the
original is kept, research notes) plus a **document type** from a managed list
(a department starts with Letter, Minutes, Newspaper clipping, Certificate,
Programme, Report and Other, made the first time the list is read), **author
or sender**, **recipient** and a **transcription**. Research notes are
encrypted; the transcription and the text a PDF carries are not, because both
are searched. A change to the title, description, date, author, recipient,
transcription or tags is always substantial. Tags point at past-member
records; there is no photo-use consent warning (owner decision: a letter
naming someone is not a photo of them).

**What is stored.** PDFs and image scans (JPEG, PNG, WebP), up to 50 MB; a
scan up to 60 megapixels. Word and other office files are refused with a note
to convert them to PDF, and so is a PDF that needs a password to open (one
merely restricted by its owner opens without one and is accepted). Every file
is type-checked from its bytes and malware-scanned before pypdf or PDFium
reads a byte.

| File                                       | PDF                                          | Image scan                          |
| ------------------------------------------ | -------------------------------------------- | ----------------------------------- |
| original (`documents` row, Documents area) | the upload, byte for byte                    | the upload                          |
| `display` (`history_document_files`)       | rebuilt from its pages alone, see below      | WebP, 2048 px, upright, no EXIF/GPS |
| `thumbnail`                                | the first page drawn by PDFium, WebP, 400 px | WebP, 400 px                        |

**The members' copy of a PDF** (`history_document_files.make_pdf_copies`) is
built by copying the pages into a new file, so nothing in the document
catalogue comes across: no document information, XMP, open action, document
JavaScript, embedded files, outline or form scripts. Each page is cleaned
_before_ it is copied (deleting a reference afterwards would leave the object
it pointed to in the file, orphaned but readable): its own actions and
metadata go, file-attachment and media annotations go, a kept annotation keeps
only a link or in-document jump, and a form field's scripts go. Every JPEG
image inside loses its EXIF, XMP, IPTC and comment segments without being
re-encoded. Pages, text, images and annotations are kept. PDFium is not
thread-safe, so its use is serialized behind a lock.

**Search** covers the title, description, place, author, recipient,
accession number, transcription and the PDF's text, read from the stripped
copy: at most 2,000 pages and 2 MB of text, past which the document page says
search covers only its first pages. There is no OCR, so the words inside a
scan are found through its transcription.

**Viewing.** The whole app is served with `frame-ancestors 'none'`, so a PDF
cannot be shown inside an app page. The document page shows the first-page
preview and an **Open the PDF** link (**Open full size** for a scan) that
opens `/view` (the stripped copy, inline) in a new tab, in the browser's own
viewer. Chrome refuses to show a PDF sent with
the CSP sandbox header, so the protection against a script in the file is the
rebuilt copy, not a header. `/original` is always an attachment and
`history.manage` only.

**Upload, publication and delete** are as for photos: up to 25 files a batch,
one request each; draft, members or public with the clearance list
(`record_type = "document"`); delete only while a draft, removing the
`documents` row (its catalogue, files, tags and album places follow by
cascade) and every stored file after the delete commits. A person merge moves
document tags to the kept record.

## Events, apparatus and timelines

Phase 5, built to the owner-approved spec of 2026-11-21. Both new records are
published like every other: draft, members or public with the clearance list
(`record_type = "event"` and `"apparatus"`), minor and substantial edits, a
change history, delete only while a draft, research notes encrypted.

**Historical apparatus** (`/history/apparatus`, `history_apparatus`) are
History's own records, so the archive works with the Apparatus module off and
keeps a truck after the fleet deletes it. The catalogue: a name, a type from a
managed list (a department starts with Engine, Ladder or truck, Tanker or
tender, Rescue, Ambulance, Brush, Hose wagon, Steamer, Hand-drawn, Chief's or
command car and Other), year, make, model, body builder, pump (GPM), tank
(gallons) and ladder (feet), in-service and out-of-service dates (partial,
"circa"), what became of it (in service, sold, traded, scrapped, preserved,
museum, unknown), where it is now, a description, the source, an accession
number and research notes. Its **unit numbers over time** are designation
periods (`history_apparatus_designations`): Engine 1 from 1924, Engine 3 from
1951, each with its own dates and, when known, a station. Changing anything a
reader sees, the unit numbers included, is substantial.

**Starting from a fleet truck.** With the Apparatus module on, `history.manage`
can start a record from an Apparatus-module truck (`POST /apparatus/from-fleet`).
Its name, type (matched by name to the type list), year, make, model, body
builder, pump, tank and ladder figures, unit number (as the first designation,
with its station when the fleet station's name is on the station list),
in-service date and disposal (read from the disposal method; unrecognized
wording is "unknown") are copied once. No price, VIN, plate, financing,
insurance or maintenance figure is ever copied, and nothing syncs afterwards.
`fleet_apparatus_id` records where it came from, clears if the fleet truck is
deleted, and is unique per department, so a truck has at most one record; two
requests at once are decided by that key (409).

**Events** (`/history/events`, `history_events`) have a title, a start date
(required: an undated event cannot be placed on a timeline) and an optional end
date, both partial and "circa", a place, a station and an event type from
managed lists (a department starts with Fire or incident, Station, Apparatus,
Organisation, Ceremony or celebration, Line-of-duty death, Community and
Other), a description, the source and research notes. There are no civilian
fields (owner decision): a civilian's name goes in the description, which the
clearance list checks before anything is public, or in the encrypted research
notes. An event links **past members**, each with an optional role in the
Historian's words ("commanded", "injured"), **apparatus**, and existing
**photos and documents**; a write that sends a link set replaces it, one that
omits it leaves it. A member's view lists only the links they could open: a
draft person, truck, photo or document linked to a published event is left
out, not shown as a name. Changing a link is substantial. A person merge moves
event links; on an event with both people, the kept person's link and role
stay.

**Photos and documents** can be tagged with apparatus
(`PUT /media/{id}/apparatus`, `PUT /documents/{id}/apparatus`), substantial
like a change of people, with no consent warning. Their pages list the
apparatus and the events they belong to, as far as the reader may open them.

**Stations** are a managed list of names (`history_stations`), not yet
records of their own (owner decision: full station records come later). Events
and designations point at an entry, so a misspelling is corrected once,
everywhere, and two names for one firehouse are merged; the list shows how
many records use each name. When station records arrive, this list becomes
them. Stations, apparatus types and event types are kept like sources:
retired or merged, never deleted while in use. A source's usage count and a
source merge now cover apparatus and events too.

**The department timeline** (`/history/timeline`) shows events plus
milestones read from their records each time, never stored, so correcting a
record corrects the timeline:

| Milestone                             | Read from                               | A member sees it when                                                                                |
| ------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Apparatus in service / out of service | its in-service and out-of-service dates | the apparatus is published to members                                                                |
| Line-of-duty death                    | an Honor Roll record's death date       | the person is published to members **and** the death date's own visibility is `members` or `public`  |
| A title's start ("became Chief")      | a held title's own "held from" date     | the title's **On the timeline** switch is on (off by default) and the person is published to members |

A held title's dates (`historical_member_period_titles.held_from_*` /
`held_to_*`) are optional and entered on the person form. A title is never
placed by its service period's start: someone who served 1950–1990 and was
Chief from 1975 is not "Chief, 1950". The archive's keepers see drafts on the
timeline, badged. The page loads a count per decade, then one decade when it
is opened; filters narrow it by event type and by milestone kind, and a
switch shows events alone; the viewer's choices are kept in their browser.

**A person's and an apparatus's own timelines.** A person page shows the
events they took part in and their timeline: those events, their line-of-duty
death, and every title they held with a date entered (on their own page every
dated title belongs, switched on or not). An apparatus page shows entering
and leaving service, each change of unit number, the events it took part in,
and the photos and documents tagged with it.

**"Today in history"** (`GET /today`) lists entries dated to the **day** whose
day and month are today's on the department's calendar
(`resolve_org_today`), in earlier years, oldest first: events, apparatus in
and out of service, line-of-duty deaths and switched-on title starts, by the
same visibility rules as the timeline. A month-only or year-only date is
stored as the 1st and never matches a day; a 29 February entry shows on 28
February in a year without a 29th. It is a card on the History home (which
says when nothing happened) and on the Dashboard when the module is on (which
hides itself on such a day). The public widget stays in phase 7 with the
public feed.

## Articles

Phase 6, built to the owner-approved spec of 2026-11-22. An article is the
archive's written piece: a station's history, a past chief's profile, the
story of a fire. It is published like every other record: draft, members or
public with the clearance list (`record_type = "article"`), minor and
substantial edits, a change history, delete only while a draft, research notes
encrypted. Only the archive's keepers (`history.manage`) write them.

**Fields** (`history_articles`): a title, a subtitle, a byline, a summary, a
cover photo, the body, four link lists, the references it cites and research
notes. The byline is free text, because a piece may be by a retired member with
no account; left out of a new article it is the writer's name.

**The body is a list of blocks** (`history_article_blocks`), each either text
or a photo:

- A text block is written in the same rich-text editor as meeting minutes and
  stored as the same small HTML subset: two heading levels, bold, italic,
  underline, lists, quotes and links. It is cleaned on every save by
  `app/utils/rich_text.py` and again in the browser.
- A photo block names an archive photo by id, with its own caption and a width
  (full or half). A recording or film is refused.

A photo is never an image inside the HTML. Referenced by id, it is checked
against each reader on every page and every export, and the sanitizer's
allowlist stays exactly as the minutes need it. A photo deleted from the
archive leaves its block empty rather than renumbering the article: readers
skip it, and the editor shows the gap to fix.

**What a reader sees.** A member sees the photos (cover and blocks), people,
events, apparatus and documents they could open, and nothing else. An article
cannot go for **public** clearance while it shows any photo that is not itself
public; the article page lists those photos for the Historian. If a photo is
withdrawn from the public later, the public copy leaves its block out. Review
clearance is never refused for this.

**Sources.** The end of an article lists the documents and events it links to
and the photos it shows (only those the reader may see), then the Historian's
own references in their order: a book, a newspaper of a given date, an
interview.

**Linked records.** Each person, event, apparatus, document and photo page has
an "Articles" section listing the articles that link to it or show it, when
there are any. A person merge moves article links to the kept person. Articles
are not placed on the timeline or in "Today in history": an article is about a
period, not a day.

**Search** covers the title, subtitle, summary and the words of every text
block and caption. The plain text is settled into `search_text` on every save,
so a search never parses HTML row by row.

**Export** (`GET /articles/{id}/export?format=pdf|docx`).

- Built on the server with ReportLab (the minutes' fonts and logo placement)
  and python-docx. Both were already dependencies.
- The file holds exactly the page its reader could read: only the photos and
  links they may see, and never the research notes. Anyone who may read the
  article may export it.
- The department's name and logo head the first page. The footer of each page
  reads "Prepared by the department historian", the date the file was made on
  the department's calendar, and the page number (the PDF says "Page N of Y").
- Archive photos are stored as WebP, which neither library embeds, so each is
  read from its display copy (already stripped of location and camera data)
  and re-encoded as JPEG at up to 1600 pixels. A photo whose stored file cannot
  be read prints "(Photo not available)" rather than failing the file.
- The file is made in full before anything is sent, so a failure answers with
  an error, never half a file. Each export is audited by article id and format,
  never its text.

## Publishing outward

Phase 7, built to the owner-approved spec of 2026-11-24. The department's own
website reads History through the existing Public Portal
(`/api/public/v1/history`), with the same API keys, rate limits and access
log. Everything served is a record's **cleared public copy**
(`public_snapshot`), never the live record: an edit waiting for the clearance
list, a member-only field or the research notes cannot reach the website,
because none of them is in that copy. Each view names its fields one by one,
so a field added to a record's copy later is not published by accident.

**What has to be on.** The portal (switched on, with the Public Information
module), the History module, and the part asked for, under History settings →
"Public website" (`history_public_settings`, one row per department). Each part
starts switched off: people, the Honor Roll, photos, documents, events,
apparatus, articles, the timeline and "Today in history". A part that is off
answers 404, the same as a record that does not exist, so a website cannot tell
what the department keeps. A portal that is off answers 503, as the portal's
other routes do. Holders of `history.manage` or `settings.manage` edit the
switches; the Public Portal's Configuration tab points there.

**What a website can read** (each with the portal key in `X-API-Key`):

- `GET /feed?limit=&before=`: what was most recently made public, newest
  first, across every part that is on. Page back with `before` set to the last
  item's `published_at`.
- `GET /people`, `/people/{id}`, `/honor-roll`, `/photos`, `/photos/{id}`,
  `/documents`, `/documents/{id}`, `/events`, `/events/{id}`, `/apparatus`,
  `/apparatus/{id}`, `/articles`, `/articles/{id}`. Lists are paged
  (`limit`, `offset`) and, except articles, filter by `decade` (its first
  year: `1950`). There is no text search.
- `GET /timeline/decades`, `GET /timeline?decade=` and `GET /today`, built from
  the cleared copies by the rules inside the app: day precision for "today",
  and a line-of-duty death only when its date was itself set to public. On a
  quiet day `/today` answers with the next seven days' anniversaries
  (`mode: "week"`), and with none of those `mode: "none"`.

**Links between records** appear only when the record linked to is public and
its part is on: an event lists its photos only while photos are on. Names the
cleared copy holds as text (the people on an event, the apparatus in a photo)
were cleared with the record and are given as text. A photo shown inside a
public article is linked through the article, so it opens with the photo
section off.

**Files** are named by signed links, `GET /api/public/v1/history/files/{token}`,
because a browser drawing an image cannot carry an API key. Each link is an
HMAC-SHA256, under a key derived from `SECRET_KEY` for this purpose alone, over
the department, the kind of record, its id, which copy, the article it is shown
in (if any) and an expiry 24 hours ahead (rounded to the hour, so a page
loaded twice in an hour gets the same link). Every request re-checks that the
record is still public, its part still on and the portal still on, so a
withdrawn photo's link stops working at once. The copies a link can name are a
photo's display copy or thumbnail, a document's thumbnail or cleaned PDF, and
an article's public PDF; never an original, and recordings and films are
listed but not streamed. The article PDF is printed from the cleared copy in
the phase 6 layout, with only its public photos.

**The "Today in history" widget** is one `<iframe>` line on the department's
website, at `/embed/history/<token>`. The token is a secret made under History
settings → "Public website", shown once, and kept only as its SHA-256; making a
new one stops the old one at once. The page reads
`GET /api/public/v1/history/widget/<token>/today` (no API key, rate-limited per
address) and shows today's entries, or "This week in history", or nothing at
all. It can follow the visitor's light or dark setting or be fixed to one, and
the department's name and logo can be left out.

Which websites may frame it is the same list embedded forms use: the
department's websites under Organization Settings → Forms. nginx asks
`/api/public/v1/history/widget/<token>/embed-policy` on every load and writes
the answer into `frame-ancestors`; the answer is `'none'` unless the link is
current, "Today in history" is on and the portal is on. (The Public Portal's
own `allowed_origins` is still read by nothing, as before; owner decision,
2026-11-24.)

**Caching.** The security middleware sends `no-store` with every API answer,
so nothing a website reads is cached and a withdrawal takes effect on the next
request.

## API

`/api/v1/history`, gated on the module. Every by-id read filters the
caller's department, and every client-sent id (account, title, relative,
position) is checked against it before it is stored.

| Path                                                                                                                                                                                                                                                         | Gate                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /people`, `GET /people/{id}`, `GET /honor-roll`, `GET /titles`, `GET /clearance/steps`, `GET /clearance/queue`                                                                                                                                          | signed in                                                                                                            |
| `GET /people/check`, `POST /people`, `POST /people/from-member/{user_id}`, `PATCH /people/{id}`, `PUT /people/{id}/periods`, `DELETE /people/{id}`, relations, title writes, `POST /clearance/requests`, `POST /render-markdown`                             | `history.manage`                                                                                                     |
| `GET /people/{id}/merge-preview`, `POST /people/{id}/merge`, everything under `/imports`                                                                                                                                                                     | `history.manage`                                                                                                     |
| `POST /people/{id}/publish`, `/unpublish`                                                                                                                                                                                                                    | `history.publish`                                                                                                    |
| `GET /people/{id}/revisions`                                                                                                                                                                                                                                 | `history.view` / `history.manage`, or a clearer                                                                      |
| `GET /clearance/positions`, `PUT /clearance/steps`                                                                                                                                                                                                           | `history.manage` or `settings.manage`                                                                                |
| `GET /clearance/requests/{id}`                                                                                                                                                                                                                               | keepers, the submitter, or a holder of a step's position                                                             |
| `POST /clearance/requests/{id}/decide`                                                                                                                                                                                                                       | a holder of the current step's position                                                                              |
| `GET /media`, `GET /media/{id}`, `/thumbnail`, `/view`, `GET /people/{id}/media`, `GET /sources`, `GET /albums`, `GET /albums/{id}`                                                                                                                          | signed in (drafts to the keepers only)                                                                               |
| `POST /media`, `PATCH /media/{id}`, `PUT /media/{id}/tags`, `DELETE /media/{id}`, `GET /media/{id}/original`, source and album writes                                                                                                                        | `history.manage`                                                                                                     |
| `POST /media/{id}/publish`, `/unpublish`                                                                                                                                                                                                                     | `history.publish`                                                                                                    |
| `GET /media/{id}/revisions`                                                                                                                                                                                                                                  | `history.view` / `history.manage`, or a clearer                                                                      |
| `GET /documents`, `GET /documents/{id}`, `/thumbnail`, `/view`, `GET /people/{id}/documents`, `GET /document-types`                                                                                                                                          | signed in (drafts to the keepers only)                                                                               |
| `POST /documents`, `PATCH /documents/{id}`, `PUT /documents/{id}/tags`, `DELETE /documents/{id}`, `GET /documents/{id}/original`, document-type writes                                                                                                       | `history.manage`                                                                                                     |
| `POST /documents/{id}/publish`, `/unpublish`                                                                                                                                                                                                                 | `history.publish`                                                                                                    |
| `GET /documents/{id}/revisions`                                                                                                                                                                                                                              | `history.view` / `history.manage`, or a clearer                                                                      |
| `PUT /albums/{id}/items`                                                                                                                                                                                                                                     | `history.manage`; `entries` (photos and documents in order) or the earlier `media_ids` (photos only; documents stay) |
| `GET /events`, `GET /events/{id}`, `GET /apparatus`, `GET /apparatus/{id}`, `GET /apparatus/{id}/timeline`, `GET /people/{id}/timeline`, `GET /timeline`, `GET /timeline/decades`, `GET /today`, `GET /stations`, `GET /apparatus-types`, `GET /event-types` | signed in (drafts to the keepers only)                                                                               |
| `POST /events`, `PATCH /events/{id}`, `DELETE /events/{id}`, `POST /apparatus`, `PATCH /apparatus/{id}`, `DELETE /apparatus/{id}`, `PUT /media/{id}/apparatus`, `PUT /documents/{id}/apparatus`, station and type writes                                     | `history.manage`                                                                                                     |
| `GET /apparatus/fleet-options`, `POST /apparatus/from-fleet`                                                                                                                                                                                                 | `history.manage`, with the Apparatus module on                                                                       |
| `POST /events/{id}/publish`, `/unpublish`, `POST /apparatus/{id}/publish`, `/unpublish`                                                                                                                                                                      | `history.publish`                                                                                                    |
| `GET /events/{id}/revisions`, `GET /apparatus/{id}/revisions`                                                                                                                                                                                                | `history.view` / `history.manage`, or a clearer                                                                      |
| `GET /articles`, `GET /articles/{id}`, `GET /articles/{id}/export`                                                                                                                                                                                           | signed in (drafts to the keepers only)                                                                               |
| `POST /articles`, `PATCH /articles/{id}`, `DELETE /articles/{id}`                                                                                                                                                                                            | `history.manage`                                                                                                     |
| `POST /articles/{id}/publish`, `/unpublish`                                                                                                                                                                                                                  | `history.publish`                                                                                                    |
| `GET /articles/{id}/revisions`                                                                                                                                                                                                                               | `history.view` / `history.manage`, or a clearer                                                                      |
| `GET /public-settings`, `PUT /public-settings`, `POST /public-settings/widget-link`, `DELETE /public-settings/widget-link`                                                                                                                                   | `history.manage` or `settings.manage`                                                                                |

Markdown is rendered on the server (`app/utils/markdown_render.py`:
`markdown-it-py` with raw HTML and images off, then `nh3` against an
allowlist) and cleaned again in the browser with DOMPurify against the same
allowlist (`modules/history/utils/historyFormat.ts`).

## Frontend

`frontend/src/modules/history`: `/history`, `/history/people`,
`/history/people/new`, `/history/people/:personId`,
`/history/people/:personId/edit`, `/history/people/:personId/merge`,
`/history/import`, `/history/import/:importId`, `/history/honor-roll`,
`/history/clearance/:requestId`, `/history/settings`, `/history/media`,
`/history/media/upload`, `/history/media/:mediaId`,
`/history/media/:mediaId/edit`, `/history/documents`,
`/history/documents/upload`, `/history/documents/:documentId`,
`/history/documents/:documentId/edit`, `/history/albums`,
`/history/albums/:albumId`, `/history/timeline`, `/history/events`,
`/history/events/new`, `/history/events/:eventId`,
`/history/events/:eventId/edit`, `/history/apparatus`,
`/history/apparatus/new`, `/history/apparatus/:apparatusId`,
`/history/apparatus/:apparatusId/edit`, `/history/articles`,
`/history/articles/new`, `/history/articles/:articleId`,
`/history/articles/:articleId/edit`. Every route carries
`requiredModule="history"`; the API client is `createApiClient`, and `/history`
URLs are never cached (`UNCACHEABLE_SUBSTRINGS`).
