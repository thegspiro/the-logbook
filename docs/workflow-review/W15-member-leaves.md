# Workflow Review — W15 A Member Leaves: Departure Clearance, Property Return, Archive, Reinstate

**Driven:** 2026-09-28 · **As:** `admin`, with `member` reading the directory and `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `be7851f` plus this run's fix (re-driven) · **Database:** continued from W14; no reset

---

## What was driven

The review install had no inventory. As setup, one item ("W15 Turnout Coat") was created and assigned to Ian Two through the API. Inventory itself is reviewed in its own activities.

1. As `admin`, on Ian Two's profile: Change status → Dropped (voluntary), with a reason.
2. Read what the drop produced:
   - the status;
   - the departure clearance;
   - the property return report;
   - the Inventory Administration hub, before and after the fix.
3. Followed the hub's "Review" link to Members Equipment. Returned the coat with **Return**, then read the clearance and Ian's status.
4. With no screen to work a clearance (W15-2), resolved the line and completed the clearance through the API. Ian was then archived automatically.
5. As `member`, read the directory.
6. As `admin`, from the directory's **Archived** filter:
   - **Reactivate** with today's date, which was refused (W15-3);
   - then, after moving the service end back a day in Service History, again, which succeeded.
7. As `member2`: the profile, and the status, archive, reactivate, clearance and property-report APIs.
8. The directory and the status dialog at 390×844.

## Held up ✅

- **The drop:**
  - The dialog warns that it "will generate a property return report and may send an email notification".
  - The status and reason were stored.
  - A departure clearance opened for the one coat, with a 14-day return deadline.
  - The property return report is served.
- **Auto-archive fires once the clearance is completed.** The status becomes `archived`, as designed in `check_and_auto_archive`.
- **Reactivate is clear:**
  - It says what is kept and that the membership number is restored.
  - It offers "Continue prior service" or "Restart at zero", with the department default marked.
  - After it, the profile shows two stints: "1/20/2023 – 9/27/2026 · Dropped (voluntary)" and "9/28/2026 – present". The membership number `IMP-002` came back.
- **`member2` is refused** all five APIs (`403`) and is offered no status control on the profile.
- **At 390px:** no sideways scroll, and the status dialog fits.

## Findings

### W15-1 — MED — Inventory Administration hid a freshly dropped member's clearance — ✅ FIXED

**Did:** dropped Ian Two while he held a coat, then opened Inventory Administration.
**Saw:** "Needs attention — Nothing needs attention. All inventory work is up to date."

- The hub asked for clearances with status `in_progress` only.
- A clearance opens as `initiated` and becomes `in_progress` only once a line is resolved.
- So every member dropped with property outstanding was missing from the list meant to chase it.
- A row that did appear named the member by raw id: `Member fa936425-… · 1 outstanding`.

**Where:** `InventoryAdminHub.tsx`, the attention-row loader.
**Fix:**

- The hub loads every clearance and keeps the open ones (`initiated`, `in_progress`).
- It labels each by `member_name`, which the API already returns.

**Re-driven:** "Unresolved departure clearance · Ian Two · 1 outstanding · Due 10/12/2026 · Review".
**Test:** `InventoryAdminHub.test.tsx`. It failed before the fix.

### W15-2 — MED — A departure clearance cannot be worked or completed from any screen — FLAGGED

**Did:** followed the hub's Review link to Members Equipment and returned the coat with **Return**.
**Saw:**

- "Returned 1 item successfully", but the clearance stayed `initiated` with 1 item outstanding.
- Ian stayed `dropped_voluntary`.

**Why (read from code):**

- An ordinary return unassigns the item and runs the auto-archive check.
- That check stops while any clearance is open.
- Only `POST /inventory/clearances/{id}/items/{line}/resolve` and `…/complete` close one, and no screen calls either.
- The service deliberately leaves a fully resolved clearance open "so staff can review".

So a member dropped with property is never archived through the UI, and the hub's row can never be cleared.
**Why flagged:** there are two routes, and choosing between them is a product decision:

- **A clearance screen:** resolve each line, then complete.
- **Resolving a clearance line automatically when its item is returned the ordinary way:** this changes the service's "staff review" design.

Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W15-3 — LOW — A member dropped today cannot be reinstated until tomorrow — FLAGGED

**Did:** Reactivate, with the dialog's default return date of today.
**Saw:** "The return date must be after the member's last day of previous service (2026-09-28)."

`record_rejoin` refuses a return date in the future, and one on or before the last day of service. On the day of the drop, no date satisfies both. A drop made by mistake cannot be undone that day except by editing Service History first, which worked here.
**Why flagged:** whether a same-day return should be allowed, which means a one-day overlap or a zero-length gap, is a rule about how service is counted. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W15-4 — LOW — Departed members are listed in every member's directory — FLAGGED

**Did:** as `member`, opened Members while Ian was archived.
**Saw:** "Ian Two · IMP-002 · ARCHIVED" in the list. The directory's default filter is "All Status", and `GET /users` returns archived members to a member.
**Why flagged:** whether members should see former members, and what of them, is a privacy and policy decision. Mirrored to `docs/KNOWN_LIMITATIONS.md`.
**Owner decision (2026-10-05) — fixed:** hide archived members from non-managers and open their directory on Active. `GET /users/directory` (the non-manager directory, USR-8) leaves archived members out, and the Members page defaults a non-manager's filter to Active; coordinators keep the whole roster.

Seen and left:

- **A dropped member's profile heading reads "Active member".** That is the membership tier, shown directly above the status "dropped voluntary".
- **There is no manual Archive button.** Archiving happens when the clearance completes; the API exists for scripts.

## Leads for later activities

- **Inventory activities:**
  - The hub's "Needs attention" tile comes from the backend summary, which counts only PPE replacement and below-par stock. It read 0 over a list of 1.
  - "Issued to members" counts pool issuances only, so a permanently assigned coat read "0, held by 0 members".

## Checklist

| Section                 | Result                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | Partly: drop → clearance → archive → reinstate works, but the clearance needs the API (W15-2)       |
| 2. The right people     | ✅ `member2` refused on five APIs; W15-4 flagged                                                    |
| 3. Wrong input, failure | Reinstate on the drop day refused (W15-3); the reason is shown in the dialog                        |
| 4. Browser signals      | ✅ only the provoked `400`                                                                          |
| 5. Coming back to it    | ✅ status, stints and membership number read back after reload                                      |
| 6. On a phone           | ✅ no overflow; the dialogs fit                                                                     |
| 7. Everyone can use it  | ✅ reactivate dialog fully labelled                                                                 |
| 8. What happens around  | ✅ after W15-1 the hub shows the clearance; Ian reinstated, and the coat is returned and unassigned |

## Completion gate

| Check                    | Result                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                         |
| npm run lint             | ✅ clean                                                                         |
| flake8 (changed files)   | n/a — no Python changed                                                          |
| black --check            | n/a                                                                              |
| frontend tests (touched) | ✅ full suite: 607 files, 8,256 tests. The W15-1 case failed against the old hub |
| backend tests (touched)  | n/a                                                                              |
