# Disconnected Backend Endpoints

> **Generated:** 2026-02-17
> **Updated:** 2026-02-18
> **Purpose:** Comprehensive inventory of all backend API endpoints that have no corresponding frontend integration. Use this as a checklist to systematically connect each endpoint to the UI.

## Summary

| Module | Connected | Disconnected | Total | Coverage |
|--------|-----------|-------------|-------|----------|
| Auth | 13 | 2 | 15 | 87% |
| Users / Members | 14 | 0 | 14 | 100% |
| Roles & Permissions | 10 | 3 | 13 | 77% |
| Organization Settings | 7 | 0 | 7 | 100% |
| Member Status & Lifecycle | 11 | 0 | 11 | 100% |
| Membership Pipeline (Prospective) | 27 | 3 | 30 | 90% |
| Events (core) | 24 | 0 | 24 | 100% |
| Events (attachments/settings) | 6 | 1 | 7 | 86% |
| Scheduling (core shifts/calendar) | 11 | 0 | 11 | 100% |
| Scheduling (calls) | 4 | 1 | 5 | 80% |
| Scheduling (templates & patterns) | 9 | 2 | 11 | 82% |
| Scheduling (assignments) | 2 | 3 | 5 | 40% |
| Scheduling (swap requests) | 4 | 1 | 5 | 80% |
| Scheduling (time-off) | 4 | 1 | 5 | 80% |
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
| Documents | 10 | 1 | 11 | 91% |
| Analytics | 3 | 0 | 3 | 100% |
| Dashboard | 1 | 0 | 1 | 100% |
| Integrations | 5 | 0 | 5 | 100% |
| Error Logs | 5 | 0 | 5 | 100% |
| Scheduled Tasks (admin) | 2 | 0 | 2 | 100% |
| **TOTALS** | **283** | **18** | **301** | **94%** |

---

## Recently Connected (this branch)

The following modules were connected in the current development cycle:

- **Membership Pipeline** — 27 of 30 endpoints connected via `CreatePipelinePage`, `PipelineDetailPage`, `ApplicantDetailDrawer`, and module-specific service at `modules/prospective-members/services/api.ts`. Pipeline CRUD, steps management, kanban board, prospect lifecycle, documents, and election packages all wired up.
- **Member Status & Lifecycle** — 11 of 11 endpoints connected via `MemberLifecyclePage` and `MemberProfilePage`. Status changes, archiving, reactivation, membership tiers, property return reminders and preview all wired up.
- **External Training** — All 15 endpoints connected via `ExternalTrainingPage`. Full provider management, sync, category/user mappings, and import UI.
- **Event Attachments & Settings** — 6 of 7 endpoints connected. Attachment upload/download/delete on `EventDetailPage`, module settings on `EventsSettingsPage`.
- **Organization Membership ID Settings** — Both endpoints connected via `SettingsPage` and `AddMember` (preview next ID).
- **Scheduling Sub-Modules** — Templates, patterns, pattern generation, swap requests, time-off, availability, and reports all connected via `services/api.ts`. Shift calls connected via `ShiftCallsPanel`.
- **Shift Attendance** — All 4 endpoints connected via `ShiftAttendancePage` and `services/api.ts`.
- **Inventory Checkout** — All 4 endpoints connected via `InventoryCheckoutsPage` and `services/api.ts`.
- **Meeting Attendance Waivers** — Connected via `services/api.ts`.
- **Scheduled Tasks** — Both endpoints connected via `services/api.ts` (uses `/admin/scheduled-tasks` path).
- **Training Session Approvals** — Both endpoints connected via `services/api.ts` (uses `/training/sessions/approval/{token}` path).

---

## Path Mismatches (Frontend vs Backend)

> **Action needed:** These endpoints are functionally connected but the frontend path does not exactly match the backend route. Verify that both paths resolve correctly or align them.

