# Workflow Review — W57 Email Templates: Edit, Preview, Restore

**Driven:** 2026-10-13 · **As:** `admin`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-13 plus this run's changes · **Database:** continued from W56

---

## What was driven

1. As `admin`, Communications → Email Templates:
   - the template list, the editor's fields and buttons;
   - Event Reminder's subject edited, and the live preview read;
   - another template picked with the edit unsaved, then Event Reminder again;
   - the edit kept through the Footers tab and back;
   - Save double-clicked, then a reload;
   - Reset, confirmed, and the backups list read.
2. Ballot Notification: the variable palette, and the preview (the W50-68
   lead). Election Report: the preview's quorum line.
3. "Send Test to Me", with email switched off in the review install.
4. As `member`: `/communications/email-templates`, and with `wr.api` list,
   update and reset.
5. At 390×844: the template list.

## Held up ✅

- **The live preview** follows the draft: the edited subject showed in the
  rendered preview before saving.
- **Saving:** a double-clicked Save wrote once. After a reload the list
  marked the template "Edited · never sent".
- **Changing tabs** keeps the draft: an edit survived Footers → Templates.
- **Reset:**
  - asks first, naming what it restores and that CC/BCC are kept;
  - says "You cannot undo this", which is true: the backups list stayed
    empty;
  - the subject went back to the default.
- **The W50-68 lead:**
  - Ballot Notification's palette lists `{{meeting_date_html}}` and
    `{{meeting_date_text}}`;
  - the Election Report preview's "Quorum Met" comes from sample data, with
    "Sample data (default)" selected in the dropdown above the preview.
- **Who can do what:** `member` got "Access Denied" on the page and 403 on
  list, update and reset.
- **Phone:** no sideways overflow on the list.
- **Browser signals:** no console errors. The only failed request was the
  test send below, which was a 500.

## Findings

### W57-1 — MED — Picking another template threw away an unsaved edit — ✅ FIXED

**Did:** changed Event Reminder's subject without saving, clicked Shift
Reminder, then clicked Event Reminder again.
**Saw:**

- No warning. The subject was back to the saved text and the edit was gone.
- Picking a template re-seeds the editor from it.
- A browser refresh or close with unsaved changes was not guarded either.

**Where:** `EmailTemplatesPage.tsx`, the list's `onSelect`.
**Fix:**

- With unsaved changes, picking another template asks first: "Discard your
  changes? Your unsaved changes to Event Reminder will be lost.", with the
  buttons "Keep editing" and "Discard changes".
- The page uses `useUnsavedChanges`, so a refresh or close warns too.

**Re-driven:** the dialog appeared, and "Keep editing" left the edit in
place.

### W57-2 — MED — "Send Test to Me" with email switched off returned a 500 claiming the email was sent — ✅ FIXED

**Did:** pressed "Send Test to Me" on an install with email off.
**Saw:**

- The toast said "Failed to send test email".
- The server log had "HTTP 500 … Email sent but failed to log history".
- In fact no email was sent: with email off, `EmailService.send_email`
  skips the send and writes no history row, and the endpoint read the
  missing row as a logging fault.
- The History tab's own test send behaved the same way.

**Where:** `api/v1/endpoints/message_history.py` `send_test_email`;
`EmailTemplatesPage.tsx` and `MessageHistoryList.tsx`, each send's `catch`.
**Fix:**

- The endpoint checks `EmailService.can_send` first. If email is off it
  answers 400 "Email is not set up on this server, so no test email can be
  sent. Ask whoever runs the server to configure email."
- Both screens show the server's reason.

**Re-driven:** the toast now gives that message, and the request is a 400.

### W57-3 — LOW — The template filter and the preview's member picker had no label — ✅ FIXED

The two controls are now named "Filter templates" and "Preview as member".

### W57-4 — LOW — The template group headers were 28px tap targets on a phone — ✅ FIXED

"MEMBERS & ACCOUNTS", "EVENTS & SCHEDULING" and the rest are 44px on a phone
or touch screen.

## Checklist

| Section                 | Result                                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held for edit, preview, save, reset. Fixed W57-1 (an edit could be silently lost).                    |
| 2. The right people     | Held: member refused the page and every call.                                                         |
| 3. Wrong input, failure | Fixed W57-2 (a 500 when email is off, and the reason hidden).                                         |
| 4. Browser signals      | One 500, the test send, fixed (W57-2).                                                                |
| 5. Coming back to it    | Held: saved edits survive a reload; the draft survives a tab change. Refresh now warns (W57-1).       |
| 6. On a phone           | No overflow. Fixed W57-4.                                                                             |
| 7. Everyone can use it  | Fixed W57-3.                                                                                          |
| 8. What happens around  | Held: the W50-68 variables are in the palette, and the preview's quorum line is labelled sample data. |

## Completion gate

| Check                    | Result                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                             |
| npm run lint             | clean                                                                                                                                             |
| flake8 / black / isort   | clean on `message_history.py` and `test_send_test_email.py`                                                                                       |
| frontend tests (touched) | `src/modules/communications`: 258 passed (4 new, all failing on old code); `touchTargetIntegrity` passed                                          |
| backend tests            | `test_send_test_email.py`, `test_message_history.py`: 13 passed (1 new, failing on old code)                                                      |
| also fixed               | `MessagesAdminPage.delivery.test.tsx`, which arrived from `main` in this merge, looked for W55's old button name; updated to the per-message name |
