# Workflow Review — W55 Messages: Send to a Group, the Member's Inbox, Message Administration

**Driven:** 2026-10-05 · **As:** `admin`, `member`, `member2` · **Viewports:** 1280×900, 390×844
**Commit:** `1d90b34` plus this run's changes · **Database:** continued from W54

---

## What was driven

1. As `admin`, from the navigation: looked for Department Messages
   (`/communications/messages`). Then, on the screen:
   - "Post message" with nothing filled in;
   - "W55 Hose test Saturday", Important, sent to one member found by
     searching "jordan" (Jordan Avery, the `member` account), with
     acknowledgment required and a link in the body. "Post message" was
     double-clicked.
2. As `member`:
   - the navigation, the dashboard, the inbox and the message;
   - Acknowledge, double-clicked, then a reload;
   - the unread count.
3. As `admin`: "View acknowledgments" on that message.
4. As `member2` (not a recipient):
   - the inbox, and the message's URL;
   - read and acknowledge on it with `wr.api`;
   - `GET`, `POST` and `DELETE` on the admin endpoints;
   - `/communications/messages`.
5. As `admin`:
   - a message to the Secretary role, expiring 31 Dec at 5:00 PM;
   - a message scheduled for 1 Dec;
   - the role message edited: expiry emptied, audience widened to Everyone;
   - `member2`'s inbox read after each step;
   - the role message deleted;
   - with `wr.api`, an expiry before the scheduled time, and an expiry in the
     past;
   - an expiry in the past through the form.
6. At 390×844:
   - `member`'s inbox and message;
   - `admin`'s message list and the compose form;
   - the Admin menu.

## Held up ✅

- **Double-clicks:** "Post message" made one message, and "Acknowledge" made
  one acknowledgment.
- **Targeting:**
  - only Jordan Avery got the hose-test message;
  - `member2` saw nothing, got 404 at its URL, and 400 on read and
    acknowledge;
  - widening the role message to Everyone delivered it to `member2`;
  - deleting it took it out of their inbox again.
- **Scheduled message:** stayed out of every inbox. The admin list marks it
  "Scheduled · Tuesday, December 1, 2026 at 9:00 AM".
