# History Module

_(Phase 1 2026-11-03; roster import and merge, photos and media 2026-11-13;
documents 2026-11-14; events, apparatus, timelines and "Today in history"
2026-11-21)_

> The full engineering reference is [docs/HISTORY_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/HISTORY_MODULE.md).
> The step-by-step guide to past members, the Honor Roll, titles and clearance
> is the History section of
> [Membership training guide 01](https://github.com/thegspiro/the-logbook/blob/main/docs/training/01-membership.md#history-2026-11-03).
> Decisions the owner made are in
> [docs/KNOWN_LIMITATIONS.md](https://github.com/thegspiro/the-logbook/blob/main/docs/KNOWN_LIMITATIONS.md#history--decisions-the-module-ships-with-2026-11-03).

The department archive: everyone who served, the Honor Roll, photos,
recordings and papers, the department's past events and apparatus, a timeline,
and a review list before anything goes public. **Off by default.**

---

## Enabling it

**Administration → Organization Settings → Organization → Modules**
(`/settings`, needs `settings.manage`). History is listed under **Additional
Modules**.

Once it is on, **History** appears in the menu with **Overview**, **Past
Members** and **Honor Roll**. The **Department History** overview has cards
for **Past members**, **Photos and media**, **Documents**, **Honor Roll**,
**Timeline**, **Events** and **Apparatus** _(2026-11-21)_, plus **Import a
roster** for the historian and **Titles, lists and clearance** for anyone who
can configure the module. Below the cards is **Today in history** (see
[below](#today-in-history-2026-11-21)). The menu itself still lists only
Overview, Past Members and Honor Roll; reach the rest from the overview.

Every signed-in member can read what has been published. Nothing else needs a
permission.

| Permission        | What it lets you do                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history.view`    | Read drafts, the research fields and each record's change history                                                                                                                   |
| `history.manage`  | Add and edit people, photos, documents, events and apparatus; import, merge, albums, titles and the managed lists (sources, document types, stations, apparatus types, event types) |
| `history.publish` | Publish to members or to the public                                                                                                                                                 |

The seeded **Historian** position holds all three. Officers with
`settings.manage` can also open **Titles and clearance** to edit the clearance
list.

Restricted fields — birth date, addresses, verification sources and research
notes (on people, events and apparatus) — are encrypted and never shown
outside the keepers.

## Past members

A record for each person who served: name, badge number, an optional link to
their member account, service periods with partial or approximate dates
("June 1952", "c. 1960", "1998–present"), the titles they held, a Markdown
biography, family links, and memorial and line-of-duty details, each with its
own visibility. Titles come from one managed list, so renaming a title
corrects every record. **Honor Roll** lists the line-of-duty deaths.

**Held-title dates** _(2026-11-21)_. Under **Edit periods of service and
titles**, each title held now has optional **_Title_: held from** and
**_Title_: held to** dates (partial and approximate like any other date). A
title reaches the timeline only through its own "held from" date, never the
service period's start: someone who served 1950–1990 and was Chief from 1975
is not "Chief, 1950". Titles entered before 2026-11-21 have no dates until you
add them. A person's page now also lists the **Events** they took part in and
their own **Timeline**.

## Publication levels

People, photos, recordings, documents, events and apparatus share one model:

| Level                    | Who can read it                                                          |
| ------------------------ | ------------------------------------------------------------------------ |
| **Draft**                | The historian, and anyone reviewing it for clearance                     |
| **Published to members** | Every signed-in member                                                   |
| **Public**               | Meant for the public, once cleared. Nothing outside the app shows it yet |

Every save asks for **Minor** or **Substantial**. A substantial edit to a
public item leaves the public copy as it was until it is cleared again. Only a
draft can be deleted. Publishing to members is direct. Publishing to the
public needs the department's **clearance list** — an ordered set of
positions — to clear the latest substantial change; with no list, it is
direct. The clearance list is set up under **Titles and clearance →
Clearance list**.

## Importing a roster _(2026-11-13)_

**Past Members → Import**, or the **Import a roster** card (`history.manage`).

1. Select **Download template** for the columns, then **Choose CSV file**.
   The file can hold up to 5,000 people and 5 MB. Dates can be a year
   (`1952`), a month (`1952-06`, `June 1952`) or a day, with `c.` in front when
   approximate; `present` means still serving. Separate several titles with
   `;`.
2. The file becomes a draft under **In review**. Nothing reaches the archive
   yet. A draft left untouched for 30 days is deleted.
3. On **Review _file name_**, each line shows the server's suggestions, such
   as **Add to** an existing record or **Link to** a member account. Pick
   one, or select **New record**, **Skip**, **Another record…** or **Mark as**
   the same person as another line (someone who left and rejoined). Use
   **Correct values** to fix a cell, and **Undo decision** to start a row
   again.
4. **Accept clear suggestions** decides every row with exactly one
   suggestion and makes a new record of every row with none. Rows with
   several possible matches are left for you.
5. Under **Titles in this file**, answer each title your list does not hold,
   then select **Save title answers**. The answer is remembered next time.
6. Filter the rows with **All**, **Need a decision** and **With a problem**.
   **Import** stays greyed out until the **Still to do** list is empty.

New people start as drafts. On a finished import, **Remove this import's
records** deletes the records it created that nobody has edited, published,
linked or reviewed since, and lists the ones it kept and why.

## Merging two records _(2026-11-13)_

When one person was entered twice, open the record to keep and select
**Merge with…**. Find the other under **The other record**, choose what to
keep for each field that differs, and select **Merge**. Service periods,
family links, tags and the change history move to the kept record, and the
old address forwards to it. Two records linked to different member accounts
cannot be merged.

## Photos and media _(2026-11-13)_

**Photos and Media** lists photos, audio and video. Filter by type, decade
and album.

- **Upload** (`history.manage`) takes up to 25 files at once with one
  catalogue (**Catalogue for every file**) and one set of tags (**People in
  every file**). A refused file is marked and the rest carry on. Every file
  becomes a draft.
- Photos are JPEG, PNG or WebP up to 20 MB. TIFF is refused; convert scans to
  JPEG or PNG. Audio is MP3, M4A, WAV or FLAC, and video MP4 or WebM, up to
  55 MB.
- Members see a copy with the location and camera details removed. Only the
  historian can download the **Original**.
- **Tags** point at past-member records. The item page shows each tagged
  person's **Photo-use consent**. Publishing an item that tags someone who
  declined or never answered asks first; it never blocks.

**Albums** group photos and documents in one order. Type a name under **New
album** and select **Create**. On the album, use **Add photos and
documents**, the arrows to reorder, and **Show to members** to share it.

## Documents _(2026-11-14)_

**Documents** holds letters, minutes, clippings and other papers. Each has a
**document type**, author or sender, recipient and an optional
transcription. Filter by type and decade, and search the text.

- **Upload** takes PDFs and scans (JPEG, PNG, WebP) up to 50 MB, 25 at a
  time. Word files and password-protected PDFs are refused; save them as a
  PDF first.
- The file is also kept in a protected **History** folder in the Documents
  module. It can be downloaded there but not renamed, moved or deleted, and
  nothing can be uploaded into that folder from Documents.
- **Open the PDF** (or **Open full size** for a scan) opens the members' copy
  in a new tab. That copy is rebuilt from the pages alone, so hidden
  metadata, scripts, attachments and photo location data never reach a
  reader. Only `history.manage` can download the original.
- **Search** covers the title, description, place, author, recipient,
  accession number, transcription and the text inside a PDF. A scan's words
  are found only through its transcription: there is no text recognition.

## Apparatus _(2026-11-21)_

**Apparatus** catalogues the department's engines and trucks, past and
present. These are History's own records, so the archive works with the
Apparatus module off and keeps a truck after the fleet deletes it. Filter by
**Type**, **Station**, **In service during** (a decade) and, for the keepers,
**Publication**.

**Add an apparatus** (`history.manage`): **Name** (the only required field),
**Type**, **Year built**, **Make**, **Model**, **Body builder**, **Pump
(GPM)**, **Tank (gallons)**, **Ladder (feet)**, **Into service** and **Out of
service** (partial or approximate dates), **What became of it**, **Where it is
now**, **Description**, **Source or donor**, **Accession number** and
**Research notes (Historian only)**. **Unit numbers** records each number it
carried, with its **Station**, **From** and **To**: Engine 1 from 1924,
Engine 3 from 1951. Changing anything a reader sees, unit numbers included, is
a substantial edit.

**Start from a truck in the fleet.** With the Apparatus module on, the new
apparatus form offers **Start from a truck in the fleet**: choose the
**Truck** and select **Start record**. Its name, type, year, make, model,
figures, unit number, in-service date and disposal are copied once, as a
draft. Nothing syncs afterwards, and no price, VIN, plate, financing or
maintenance figure is ever copied. A truck already in History is greyed out
(**already in History**): each truck can start one record.

The apparatus page shows its details, its unit numbers, a **Timeline** (into
and out of service, each change of unit number, its events) and the **Photos
and media** and **Documents** tagged with it. Photos and documents gain an
**Apparatus** section on their edit pages for that tagging; it asks no consent
question.

## Events _(2026-11-21)_

**Events** lists fires, openings, ceremonies and anything else worth keeping.
Filter by **Type**, **Station**, **Decade** and, for the keepers,
**Publication**.

**Add an event** (`history.manage`): **Title** and **Began** are required
(an undated event cannot go on the timeline); **Ended (if it ran over days or
years)**, **Type**, **Station**, **Place**, **What happened**, **Source or
donor** and **Research notes (Historian only)** are optional. **Type** and
**Station** each offer **Add a … to the list** for a missing entry. Then link:

- **People**: past-member records, each with an optional **Role** in your
  own words ("commanded", "injured").
- **Apparatus**: search by name, unit number or year.
- **Photos and documents**: **Add a photo, recording or film** and **Add a
  document** link items already in the archive.

There are **no fields for members of the public**. Name a civilian in **What
happened** only if the clearance list should check it before anything goes
public; otherwise keep the name in the research notes. A member reading an
event sees only the links they could open themselves: a draft person, truck,
photo or document is left out. Merging two person records moves their event
links.

## Timeline _(2026-11-21)_

**Timeline** shows events and milestones by decade, newest decade open; open
another to load it. Milestones are read from the records each time, so
correcting a record corrects the timeline:

| Milestone                                        | Shown to members when                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Apparatus into service** / **out of service**  | the apparatus is published to members                                                                            |
| **Line-of-duty death**                           | the person is published **and** their **Date of death shown to** is Members or Public                            |
| **Title** (a title's start, e.g. a chief's term) | the title is switched **On the timeline** in settings (off by default) and the held title has a "held from" date |

Filters: **Event type** (narrows events only), **Show milestones as well as
events**, and a **Milestones** box for each kind. Your choices are remembered
in your browser. The archive's keepers also see drafts, badged.

## Today in history _(2026-11-21)_

A **Today in history** card lists entries dated to the exact day whose day and
month are today's (on the department's calendar), from earlier years, oldest
first: events, apparatus into and out of service, line-of-duty deaths and
switched-on title starts, under the same visibility rules as the timeline. A
date entered as a month or a year only never matches. An entry on 29 February
shows on 28 February in other years.

It is on the History overview, which says **Nothing in the archive happened on
this day.** when there is nothing, and on every member's **Dashboard** while
the module is on, where it hides itself on an empty day (or if it cannot
load).

## Settings

**Titles, lists and clearance** (the page itself is headed **Titles and
Clearance**) holds the **Clearance list**, **Historical titles**, **Sources
and donors** (shared by photos, documents, events and apparatus),
**Document types** and, since 2026-11-21, **Stations**, **Apparatus types**
and **Event types**. Each of those lists is kept like sources: renaming an
entry corrects every record, an entry in use is retired or merged, never
deleted, and each row shows how many records use it. A department starts
with a set of apparatus and event types; stations start empty. Stations are
names only for now, with no address or photos of their own.

Each historical title has an **On the timeline** box, off for every title
until you tick it, which puts that title's start on the department timeline
for each person whose record dates it.

## Not yet

- Public records are not shown outside the app, and the public "Today in
  history" widget comes with the public feed (phase 7).
- Articles with PDF and Word export are phase 6.
- Apparatus and events cannot be merged: delete a duplicate while it is a
  draft. Stations are not full records yet.

---

**See also:** [Module Configuration](Configuration-Modules) | [Security & Audit Logging](Security-Audit-Logging)
