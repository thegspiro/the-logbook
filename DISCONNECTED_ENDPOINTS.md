# Disconnected Backend Endpoints

> **Generated:** 2026-02-17
> **Purpose:** Comprehensive inventory of all backend API endpoints that have no corresponding frontend integration. Use this as a checklist to systematically connect each endpoint to the UI.

## Summary

| Module | Connected | Disconnected | Total | Coverage |
|--------|-----------|-------------|-------|----------|
| Auth | 13 | 2 | 15 | 87% |
| Users / Members | 14 | 0 | 14 | 100% |
| Roles & Permissions | 9 | 4 | 13 | 69% |
| Organization Settings | 5 | 2 | 7 | 71% |
| Member Status & Lifecycle | 0 | 11 | 11 | 0% |
| Membership Pipeline (Prospective) | 0 | 30 | 30 | 0% |
| Events (core) | 24 | 0 | 24 | 100% |
| Events (attachments/settings) | 0 | 7 | 7 | 0% |
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
| External Training | 0 | 15 | 15 | 0% |
| Documents | 10 | 1 | 11 | 91% |
| Analytics | 3 | 0 | 3 | 100% |
| Dashboard | 1 | 0 | 1 | 100% |
| Integrations | 5 | 0 | 5 | 100% |
| Error Logs | 5 | 0 | 5 | 100% |
| Scheduled Tasks (admin) | 0 | 2 | 2 | 0% |
| **TOTALS** | **184** | **117** | **301** | **61%** |

---

## Priority Groups

### P0 - Entire modules with 0% frontend coverage (high-value features)

These are complete backend feature sets with no UI at all. Building frontend pages for these unlocks major new functionality.

- **Membership Pipeline** (30 endpoints) - Prospective member management with kanban, steps, election packages
- **Member Status & Lifecycle** (11 endpoints) - Status changes, archiving, reactivation, membership tiers
- **External Training** (15 endpoints) - Integration with Vector Solutions, Target Solutions, etc.

### P1 - Scheduling sub-modules with 0% coverage

These extend the already-working scheduling system with advanced features.

- **Shift Templates & Patterns** (10 endpoints) - Reusable shift templates and auto-generation
- **Shift Assignments** (5 endpoints) - Assign members to shifts, confirm assignments
- **Swap Requests** (5 endpoints) - Shift swap workflows with approval
- **Time-Off Requests** (5 endpoints) - Time-off with approval workflow
- **Shift Calls** (5 endpoints) - Call logging on shifts
- **Availability & Reports** (4 endpoints) - Member availability, hours/coverage/call-volume reports

### P2 - Small gaps in otherwise-connected modules

- **Event Attachments** (4 endpoints) - Upload/download readahead materials
- **Event Settings** (2 endpoints) - Module-level event configuration
- **Event Document Folder** (1 endpoint) - Auto-create document folder per event
- **Shift Attendance CRUD** (3 endpoints) - View/update/delete attendance records
- **Inventory Checkout** (3 endpoints) - Check-in, active/overdue checkout views
- **Meeting Attendance Waivers** (1 endpoint) - List waivers for a meeting
- **Training Session Approvals** (2 endpoints) - Token-based approval flow
- **Documents My-Folder** (1 endpoint) - Personal folder auto-creation

### P3 - Admin/utility endpoints (low priority)

- **Scheduled Tasks** (2 endpoints) - Admin manual task triggers
- **Roles helper endpoints** (4 endpoints) - Alternate permission/role lookup paths
- **Organization Membership ID settings** (2 endpoints) - Alternate route for existing settings
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

### ORGANIZATION SETTINGS (2 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 7 | GET | `/organization/settings/membership-id` | organizations.py:231 | Get membership ID settings separately |
| 8 | PATCH | `/organization/settings/membership-id` | organizations.py:245 | Update membership ID settings separately |

### MEMBER STATUS & LIFECYCLE (11 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 9 | PATCH | `/users/{user_id}/status` | member_status.py:44 | Change member status (active, dropped, etc.) |
| 10 | GET | `/users/{user_id}/property-return-report` | member_status.py:240 | Preview property return report |
| 11 | POST | `/users/property-return-reminders/process` | member_status.py:285 | Process property return reminders |
| 12 | GET | `/users/property-return-reminders/overdue` | member_status.py:312 | Get overdue property returns |
| 13 | POST | `/users/{user_id}/archive` | member_status.py:352 | Archive a dropped member |
| 14 | POST | `/users/{user_id}/reactivate` | member_status.py:430 | Reactivate an archived member |
| 15 | GET | `/users/archived` | member_status.py:465 | List archived members |
| 16 | PATCH | `/users/{user_id}/membership-type` | member_status.py:517 | Change membership tier |
| 17 | POST | `/users/advance-membership-tiers` | member_status.py:596 | Auto-advance members to next tier |
| 18 | GET | `/users/membership-tiers/config` | member_status.py:623 | Get membership tier configuration |
| 19 | PUT | `/users/membership-tiers/config` | member_status.py:647 | Update membership tier configuration |

