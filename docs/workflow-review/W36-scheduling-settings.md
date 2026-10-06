# Workflow Review — W36 Every Scheduling Settings Section

**Driven:** 2026-09-29 · **As:** `scheduling_officer`, with `member` refused · **Viewports:** 1280×900
**Commit:** `3383b4700` plus this run's changes · **Database:** continued from W35

---

## What was driven

1. As `scheduling_officer`, every section under `/scheduling/admin/settings/`:
   General, Apparatus, Platoons, Eligibility, Notifications, Shift Reports and Outside Apparatus.
   Each section's visible controls were checked for accessible names and state.
2. Saved and reloaded:
   - **General:** Overtime advisory hours limit 0 → 56 (Save double-clicked); the Restrict check-in to assigned members switch. Both were put back afterwards.
   - **Outside Apparatus:** Add a department "Township Fire Company", double-clicked.
3. Read Notifications against what W33 observed being sent.
4. As `member`: the settings page and `PUT /scheduling/eligibility/settings`.

## Held up ✅

- **Saving:**
  - The hours limit (56) and the check-in switch both saved ("Settings saved") and survived a reload.
  - A double-clicked Save saved once, and a double-clicked Add department made **one** department.
- **Only the right controls on each section:** the Save/Reset footer shows only on General and Apparatus, the two sections it writes (`LOCALLY_SAVED_SECTIONS`). The others have their own save controls.
- **Names:** almost every control was already named, including the ~14 switches on General and the Notifications switches.
- **Honest labels elsewhere:**
  - Outside Apparatus says members can't log shifts with other departments until one is added.
  - Enforce EVOC for drivers shows on, matching the backend default.
- **Refusals:** `member` got Access Denied on the page and 403 on the eligibility write.

## Findings

### W36-1 — MED — The six Scheduling Notifications switches are read by nothing — ✅ REMOVED

**Did:** `scheduling_officer`, Notifications. All six preset switches read off:
New Assignment, Assignment Confirmed, Assignment Declined, Time-Off Approved,
Swap Request and Understaffed Shift.
**Saw:** in W33, with "Time-Off Approved" and "Swap Request" both off, the
member received "Time-Off Approved" and "Swap Request Approved". The switches
look like they control those notices, and they don't:

- Each switch stores a `schedule_change` notification rule.
- `schedule_change` is not in `ENFORCED_TRIGGERS` (`backend/app/models/notification.py:60`).
- Nothing in the scheduling senders consults it.

This is CLAUDE.md pitfall 19 exactly: a switch wired to nothing, which lets an
officer believe a notice is off when it is not.
**Where:** `frontend/src/modules/scheduling/components/SchedulingNotificationsPanel.tsx:320`, `:374`.
**Fixed here:** the pitfall's own remedy, "mark it in the UI as not yet in
effect":

- Unless the backend reports a `schedule_change` rule as enforced, the panel says "Not in effect yet — these switches are saved, but scheduling does not read them. Each of these notices is sent, or not, whatever the switch shows."
- Each switch is described by that notice.
- The notice goes away by itself once a stored rule reports `enforced`.

Covered by two cases in `SchedulingNotificationsPanel.test.tsx`; the first
fails against the old panel.
**Flagged because:** whether to wire a reader (each sender consulting its rule,
with absence meaning today's behaviour) or remove the switches is the owner's
call. Mirrored into `docs/KNOWN_LIMITATIONS.md`.
**Resolved 2026-10-05 (owner decision):** the six switches were removed. The
panel now holds only the decline, assignment, reminder and equipment-alert
settings, each read by its sender. `schedule_change` rules already stored stay
in the database, inert, and the notification rules screen still labels them
not in effect.

### W36-2 — LOW — Eligibility's membership-type and open-position chips showed their state by colour only — ✅ FIXED

**Did:** `scheduling_officer`, Eligibility.
**Saw:**

- "Excluded from Self-Signup" (Prospective, Probationary, Active …) and "Open Positions" (Officer, Driver/Operator …) are toggle buttons.
- Which ones are chosen showed only as red or green tint.
- The buttons carried no `type`, so each defaulted to a submit button.

**Where:** `frontend/src/modules/scheduling/components/EligibilitySettingsCard.tsx:115`, `:145`.
**Fix:**

- Each chip carries `aria-pressed` and `type="button"`.
- Each group is named by its heading.

Covered by the new `EligibilitySettingsCard.test.tsx` (fails against the old
card).

### W36-3 — LOW — The custom position field had no name — ✅ FIXED

**Did:** `scheduling_officer`, General → Add Custom Position.
**Saw:** the one unnamed control on any settings section: the text box beside
Add Position, named only by its placeholder "Display name (e.g., Tillerman)".
**Where:** `frontend/src/modules/scheduling/components/PositionNamesCard.tsx:149`.
**Fix:** named "Custom position name". Covered by the new
`PositionNamesCard.test.tsx` (fails against the old card).

### W36-4 — NIT — `/settings/platoons` shows General under a "Platoons" breadcrumb while platoons are off — OPEN

With platoon scheduling off, Platoons is not offered as a section, which is
deliberate: the General toggle reveals it. A link straight to
`/scheduling/admin/settings/platoons` renders General, marked current in the
section nav, under a breadcrumb that still says "Platoons", with nothing
saying why. W35's platoons page links to Scheduling Settings the same way.
Left: a one-line explanation would do, but the fallback is deliberate, so this
is a copy choice for the owner.

## Checklist

| Section                 | Result                                                        |
| ----------------------- | ------------------------------------------------------------- |
| 1. The job gets done    | ✅ settings save and persist; ⚠ W36-1 six switches do nothing |
| 2. The right people     | ✅ member Access Denied and 403                               |
| 3. Wrong input, failure | ✅ double save and double add acted once                      |
| 4. Browser signals      | ✅ clean `events`                                             |
| 5. Coming back to it    | ✅ saved values survive reload                                |
| 6. On a phone           | not driven (desktop configuration)                            |
| 7. Everyone can use it  | Fixed W36-2, W36-3                                            |
| 8. What happens around  | Labelled and flagged W36-1                                    |

## Completion gate

| Check                    | Result                                                          |
| ------------------------ | --------------------------------------------------------------- |
| npm run typecheck        | clean                                                           |
| npm run lint             | clean on the changed files                                      |
| flake8 (changed files)   | no Python changed                                               |
| black --check            | no Python changed                                               |
| frontend tests (touched) | `pages/scheduling`, `modules/scheduling` — 58 files, 788 passed |
| backend tests (touched)  | none touched                                                    |
