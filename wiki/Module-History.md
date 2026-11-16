# History Module

> The full engineering reference is [docs/HISTORY_MODULE.md](https://github.com/thegspiro/the-logbook/blob/main/docs/HISTORY_MODULE.md).
> The step-by-step guide to past members, the Honor Roll, titles and clearance
> is the History section of
> [Membership training guide 01](https://github.com/thegspiro/the-logbook/blob/main/docs/training/01-membership.md#history-2026-11-03).

The department archive: everyone who served, the Honor Roll, photos,
recordings and papers, and a review list before anything goes public. **Off by
default.**

---

## Enabling it

**Administration → Organization Settings → Organization → Modules**
(`/settings`, needs `settings.manage`). History is listed under **Additional
Modules**.

Once it is on, **History** appears in the menu with **Overview**, **Past
Members** and **Honor Roll**. The **Department History** overview has cards
for **Past members**, **Photos and media**, **Documents** and **Honor Roll**,
plus **Import a roster** for the historian and **Titles and clearance** for
anyone who can configure the module.

Every signed-in member can read what has been published. Nothing else needs a
permission.

| Permission        | What it lets you do                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `history.view`    | Read drafts, the research fields and each record's change history                                    |
| `history.manage`  | Add and edit people, photos and documents; import, merge, albums, titles, sources and document types |
| `history.publish` | Publish to members or to the public                                                                  |

The seeded **Historian** position holds all three. Officers with
`settings.manage` can also open **Titles and clearance** to edit the clearance
list.

## Publication levels

People, photos, recordings and documents share one model:

| Level                    | Who can read it                                                          |
| ------------------------ | ------------------------------------------------------------------------ |
| **Draft**                | The historian, and anyone reviewing it for clearance                     |
| **Published to members** | Every signed-in member                                                   |
| **Public**               | Meant for the public, once cleared. Nothing outside the app shows it yet |

Every save asks for **Minor** or **Substantial**. A substantial edit to a
public item leaves the public copy as it was until it is cleared again. Only a
draft can be deleted. The clearance list is set up under **Titles and
clearance → Clearance list**.

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
  in a new tab, with its hidden metadata, scripts and attachments removed.
- A scan's words are found only through its transcription. There is no text
  recognition.

## Settings

**Titles and clearance** holds the **Clearance list**, **Historical titles**,
**Sources and donors** (shared by photos and documents) and **Document
types**.

## Not yet

- Public records are not shown outside the app.
- Events and timelines, articles, and the "Today in history" widget are
  later phases.

---

**See also:** [Module Configuration](Configuration-Modules) | [Security & Audit Logging](Security-Audit-Logging)