### MEMBERSHIP PIPELINE - Prospective Members (30 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 20 | GET | `/prospective-members/pipelines` | membership_pipeline.py:54 | List membership pipelines |
| 21 | POST | `/prospective-members/pipelines` | membership_pipeline.py:87 | Create new pipeline |
| 22 | GET | `/prospective-members/pipelines/{id}` | membership_pipeline.py:118 | Get single pipeline |
| 23 | PUT | `/prospective-members/pipelines/{id}` | membership_pipeline.py:136 | Update pipeline |
| 24 | DELETE | `/prospective-members/pipelines/{id}` | membership_pipeline.py:159 | Delete pipeline |
| 25 | POST | `/prospective-members/pipelines/{id}/duplicate` | membership_pipeline.py:176 | Duplicate pipeline |
| 26 | POST | `/prospective-members/pipelines/{id}/seed-templates` | membership_pipeline.py:200 | Seed default templates |
| 27 | GET | `/prospective-members/pipelines/{id}/steps` | membership_pipeline.py:220 | List pipeline steps |
| 28 | POST | `/prospective-members/pipelines/{id}/steps` | membership_pipeline.py:238 | Add step to pipeline |
| 29 | PUT | `/prospective-members/pipelines/{id}/steps/{step_id}` | membership_pipeline.py:261 | Update pipeline step |
| 30 | DELETE | `/prospective-members/pipelines/{id}/steps/{step_id}` | membership_pipeline.py:286 | Delete pipeline step |
| 31 | PUT | `/prospective-members/pipelines/{id}/steps/reorder` | membership_pipeline.py:306 | Reorder pipeline steps |
| 32 | GET | `/prospective-members/pipelines/{id}/kanban` | membership_pipeline.py:333 | Get kanban board view |
| 33 | GET | `/prospective-members/pipelines/{id}/stats` | membership_pipeline.py:357 | Get pipeline statistics |
| 34 | POST | `/prospective-members/pipelines/{id}/purge-inactive` | membership_pipeline.py:379 | Purge inactive prospects |
| 35 | GET | `/prospective-members/prospects` | membership_pipeline.py:417 | List prospects with filtering |
| 36 | POST | `/prospective-members/prospects/check-existing` | membership_pipeline.py:460 | Check if prospect matches existing member |
| 37 | POST | `/prospective-members/prospects` | membership_pipeline.py:492 | Create new prospect |
| 38 | GET | `/prospective-members/prospects/{id}` | membership_pipeline.py:549 | Get prospect details |
| 39 | PUT | `/prospective-members/prospects/{id}` | membership_pipeline.py:567 | Update prospect |
| 40 | POST | `/prospective-members/prospects/{id}/complete-step` | membership_pipeline.py:591 | Mark step completed |
| 41 | POST | `/prospective-members/prospects/{id}/advance` | membership_pipeline.py:620 | Advance to next step |
| 42 | POST | `/prospective-members/prospects/{id}/transfer` | membership_pipeline.py:644 | Transfer to full membership |
| 43 | GET | `/prospective-members/prospects/{id}/activity` | membership_pipeline.py:674 | Get activity log |
| 44 | GET | `/prospective-members/prospects/{id}/documents` | membership_pipeline.py:709 | List prospect documents |
| 45 | POST | `/prospective-members/prospects/{id}/documents` | membership_pipeline.py:725 | Add prospect document |
| 46 | DELETE | `/prospective-members/prospects/{id}/documents/{doc_id}` | membership_pipeline.py:766 | Delete prospect document |
| 47 | GET | `/prospective-members/prospects/{id}/election-package` | membership_pipeline.py:796 | Get election package |
| 48 | POST | `/prospective-members/prospects/{id}/election-package` | membership_pipeline.py:814 | Create election package |
| 49 | PUT | `/prospective-members/prospects/{id}/election-package` | membership_pipeline.py:848 | Update election package |
| 50 | GET | `/prospective-members/election-packages` | membership_pipeline.py:872 | List election packages |

