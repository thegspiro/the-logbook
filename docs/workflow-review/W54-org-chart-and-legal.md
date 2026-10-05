# Workflow Review — W54 Org Chart and Legal Documents

**Driven:** 2026-10-04 · **As:** `admin`, `secretary`, `member`, signed out · **Viewports:** 1280×900, 390×844
**Commit:** `72cb065` plus this run's changes · **Database:** continued from W53

---

## What was driven

**Org chart** (`/governance/org-chart`)

1. As `admin`, from the navigation, on an empty chart:
   - "Add the first position" with Save double-clicked;
   - Edit, linking it to the Chief role;
   - "Add a position reporting to Chief" three times: Training Officer and
     Secretary (both linked to roles), and Chaplain (unlinked, a typed person
     with no account, and a phone number).
2. Edits:
   - a sideways nudge;
   - Training Officer's responsibility emptied and saved;
   - Secretary hidden and moved under Training Officer;
   - `not-an-email` typed as the Chaplain's contact email.
3. As `member`:
   - the navigation, and the chart;
   - search for a holder's name, and a search with no match;
   - `POST`, `PUT` and `DELETE` on a seat with `wr.api`;
   - the chart at 390×844.
4. As `admin` at 390×844: the editor dialog, and "Remove Training Officer"
   while the hidden Secretary reports to it.

**Legal documents** (`/governance/legal`)

5. As `secretary` (who can propose but not publish):
   - the navigation;
   - "Propose a revision": saved once with no note, then with a note and an
     effective date, Save double-clicked;
   - their own draft edited, with the effective date emptied, then a reload.
6. As `admin`, a Terms of Service draft. As `secretary`, with `wr.api`:
   - edit and delete of the admin's draft;
   - publish of their own draft;
   - revert to the built-in text.
7. As `admin`:
   - the secretary's draft edited, then published;
   - `/privacy` read signed out;
   - "Revert to the built-in text", then `/privacy` read again;
   - the page and the proposal editor at 390×844, and Escape.
8. As `member`: `/governance/legal`, and its API.
9. The audit log, for both screens' events.

## Held up ✅

- **Double-clicks:** Save position made one seat, and Save draft made one
  draft.
