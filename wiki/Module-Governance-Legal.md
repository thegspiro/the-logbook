# Governance — Legal Documents

**Added 2026-08-20.** Lets a department write and publish the privacy notice
and terms of service shown on its own `/privacy` and `/terms` pages, instead
of living with the platform default wording.

|                              |                                                        |
| ---------------------------- | ------------------------------------------------------ |
| **Page**                     | `/governance/legal`                                    |
| **Permissions**              | `legal.propose`, `legal.publish`, or `settings.manage` |
| **Public pages it controls** | `/privacy`, `/terms`                                   |
| **Table**                    | `legal_document_revisions`                             |
| **API prefix**               | `/api/v1/legal-documents`                              |

## Why it exists

The wording on a privacy notice is a local decision. A volunteer department in
one state has different record-retention rules from a combination department in
another, and neither is well served by boilerplate written for the platform.

The second reason is record-keeping. Before this module a department could see
its **current** notice but had no way to answer the question a records request
actually asks — _what did the notice say on the day this member joined?_

## Propose and publish are separate grants

This is the part to understand before handing out the permission.

| Permission        | Can do                                                                               | Cannot do            |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------- |
| `legal.propose`   | Read the current notices; draft an alternative; edit or delete their own draft       | **Publish anything** |
| `legal.publish`   | Everything above, plus publish a draft and revert a document to the platform default | —                    |
| `settings.manage` | Reaches the screen and can publish                                                   | —                    |

A department that wants two pairs of eyes on its privacy notice gets that from
the permission model rather than from procedure — the secretary drafts, an
officer publishes. A department that does not want the ceremony can give one
person `settings.manage` and carry on.

## How a change reaches the public page

1. Someone with `legal.propose` opens **Governance → Legal Documents** and
   clicks **Propose a revision**. A draft is **not public**.
2. They record a **change note** — the bylaw, SOP, statute or counsel note
   behind the new wording. This is required; the point of proposing rather
   than editing in place is that somebody later can see the reason.