### EVENT ATTACHMENTS & SETTINGS (7 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 51 | POST | `/events/{id}/attachments` | events.py:1148 | Upload attachment to event |
| 52 | GET | `/events/{id}/attachments` | events.py:1221 | List event attachments |
| 53 | GET | `/events/{id}/attachments/{att_id}/download` | events.py:1245 | Download event attachment |
| 54 | DELETE | `/events/{id}/attachments/{att_id}` | events.py:1284 | Delete event attachment |
| 55 | GET | `/events/{id}/folder` | events.py:1332 | Get/create event document folder |
| 56 | GET | `/events/settings` | events.py:1554 | Get event module settings |
| 57 | PATCH | `/events/settings` | events.py:1559 | Update event module settings |

### SCHEDULING - Shift Calls (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 58 | POST | `/scheduling/shifts/{id}/calls` | scheduling.py:278 | Create call record for shift |
| 59 | GET | `/scheduling/shifts/{id}/calls` | scheduling.py:297 | List calls for a shift |
| 60 | GET | `/scheduling/calls/{call_id}` | scheduling.py:309 | Get specific call |
| 61 | PATCH | `/scheduling/calls/{call_id}` | scheduling.py:323 | Update call record |
| 62 | DELETE | `/scheduling/calls/{call_id}` | scheduling.py:341 | Delete call record |

### SCHEDULING - Templates & Patterns (10 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 63 | GET | `/scheduling/templates` | scheduling.py:358 | List shift templates |
| 64 | POST | `/scheduling/templates` | scheduling.py:372 | Create shift template |
| 65 | GET | `/scheduling/templates/{id}` | scheduling.py:389 | Get shift template |
| 66 | PATCH | `/scheduling/templates/{id}` | scheduling.py:403 | Update shift template |
| 67 | DELETE | `/scheduling/templates/{id}` | scheduling.py:421 | Delete shift template |
| 68 | GET | `/scheduling/patterns` | scheduling.py:438 | List shift patterns |
| 69 | POST | `/scheduling/patterns` | scheduling.py:452 | Create shift pattern |
| 70 | GET | `/scheduling/patterns/{id}` | scheduling.py:469 | Get shift pattern |
| 71 | PATCH | `/scheduling/patterns/{id}` | scheduling.py:483 | Update shift pattern |
| 72 | DELETE | `/scheduling/patterns/{id}` | scheduling.py:501 | Delete shift pattern |

### SCHEDULING - Pattern Generation (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 73 | POST | `/scheduling/patterns/{id}/generate` | scheduling.py:514 | Generate shifts from pattern for date range |

### SCHEDULING - Assignments (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 74 | GET | `/scheduling/shifts/{id}/assignments` | scheduling.py:539 | List shift assignments |
| 75 | POST | `/scheduling/shifts/{id}/assignments` | scheduling.py:551 | Create shift assignment |
| 76 | PATCH | `/scheduling/assignments/{id}` | scheduling.py:569 | Update shift assignment |
| 77 | DELETE | `/scheduling/assignments/{id}` | scheduling.py:587 | Delete shift assignment |
| 78 | POST | `/scheduling/assignments/{id}/confirm` | scheduling.py:600 | Confirm own assignment |

### SCHEDULING - Swap Requests (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 79 | GET | `/scheduling/swap-requests` | scheduling.py:620 | List swap requests |
| 80 | POST | `/scheduling/swap-requests` | scheduling.py:645 | Create swap request |
| 81 | GET | `/scheduling/swap-requests/{id}` | scheduling.py:662 | Get swap request |
| 82 | POST | `/scheduling/swap-requests/{id}/review` | scheduling.py:676 | Approve/deny swap |
| 83 | POST | `/scheduling/swap-requests/{id}/cancel` | scheduling.py:694 | Cancel own swap request |

### SCHEDULING - Time-Off (5 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 84 | GET | `/scheduling/time-off` | scheduling.py:714 | List time-off requests |
| 85 | POST | `/scheduling/time-off` | scheduling.py:741 | Create time-off request |
| 86 | GET | `/scheduling/time-off/{id}` | scheduling.py:758 | Get time-off request |
| 87 | POST | `/scheduling/time-off/{id}/review` | scheduling.py:772 | Approve/deny time-off |
| 88 | POST | `/scheduling/time-off/{id}/cancel` | scheduling.py:790 | Cancel own time-off |

