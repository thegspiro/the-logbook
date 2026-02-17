# Disconnected Backend Endpoints

> **Generated:** 2026-02-17
> **Updated:** 2026-02-17
> **Purpose:** Comprehensive inventory of all backend API endpoints that have no corresponding frontend integration. Use this as a checklist to systematically connect each endpoint to the UI.

## Summary

| Module | Connected | Disconnected | Total | Coverage |
|--------|-----------|-------------|-------|----------|
| Auth | 13 | 2 | 15 | 87% |
| Users / Members | 14 | 0 | 14 | 100% |
| Roles & Permissions | 9 | 4 | 13 | 69% |
| Organization Settings | 7 | 0 | 7 | 100% |
| Member Status & Lifecycle | 10 | 1 | 11 | 91% |
| Membership Pipeline (Prospective) | 0 | 30 | 30 | 0% |
| Events (core) | 24 | 0 | 24 | 100% |
| Events (attachments/settings) | 6 | 1 | 7 | 86% |
| Scheduling (core shifts/calendar) | 11 | 0 | 11 | 100% |
| Scheduling (calls) | 0 | 5 | 5 | 0% |
| Scheduling (templates & patterns) | 0 | 10 | 10 | 0% |
| Scheduling (assignments) | 0 | 5 | 5 | 0% |
| Scheduling (swap requests) | 0 | 5 | 5 | 0% |
| Scheduling (time-off) | 0 | 5 | 5 | 0% |
| Scheduling (availability & reports) | 0 | 4 | 4 | 0% |
| Shift Attendance | 1 | 3 | 4 | 25% |
| Meeting Attendance | 2 | 1 | 3 | 67% |
| Inventory Checkout | 1 | 3 | 4 | 25% |
| Notifications | 9 | 0 | 9 | 100% |
| Reports | 2 | 0 | 2 | 100% |
| Email Templates | 6 | 0 | 6 | 100% |
| Training (core) | 24 | 0 | 24 | 100% |
| Training Programs | 21 | 0 | 21 | 100% |
| Training Sessions | 3 | 2 | 5 | 60% |
| Training Submissions | 11 | 0 | 11 | 100% |
| Training Module Config | 4 | 0 | 4 | 100% |
| External Training | 15 | 0 | 15 | 100% |
| Documents | 10 | 1 | 11 | 91% |
| Analytics | 3 | 0 | 3 | 100% |
| Dashboard | 1 | 0 | 1 | 100% |
| Integrations | 5 | 0 | 5 | 100% |
| Error Logs | 5 | 0 | 5 | 100% |
| Scheduled Tasks (admin) | 0 | 2 | 2 | 0% |
| **TOTALS** | **217** | **84** | **301** | **72%** |

---

## Recently Connected (this branch)

The following modules were connected in the current development cycle:

- **Member Status & Lifecycle** — 10 of 11 endpoints connected via `MemberLifecyclePage` and `MemberProfilePage`. Status changes, archiving, reactivation, membership tiers, property return reminders all wired up.
- **External Training** — All 15 endpoints connected via `ExternalTrainingPage`. Full provider management, sync, category/user mappings, and import UI.
- **Event Attachments & Settings** — 6 of 7 endpoints connected. Attachment upload/download/delete on `EventDetailPage`, module settings on `EventsSettingsPage`.
- **Organization Membership ID Settings** — Both endpoints connected via `SettingsPage` and `AddMember` (preview next ID).

---

## Priority Groups

### P0 - Entire modules with 0% frontend coverage (high-value features)

These are complete backend feature sets with no UI at all. Building frontend pages for these unlocks major new functionality.

- **Membership Pipeline** (30 endpoints) - Prospective member management with kanban, steps, election packages

### P1 - Scheduling sub-modules with 0% coverage

These extend the already-working scheduling system with advanced features.

- **Shift Templates & Patterns** (10 endpoints) - Reusable shift templates and auto-generation
- **Shift Assignments** (5 endpoints) - Assign members to shifts, confirm assignments
- **Swap Requests** (5 endpoints) - Shift swap workflows with approval
- **Time-Off Requests** (5 endpoints) - Time-off with approval workflow
- **Shift Calls** (5 endpoints) - Call logging on shifts
- **Availability & Reports** (4 endpoints) - Member availability, hours/coverage/call-volume reports