- **Org chart editing:**
  - Linking a role named its holder before saving ("Casey Morgan holds Chief
    in this application").
  - The seat then listed them as "Linked to Chief".
  - An emptied responsibility saved as empty (pitfall 1).
  - A seat is left out of its own "Reports to" list, and the nudge buttons
    are disabled at each end.
- **Hidden seats:** the member did not see the hidden Secretary seat, and the
  admin saw it marked "Hidden".
- **Removing a seat** said "1 position reporting to Training Officer will move
  up…" first. The hidden Secretary then reported to Chief, still hidden.
- **Search:** "alvarez" kept Chaplain with the Chief it reports to. "zzz" read
  "Nothing matches that search".
- **Who can do what** — the server held on every path tried:
  - `member` had no editing controls, got 403 on create, update and delete,
    and was sent no member, role or rank lists;
  - `member` had no Legal Documents entry, and got "Access Denied" on the page
    and 403 from its API;
  - `secretary` had a Legal Documents entry, but no Publish or Revert button;
  - `secretary` got 403 on publish, on revert, and on editing or discarding
    the admin's draft, and was offered no Edit or Discard on it.
- **Legal documents:**
  - A proposal starts from the full built-in text: 9,278 characters, with the
    department's name filled in.
  - Saving with no note says "Say what this revision changes and why."
  - An emptied effective date stayed empty after a reload.
- **Publishing:**
  - The confirmation names `/privacy`.
  - Signed out, `/privacy` then showed the new text and "Last updated:
    October 4, 2026".
  - Reverting brought back the built-in text ("Last updated: August 17,
    2026") and kept the published version as "Replaced".
- **Audit log:** every change was recorded with its actor:
  - `org_chart_node_created`, `…_updated`, `…_moved` and `…_deleted`;
  - `legal.revision_proposed`, `legal.revision_updated`,
    `legal.document_published` and `legal.document_reverted_to_default`.
- **Phone:**
  - no sideways overflow at 390px on either page;
  - the chart opens as the list;
  - both editors' titles (y=33) and Save buttons (bottom 815) are on screen;
  - Escape closes the proposal editor.
- **Times** show in local time ("Sunday, October 4, 2026 at 6:25 PM" for a
  23:25 UTC save).
- **Browser signals:** no console errors and no failed requests, apart from
  the deliberate 403s and 422s.

## Findings

### W54-1 — MED — A malformed contact email was published to every member — ✅ FIXED

**Did:** edited Chaplain as `admin`, typed `not-an-email` in "Contact email",
and saved.
**Saw:**

- The dialog closed, and the chart showed `not-an-email` as a `mailto:` link
  to every member.
- The field is `type="email"`, but Save is a plain button rather than a form
  submit, so the browser never checked it.
- The server took any string up to 320 characters.

**Where:** `OrgChartNodeModal.tsx` `handleSave`; `schemas/org_chart.py`, both
the create and update schemas.
**Fix:**

- The editor refuses a malformed address with "Enter a contact email like
  training@department.org." and stays open.
- The server refuses it too, with a 422 naming `contactEmail`.
- The check is loose (something@something.tld), like the organization-profile
  check. A blank still clears the field.

**Re-driven:** the editor showed the message; `PUT` and `POST` with a bad
address got 422; a real address saved.

**Note:** a seat that already holds a malformed address cannot be saved until
the address is corrected, because the editor sends every field on every save.
The message says which field.

### W54-2 — LOW — The legal tabs controlled no tab panel — ✅ FIXED

**Saw:** "Privacy Policy" and "Terms of Service" are `role="tab"`, but nothing
had `role="tabpanel"`, so a screen reader could not tell which content a tab
controls.
**Fix:** the document area is a `tabpanel` named by the selected tab, and each
tab points at it with `aria-controls`. Re-driven: the panel was found as
"Terms of Service".

### W54-3 — MED — The published history does not show a return to the built-in text — FLAGGED

**Did:** published a privacy policy as `admin`, then reverted to the built-in
text.
**Saw:**

- History reads "Replaced — published by Riley Owner, Sunday, October 4, 2026
  at 6:27 PM", and that is all.
- Nothing records when the department went back to the built-in text, or who
  did it. Only the audit log knows.

The page says the history is "kept so the department can show what members
saw on a given date", and after a revert it cannot.
**Why flagged:** a revert has no revision row to show. Recording one means a
new row type or a "replaced at / replaced by" column, which is a migration and
a product choice. In `KNOWN_LIMITATIONS.md`.

### W54-4 — LOW — A publisher's edit to a proposal keeps only the proposer's name — FLAGGED

**Did:** as `admin`, edited the secretary's draft by adding a paragraph, then
published it.
**Saw:**

- Before publishing, the card still read "Sam Ortiz proposed this", with
  nothing saying the admin had changed it.
- The published history entry names only the publisher, so who proposed the
  wording is lost from the screen.
- The audit log has both edits, with their actors.

**Why flagged:** showing "edited by" needs a new column. Whether a publisher
should edit a proposal or comment on it is a governance choice. In
`KNOWN_LIMITATIONS.md`.

### W54-5 — LOW — A department's text loses the headings and lists of the built-in one — FLAGGED

**Saw:** a proposal starts from the built-in text, flattened to plain text.
Published, `/privacy` showed its section headings as capitals ("THE SHORT
VERSION") and its lists as lines starting with a literal "- ".
`LegalPage.tsx` splits department text into paragraphs only, by design, so it
can never carry markup. A department that changes one sentence of the built-in
policy gets a page that looks worse than the one it replaced.
**Why flagged:** supporting a small set of formatting (headings, lists) on a
public page is a design and security decision. The editor already says
formatting marks are shown as typed. In `KNOWN_LIMITATIONS.md`.

### W54-6 — LOW — Two small tap targets on the legal page — LEAD (W79)

At 390px, "Open /privacy" and each "Read this version" summary are 20px tall.
Added to the W79 leads.

## Checklist

| Section                 | Result                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held: chart built, re-parented, hidden and removed; a draft proposed, published and reverted. Fixed W54-1.             |
| 2. The right people     | Held: member read-only on the chart and refused on legal; secretary proposes only and cannot touch another's draft.    |
| 3. Wrong input, failure | Fixed W54-1. Title and change note are required, and say so. A cleared responsibility and effective date stay cleared. |
| 4. Browser signals      | Clean.                                                                                                                 |
| 5. Coming back to it    | Held: changes visible from the other role and after a reload. History after a revert is flagged (W54-3).               |
| 6. On a phone           | Held. Two 20px targets passed to W79 (W54-6).                                                                          |
| 7. Everyone can use it  | Fixed W54-2. Every editor field was found by its label, and icon buttons are named ("Edit Chief", "Move Chief left").  |
| 8. What happens around  | Audit log complete for both screens. Times in local time. No notifications are involved.                               |

## Completion gate

| Check                    | Result                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| npm run typecheck        | clean                                                                                |
| npm run lint             | clean                                                                                |
| flake8 / black           | clean on `schemas/org_chart.py` and `tests/test_org_chart_schemas.py`                |
| frontend tests (touched) | `src/modules/governance`: 60 passed (2 new, each failing on old code)                |
| backend tests            | `-k "org_chart or legal"`: 123 passed (5 new cases; the 2 refusals fail on old code) |
