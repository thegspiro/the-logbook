# History Module

_(Phase 1 2026-11-03; roster import and merge, photos and media 2026-11-13;
documents 2026-11-14)_

The department's archive: the people who served, their photos, and the
letters, minutes and clippings that record the department's past. It is
switched on per department under **Organization Settings → Modules**, and
appears in the sidebar as **History**.

The full engineering reference is
[`docs/HISTORY_MODULE.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/HISTORY_MODULE.md).
Decisions the owner made are in
[`docs/KNOWN_LIMITATIONS.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md#history--decisions-the-module-ships-with-2026-11-03).

---

## Who sees what

| Who                                                | Sees                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The **Historian** position (seeded with all three) | Everything, drafts and research included                                                   |
| `history.view`                                     | Unpublished records, research notes and the change history                                 |
| `history.manage`                                   | Create and edit records, photos, documents, titles and the clearance list; import a roster |
| `history.publish`                                  | Publish to members, and to the public once the clearance list has cleared                  |
| Every other signed-in member                       | Only what has been published to members or the public                                      |

Restricted fields — birth date, addresses, verification sources and research
notes — are encrypted and never shown outside the keepers.

## The overview page

**History** opens on cards for **Past members**, **Photos and media**,
**Documents** and **Honor Roll**, plus **Import a roster** and **Titles and
clearance** for those who manage the archive. Below are the clearance requests
waiting on you, drafts, and recent changes.

## Past members

A record for each person who served: name, badge number, an optional link to
their member account, service periods with partial or approximate dates
("June 1952", "c. 1960", "1998–present"), the titles they held, a Markdown
biography, family links, and memorial and line-of-duty details, each with its
own visibility. Titles come from one managed list, so renaming a title
corrects every record. **Honor Roll** lists the line-of-duty deaths.

**Import a roster** reads a CSV of up to 5,000 people into a draft. The
Historian matches each row to an existing record, links it to a member
account, creates a new record, joins it to another row (someone who left and
rejoined) or skips it, and nothing reaches the archive
until the import is committed. Two records for one person can be **merged**.

## Photos and media

Photos, audio and video, each with a catalogue (title, date, place, source or
donor, rights note, accession number, where the original is kept) and tags
naming the past members in it. Up to 25 files upload at once. **Albums**
collect photos and documents in one order.

## Documents _(2026-11-14)_

`/history/documents`. Letters, minutes, newspaper clippings, certificates,
programmes, reports and other papers.

1. On **Documents**, select **Upload**. Add PDFs or image scans (JPEG, PNG,
   WebP), up to 50 MB each and 25 at a time. Word files are refused: convert
   them to PDF first. A password-protected PDF is refused too.
2. Each file becomes a draft. Open it and fill in the catalogue: the photo
   fields plus a **document type** (from a list the department manages),
   **author or sender**, **recipient** and a **transcription**.
3. Tag the past members it names. A document has no photo-use consent
   warning: a letter naming someone is not a photo of them.
4. Publish it to members, or send it through the clearance list for the
   public.

**Search** covers the title, description, place, author, recipient, accession
number, transcription and the text inside a PDF. There is no text recognition
for scans, so type a scan's transcription to make its words searchable.

**Viewing.** The document page shows a preview of the first page. **Open the PDF** (or **Open full size**)
shows the members' copy in a new browser tab. That copy is rebuilt from the
pages alone, so hidden metadata, scripts, attachments and photo location data
never reach a reader. Only `history.manage` can download the original.

**Where the file lives.** The original is kept in a protected **History**
folder in Documents. It can be downloaded there by anyone who can open that
folder, but it cannot be renamed, moved or deleted from Documents, and nothing
can be uploaded into that folder from Documents: everything goes through
**History → Documents** so it is catalogued and cleaned.

## Publishing and the clearance list

Every edit writes a revision, marked **minor** or **substantial**. Publishing
to members is direct. Publishing to the public needs the department's
**clearance list** — an ordered set of positions — to clear the latest
substantial change; with no list, it is direct. A substantial edit to a public
record leaves the public copy as it was until it clears again. Only a draft
can be deleted.

## Coming later

Events and timelines with historical apparatus (phase 5), articles with PDF
and Word export (phase 6), and the public portal feed and "Today in history"
widget (phase 7).
