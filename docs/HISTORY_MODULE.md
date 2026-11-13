# History Module

The department archive. Phase 1 (2026-11-03) delivers the module switch, the
past-members roster, the managed title list, family links, the Honor Roll, the
change history and the department clearance list. Phase 2 (2026-11-13) adds
roster import and person merge. Later phases add photos and media (3),
documents (4), events and
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

Markdown is rendered on the server (`app/utils/markdown_render.py`:
`markdown-it-py` with raw HTML and images off, then `nh3` against an
allowlist) and cleaned again in the browser with DOMPurify against the same
allowlist (`modules/history/utils/historyFormat.ts`).

## Frontend

`frontend/src/modules/history`: `/history`, `/history/people`,
`/history/people/new`, `/history/people/:personId`,
`/history/people/:personId/edit`, `/history/people/:personId/merge`,
`/history/import`, `/history/import/:importId`, `/history/honor-roll`,
`/history/clearance/:requestId`, `/history/settings`. Every route carries
`requiredModule="history"`; the API client is `createApiClient`, and `/history`
URLs are never cached (`UNCACHEABLE_SUBSTRINGS`).