- **Acknowledgment:**
  - it survived a reload ("Acknowledged on Monday, October 5, 2026 at
    9:44 PM");
  - the unread count went from 1 to 0;
  - the report read "Read: 1/1, Acknowledged: 1/1".
- **Who can do what:** `member2` got 403 on list, create and delete, and
  "Access Denied" on the admin screen.
- **Edits:**
  - an emptied expiry was saved as empty (pitfall 1);
  - switching to Everyone cleared the role list;
  - the expiry entered as 5:00 PM Chicago was stored as 23:00 UTC.
- **Validation:** an empty compose says "Title and message body are
  required."; the server refuses an expiry in the past or before the
  scheduled time.
- **Links in a message** become links with `target="_blank"` and
  `rel="noopener noreferrer nofollow"`.
- **Notifications** (read from code): delivery goes through
  `message_delivery_service`. It emails every recipient, and escalates
  urgent messages to SMS only through `SmsAlert` and
  `resolve_sms_recipients` (pitfall 18).
- **Phone:** no sideways overflow on any of the three screens.
- **Browser signals:** no console errors. The only failed requests were the
  deliberate 400s, 403s and 404s.

## Findings

### W55-1 — HIGH — On the top-navigation layout, members could not reach their inbox, nor officers the Department Messages screen — ✅ FIXED

**Did:** signed in as `admin` and as `member`. The review install uses the
top-navigation layout. Searched the bar and the "More" menu for Messages.
**Saw:**

- No link to `/messages`, `/communications/messages` or `/suggestions`
  anywhere in the navigation.
- The dashboard shows a message that needs action, but nothing leads to
  the inbox.
- `SideNavigation` has always listed Messages and Suggestions for every
  member, and a "Forms & Comms" admin group. `TopNavigation` never had any
  of these (checked with `git log -S`).
- So a department on that layout could not open its inbox, its suggestion
  box, Department Messages, Email Templates, Member Emails & Texts,
  Suggestion Boxes or Photo Use Consent from the navigation at all.

**Where:** `components/layout/TopNavigation.tsx`, `navItems`.
**Fix:**

- Messages and Suggestions are now in the member bar.
- The Admin menu has the Forms & Comms screens, with the same permission
  gates as `SideNavigation`.
- Department Messages is named that way so it is not confused with the
  member's own Messages.

**Re-driven:** "Messages" opened the inbox as `member`. On a phone, Admin →
"Department Messages" opened the admin screen as `admin`.

### W55-2 — MED — The compose form hid the server's reason behind "Try again" — ✅ FIXED

**Did:** posted a message expiring 1 Jan 2026, which is in the past.
**Saw:** the server answered 400 "expires_at must be in the future for a
published message". The form showed "Unable to post the message. Try
again." Trying again fails the same way.
**Where:** `MessageComposeForm.tsx`, `handleSubmit`'s `catch`.
**Fix:**

- The form shows the server's message, through `getErrorMessage`. The old
  text is still the fallback when there is no message.
- The two expiry messages are reworded so an officer can act on them:
  - "The expiry time must be in the future";
  - "The expiry time must be later than the scheduled time".

**Re-driven:** the form showed "The expiry time must be in the future".

### W55-3 — LOW — Every row's buttons had the same name, and were 32px on a phone — ✅ FIXED

**Saw:**

- Each message in the admin list had "View acknowledgments", "Edit message"
  and "Delete message", so a screen reader could not say which message a
  button acts on.
- At 390px each button was 32×32.

**Fix:**

- The buttons are named after their message, e.g. "Delete W55 Hose test
  Saturday".
- They are 44px on a phone or touch screen (`touch:min-h-11
touch:min-w-11`).
- A single recipient now reads "1 member", not "1 members".

### W55-4 — LOW — The member search had no label, and the compose checkboxes were 20px rows — ✅ FIXED

**Saw:**

- "Search members…" under Specific members had only a placeholder.
- At 390px the rows for Pin to top, Keep in inbox, Require acknowledgment,
  and each role, status and member checkbox were 20px tall.

**Fix:**

- The search is labelled "Search members".
- The checkbox rows are 44px on a phone or touch screen.

**Re-driven:** the three option rows measured 44px.

## Checklist

| Section                 | Result                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held once reachable; fixed W55-1 (no navigation entry on the top layout).                                       |
| 2. The right people     | Held: targeting, 404 for a non-recipient, 403 on admin endpoints, Access Denied on the screen.                  |
| 3. Wrong input, failure | Required fields and dates enforced. Fixed W55-2 (the reason was hidden). Cleared expiry stays cleared.          |
| 4. Browser signals      | Clean.                                                                                                          |
| 5. Coming back to it    | Held: acknowledgment after a reload; a message's URL refuses a non-recipient with "Message unavailable".        |
| 6. On a phone           | No overflow. Fixed W55-3 and W55-4 (small targets).                                                             |
| 7. Everyone can use it  | Fixed W55-3 (identical button names) and W55-4 (unlabelled search).                                             |
| 8. What happens around  | Email to every recipient; SMS only for urgent, via the allowlist (read from code). Audit events on every write. |

## Completion gate

| Check                    | Result                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                      |
| npm run lint             | clean                                                                                                      |
| flake8 / black           | clean on `messaging_service.py` and `test_messaging_service.py`                                            |
| frontend tests (touched) | `src/modules/communications` and `src/components/layout`: 300 passed. 7 new tests, all failing on old code |
| frontend tests (checks)  | `touchTargetIntegrity`, `routeIntegrity`: passed                                                           |
| backend tests            | `test_messaging_service.py`: 79 passed (two asserted messages reworded)                                    |