3. Someone with `legal.publish` clicks **Publish** on the draft and confirms
   with **Publish it** (_"Everyone who visits /privacy [or /terms] sees this text
   immediately. The version published now is archived, not deleted."_). The new
   wording goes live, and the revision it replaced is **archived**, not deleted.
4. `/privacy` and `/terms` serve the new text to anonymous visitors
   immediately.

**Revert to the built-in text** (confirmed with **Use the default**) returns a
document to the platform wording. It needs `legal.publish`. The published
history records it as **Built-in text restored by …** with the date — a row of
its own (`reverts_to_default`), born `archived` so it can never be edited or
published. Nothing is recorded if the built-in text was already live. The
history is ordered by when each entry went live.

## Who edited a proposal

A publisher may edit anyone's draft. The proposer stays the proposer: the
revision also records `edited_by` / `edited_at`, and the card reads
"Sam Ortiz proposed this" with "Edited by Pat Lee on …" beneath; the published
history keeps both names. Only an edit by someone **other than** the proposer
sets them, and only the latest such editor is shown — every edit is in the
audit log as `legal.revision_updated`.

## Formatting department text

Department text may use headings and lists, and nothing else:

| Type                   | Becomes              |
| ---------------------- | -------------------- |
| `## Heading` (or `# `) | a section heading    |
| `### Heading`          | a smaller heading    |
| `- item` or `* item`   | a bulleted list item |
| `1. item` or `1) item` | a numbered list item |
| a blank line           | a new paragraph      |

Links, bold, and any HTML are shown exactly as typed. There is no sanitizer and
no dependency behind this: `frontend/src/pages/legal/legalMarkup.ts` parses
the subset into plain data and `LegalMarkup.tsx` renders every string as a
React text node, so a `<script>` or a `javascript:` link is only ever text. The
same renderer draws `/privacy` and `/terms`, the published text, proposals and
history on this screen, and the editor's preview. A new proposal starts from
the built-in text with its headings as `## ` lines.

## Where the text actually lives

The **published** text is stored in the organization's own settings, which is
what the anonymous public endpoint reads — no sign-in, no database join. The
`legal_document_revisions` table is the **governance record around** it.

This matters when reasoning about the module: reading the revisions table does
not tell you what the public sees, and the public path never touches that
table.

## Statuses

| Status      | Meaning                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `draft`     | A proposal. Not public                                                                                                                                             |
| `published` | What `/privacy` or `/terms` currently serves. The service archives the previous one as it publishes, so in practice one per document type — but see the note below |
| `archived`  | Was published and has been replaced, or was a draft that was superseded                                                                                            |

Archived rows are kept permanently.

> **One-live-version is a service convention, not a database constraint.**
> `publish()` reads the current published rows, archives them, then marks its
> own draft published — and the migration creates only a **non-unique** index
> on `(organization_id, document_type, status)`. Two publishers committing at
> the same moment can therefore both archive the same predecessor and leave two
> rows in `published`. It has not been seen in practice (publishing is a rare,
> deliberate act by one person), but do not rely on the invariant when writing
> code that reads the published row — order the query, or take the most
> recently published.

## Edge cases worth knowing

- **The "Last updated" line is free text and is never parsed.** Departments
  date their policies however their records officer does — `March 3, 2026`,
  `FY26-Q1`, `Adopted at the 3/3/26 business meeting`. It is displayed
  verbatim.
- **Clearing that date clears the revision, not the public page.** Emptying
  the box does persist as a cleared value on the revision (rather than being
  silently dropped from the payload). But the **public** "Last updated" line
  lives once in the organization's settings and is shared by `/privacy` and
  `/terms`; `_write_settings` only assigns it when a revision carries a date
  and never deletes it. So publishing a revision with an empty date leaves the
  previously shown date in place. This is deliberate — reverting the terms must
  not blank the date above a privacy notice that is still published — but it
  means **the only way to change the public date is to publish a new one.**
- **Deleting the member who drafted or published a revision does not delete
  the revision.** The author reference is cleared and the record stays — the
  wording published on a date is a department record and outlives the account.
- **Deleting the organization does delete its revisions** (cascade), as with
  all other org-scoped data.
- **There is no approval queue.** A draft does not notify anyone; publishing
  is a deliberate act by someone who already holds the grant. If a department
  wants review, that is a process it runs, not a workflow the module enforces.

## API

| Method   | Path                                                 | Permission                                            |
| -------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `GET`    | `/legal-documents`                                   | `legal.propose`, `legal.publish` or `settings.manage` |
| `GET`    | `/legal-documents/{document_type}/revisions`         | `legal.propose`, `legal.publish` or `settings.manage` |
| `POST`   | `/legal-documents/revisions`                         | `legal.propose`, `legal.publish` or `settings.manage` |
| `PUT`    | `/legal-documents/revisions/{id}`                    | `legal.propose`, `legal.publish` or `settings.manage` |
| `DELETE` | `/legal-documents/revisions/{id}`                    | `legal.propose`, `legal.publish` or `settings.manage` |
| `POST`   | `/legal-documents/revisions/{id}/publish`            | `legal.publish` or `settings.manage`                  |
| `POST`   | `/legal-documents/{document_type}/revert-to-default` | `legal.publish` or `settings.manage`                  |

`document_type` is `privacy_policy` or `terms_of_service`.

## Schema

`legal_document_revisions`

| Column                      | Type                 | Notes                                     |
| --------------------------- | -------------------- | ----------------------------------------- |
| `id`                        | VARCHAR(36) PK       |                                           |
| `organization_id`           | VARCHAR(36) NOT NULL | FK → `organizations.id`, cascade delete   |
| `document_type`             | ENUM                 | `privacy_policy` \| `terms_of_service`    |
| `status`                    | ENUM                 | `draft` \| `published` \| `archived`      |
| `body`                      | TEXT NOT NULL        | The wording                               |
| `change_note`               | TEXT NOT NULL        | Why. Required at the schema layer         |
| `effective_date`            | VARCHAR(64) NULL     | Displayed as "Last updated". Never parsed |
| `created_by`                | VARCHAR(36) NULL     | FK → `users.id`, `SET NULL`               |
| `published_by`              | VARCHAR(36) NULL     | FK → `users.id`, `SET NULL`               |
| `published_at`              | DATETIME(tz) NULL    |                                           |
| `reverts_to_default`        | BOOL NOT NULL        | A "built-in text restored" history row    |
| `edited_by`                 | VARCHAR(36) NULL     | FK → `users.id`, `SET NULL`               |
| `edited_at`                 | DATETIME(tz) NULL    | When `edited_by` last edited the draft    |
| `created_at` / `updated_at` | DATETIME(tz)         |                                           |

Index: `ix_legal_revisions_org_type_status (organization_id, document_type, status)`.

Migrations: `06adc68a8b84` (table), `81b38694152f` (revert rows and edit
attribution).
