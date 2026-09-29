# Workflow Review — W12 Member Settings

**Driven:** 2026-09-28 · **As:** `admin`, with `member` reading, `membership_coordinator` and `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `52a3024` plus this run's fixes (re-driven) · **Database:** continued from W11; no reset

---

## What was driven

Members Administration → Settings, section by section:

1. **Contact Visibility**
   - Turned the ceiling on, set email and phone, and reloaded.
   - As `member`, read the directory.
   - Put everything back off.
2. **Membership IDs**
   - Enabled IDs with auto-generate, prefix `RV-` and next number 150, then reloaded.
   - Compared the section's "Next" with Add Member's preview.
   - Put it back to off, no prefix, next 1.
3. **Operational Ranks**
   - Added "Senior Firefighter", then added it again.
   - Renamed it, moved it up, and made it eligible for the Firefighter seat. Reloaded.
   - Tried to delete Firefighter, which 10 members hold.
   - Deleted the new rank.
4. **Membership Tiers**
   - Tried a new tier whose name collides with an existing id ("Senior").
   - Changed a threshold and saved. Saved an out-of-order ladder, which the server refused.
   - Tried to remove a tier members hold.
   - Put Life Member back to its seeded 20 years.
5. **EVOC Levels**
   - Added a duplicate level 1, then a level 5.
   - Deactivated level 5, reloaded, and deleted it.
6. Refusals:
   - As `member2`, the page and both write APIs.
   - As `membership_coordinator` (`members.manage` only), every section and the contact-visibility and tiers APIs.
7. Every section at 390×844.

## Held up ✅

- **Contact Visibility saves per switch, and the header pill says "All changes saved".**
  - The choices survived a reload.
  - With email on, `member` saw colleagues' addresses in the directory.
  - With the ceiling off, `member` saw none.
- **Membership IDs** saved and survived a reload. Add Member previewed the ID the server will issue (`RV-0150`).
- **Ranks:**
  - The code is derived from the display name.
  - A duplicate is refused with "Rank code 'senior_firefighter' already exists", and the form stays open.
  - Rename, reorder and the seat toggle all persisted.
  - Deleting a rank members hold is refused: "Cannot delete rank 'Firefighter' while it is assigned to 10 members. Reassign those members first."
- **Tiers:**
  - A colliding id is refused in the page before anything is sent.
  - A tier that members hold cannot be removed, and its member count shows beside the button.
  - The server refuses a ladder whose years would demote long-serving members, and explains why.
- **EVOC:**
  - A duplicate level is refused with the reason.
  - Deactivate persisted as "Inactive".
  - Delete asks first and explains what is lost.
- **Access:**
  - `member2` gets Access Denied, and `403` on both write APIs.
  - `membership_coordinator` is sent from Contact Visibility to Ranks, the one section its grant opens, and is offered no reorder arrows. Contact visibility returns `403` to it.
  - Tiers accepts `members.manage` by design.
- **No sideways scroll** at 390px on any section.

## Findings

### W12-1 — LOW — The Membership IDs screen showed a different next ID from the one the server issues — ✅ FIXED

**Did:** set prefix `RV-` and next number 150.
**Saw:**

- The section header read "Next: RV-150".
- Add Member previewed `RV-0150`, and the server issues that one: `generate_next_membership_id` zero-pads to four digits, as does the preview endpoint.
- The help text promised `"FD-" produces FD-001`.

**Where:** `MembershipIdSection.tsx`.
**Fix:** the header and help text use the server's format ("Next: RV-0150", "FD-0001"), with a comment naming the backend they mirror.
**Test:** `MembersSettingsPage.test.tsx`.

### W12-2 — LOW — One tap on a rank's trash icon deleted it permanently — ✅ FIXED

**Did:** deleted the new rank.
**Saw:** no confirmation; the row was gone. The delete removes the row outright, not a deactivation. The server refuses a rank anyone holds, so what was at risk is an unheld rung and its seat list. EVOC levels, a sibling section, already ask first.
**Where:** `RanksSettingsSection.tsx`.
**Fix:** the delete asks through `useConfirm`: "Delete the Temp Rank rank? Its place in the ladder and its eligible positions go with it, and this cannot be undone." The buttons are "Keep it" and "Delete".

Three test files that render the ladder bare now wrap it in `ConfirmProvider`, as the app shell does:

- `RanksSettingsSection.test.tsx`
- `RanksSection.test.tsx`
- the onboarding `RankLadderSection.test.tsx`

**Re-driven:** "Keep it" left the rank; "Delete" removed it.
**Test:** `RanksSettingsSection.test.tsx`.

### W12-3 — LOW — The rank form was unlabelled, and seat eligibility was shown by colour alone — ✅ FIXED

**Saw:**

- The Add/Edit Rank form's Display Name and Code fields had no programmatic label.
- The seat picker marked the chosen seats only by fill colour.

**Fix:**

- Both fields are labelled.
- Each seat button carries `aria-pressed`.

**Re-driven:** both fields are found by name, and Firefighter reads pressed on a rank that holds it.
**Test:** `RanksSettingsSection.test.tsx`.

### W12-4 — NIT — Tap targets at 390px — ✅ FIXED

- **Ranks:**
  - Move arrows were 18px. They now sit side by side on a phone, as the tiers list already does, rather than stacking to 88px.
  - Edit and delete were 26px.
  - Seat chips were 26px.
  - "Done" and "Edit" were 18px and 22px.
- **EVOC:** Deactivate, edit and delete were 26–28px.

All are now 44px on phones. Re-driven: nothing under 44px on any section.

Seen and left:

- **A cleared number field snaps back.** Emptying Next ID Number shows `1`, and a tier's years shows `0`, so clear-then-type appends to the snapped value. Selecting and typing over it works.
- **Contact Visibility's sub-switches keep their values while the ceiling is off.** They come back as they were when it is turned on again. W10 had left email and phone on under an off ceiling, so the first click here turned them off. That is consistent, and the switches show their state once visible.
- **The section says it controls "the member list page".** It also governs profiles and the directory search (W10).
- **The rank arrows are named "Move up" / "Move down"** without the rank. The tier arrows name theirs.

## Checklist

| Section                 | Result                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ every section saves and survives a reload                                        |
| 2. The right people     | ✅ `member2` refused; the coordinator sees only what its grant opens                |
| 3. Wrong input, failure | ✅ duplicates and a demoting ladder refused with reasons; W12-2                     |
| 4. Browser signals      | ✅ only the provoked `400`s                                                         |
| 5. Coming back to it    | ✅ every change read back after a reload and through the API                        |
| 6. On a phone           | ✅ after W12-4                                                                      |
| 7. Everyone can use it  | ✅ after W12-3                                                                      |
| 8. What happens around  | ✅ W12-1: the ID shown here is now the ID issued; settings restored after the drive |

## Completion gate

| Check                    | Result                                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                                                                           |
| npm run lint             | ✅ clean                                                                                                                                                                           |
| flake8 (changed files)   | n/a — no Python changed                                                                                                                                                            |
| black --check            | n/a                                                                                                                                                                                |
| frontend tests (touched) | ✅ full suite: 604 files, 8,221 tests. W12-1's case was run against the old code and failed; the rank cases assert a dialog, labels and `aria-pressed` the old code did not render |
| backend tests (touched)  | n/a                                                                                                                                                                                |