| Frontend Path | Backend Path | Module | Notes |
|---------------|-------------|--------|-------|
| `/training/sessions/approval/{token}` | `/training/sessions/approve/{token}` | Training Sessions | `services/api.ts:3064-3069` — check if both paths are registered |
| `/members/{userId}/property-return-preview` | `/users/{user_id}/property-return-report` | Member Status | `services/api.ts:3519` — different base path and action name |
| `/admin/scheduled-tasks` | `/scheduled/tasks` | Scheduled Tasks | `services/api.ts:3600-3604` — entirely different base path |

---

## Remaining Disconnected Endpoints (18)

### P0 - Functionality Gaps

These are endpoints where the backend feature is available but the UI doesn't call them.

#### Membership Pipeline (3 disconnected)

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 1 | POST | `/prospective-members/prospects/check-existing` | Check if prospect matches existing member | Prevents duplicate applications; should be called during prospect creation |
| 2 | GET | `/prospective-members/prospects/{id}/activity` | Get prospect activity log | Timeline/history view for prospect tracking |
| 3 | POST | `/prospective-members/prospects/{id}/complete-step` | Mark pipeline step as completed | May be handled via advance endpoint instead |

#### Scheduling - Assignments (3 disconnected)

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 4 | PATCH | `/scheduling/assignments/{id}` | Update shift assignment | Edit role or notes on existing assignment |
| 5 | DELETE | `/scheduling/assignments/{id}` | Remove shift assignment | Unassign a member from a shift |
| 6 | POST | `/scheduling/assignments/{id}/confirm` | Confirm own assignment | Member self-confirmation of their shift |

### P1 - Individual GET Endpoints (Low Priority)

These individual GET-by-ID endpoints are missing but the data is available through list endpoints. Low impact.

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 7 | GET | `/scheduling/templates/{id}` | Get single shift template | Data available via GET `/scheduling/templates` |
| 8 | GET | `/scheduling/patterns/{id}` | Get single shift pattern | Data available via GET `/scheduling/patterns` |
| 9 | GET | `/scheduling/calls/{call_id}` | Get single call record | Data available via GET `/scheduling/shifts/{id}/calls` |
| 10 | GET | `/scheduling/swap-requests/{id}` | Get single swap request | Data available via GET `/scheduling/swap-requests` |
| 11 | GET | `/scheduling/time-off/{id}` | Get single time-off request | Data available via GET `/scheduling/time-off` |

### P2 - Minor Feature Endpoints

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 12 | GET | `/events/{id}/folder` | Get/create event document folder | Auto-create document folder per event |
| 13 | GET | `/documents/my-folder` | Get/create user's personal folder | Personal document folder auto-creation |
| 14 | POST | `/scheduling/shifts/{id}/calls` | Create call record for shift | API method defined in `services/api.ts:2527` but not used in any UI component |

### P3 - Admin/Utility Endpoints (Low Priority)

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 15 | GET | `/roles/my/roles` | Get current user's own roles | Alternate lookup; data available via user profile |
| 16 | GET | `/roles/my/permissions` | Get current user's own permissions | Alternate lookup; data available via user profile |
| 17 | GET | `/roles/admin-access/check` | Check if user has admin access | Utility endpoint; role check done client-side |

### Not Applicable (Design Decision)

| # | Method | Path | Description | Notes |
|---|--------|------|-------------|-------|
| 18 | GET | `/auth/oauth/google` | OAuth redirect flow for Google sign-in | Server-side redirect — not called from SPA |
| — | GET | `/auth/oauth/microsoft` | OAuth redirect flow for Microsoft sign-in | Server-side redirect — not called from SPA |

---

## Recommended Connection Order

### Phase 1: Membership Pipeline Gaps (3 endpoints)
Connect the remaining prospective member features: duplicate checking during creation, activity log timeline, and step completion action.

### Phase 2: Scheduling Assignment Management (3 endpoints)
Add assignment editing, removal, and self-confirmation to the scheduling module.

### Phase 3: Document & Folder Features (3 endpoints)
Wire up event document folders, personal document folders, and call creation UI.

### Phase 4: Individual GET Endpoints (5 endpoints)
Low priority — add GET-by-ID methods for templates, patterns, calls, swap requests, and time-off when detail views are needed.

### Phase 5: Path Mismatches (3 pairs)
Verify and align frontend/backend paths for training approvals, property return preview, and scheduled tasks.
