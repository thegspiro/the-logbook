# History Module

The department archive. Phase 1 (2026-11-03) delivers the module switch, the
past-members roster, the managed title list, family links, the Honor Roll, the
change history and the department clearance list. Later phases add bulk
import and person merge (2), photos and media (3), documents (4), events and
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

## API

`/api/v1/history`, gated on the module. Every by-id read filters the
caller's department, and every client-sent id (account, title, relative,
position) is checked against it before it is stored.

| Path                                                                                                                                                                                                                             | Gate                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /people`, `GET /people/{id}`, `GET /honor-roll`, `GET /titles`, `GET /clearance/steps`, `GET /clearance/queue`                                                                                                              | signed in                                                |
| `GET /people/check`, `POST /people`, `POST /people/from-member/{user_id}`, `PATCH /people/{id}`, `PUT /people/{id}/periods`, `DELETE /people/{id}`, relations, title writes, `POST /clearance/requests`, `POST /render-markdown` | `history.manage`                                         |
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
`/history/people/:personId/edit`, `/history/honor-roll`,
`/history/clearance/:requestId`, `/history/settings`. Every route carries
`requiredModule="history"`; the API client is `createApiClient`, and `/history`
URLs are never cached (`UNCACHEABLE_SUBSTRINGS`).