### P2 - Small gaps in otherwise-connected modules

- **Event Document Folder** (1 endpoint) - Auto-create document folder per event (`/events/{id}/folder` — API method exists but not used in UI)
- **Member Property Return Report** (1 endpoint) - Preview property return report (`/users/{id}/property-return-report` — API method exists but not used in UI)
- **Shift Attendance CRUD** (3 endpoints) - View/update/delete attendance records
- **Inventory Checkout** (3 endpoints) - Check-in, active/overdue checkout views
- **Meeting Attendance Waivers** (1 endpoint) - List waivers for a meeting
- **Training Session Approvals** (2 endpoints) - Token-based approval flow
- **Documents My-Folder** (1 endpoint) - Personal folder auto-creation

### P3 - Admin/utility endpoints (low priority)

- **Scheduled Tasks** (2 endpoints) - Admin manual task triggers
- **Roles helper endpoints** (4 endpoints) - Alternate permission/role lookup paths
- **OAuth redirect endpoints** (2 endpoints) - Google/Microsoft OAuth flows

---

## Detailed Endpoint Inventory

### AUTH (2 disconnected)

| # | Method | Path | File | Description |
|---|--------|------|------|-------------|
| 1 | GET | `/auth/oauth/google` | auth.py | OAuth redirect flow for Google sign-in |
| 2 | GET | `/auth/oauth/microsoft` | auth.py | OAuth redirect flow for Microsoft sign-in |

### ROLES & PERMISSIONS (4 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 3 | GET | `/roles/my/roles` | roles.py:433 | Get current user's own roles |
| 4 | GET | `/roles/my/permissions` | roles.py:448 | Get current user's own permissions |
| 5 | GET | `/roles/user/{user_id}/permissions` | roles.py:392 | Get permissions for a specific user |
| 6 | GET | `/roles/admin-access/check` | roles.py:473 | Check if user has admin access |

### ~~ORGANIZATION SETTINGS~~ — ✅ Fully connected

### MEMBER STATUS & LIFECYCLE (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 7 | GET | `/users/{user_id}/property-return-report` | member_status.py:240 | Preview property return report (API method defined, not used in UI) |

### MEMBERSHIP PIPELINE - Prospective Members (30 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 8 | GET | `/prospective-members/pipelines` | membership_pipeline.py:54 | List membership pipelines |
| 9 | POST | `/prospective-members/pipelines` | membership_pipeline.py:87 | Create new pipeline |
| 10 | GET | `/prospective-members/pipelines/{id}` | membership_pipeline.py:118 | Get single pipeline |
| 11 | PUT | `/prospective-members/pipelines/{id}` | membership_pipeline.py:136 | Update pipeline |
| 12 | DELETE | `/prospective-members/pipelines/{id}` | membership_pipeline.py:159 | Delete pipeline |
| 13 | POST | `/prospective-members/pipelines/{id}/duplicate` | membership_pipeline.py:176 | Duplicate pipeline |
| 14 | POST | `/prospective-members/pipelines/{id}/seed-templates` | membership_pipeline.py:200 | Seed default templates |
| 15 | GET | `/prospective-members/pipelines/{id}/steps` | membership_pipeline.py:220 | List pipeline steps |
| 16 | POST | `/prospective-members/pipelines/{id}/steps` | membership_pipeline.py:238 | Add step to pipeline |
| 17 | PUT | `/prospective-members/pipelines/{id}/steps/{step_id}` | membership_pipeline.py:261 | Update pipeline step |
| 18 | DELETE | `/prospective-members/pipelines/{id}/steps/{step_id}` | membership_pipeline.py:286 | Delete pipeline step |
| 19 | PUT | `/prospective-members/pipelines/{id}/steps/reorder` | membership_pipeline.py:306 | Reorder pipeline steps |
| 20 | GET | `/prospective-members/pipelines/{id}/kanban` | membership_pipeline.py:333 | Get kanban board view |
| 21 | GET | `/prospective-members/pipelines/{id}/stats` | membership_pipeline.py:357 | Get pipeline statistics |
| 22 | POST | `/prospective-members/pipelines/{id}/purge-inactive` | membership_pipeline.py:379 | Purge inactive prospects |
| 23 | GET | `/prospective-members/prospects` | membership_pipeline.py:417 | List prospects with filtering |
| 24 | POST | `/prospective-members/prospects/check-existing` | membership_pipeline.py:460 | Check if prospect matches existing member |
| 25 | POST | `/prospective-members/prospects` | membership_pipeline.py:492 | Create new prospect |
| 26 | GET | `/prospective-members/prospects/{id}` | membership_pipeline.py:549 | Get prospect details |
| 27 | PUT | `/prospective-members/prospects/{id}` | membership_pipeline.py:567 | Update prospect |
| 28 | POST | `/prospective-members/prospects/{id}/complete-step` | membership_pipeline.py:591 | Mark step completed |
| 29 | POST | `/prospective-members/prospects/{id}/advance` | membership_pipeline.py:620 | Advance to next step |
| 30 | POST | `/prospective-members/prospects/{id}/transfer` | membership_pipeline.py:644 | Transfer to full membership |
| 31 | GET | `/prospective-members/prospects/{id}/activity` | membership_pipeline.py:674 | Get activity log |
| 32 | GET | `/prospective-members/prospects/{id}/documents` | membership_pipeline.py:709 | List prospect documents |
| 33 | POST | `/prospective-members/prospects/{id}/documents` | membership_pipeline.py:725 | Add prospect document |
| 34 | DELETE | `/prospective-members/prospects/{id}/documents/{doc_id}` | membership_pipeline.py:766 | Delete prospect document |
| 35 | GET | `/prospective-members/prospects/{id}/election-package` | membership_pipeline.py:796 | Get election package |
| 36 | POST | `/prospective-members/prospects/{id}/election-package` | membership_pipeline.py:814 | Create election package |
| 37 | PUT | `/prospective-members/prospects/{id}/election-package` | membership_pipeline.py:848 | Update election package |
| 38 | GET | `/prospective-members/election-packages` | membership_pipeline.py:872 | List election packages |

