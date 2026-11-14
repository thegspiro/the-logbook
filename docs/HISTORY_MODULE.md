# History Module

The department archive. Phase 1 (2026-11-03) delivers the module switch, the
past-members roster, the managed title list, family links, the Honor Roll, the
change history and the department clearance list. Phase 2 (2026-11-13) adds
roster import and person merge. Phase 3 (2026-11-13) adds photos, audio and
video, with albums, a managed source list and tags on past-member records.
Later phases add documents (4), events and
timelines with historical apparatus (5), articles with PDF/Word export (6),
and publishing outward — the public portal feed and the "Today in history"
widget (7).

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

**Albums** (`/history/albums`) are named, ordered lists of items, at draft or
members level; an album lists only the items its reader may see. **Sources**
are managed in History settings; two sources for one donor can be merged.

**Deleting** an item is allowed only while it is a draft. Its files are removed
after the delete commits, so a failed commit never leaves a row pointing at a
missing file.

## API

`/api/v1/history`, gated on the module. Every by-id read filters the
caller's department, and every client-sent id (account, title, relative,
position) is checked against it before it is stored.

| Path                                                                                                                                                                                                                             | Gate                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /people`, `GET /people/{id}`, `GET /honor-roll`, `GET /titles`, `GET /clearance/steps`, `GET /clearance/queue`                                                                                                              | signed in                                                |
| `GET /people/check`, `POST /people`, `POST /people/from-member/{user_id}`, `PATCH /people/{id}`, `PUT /people/{id}/periods`, `DELETE /people/{id}`, relations, title writes, `POST /clearance/requests`, `POST /render-markdown` | `history.manage`                                         |
| `GET /people/{id}/merge-preview`, `POST /people/{id}/merge`, everything under `/imports`                                                                                                                                         | `history.manage`                                         |
| `POST /people/{id}/publish`, `/unpublish`                                                                                                                                                                                        | `history.publish`                                        |
| `GET /people/{id}/revisions`                                                                                                                                                                                                     | `history.view` / `history.manage`, or a clearer          |
| `GET /clearance/positions`, `PUT /clearance/steps`                                                                                                                                                                               | `history.manage` or `settings.manage`                    |
| `GET /clearance/requests/{id}`                                                                                                                                                                                                   | keepers, the submitter, or a holder of a step's position |
| `POST /clearance/requests/{id}/decide`                                                                                                                                                                                           | a holder of the current step's position                  |
| `GET /media`, `GET /media/{id}`, `/thumbnail`, `/view`, `GET /people/{id}/media`, `GET /sources`, `GET /albums`, `GET /albums/{id}`                                                                                              | signed in (drafts to the keepers only)                   |
| `POST /media`, `PATCH /media/{id}`, `PUT /media/{id}/tags`, `DELETE /media/{id}`, `GET /media/{id}/original`, source and album writes                                                                                            | `history.manage`                                         |
| `POST /media/{id}/publish`, `/unpublish`                                                                                                                                                                                         | `history.publish`                                        |
| `GET /media/{id}/revisions`                                                                                                                                                                                                      | `history.view` / `history.manage`, or a clearer          |

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
`/history/media/:mediaId/edit`, `/history/albums`,
`/history/albums/:albumId`. Every route carries
`requiredModule="history"`; the API client is `createApiClient`, and `/history`
URLs are never cached (`UNCACHEABLE_SUBSTRINGS`).