### SCHEDULING - Availability & Reports (4 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 89 | GET | `/scheduling/availability` | scheduling.py:806 | Member availability for date range |
| 90 | GET | `/scheduling/reports/member-hours` | scheduling.py:884 | Member hours report |
| 91 | GET | `/scheduling/reports/coverage` | scheduling.py:904 | Shift coverage report |
| 92 | GET | `/scheduling/reports/call-volume` | scheduling.py:924 | Call volume report |

### SHIFT ATTENDANCE (3 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 93 | GET | `/scheduling/shifts/{id}/attendance` | scheduling.py:182 | Get attendance records for shift |
| 94 | PATCH | `/scheduling/attendance/{id}` | scheduling.py:194 | Update attendance record |
| 95 | DELETE | `/scheduling/attendance/{id}` | scheduling.py:211 | Remove attendance record |

### MEETING ATTENDANCE (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 96 | GET | `/meetings/{id}/attendance-waivers` | meetings.py:346 | List attendance waivers for meeting |

### INVENTORY CHECKOUT (3 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 97 | POST | `/checkout/{id}/checkin` | inventory.py:477 | Check in a checked-out item |
| 98 | GET | `/checkout/active` | inventory.py:513 | Get all active checkouts |
| 99 | GET | `/checkout/overdue` | inventory.py:533 | Get all overdue checkouts |

### TRAINING SESSIONS (2 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 100 | GET | `/training/sessions/approve/{token}` | training_sessions.py:153 | Get approval data by token (no auth) |
| 101 | POST | `/training/sessions/approve/{token}` | training_sessions.py:179 | Submit approval with time adjustments |

### EXTERNAL TRAINING (15 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 102 | GET | `/training/external/providers` | external_training.py:60 | List external training providers |
| 103 | POST | `/training/external/providers` | external_training.py:85 | Create provider |
| 104 | GET | `/training/external/providers/{id}` | external_training.py:137 | Get provider details |
| 105 | PATCH | `/training/external/providers/{id}` | external_training.py:165 | Update provider config |
| 106 | DELETE | `/training/external/providers/{id}` | external_training.py:216 | Delete/deactivate provider |
| 107 | POST | `/training/external/providers/{id}/test` | external_training.py:245 | Test provider connection |
| 108 | POST | `/training/external/providers/{id}/sync` | external_training.py:364 | Trigger sync operation |
| 109 | GET | `/training/external/providers/{id}/sync-logs` | external_training.py:431 | List sync logs |
| 110 | GET | `/training/external/providers/{id}/category-mappings` | external_training.py:459 | List category mappings |
| 111 | PATCH | `/training/external/providers/{id}/category-mappings/{map_id}` | external_training.py:517 | Update category mapping |
| 112 | GET | `/training/external/providers/{id}/user-mappings` | external_training.py:588 | List user mappings |
| 113 | PATCH | `/training/external/providers/{id}/user-mappings/{map_id}` | external_training.py:650 | Update user mapping |
| 114 | GET | `/training/external/providers/{id}/imports` | external_training.py:727 | List imported records |
| 115 | POST | `/training/external/providers/{id}/imports/{imp_id}/import` | external_training.py:757 | Import single record |
| 116 | POST | `/training/external/providers/{id}/imports/bulk` | external_training.py:852 | Bulk import records |

### DOCUMENTS (1 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 117 | GET | `/documents/my-folder` | documents.py:282 | Get/create user's personal folder |

### SCHEDULED TASKS - Admin (2 disconnected)

| # | Method | Path | File:Line | Description |
|---|--------|------|-----------|-------------|
| 118 | GET | `/scheduled/tasks` | scheduled.py:18 | List available scheduled tasks |
| 119 | POST | `/scheduled/run-task` | scheduled.py:35 | Manually trigger a scheduled task |

---

## Recommended Connection Order

### Phase 1: Member Lifecycle (11 endpoints)
Connect member status management - dropping, archiving, reactivating, and membership tier management. These are core membership operations that admins likely need.

### Phase 2: Scheduling Extensions (35 endpoints)
Build out the scheduling module with templates, patterns, assignments, swap requests, time-off, calls, and reports. The core scheduling infrastructure is already connected.

### Phase 3: Membership Pipeline (30 endpoints)
Build the prospective member management UI with kanban board, pipeline steps, election packages. This is a complete standalone feature.

### Phase 4: External Training (15 endpoints)
Add the external training provider integration UI. This connects to third-party training systems.

### Phase 5: Small Gaps (11 endpoints)
Clean up remaining gaps: event attachments/settings, inventory checkout, training approvals, documents my-folder.

### Phase 6: Admin/Utility (8 endpoints)
Low-priority admin endpoints: scheduled tasks, alternate role/permission lookups, OAuth flows.
