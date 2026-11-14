# Workflow Review — W05 Positions and Permissions

**Driven:** 2026-09-28 · **As:** `admin` → `member`, plus `membership_coordinator` and `chief` · **Viewports:** 1280×900, 390×844
**Commit:** `7e35219` plus this run's fixes (each re-driven) · **Database:** continued from W04; no reset

---

## What was driven

1. As `member`, before any change: `/settings/roles` and `/reports` in the browser, then `GET /roles` and `POST /roles` through the API.
2. As `admin`, from the navigation (More → Role Management): created a position with an empty name, then "Report Reader" granting `reports.view`. Then a second position with the same name, and a double-click on Create Role.
3. Deleted the two throwaway positions through the page, answering its confirmation dialog.
4. From Members Administration (Manage Roles), assigned "Report Reader" to `member`.
5. As `member`, still signed in: the navigation, `/reports`, and `GET /roles/my/permissions`.
6. As `admin`, unchecked `reports.view` on the position and saved. As `member`, opened `/reports` again.
7. As `admin`, deleted the position while `member` still held it, then read the member's row and the audit log.
8. As `membership_coordinator`: assigned Chief to `member` through the API and through Manage Roles, then assigned Firefighter and put it back.
9. As `chief`, which holds no `*`: tried to empty the IT Manager position (which holds `*`), and to add `*` to Member.
10. Both pages and both dialogs at 390×844.

Not driven: cloning a position (`POST /roles/{id}/clone`) and the "View by Role → Manage Members" save. Both were read from code only.

## Held up ✅

- **The grant reaches the member without a new sign-in.** After the assignment, `member` saw Reports in the menu and the page opened. `/roles/my/permissions` included `reports.view`.
- **Revoking works both ways.** Unchecking the permission on the position gave `member` "Access Denied" on `/reports`. Deleting the position also removed it from `member`'s row.
- **A member is refused everywhere:**
  - Both pages show "Access Denied" with a way back to the dashboard.
  - `GET /roles` and `POST /roles` (even asking for `*`) return `403`.
- **The grant ceiling holds:**
  - The coordinator can assign Firefighter but not Chief: `403` "You cannot assign a role that grants permissions beyond your own."
  - `chief` cannot empty the IT Manager position or add `*` to Member, and each refusal names the permission at fault.
- **Double submit** created one position.
- **Deletion** asks first, names the position, and says members will lose its permissions.
- **Every change is audited** with `review_admin` as the actor: `role_created`, `role_updated`, `role_deleted` and `user_role_assigned`.
- **At 390px:** no sideways scroll, and the position dialog's title and buttons are both on screen (title at 59px, buttons end at 801px of 844).

## Findings

### W05-1 — MED — A refused position save showed its error behind the dialog, in schema language — ✅ FIXED

**Did:** as `admin`, Create Role with no name.
**Saw:** `422`, and nothing changed in the dialog. The message "name: Value is too short. (Error code: LB-VAL-001)" was rendered on the page behind the overlay, half covered by the panel. The same happens for any refused save, including the grant-ceiling `403`.
**Where:** `RoleManagementPage.tsx` rendered its one `error` block above the list, outside the dialog.
**Fix:**

- While the dialog is open, the error shows inside it (`role="alert"`), and the page copy is suppressed.
- An empty name is caught before sending ("Give the role a name.").
- Opening the dialog clears a stale error.

Tests: `RoleManagementPage.test.tsx`. Re-driven: the message appears inside the dialog.

### W05-2 — MED — Manage Roles said "You do not have permission to assign roles" to someone who can, behind the dialog — ✅ FIXED

**Did:** as `membership_coordinator`, ticked Chief for `member` in Manage Roles and saved.
**Saw:** `403`, and the dialog stayed as it was. Behind it, the page said "You do not have permission to assign roles. Contact an administrator." That's untrue: the coordinator had just assigned Firefighter. The server's actual reason, that Chief carries more than the coordinator holds, was thrown away.
**Where:** `MembersAdminPage.tsx`, in `handleSaveRoles`, `handleSaveMembers` and both position dialogs. The page's other dialogs already showed their errors inside.
**Fix:**

- A `403` shows the server's reason when there is one.
- Both position dialogs render the error inside themselves, and the page copy is suppressed while either is open.

Test: `MembersAdminPage.test.tsx` (new). Re-driven: the server's reason appears inside the dialog.

### W05-3 — LOW — The position dialog's fields had no visible box — ✅ FIXED

**Saw:** Role Name, Description and Priority drawn with no border, easy to miss as fields. The hand-typed class strings set a border colour but no border width (CLAUDE.md pitfall 17).
**Fix:** `form-input`. Re-driven: 1px border, 42px tall.

