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
