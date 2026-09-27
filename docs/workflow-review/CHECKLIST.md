# Workflow Review — Per-Activity Checklist

Every run works through these for its activity. Not every item applies to every
activity; write "n/a" rather than skipping it, so a reader can tell _checked
and clean_ from _not checked_.

Drive it; do not infer it. "The endpoint looks right" is an app-review finding.
A workflow finding says what was clicked, as whom, and what happened.

---

## 1. The job gets done

- [ ] **The happy path, end to end, as the role in the row.** Start where that
      person would start — the dashboard or the navigation, not a typed URL —
      and finish the task. If they cannot find the way in, that is a finding.
- [ ] **The result is where the next person looks for it.** The member sees the
      record the officer approved; the roster shows the new member; the event
      shows the RSVP. Check from the _other_ role's session, and after a
      reload — not from the success toast.
- [ ] **Success is only reported on success.** Compare every toast and
      "complete" screen with the `events` the driver returned. A green toast
      over a 4xx/5xx, or over a request that never fired, is HIGH.
- [ ] **Undo, edit and cancel work** where the screen offers them, and a
      cancelled or deleted thing stops appearing everywhere it appeared.

## 2. The right people, and only them

- [ ] **The role that should can.** And one step down — a plain `member` —
      cannot: the entry point is hidden _and_ the page or API refuses. Try the
      URL directly and one mutation with `wr.api` as the lower role.
- [ ] **Refusals read as refusals.** "Access Denied" with a way back, not a
      blank page, a spinner that never ends, or a generic error.
- [ ] **A member sees only what is theirs to see** — contact details under the
      visibility settings, their own records and not a colleague's.

## 3. Wrong input, and failure

- [ ] **Required fields** are marked, and leaving one empty says which one.
- [ ] **Invalid values** (a date in the past where it matters, a negative
      quantity, text in a number, a too-long name) are refused with a message
      a person can act on. A 422 must never surface as `[object Object]` or a
      raw array (CLAUDE.md pitfall 5).
- [ ] **Clearing a field saves the clear** (pitfall 1): edit a record, empty an
      optional field, save, reload. The old value coming back is a finding.
- [ ] **Double submit** — press the primary button twice quickly. Two records
      is a finding.
- [ ] **A server error** is shown, not swallowed: where a failure can be
      provoked safely (a duplicate name, a value the server rejects), do it.

## 4. What the browser reported

- [ ] **No page errors, no console errors.** Every one gets a finding or a
      stated reason it is harmless.
- [ ] **Every 4xx/5xx in `events` is accounted for.** A 403 fired for a module
      the user cannot use, or a request fired on every render, is a finding
      even when the page looks fine.
- [ ] **Nothing reads as broken:** no "undefined", "NaN", "Invalid Date",
      `[object Object]`, raw ISO timestamps, or UTC shown as local time.

## 5. Coming back to it

- [ ] **Reload** on each screen of the activity keeps the user where they were.
- [ ] **Back** returns to the previous screen, not out of the activity.
- [ ] **A deep link** to the record (copied from the address bar) opens it for
      someone else with access, and refuses someone without.
- [ ] **A half-filled form** is not discarded by a stray click outside a dialog
      (pitfall 31).

## 6. On a phone

Repeat the core step at `{ width: 390, height: 844 }` (`wr.as(role, viewport)`).

- [ ] Nothing overflows sideways; tables reflow or scroll inside themselves.
- [ ] A dialog's title and its buttons are both reachable (pitfall 21).
- [ ] Nothing important sits under the bottom navigation bar.
- [ ] Controls are big enough to tap (44px), and the keyboard does not cover
      the field being typed into.

## 7. Everyone can use it

- [ ] Every field has a label a screen reader announces — `getByLabel` finds it.
- [ ] Buttons that are only an icon have an accessible name.
- [ ] Keyboard alone completes the core step: Tab order is sensible, Escape
      closes dialogs, focus lands somewhere useful after an action.

## 8. What happens around it

- [ ] **Notifications** go where CLAUDE.md pitfall 18 says: email first; SMS
      only for alerts on the allowlist. With email off in the review install,
      nothing should claim an email was sent.
- [ ] **The audit log** records a security-sensitive action (permissions,
      member status, money), with the right actor.
- [ ] **Dates and times** show in the department's timezone
      (`America/Chicago` in the review install), and a date entered comes back
      as the same date.

---

## Recording what was driven

The findings file says what was actually done: which roles, which screens, what
input, at what viewport. Keep the steps short enough that someone could repeat
them. Screenshots stay in `.workflow-review/shots/` (they hold seeded data and
are not committed); describe what they show instead.
