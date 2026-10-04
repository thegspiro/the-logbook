# Workflow Review — W53 Documents: Folders, Upload, Who Can See What

**Driven:** 2026-10-04 · **As:** `secretary`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `9f83890` plus this run's changes · **Database:** continued from W52

---

## What was driven

1. As `secretary`: Documents from the navigation, and the 11 system folders.
2. In SOPs & Procedures: New Folder "W53 Hose Testing", with Create
   double-clicked. In that folder: Upload Document with a text file, no name
   typed, a description, and Upload double-clicked.
3. A confidential file uploaded into **Member Separations**. The folder API
   was read for each folder's visibility.
4. As `member`:
   - the folder list;
   - the confidential document by id, its download, and a search for it;
   - a `DELETE` of the hose-test document;
   - a download of the hose-test document from the screen.
5. As `secretary`:
   - Tab through the upload dialog;
   - Delete on a document, then Cancel;
   - the list and the upload dialog at 390×844.
6. After the fixes: the folder badges, the upload folder list, and the delete
   dialog's role. A keyboard-only upload: Tab to the picker, Space, choose a
   file, Upload. The member's view again.

Not driven: version history, member and apparatus sub-folders (they are created
by other modules), and the minutes publish path (W51 drove it).

## Held up ✅

- **Double-clicks:** Create Folder made one folder (11 became 12), and Upload
  made one document.
- **Upload:** the file landed in the open folder. With no name typed, it took
  the file name. "Uploaded by Sam Ortiz 10/4/2026" is in local time.
- **Who can see what** — the server's rules held on every path tried:
  - `member` saw nine folders and not the two leadership-only ones (Member
    Separations, Apparatus Files);
  - the confidential document returned **404** to both a direct read and a
    download, and a search for it found nothing;
  - `DELETE` got **403**, and the member was offered no upload, new-folder or
    delete control;
  - the member downloaded the hose-test file from the screen, with its own
    file name and contents.
- **Delete:** asks first, and Cancel keeps the document.
- **Phone:** no sideways overflow at 390px, and the upload dialog's title
  (y=131) and Upload button (bottom 722) are on screen.
- **Browser signals:** no console errors. The only failed request was the
  deliberate 404 above.

## Findings

### W53-1 — MED — A file could not be chosen with the keyboard — ✅ FIXED

**Did:** opened Upload Document as `secretary` and pressed Tab ten times.
**Saw:** focus cycled through name → description → folder → Cancel → Close and
never reached the file picker. The `<input type="file">` was `hidden`
(`display: none`), which takes no focus, and the "Choose File" label is not
focusable either. Upload stays disabled until a file is chosen, so a keyboard
user could upload nothing.
**Where:** `DocumentsPage.tsx`, the upload dialog's file input.
**Fix:**

- The input is `sr-only`: visually hidden but focusable.
- The label shows the focus ring (`peer-focus-visible:ring-2`).
- Re-driven: Tab reached the picker and Space opened the file chooser. The
  file uploaded into the chosen folder.

### W53-2 — LOW — The upload and delete dialogs were not announced as dialogs — ✅ FIXED

**Saw:** neither had a dialog role or a name: the role count was 0, while
Create Folder, in the same file, already had one.
**Fix:**

- The upload dialog is `role="dialog"`, named by its heading.
- The delete confirmation is `role="alertdialog"`, named and described by its
  warning.

### W53-3 — MED — Nothing said which folders members cannot see — ✅ FIXED

**Saw:** the folder API reports each folder's `visibility`, and two system
folders are leadership-only. But the folder cards and the upload dialog's
folder list looked identical for every folder. A secretary filing a departure
clearance had no way to tell Member Separations (leadership) from General
Documents (everyone).
**Fix:**

- A restricted folder's card carries "Leadership only" or "Owner and
  leadership only", with a lock icon.
- The upload folder list names the restriction, e.g. "Member Separations
  (leadership only)".
- Members never see the badge, because they never see those folders.
- `DocumentFolder` gains the `visibility` field the API already sends.

### W53-4 — MED — Folders cannot be restricted, renamed, moved or deleted from the screen — FLAGGED

**Saw:** Create Folder takes a name and a description only. Every folder made
on the screen is visible to all members, and nothing on the screen renames,
moves or deletes a folder. The API supports all of this already
(`PATCH /documents/folders/{id}` with `visibility`, `allowed_roles` and
`parent_id`; `DELETE /documents/folders/{id}`). So a department cannot make its
own leadership-only folder, or tidy a misnamed one, without the API.
**Why flagged:** it is a feature build, with product choices: which visibility
options to offer, what deleting a non-empty folder does, and whether system
folders can move. In `KNOWN_LIMITATIONS.md`.

### W53-5 — NIT — The route file said to disable Documents by editing `App.tsx` — ✅ FIXED

Documents is an essential module: always on, with no module gate. The comment
now says that, and says where folder access is decided.

### W53-6 — LOW — A document's type shows as a raw MIME type — OPEN

The list shows "TEXT/PLAIN" and "APPLICATION/PDF". This is cosmetic and left
as a lead.

## Checklist

| Section                 | Result                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held for folders inside existing ones, uploads and downloads. Folder management is flagged (W53-4). |
| 2. The right people     | Held: leadership folders hidden, and direct reads, downloads and search refused for the member.     |
| 3. Wrong input, failure | Held: Create needs a name; Upload needs a file.                                                     |
| 4. Browser signals      | Clean.                                                                                              |
| 5. Coming back to it    | Held: the folder and documents were there after a reload and to the other role.                     |
| 6. On a phone           | Held.                                                                                               |
| 7. Everyone can use it  | Fixed W53-1 and W53-2.                                                                              |
| 8. What happens around  | Upload and download times are in local time. Publishing minutes into Documents was driven in W51.   |

## Completion gate

| Check                    | Result                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| npm run typecheck        | clean                                                            |
| npm run lint             | clean                                                            |
| flake8 / black           | n/a: no Python changed                                           |
| frontend tests (touched) | `DocumentsPage*`: 27 passed (4 new, all failing on the old page) |
| frontend tests (full)    | 721 files, 9086 tests passed                                     |
| backend tests            | n/a: no backend change                                           |
