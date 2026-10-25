# Workflow Review — W56 Notification Rules and Logs, the In-App Bell

**Driven:** 2026-10-12 · **As:** `admin`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `e7bdbf3` plus this run's changes · **Database:** continued from W55

---

## What was driven

1. As `admin`, from the bell: `/notifications` on an install with no rules.
   - "Add Rule" with no name;
   - "W56 Event reminders" on the Event Reminder trigger, with "Create Rule"
     double-clicked;
   - the rule switched off, then a reload;
   - the Email Templates and Send Log tabs.
2. As `member`:
   - the tabs offered, and `?tab=rules` typed into the address bar;
   - with `wr.api`, list, create, toggle, edit and delete on the rules, and
     the summary;
   - the inbox: the W55 message stack opened, one notification pinned, and
     "Read Message" on the notification for the message W55 deleted;
   - the bell after reading;
   - Tab through the open stack;
   - the inbox and Send Log at 390×844.
3. After the fixes:
   - the Tab order again;
   - the rule switch;
   - the Trigger Event label and the empty-name error;
   - the Send Log filter.

## Held up ✅

- **Double-click:** "Create Rule" made one rule. Its effect text names the
  trigger and says every rule for it must be off to stop it.
- **The switch:** turning the rule off survived a reload ("Disabled"), and
  the summary read 1 rule, 0 active.
- **Who can do what:**
  - `member` saw only My Notifications and Send Log;
  - `?tab=rules` fell back to the inbox;
  - every rules call and the summary got 403.
- **The inbox:**
  - pinning survived a reload;
  - opening the notification marked it read;
  - the bell went from "Notifications (1 unread)" to "Notifications".
- **A deleted message:** its notification still opens, and lands on "Message
  unavailable — It may have expired or been removed".
- **Send Log:** scoped to the caller. The admin's was empty; the member's
  listed both W55 messages, with times in Chicago time.
- **Phone:** no sideways overflow on the inbox or Send Log.
- **Browser signals:** no console errors. The only failed requests were the
  deliberate 403s and the deleted message's 404.

## Findings

### W56-1 — MED — Tab landed on the hidden buttons of a closed notification — ✅ FIXED

**Did:** opened the department-message stack as `member` and pressed Tab
from the first notification's header.
**Saw:**

- Focus went to "Read Message", then "Pin", inside a card that was still
  closed. Its body measured 0px tall, so the focus ring was invisible.
- Playwright could not click those buttons either: other cards cover them.
- A closed card is squeezed to height 0, not removed, so its actions stay in
  the tab order and the accessibility tree.

**Where:** `components/NotificationCard.tsx`, the expandable region.
**Fix:** the region is `inert` while the card is closed.
**Re-driven:** Tab now goes from one card header to the next.

### W56-2 — LOW — The rule switch had no name, and the create dialog's trigger and error were not wired up — ✅ FIXED

**Saw:**

- The on/off control on each rule was an icon-only button with no name or
  state.
- "Trigger Event" was a label linked to nothing, so `getByLabel` found no
  field.
- "Enter a rule name." appeared in the dialog but was not announced.

**Fix:**

- The control is a `switch`, named after its rule and state ("W56 Event
  reminders: notifications on"), with `aria-checked`, and 44px on touch
  screens.
- The label is tied to its select.
- The error is `role="alert"`.

### W56-3 — LOW — The Send Log channel filter showed the selection by colour alone — ✅ FIXED

**Saw:** All / Email / In-App carried no pressed state, and were about 28px
tall on a phone.
**Fix:** the buttons carry `aria-pressed` and are 44px on touch screens.

### W56-4 — MED — A rule cannot be renamed or deleted from the screen — ✅ FIXED 2026-10-25

Edit and Delete added to each rule; deleting warns when it turns the trigger back
on (no rule left) or off (the last enabled one among disabled ones). Original
finding below.

**Saw:**

- The rules tab offers create and on/off only.
- The API already has `PATCH /notifications/rules/{id}` and
  `DELETE /notifications/rules/{id}` (`member` got 403 on both, so they are
  gated).
- So a rule made with a typo, or on the wrong trigger, stays on the list
  forever.

**Why flagged:** deleting a rule is not neutral here. With no rule for a
trigger, its notifications go out by default (pitfall 19). So deleting the
one switched-off rule quietly turns the reminders back on. The screen would
need to say so, or offer only edit. In `KNOWN_LIMITATIONS.md`.

## Checklist

| Section                 | Result                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Held for create, on/off, read, pin. Editing and deleting a rule is flagged (W56-4).          |
| 2. The right people     | Held: member sees inbox and own log only; every rules call 403.                              |
| 3. Wrong input, failure | Held: a name is required (now announced, W56-2). Double-click made one rule.                 |
| 4. Browser signals      | Clean.                                                                                       |
| 5. Coming back to it    | Held: rule state, pin and read survive a reload; `?tab=` is honoured only where allowed.     |
| 6. On a phone           | No overflow. Fixed the 28px filter buttons (W56-3).                                          |
| 7. Everyone can use it  | Fixed W56-1, W56-2, W56-3.                                                                   |
| 8. What happens around  | The bell follows the inbox. A deleted message's notification lands on a clear "unavailable". |

## Completion gate

| Check                    | Result                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                     |
| npm run lint             | clean                                                                                                     |
| flake8 / black           | n/a: no Python changed                                                                                    |
| frontend tests (touched) | `NotificationCard`, `NotificationStack`, `NotificationsPage*`: 72 passed (4 new, all failing on old code) |
| backend tests            | n/a: no backend change                                                                                    |