### EVENT ATTACHMENTS & SETTINGS (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 39 | GET | `/events/{id}/folder` | events.py:1332 | Get/create event document folder (API method defined, not used in UI) |

### ~~EXTERNAL TRAINING~~ — ✅ Fully connected

### SCHEDULING - Shift Calls (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 40 | POST | `/scheduling/shifts/{id}/calls` | scheduling.py:278 | Create call record for shift |
| 41 | GET | `/scheduling/shifts/{id}/calls` | scheduling.py:297 | List calls for a shift |
| 42 | GET | `/scheduling/calls/{call_id}` | scheduling.py:309 | Get specific call |
| 43 | PATCH | `/scheduling/calls/{call_id}` | scheduling.py:323 | Update call record |
| 44 | DELETE | `/scheduling/calls/{call_id}` | scheduling.py:341 | Delete call record |

### SCHEDULING - Templates & Patterns (10 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 45 | GET | `/scheduling/templates` | scheduling.py:358 | List shift templates |
| 46 | POST | `/scheduling/templates` | scheduling.py:372 | Create shift template |
| 47 | GET | `/scheduling/templates/{id}` | scheduling.py:389 | Get shift template |
| 48 | PATCH | `/scheduling/templates/{id}` | scheduling.py:403 | Update shift template |
| 49 | DELETE | `/scheduling/templates/{id}` | scheduling.py:421 | Delete shift template |
| 50 | GET | `/scheduling/patterns` | scheduling.py:438 | List shift patterns |
| 51 | POST | `/scheduling/patterns` | scheduling.py:452 | Create shift pattern |
| 52 | GET | `/scheduling/patterns/{id}` | scheduling.py:469 | Get shift pattern |
| 53 | PATCH | `/scheduling/patterns/{id}` | scheduling.py:483 | Update shift pattern |
| 54 | DELETE | `/scheduling/patterns/{id}` | scheduling.py:501 | Delete shift pattern |

### SCHEDULING - Pattern Generation (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 55 | POST | `/scheduling/patterns/{id}/generate` | scheduling.py:514 | Generate shifts from pattern for date range |

