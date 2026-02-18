# Disconnected Backend Endpoints

> **Generated:** 2026-02-17
> **Updated:** 2026-02-18
> **Purpose:** Comprehensive inventory of all backend API endpoints that have no corresponding frontend integration. Use this as a checklist to systematically connect each endpoint to the UI.

## Summary

| Module | Connected | Disconnected | Total | Coverage |
|--------|-----------|-------------|-------|----------|
| Auth | 13 | 2 | 15 | 87% |
| Users / Members | 14 | 0 | 14 | 100% |
| Roles & Permissions | 13 | 0 | 13 | 100% |
| Organization Settings | 7 | 0 | 7 | 100% |
| Member Status & Lifecycle | 11 | 0 | 11 | 100% |
| Membership Pipeline (Prospective) | 30 | 0 | 30 | 100% |
| Events (core) | 24 | 0 | 24 | 100% |
| Events (attachments/settings) | 7 | 0 | 7 | 100% |
| Scheduling (core shifts/calendar) | 11 | 0 | 11 | 100% |
| Scheduling (calls) | 5 | 0 | 5 | 100% |
| Scheduling (templates & patterns) | 11 | 0 | 11 | 100% |
| Scheduling (assignments) | 5 | 0 | 5 | 100% |
| Scheduling (swap requests) | 5 | 0 | 5 | 100% |
| Scheduling (time-off) | 5 | 0 | 5 | 100% |
| Scheduling (availability & reports) | 4 | 0 | 4 | 100% |
| Shift Attendance | 4 | 0 | 4 | 100% |
| Meeting Attendance | 3 | 0 | 3 | 100% |
| Inventory Checkout | 4 | 0 | 4 | 100% |
| Notifications | 9 | 0 | 9 | 100% |
| Reports | 2 | 0 | 2 | 100% |
| Email Templates | 6 | 0 | 6 | 100% |
| Training (core) | 24 | 0 | 24 | 100% |
| Training Programs | 21 | 0 | 21 | 100% |
| Training Sessions | 5 | 0 | 5 | 100% |
| Training Submissions | 11 | 0 | 11 | 100% |
| Training Module Config | 4 | 0 | 4 | 100% |
| External Training | 15 | 0 | 15 | 100% |
| Documents | 11 | 0 | 11 | 100% |
| Analytics | 3 | 0 | 3 | 100% |
| Dashboard | 1 | 0 | 1 | 100% |
| Integrations | 5 | 0 | 5 | 100% |
| Error Logs | 5 | 0 | 5 | 100% |
| Scheduled Tasks (admin) | 2 | 0 | 2 | 100% |
| **TOTALS** | **299** | **2** | **301** | **99%** |

---

## Recently Connected (this branch)

The following modules were connected in the current development cycle:

- **Membership Pipeline** — All 30 endpoints connected. Pipeline CRUD, steps management, kanban board, prospect lifecycle, documents, election packages, duplicate checking (`check-existing`), activity log, and step completion all wired up via `modules/prospective-members/services/api.ts`, `ProspectiveMembersPage`, and `ApplicantDetailDrawer`.
- **Member Status & Lifecycle** — All 11 endpoints connected via `MemberLifecyclePage` and `MemberProfilePage`. Path mismatches fixed (frontend was using `/members/` prefix, backend uses `/users/`).
- **External Training** — All 15 endpoints connected via `ExternalTrainingPage`.
- **Event Attachments, Settings & Folders** — All 7 endpoints connected. Attachment upload/download/delete, module settings, and event document folder endpoint.
- **Organization Membership ID Settings** — Both endpoints connected via `SettingsPage` and `AddMember`.
- **Scheduling (all sub-modules)** — All endpoints connected:
  - Templates & patterns: full CRUD + GET-by-ID + pattern generation
  - Assignments: full CRUD + self-confirmation
  - Swap requests: full CRUD + review + GET-by-ID
  - Time-off: full CRUD + review + GET-by-ID
  - Shift calls: full CRUD + GET-by-ID
  - Availability & reports: all 4 reports connected
- **Shift Attendance** — All 4 endpoints connected via `ShiftAttendancePage`.
- **Inventory Checkout** — All 4 endpoints connected via `InventoryCheckoutsPage`.
- **Meeting Attendance Waivers** — Connected via `services/api.ts`.
- **Scheduled Tasks** — Both endpoints connected. Path fixed (`/admin/scheduled-tasks` → `/scheduled/tasks`).
- **Training Session Approvals** — Both endpoints connected. Path fixed (`/approval/` → `/approve/`).
- **Documents** — All 11 endpoints connected including personal folder (`/documents/my-folder`).
- **Roles & Permissions** — All 13 endpoints connected including `getMyRoles()`, `getMyPermissions()`, and `checkAdminAccess()`.

---

## Path Mismatches Fixed

The following frontend-backend path mismatches were identified and corrected:

| Previous Frontend Path | Corrected Path | Module |
|----------------------|----------------|--------|
| `/training/sessions/approval/{token}` | `/training/sessions/approve/{token}` | Training Sessions |
| `/members/{userId}/property-return-preview` | `/users/{userId}/property-return-report` | Member Status |
| `/members/archived` | `/users/archived` | Member Status |
| `/members/{userId}/reactivate` | `/users/{userId}/reactivate` | Member Status |
| `/members/overdue-property-returns` | `/users/property-return-reminders/overdue` | Member Status |
| `/members/property-return-reminders` | `/users/property-return-reminders/process` | Member Status |
| `/members/tier-config` | `/users/membership-tiers/config` | Member Status |
| `/members/advance-tiers` | `/users/advance-membership-tiers` | Member Status |
| `/admin/scheduled-tasks` | `/scheduled/tasks` | Scheduled Tasks |
| `/admin/scheduled-tasks/{id}/run` | `/scheduled/run-task?task={id}` | Scheduled Tasks |

---

## Remaining Unconnected (2 endpoints)

These are OAuth redirect endpoints that are server-side by design and not called from the SPA:

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 1 | GET | `/auth/oauth/google` | OAuth redirect flow for Google sign-in | Server-side redirect — browser navigates directly |
| 2 | GET | `/auth/oauth/microsoft` | OAuth redirect flow for Microsoft sign-in | Server-side redirect — browser navigates directly |

These endpoints are intentionally not called via the API client. When OAuth is enabled, the frontend navigates the browser to these URLs directly, which triggers a server-side redirect to the OAuth provider.