### W05-4 — LOW — "Higher priority roles have more authority" was untrue — ✅ FIXED

**Where:** read from code, priority only orders position lists and picks a member's main position (`label_service`, `inventory_service`, `messaging_service`). No permission check reads it. An administrator could reasonably rely on a high priority to outrank someone, and it doesn't.
**Fix:** the hint now says what priority does, and that it grants no permissions. Test: `RoleManagementPage.test.tsx`.

### W05-5 — LOW — Two positions can share a name — FLAGGED

**Saw:** a second "Report Reader" was accepted (slug `report_reader_2`). Both then appear identically in Role Management and Manage Roles.
**Why not fixed:** refusing duplicates changes behaviour an installation may rely on, and may want a migration. Mirrored to `docs/KNOWN_LIMITATIONS.md`.
**Owner decision (2026-10-05) — fixed:** refuse duplicates on create and rename; existing duplicates are left and flagged. A new, cloned or renamed position whose name (trimmed, case-insensitive) another position in the organization uses is refused with `409`. Pairs that already exist still save, and Role Management marks each with "Same name as another position" and its internal name, so one can be renamed apart. No migration.

### W05-6 — LOW — Permission chips showed only the last word — ✅ FIXED

**Saw:** Chief's summary read "view view_contact view view view +93 more". Every chip said "view", with no way to tell which module it belonged to.
**Fix:** each chip shows the full name (`members.view`). Test: `RoleManagementPage.test.tsx`.

### W05-7 — NIT — Touch targets under 44px at 390px — ✅ FIXED

These were 16–38px tall and are now 44px on phones (`touch-target-phone`):

- Edit and Delete in Role Management.
- The row actions and the "×" on each position chip in Members Administration.
- Manage Members and its "×" in the View by Role layout.

## Checklist

| Section                 | Result                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ create → grant → assign → the member's access → revoke → delete           |
| 2. The right people     | ✅ member refused on page and API; grant and edit ceilings hold              |
| 3. Wrong input, failure | ✅ after W05-1 and W05-2; double submit held; W05-5 flagged                  |
| 4. Browser signals      | ✅ only the provoked `422`/`403`s                                            |
| 5. Coming back to it    | ✅ changes survive a reload and show in the other role's session             |
| 6. On a phone           | ✅ no overflow; dialog ends reachable; W05-7                                 |
| 7. Everyone can use it  | ✅ checkboxes labelled; errors announced (`role="alert"`) after W05-1, W05-2 |
| 8. What happens around  | ✅ every position change and assignment audited with the actor               |

## Completion gate

| Check                    | Result                                                                    |
| ------------------------ | ------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                  |
| npm run lint             | ✅ clean                                                                  |
| flake8 (changed files)   | n/a — no Python changed                                                   |
| black --check            | n/a                                                                       |
| frontend tests (touched) | ✅ full suite: 603 files, 8190 tests; each new case failed before its fix |
| backend tests (touched)  | n/a                                                                       |

---

## Second pass — positions after the November security work (2026-11-08)

**Driven:** 2026-11-08 · **As:** `member`, `admin`, `membership_coordinator` · **Viewports:** 1280×900, 390×844
**Commit:** `bd49041` plus this pass's fixes (each re-driven) · **Database:** continued from the W04 second pass; no reset

The owner asked to continue with W05. Since the first pass:

- duplicate position names are refused (W05-5, owner decision 2026-10-05);
- a position has a kind: office, committee, or the platform's own (2026-10-29);
- creating, changing or deleting a position, and changing a member's positions, needs a fresh "confirm it's you" step-up (PERM-10, PERM-11, 2026-11-03).

### What was driven

1. As `member`: `/settings/roles` and `/reports`, then `GET /roles` and `POST /roles` asking for `*`.
2. As `admin`: created "Report Reader" (Office, `reports.view`), met the step-up, entered a wrong password, then the right one.
3. From Members Administration → Manage Positions, assigned it to `member`.
4. As `member`, still signed in: `/reports` and `/roles/my/permissions`.
5. As `admin`: unticked `reports.view` on the position. As `member`: `/reports` again.
6. As `admin`: deleted the position while `member` held it, then read the audit log.
7. As `membership_coordinator`: assigned IT Manager (which holds `*`) to `member2` through the API, before and after a step-up.
8. Role Management, its dialog and Manage Positions at 390×844.

### Held up ✅