### SCHEDULING - Assignments (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 56 | GET | `/scheduling/shifts/{id}/assignments` | scheduling.py:539 | List shift assignments |
| 57 | POST | `/scheduling/shifts/{id}/assignments` | scheduling.py:551 | Create shift assignment |
| 58 | PATCH | `/scheduling/assignments/{id}` | scheduling.py:569 | Update shift assignment |
| 59 | DELETE | `/scheduling/assignments/{id}` | scheduling.py:587 | Delete shift assignment |
| 60 | POST | `/scheduling/assignments/{id}/confirm` | scheduling.py:600 | Confirm own assignment |

### SCHEDULING - Swap Requests (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 61 | GET | `/scheduling/swap-requests` | scheduling.py:620 | List swap requests |
| 62 | POST | `/scheduling/swap-requests` | scheduling.py:645 | Create swap request |
| 63 | GET | `/scheduling/swap-requests/{id}` | scheduling.py:662 | Get swap request |
| 64 | POST | `/scheduling/swap-requests/{id}/review` | scheduling.py:676 | Approve/deny swap |
| 65 | POST | `/scheduling/swap-requests/{id}/cancel` | scheduling.py:694 | Cancel own swap request |

### SCHEDULING - Time-Off (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 66 | GET | `/scheduling/time-off` | scheduling.py:714 | List time-off requests |
| 67 | POST | `/scheduling/time-off` | scheduling.py:741 | Create time-off request |
| 68 | GET | `/scheduling/time-off/{id}` | scheduling.py:758 | Get time-off request |
| 69 | POST | `/scheduling/time-off/{id}/review` | scheduling.py:772 | Approve/deny time-off |
| 70 | POST | `/scheduling/time-off/{id}/cancel` | scheduling.py:790 | Cancel own time-off |

### SCHEDULING - Availability & Reports (4 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 71 | GET | `/scheduling/availability` | scheduling.py:806 | Member availability for date range |
| 72 | GET | `/scheduling/reports/member-hours` | scheduling.py:884 | Member hours report |
| 73 | GET | `/scheduling/reports/coverage` | scheduling.py:904 | Shift coverage report |
| 74 | GET | `/scheduling/reports/call-volume` | scheduling.py:924 | Call volume report |

### SHIFT ATTENDANCE (3 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 75 | GET | `/scheduling/shifts/{id}/attendance` | scheduling.py:182 | Get attendance records for shift |
| 76 | PATCH | `/scheduling/attendance/{id}` | scheduling.py:194 | Update attendance record |
| 77 | DELETE | `/scheduling/attendance/{id}` | scheduling.py:211 | Remove attendance record |

### MEETING ATTENDANCE (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 78 | GET | `/meetings/{id}/attendance-waivers` | meetings.py:346 | List attendance waivers for meeting |

### INVENTORY CHECKOUT (3 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 79 | POST | `/checkout/{id}/checkin` | inventory.py:477 | Check in a checked-out item |
| 80 | GET | `/checkout/active` | inventory.py:513 | Get all active checkouts |
| 81 | GET | `/checkout/overdue` | inventory.py:533 | Get all overdue checkouts |

### TRAINING SESSIONS (2 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 82 | GET | `/training/sessions/approve/{token}` | training_sessions.py:153 | Get approval data by token (no auth) |
| 83 | POST | `/training/sessions/approve/{token}` | training_sessions.py:179 | Submit approval with time adjustments |

### DOCUMENTS (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 84 | GET | `/documents/my-folder` | documents.py:282 | Get/create user's personal folder |

### SCHEDULED TASKS - Admin (2 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 85 | GET | `/scheduled/tasks` | scheduled.py:18 | List available scheduled tasks |
| 86 | POST | `/scheduled/run-task` | scheduled.py:35 | Manually trigger a scheduled task |

---

## Recommended Connection Order

### Phase 1: Scheduling Extensions (35 endpoints)
Build out the scheduling module with templates, patterns, assignments, swap requests, time-off, calls, and reports. The core scheduling infrastructure is already connected.

### Phase 2: Membership Pipeline (30 endpoints)
Build the prospective member management UI with kanban board, pipeline steps, election packages. This is a complete standalone feature.

### Phase 3: Small Gaps (12 endpoints)
Clean up remaining gaps: event document folder, property return report preview, inventory checkout, shift attendance CRUD, training approvals, meeting waivers, documents my-folder.

### Phase 4: Admin/Utility (8 endpoints)
Low-priority admin endpoints: scheduled tasks, alternate role/permission lookups, OAuth flows.