- **A member is refused:** both pages show "Access Denied", and `GET` and `POST /roles` return `403`.
- **The step-up:**
  - the first change of the session opens "Confirm it's you" over the dialog;
  - a wrong password gets "Verification failed" and the prompt stays open;
  - the right one completes the create without pressing Create again;
  - later changes within the window don't ask again.
- **The grant reaches the member without a new sign-in,** and unticking the permission takes it away again ("Access Denied" on `/reports`).
- **Deleting** asks first, naming the position and how many members hold it ("1 member holds it and will lose its permissions"), with Keep it / Delete. It returns `204`.
- **The grant ceiling:** past the step-up, the coordinator assigning IT Manager gets `403` "You cannot assign a role that grants permissions beyond your own".
- **Audit:** `role_created`, `user_role_assigned`, `role_updated` and `role_deleted` each carry the actor, IP and department. So do `stepup_failed` and `stepup_verified`.
- **Manage Positions** names each row's button ("Manage positions for Jordan Avery") and says that a rank is set from the profile, not there.
- **Phone:** no sideways scroll. Both dialogs fill the screen with nothing under 44px, and their checkbox labels are 44px or taller.

### W05-10 — LOW — Every position card's buttons were named only "Edit" and "Delete" — ✅ FIXED

**Did:** read the buttons on Role Management.
**Saw:** thirty buttons named "Edit", plus a "Delete" on each custom position, with nothing saying which position each acts on. A screen-reader user tabbing through the page, or listing its buttons, could not tell them apart. Members Administration already names its buttons after the member.
**Where:** `RoleManagementPage.tsx`, the card actions.
**Fix:** `aria-label` "Edit {name}" and "Delete {name}". The visible word leads, so voice control that says "click Edit" still finds the button. Re-driven: "Edit IT Manager", "Edit Chief" and so on.
**Tests:** `RoleManagementPage.test.tsx`, "names each card's buttons after the position they act on", which failed before the fix. Nine existing tests found the buttons by the exact name "Edit" or "Delete". Their selector now matches a name starting with that word; what they assert is unchanged.

### W05-11 — LOW — "Set it up now" in the two-factor deadline banner opened the profile tab — ✅ FIXED

**Did:** as `admin`, whose access needs two-factor by 11/18/2026, followed the banner's "Set it up now".
**Saw:** `/account`, the profile tab. Two-factor setup is on the Security tab, which the administrator then had to find.
**Where:** `MfaGraceBanner.tsx` linked to `/account`. `UserSettingsPage` already honours `?tab=security`, which the department setup checklist uses.
**Fix:** the link goes to `/account?tab=security`. Re-driven: it lands on Security, with "Add a passkey" and "Enable two-factor authentication".
**Test changed:** `MfaGraceBanner.test.tsx` asserted `href="/account"`, which was the defect. It now asserts the Security tab, and it failed before the fix. The link sits inside a sentence, so the target-size rule's inline exception applies to its 17px height.

### W05-12 — NIT — "Role" on one screen, "Position" on the next — FLAGGED

Role Management says "Role Management", "Create Custom Role", "Create New Role", "Role Name", "Edit Role: …", "System Role", and "Delete role" in its confirmation. Members Administration, the member profile and the schema call the same thing a position ("Manage Positions", `positions.*` permissions). Settling on one word is a wording call across several screens, and the e2e specs select on some of these labels, so it is left as it is.

### Also seen

- The step-up's wrong-password message is "Verification failed". "That password isn't right" would say what to do. NIT.

### Harness

The pass deleted the position it created, so the install is as it was apart
from the audit rows.

### Checklist

| Section                 | Result                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ create, grant, assign, revoke, delete; the step-up resumes the action        |
| 2. The right people     | ✅ member refused; ceiling holds past the step-up                               |
| 3. Wrong input, failure | ✅ wrong step-up password refused; delete confirms with the member count        |
| 4. Browser signals      | ✅ only the expected 403s (step-up, ceiling) and the 400 for the wrong password |
| 5. Coming back to it    | ✅ grants and revokes reach a signed-in member on their next page load          |
| 6. On a phone           | ✅ no overflow, dialogs on screen, nothing under 44px                           |
| 7. Everyone can use it  | ✅ after W05-10: each card's buttons are named                                  |
| 8. What happens around  | ✅ every change and step-up audited with actor, IP and department               |

### Completion gate

| Check             | Result                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| npm run typecheck | ✅ clean                                                                                                |
| npm run lint      | ✅ clean (8 GB heap, per the W77 tooling lead)                                                          |
| frontend tests    | ✅ `vitest related` on the two components: 13 files, 93 tests; both new cases failed before their fixes |
| backend           | n/a: no backend change                                                                                  |
