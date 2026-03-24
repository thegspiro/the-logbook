# Changelog

All notable changes to The Logbook project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Scheduling — Bulk Actions, Staffing Visualization, Notifications & Bug Fixes (2026-03-24)

- **Bulk confirm/decline on My Shifts**: When 2+ pending shift assignments exist, checkboxes appear on each shift card with "Select All" toggle, "Confirm All", and "Decline All" bulk action buttons. Optimistic UI updates with rollback on failure
- **Inline approve/deny on Requests tab**: Swap and time-off request cards now show direct "Approve" and "Deny" buttons without opening a modal. "+ Notes" link opens the review modal for comments
- **Staffing status visualization**: Shift cards display green CheckCircle2 icon when fully staffed. Crew info box shows staffing ratio (e.g., "4/4") with green/amber background. Staffing-based color tints override template colors (green for fully staffed, amber for understaffed)
- **Position-first assignment flow**: ShiftDetailPanel crew board now shows position dropdown first (defaults to first open slot), member search below. "Assign" button directly on open slots pre-fills position
- **Bulk assignment**: "Fill All Open" button when 2+ positions unfilled. Compact form with one member dropdown per position
- **Unavailable member filtering**: New `GET /api/v1/scheduling/shifts/{id}/unavailable-members` endpoint consolidates members on leave, with time-off, or already assigned. Removed from assignment dropdowns
- **Required/Optional position toggle**: Template position editor adds required/optional toggle per position. Violet badge when required, muted when optional. Data structure changed from `string[]` to `{position: string, required: boolean}[]`
- **Shift assignment notifications**: In-app + optional email notification when a member is assigned to a shift. Settings in Scheduling Notifications Panel under "Shift Assignment Alerts"
- **Start-of-shift reminders**: Scheduled task (30-minute interval) sends reminders to assigned members within configurable lookahead window (default 2 hours). Includes equipment checklist list for the shift's apparatus. Settings: enable toggle, lookahead hours, email toggle, CC emails. Stored in `org.settings.shift_reminders`
- **Selected shift highlight**: Currently viewed shift highlighted with violet ring across all calendar views (week, mobile, month, list)
- **Collapsible shift creation options**: Start/End Date shown first; Custom Times, Apparatus, Officer, and Notes behind a collapsible "Additional Options" section
- **Searchable template dropdown**: Shows search input when >5 templates, filters by name/apparatus/category
- **Open/Specific swap selector**: Two-card radio buttons replace single dropdown for swap type selection
- **Time-off conflict warning**: Amber banner on shift detail listing conflicting time-off requests with dates
- **Notification history link**: "Alerts" link on My Shifts tab filtered to `schedule_change` trigger type
- **Equipment check inline status**: Badge counts (pass/fail/in-progress/pending) next to equipment check header. Action hints: "Start check → Go to Checklists tab" or "Continue check → N items remaining"
- **Member hours report fix**: Service now queries `ShiftAssignment` joined with `Shift` instead of `ShiftAttendance` (clock-in records), returning scheduled shift hours. Added `first_name`/`last_name` to `MemberHoursReport` schema and frontend type
- **Availability report fix**: New `get_availability_summary()` aggregates time-off/leave/assignment data per member instead of returning raw records
- **Shift overlap false positive fix**: Open-ended shifts (no `end_time`) restricted to same `shift_date` instead of being treated as infinitely long
- **UTC timezone in notifications fix**: Shift assignment, shift reminder, and inventory overdue notifications now convert times to org timezone before formatting
- **Shift color parsing fix**: `getShiftTemplateColor()` extracts time portion after "T" split before parsing hour, fixing all shifts defaulting to indigo
- **Notes form coercion fix**: Changed `editingNotesValue ?? undefined` to `editingNotesValue || undefined` to prevent 422 on empty notes
- **Pattern generation 422 fix**: Removed redundant `pattern_id` from `GenerateShiftsRequest` body (already a URL path parameter)
- **Shift card text color accessibility**: WCAG AA 4.5:1 contrast calculation for hex template colors. Iterative lightening/darkening based on dark/light mode
- **Dark mode fixes**: Added `dark:` variants on all interactive elements (confirm/decline/cancel buttons, inline text, request review buttons) across scheduling views
- **Mobile touch targets**: Increased from 36px to 44px (WCAG standard) on My Shifts and ShiftDetailPanel action buttons
- **Code reduction**: Consolidated 33 → 23 useState hooks in ShiftDetailPanel. Extracted `INACTIVE_ASSIGNMENT_STATUSES` constant. Deduplicated shift enrichment via `_enrich_shift_dict()`

**New API Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/scheduling/shifts/{id}/unavailable-members` | Consolidated unavailable user IDs for assignment filtering |

**Data Model Changes:**

| Table/Field | Change | Description |
|-------------|--------|-------------|
| `shift_templates.positions` | Schema change | JSON changed from `string[]` to `{position, required}[]` |
| `shifts.activities` | New JSON key | `start_reminder_sent` (Boolean) prevents duplicate reminders |
| `email_template_types` | Enum sync | Added `shift_assignment`, `shift_reminder` types |
| `org.settings.shift_reminders` | New JSON key | `enabled`, `lookahead_hours`, `send_email`, `cc_emails` |
| `org.settings.scheduling_assignment` | New JSON key | `notify_on_assignment`, `send_email`, `cc_emails` |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Bulk confirm with API failure | Optimistic UI reverts; toast shows error |
| Template with bare string positions | Backward-compatible: defaults to `required=true` |
| Shift with no `end_time` overlapping next day | Overlap restricted to same `shift_date` only |
| Reminder for shift already started | Skipped — only shifts starting within lookahead window |
| All positions filled via bulk assign | "Fill All Open" button hidden |
| Member on leave assigned via API | Blocked by unavailable-members check in UI; API still accepts (no backend guard) |
| Notes cleared to empty string | Converted to `undefined` via `||` to prevent 422 |
| Dark mode with light template color | Text auto-darkened to maintain 4.5:1 contrast ratio |

### Elections — Secretary Workflow, Eligibility Roster, Enums & Result Publishing (2026-03-24)

- **Tabbed election detail workflow**: `ElectionWorkflowTabs` replaces monolithic detail page. Tabs: Ballot, Candidates, Eligibility, Overrides, Proxies, Attendance (draft/open), Cast Vote (open), Results (closed). WAI-ARIA Tabs pattern with roving tabindex
- **Eligibility roster**: New `EligibilityRoster` component and `GET /api/v1/elections/{id}/eligibility-roster` endpoint. Color-coded rows (green/red/blue/muted), search + filter (All/Eligible/Ineligible/Voted/Override), expandable per-member rows showing per-ballot-item eligibility, ballot delivery indicator, ineligibility reasons
- **Publish results panel**: One-click toggle to publish/hide results (`aria-pressed`). "Send Report" button emails results to eligible voters. Color-coded status indicators (green=closed, blue=open)
- **Runoff chain visualization**: Horizontal timeline showing original → runoff 1 → runoff 2 elections. Each node: title, status, vote count, status icon. Current election highlighted with `aria-current="page"`
- **Election summary cards**: 4-column dashboard metrics on elections list page: Active Elections, Need Attention (draft + expired), Completed, Total Votes Cast
- **Election enums extracted to constants**: `VotingMethod`, `VictoryCondition`, `BallotChoice`, `RunoffType`, `QuorumType` added to `constants/enums.ts`. 50+ string literals replaced across 10+ files
- **Backend validator deduplication**: 8 field validators consolidated into reusable `_validate_choice()` helper. `VALID_QUORUM_TYPES` extracted as constant
- **Event type filter removed**: Elections can now be linked to any event type (not just business meetings)
- **Accessibility**: WAI-ARIA Tabs pattern, `aria-expanded` on expandable rows, `aria-pressed` on toggle buttons, `aria-current` on runoff chain, keyboard navigation (Enter/Space)
- **Department email generation**: New `DepartmentEmailSettings` schema with 4 format patterns (first.last, flast, firstlast, last.first). Auto-generated at member election/transfer. Uniqueness check with numeric suffix on collision. Personal email preserved in `User.personal_email`

**New API Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/elections/{id}/eligibility-roster` | Full member eligibility breakdown for secretary |

**New Frontend Components:**

| Component | Location | Description |
|-----------|----------|-------------|
| `ElectionWorkflowTabs` | `modules/elections/components/` | Tabbed navigation with dynamic visibility |
| `EligibilityRoster` | `modules/elections/components/` | Secretary eligibility dashboard |
| `PublishResultsPanel` | `modules/elections/components/` | Post-election result publishing |
| `RunoffChain` | `modules/elections/components/` | Multi-stage election timeline |
| `ElectionSummaryCards` | `modules/elections/components/` | Dashboard metrics cards |

**New Enums (frontend):**

| Enum | Values |
|------|--------|
| `VotingMethod` | `simple_majority`, `ranked_choice`, `approval`, `supermajority` |
| `VictoryCondition` | `most_votes`, `majority`, `supermajority`, `threshold` |
| `BallotChoice` | `approve`, `deny`, `abstain`, `write_in` |
| `RunoffType` | `top_two`, `eliminate_lowest` |
| `QuorumType` | `none`, `percentage`, `count` |

**Data Model Changes:**

| Table/Field | Change | Description |
|-------------|--------|-------------|
| `org.settings.department_email` | New JSON key | `enabled`, `domain`, `format` for department email generation |
| `users.personal_email` | New column | Stores prospect's original email after department email assignment |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Election linked to non-business-meeting event | Now allowed — event type filter removed |
| Department email collision (john.smith@dept.org exists) | Appends numeric suffix: john.smith2@dept.org |
| Department email disabled | Uses prospect's personal email as primary |
| Tabs when election is cancelled | Only Ballot tab visible |
| Results tab auto-select | Auto-navigates to Results when election is closed |
| Runoff chain with no parent | Shows single-node chain for standalone elections |

### Inventory — Storage Areas, Barcode Backfill, Item Detail & WebSocket Fix (2026-03-24)

- **Storage area items display**: Storage Areas page now shows actual inventory items assigned to each area with expandable inline panels. Items display name, serial number, status, and condition with direct links to item detail pages
- **Storage area item link fix**: Item links from storage areas now navigate to `/inventory/items/{id}` instead of dashboard
- **Barcode and asset tag always visible**: Item detail page always shows barcode and asset tag fields with `--` fallback when empty, instead of hiding them
- **Barcode backfill**: Items created before auto-generation lazily receive barcodes (INV-XXXXXXXX format) on first fetch. No migration needed
- **Admin items page improvements**: InventoryItemsPage readability and bug fixes
- **WebSocket double-accept fix**: Guard `client_state` check before `accept()` to prevent `RuntimeError` in inventory WebSocket endpoint
- **Equipment check template builder fix**: Removed `useBlocker` from `useUnsavedChanges` (incompatible with BrowserRouter). Kept `beforeunload` handler for browser close/refresh
- **Storage area name resolution**: Item detail page resolves and displays the storage area name instead of raw ID

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Item created before barcode auto-generation | Barcode lazily generated on first fetch |
| Storage area with no items | Shows empty state message |
| Item with no barcode or asset tag | Fields display `--` placeholder |
| WebSocket connection already accepted | Guard prevents second `accept()` call |
| Template builder navigation during unsaved changes | `beforeunload` fires on browser close; no in-app blocking (BrowserRouter limitation) |

### Notifications — Batch Read, Badges, Polling & Dashboard Fixes (2026-03-24)

- **Batch mark-all-read**: New `POST /api/v1/notifications/logs/read-all` endpoint marks all org notification logs as read in a single query
- **Unread badge**: Bell icon (top nav) and Notifications link (side nav) show unread notification count badge. Shared Zustand store + `useNotificationPoller` hook initialized in AppLayout
- **Smart polling**: Notification polling pauses when browser tab is hidden (Page Visibility API). Refetches immediately when tab becomes visible
- **Pagination**: Notifications inbox uses "Load More" pagination (20 per page)
- **Read filter**: "Show read" toggle to filter read/unread notifications. Improved empty states for filtered views
- **Clear All fix**: Dashboard fetches only unread notifications (`include_read: false`). Cleared notifications no longer reappear on navigation
- **Clickable dashboard notifications**: Notifications navigate to inbox if no `action_url` is set
- **View All link fix**: "View All" navigates to `/notifications?tab=inbox` instead of bare `/notifications`
- **Code cleanup**: Removed dead branches and simplified notification rendering logic

**New API Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/notifications/logs/read-all` | Batch mark all notification logs as read |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Tab hidden for extended period | Polling pauses; refetches on tab focus |
| Clear All with no unread notifications | No-op; empty state displayed |
| Notification with `action_url` clicked on dashboard | Navigates to `action_url` |
| Notification without `action_url` clicked on dashboard | Navigates to notifications inbox |
| Mark all read with 0 unread | Endpoint returns success; no DB writes |

### Membership — Department Emails, Username Safety & Default Roles (2026-03-24)

- **Department email generation at election**: When a prospect is elected to membership, the system generates a department email (e.g., john.smith@firedept.org) based on configurable format patterns. Four formats: `first.last`, `flast` (first-initial + last), `firstlast`, `last.first`. Collisions resolved with numeric suffix (john.smith2@firedept.org). Prospect's personal email preserved in `User.personal_email`
- **Username collision handling**: `_generate_unique_username()` checks for existing usernames and appends incrementing suffixes (jsmith, jsmith1, jsmith2). Manual username validation also enforced
- **Default member role**: All member creation paths (self-registration, admin creation, prospect transfer) now assign the default "member" role for baseline permissions
- **`password_changed_at` set on creation**: All creation paths set `password_changed_at` to creation time so HIPAA password age checks work from day one. Self-registered users get `must_change_password=True`
- **Membership ID auto-generation**: `generate_next_membership_id()` and `assign_next_membership_number()` added to OrganizationService. Previous membership numbers preserved on soft-delete and restored on reactivation
- **Transfer UX improvements**: Department email generation integrated into transfer workflow

**Data Model Changes:**

| Table/Field | Change | Description |
|-------------|--------|-------------|
| `users.personal_email` | New column | Stores personal email when department email becomes primary |
| `users.previous_membership_number` | New column | Preserves membership number on archive for reuse on reactivation |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Department email disabled in org settings | Uses prospect's personal email as primary |
| Username "jsmith" already exists | Generates "jsmith1", "jsmith2", etc. |
| Reactivated member with previous membership number | Previous number restored automatically |
| Member soft-deleted then new member uses same number | Original number stored in `previous_membership_number`; new member gets next available |
| Self-registered user without password change | `must_change_password=True` forces change on first login |

### WCAG Accessibility Improvements (2026-03-24)

- **Color contrast fixes (75 components)**: Light-mode semantic colors (`text-{color}-400/300`) replaced with WCAG AA-compliant variants (`text-{color}-700 dark:text-{color}-400`). Dark mode appearance unchanged
- **Color contrast utility**: New `utils/colorContrast.ts` with `hexToRgb()`, `rgbToHex()`, `relativeLuminance()`, `contrastRatio()`, `accessibleTextColor()`, `colorCardStyle()`. Ensures 4.5:1 contrast ratio across all themes
- **Form accessibility**: `htmlFor`/`id` associations on ~24 form inputs. `aria-required="true"` on required fields. `fieldset`/`legend` wrapping radio button groups across 7 components
- **Live regions**: `aria-live="assertive"` added to ~52 `role="alert"` elements. `role="status" aria-live="polite"` on loading spinners
- **Focus rings**: Fixed `DateRangePicker` date input focus outlines
- **Alt text**: Image previews in `FileDropzone` now include descriptive alt text
- **Camera error handling improvements**: `MemberScanPage` surfaces scanner errors via `tryStartScanner` wrapper. `InventoryScanModal` uses `getErrorMessage()` instead of generic string. Errors stay visible (no auto-dismiss)

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| High-contrast mode | Theme variables override; WCAG AAA (7:1) targeted where possible |
| Dark mode with light hex color | `accessibleTextColor()` iteratively lightens text until 4.5:1 |
| Screen reader on expandable roster rows | `aria-expanded` state announced on focus |
| Camera permission denied | Clear error message; manual entry fallback available |

### Camera Scanning — Desktop & Cross-Browser Support (2026-03-22)

- **Desktop camera scanning**: Camera-based scanning (QR codes, barcodes, member IDs) now works on desktop browsers by falling back to a user-facing camera when no environment-facing camera is detected. Previously limited to mobile devices
- **Shared camera infrastructure**: Extracted reusable `useHtml5Scanner` hook, shared `scanner.ts` types, and `camera.ts` constants. All scanner consumers (InventoryScanModal, MemberIdScannerModal, MemberScanPage) share the same camera initialization, error handling, and resolution logic
- **InventoryScanModal cross-browser support**: Inventory barcode scanning now works in all browsers via the shared scanner hook, not just those supporting the BarcodeDetector API

**New Shared Modules:**

| File | Purpose |
|------|---------|
| `frontend/src/hooks/useHtml5Scanner.ts` | Reusable HTML5 QR/barcode scanner hook with camera fallback logic |
| `frontend/src/types/scanner.ts` | TypeScript types for scanner configuration and callbacks |
| `frontend/src/constants/camera.ts` | Camera resolution presets, preferred facing modes, and error messages |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| No camera available | Displays a clear error message; does not silently fail |
| Desktop with only user-facing camera | Falls back to user-facing camera automatically |
| Browser without BarcodeDetector API | Uses Html5-QRCode library as fallback for barcode detection |
| Multiple cameras detected | Prefers environment-facing, falls back to user-facing |

### Scheduling — Permission Fixes & Shift Signup Improvements (2026-03-22)

- **Shift assignment permission fix**: Shift assignment UI was gated by `scheduling.manage_assignments` instead of the broader `scheduling.manage` — users with manage permission can now assign members to shifts
- **Self-signup visibility fix**: Open Shifts tab fallback permission and self-signup button visibility corrected for members without admin permissions
- **Calls/Incidents section removed**: Removed placeholder Calls/Incidents section from shift detail panel (feature not yet implemented)
- **Dashboard shift cleanup**: "My Upcoming Shifts" on the dashboard now correctly hides declined and cancelled shift assignments
- **Position editing in shift detail**: Officers can edit position assignments directly from the shift detail edit form without navigating elsewhere

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| User with `scheduling.manage` but not `scheduling.manage_assignments` | Can now assign members (permission broadened) |
| Declined shift in "My Upcoming Shifts" | No longer displayed on dashboard |
| Cancelled shift in "My Upcoming Shifts" | No longer displayed on dashboard |

### Inventory — Admin Hub Redesign, Kits & Variant Groups Pages, Barcode Printing (2026-03-22)

- **Inventory admin hub redesign**: Admin dashboard redesigned with grouped card sections and prominent navigation cards, replacing the previous flat list layout
- **Equipment Kits admin page**: New dedicated page at `/inventory/admin/kits` for managing equipment kit bundles (create, edit, delete, view components)
- **Variant Groups admin page**: New dedicated page at `/inventory/admin/variant-groups` for managing size/style variant groups
- **Barcode printing ISO compliance**: Label generation aligned with ISO/IEC 15417 standards — correct quiet zones, minimum bar widths, and aspect ratios for reliable scanner readability
- **Auto-rotation for thermal printers**: Roll-fed thermal printers (Dymo, Rollo) now auto-rotate labels to maximize print area when the label's long axis doesn't match the orientation
- **Test print capability**: New "Test Print" button generates a sample label for verifying printer alignment before printing a full batch
- **Unified label format catalog**: Frontend and backend now share the same label format definitions to prevent size mismatches between the UI preview and generated PDF
- **Batch label limit**: Label generation now enforces a maximum batch size to prevent browser memory issues with large print jobs
- **Inventory dashboard scoping**: Non-admin users now see only their own assigned equipment on the inventory dashboard, not the full department inventory
- **Mobile FAB fix**: Mobile floating action button changed from "Export CSV" (admin action) to "Assign Items" for non-admin users

**New Pages:**

| URL | Page | Permission |
|-----|------|------------|
| `/inventory/admin/kits` | Equipment Kits Management | `inventory.manage` |
| `/inventory/admin/variant-groups` | Variant Groups Management | `inventory.manage` |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Barcode with insufficient quiet zone | Labels now enforce ISO minimum quiet zones for scanner readability |
| Dymo label in landscape orientation | Auto-rotated to portrait for correct printing |
| Label batch > limit | Capped with warning message; user can print in batches |
| Non-admin viewing inventory dashboard | Shows only personally assigned equipment |
| Mobile user tapping FAB | Shows "Assign Items" instead of admin-only "Export CSV" |

### Elections — Eligibility, Email Improvements & Meeting Integration (2026-03-22)

- **Eligibility uses membership_type**: Election voter eligibility now correctly uses `User.membership_type` instead of role slugs, fixing incorrect voter filtering for departments with complex role structures
- **Email recipient tracking**: `email_recipients` field now tracks only successfully sent ballots (not attempted sends), giving accurate delivery counts
- **Election linked meeting filter**: Meeting dropdown on election pages now correctly shows only upcoming business meetings, not past ones
- **Concurrent ballot sending fix**: Ballot email dispatch uses concurrent sending with proper error isolation — one failed send does not block remaining recipients
- **Eligibility summary email**: Secretary receives a detailed summary after ballot dispatch listing sent count, skipped voters, and reasons for each skip
- **Secretary-facing error messages**: Election errors now include actionable guidance (e.g., "No active members with email addresses found" instead of generic failure)
- **Election report email**: New "Send Report Email" button on election detail page emails formatted round-by-round results to officers
- **Business meetings section**: Election detail page now displays upcoming business meetings for linking elections to meeting records
- **Code quality sweep**: Elections module refactored for code quality — removed dead code, fixed unused state variables, standardized error handling

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Member has role `emt` but membership_type `administrative` | Not eligible for `operational` ballot items (eligibility follows membership_type) |
| Email fails for one recipient | Loop continues; summary shows per-recipient delivery status |
| Election linked to past meeting | Past meetings filtered out of dropdown; only upcoming shown |
| No eligible voters after filtering | Returns descriptive error with reasons instead of false success |

### Events — Recurring Event Series, End Event, Admin Hours Integration (2026-03-22)

- **Rolling 12-month recurrence**: Recurring events can now use a rolling 12-month window that automatically extends the series forward, keeping future occurrences available without manual regeneration
- **Delete series support**: Officers can now delete an entire recurring event series at once, with confirmation dialog showing the number of events that will be removed
- **"End Event" button**: New bulk checkout feature — clicking "End Event" on the event detail page checks out all currently checked-in attendees at once, useful for events where individual checkout tracking isn't needed
- **Compact event create form**: Event creation form redesigned with a 2-column grid layout, pairing related sections (date/time, location, settings) side-by-side for reduced scrolling
- **Event-to-admin-hours integration**: Events can now be linked to admin hour tracking categories, automatically crediting attendance hours toward administrative compliance requirements
- **Event deletion FK fix**: Fixed event deletion failing when linked meeting minutes existed — cascade now properly handles the `meeting_minutes` foreign key constraint
- **Check-in monitoring consistency**: Fixed check-in monitoring page using different time window logic than the QR self-check-in page, causing valid check-ins to appear invalid on the monitoring dashboard
- **Event request form publish status**: Event request forms now display their publish status badge on the Events Settings page, making it clear which forms are publicly accessible

**Data Model Changes:**

| Table | Change | Description |
|-------|--------|-------------|
| `events` | `rolling_recurrence` (Boolean) | Enables rolling 12-month recurrence window |
| `event_hour_mappings` | New table | Maps event types to admin hour tracking categories |
| `admin_hours_requirements` | New table | Defines compliance requirements for admin hour categories |
| `meeting_minutes` | FK cascade update | `event_id` FK now cascades on delete |

**API Routes:**

| Method | Path | Description |
|--------|------|-------------|
| `DELETE` | `/api/v1/events/{id}/series` | Delete entire recurring event series |
| `POST` | `/api/v1/events/{id}/end` | Bulk checkout all checked-in attendees |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Rolling recurrence with no end date | Generates occurrences up to 12 months ahead, automatically refreshed |
| Delete series with some past events | All events in series removed (past and future) |
| "End Event" with no checked-in attendees | No-op with informational message |
| Event linked to meeting minutes then deleted | Meeting minutes `event_id` set to null via cascade |
| Admin hours integration with no mapping | Event attendance not credited; mapping must be configured in Events Settings |

### Notifications — Dashboard Clear/Dismiss & Department Messages (2026-03-22)

- **Notification clear/dismiss buttons**: Dashboard notification cards now include clear and dismiss buttons, allowing users to manage their notification queue without navigating to the full notifications page
- **Persistent department messages**: Administrators can create department-wide messages that persist until explicitly cleared by an admin. Regular users see the message but cannot dismiss it
- **Notification channel filter**: Notifications page now includes a channel filter (email, in-app, SMS) for viewing notifications by delivery method
- **Notifications page title**: Page title renamed for clarity

**Data Model Changes:**

| Table | Change | Description |
|-------|--------|-------------|
| `department_messages` | `is_persistent` (Boolean) | Marks messages that only admins can clear |

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Non-admin trying to clear persistent message | Clear button not shown; message remains |
| Admin clearing persistent message | Clears for all users department-wide |
| Notification with multiple channels | Appears in each channel's filter view |

### Email Deliverability — Gmail & Microsoft Compatibility (2026-03-22)

- **Message-ID header**: All outgoing emails now include a proper `Message-ID` header, preventing Gmail from rejecting messages as spam
- **Batch rate limiting**: Email sends are rate-limited per batch to avoid triggering Gmail and Microsoft bulk-send throttles
- **Inline CSS**: Email templates now inline all CSS styles, since Gmail strips `<style>` tags — ensures consistent rendering across email clients
- **SMTP connection reuse**: SMTP connections are reused within a batch send operation, improving performance for large recipient lists
- **Admin email template support**: Administrators can now send emails using saved templates directly from the admin interface
- **Gmail clipping fix**: Replaced base64-encoded logo data URIs with hosted image URLs, preventing Gmail from clipping long emails

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Gmail with strict DKIM/SPF | Message-ID header satisfies authentication checks |
| Batch > 50 recipients | Rate-limited to avoid triggering bulk-send throttles |
| Email client without CSS support | Inline styles ensure consistent rendering |
| Logo image not accessible | Falls back to text-only header with organization name |

### Mobile Responsiveness — Dashboard & Inventory (2026-03-22)

- **Main dashboard responsive redesign**: Dashboard layout adapts to phone and tablet screens with stacked cards, collapsible sections, and touch-friendly controls
- **Inventory module mobile improvements**: Inventory pages (items list, admin hub, member equipment) redesigned for mobile with card layouts, floating action button, and optimized touch targets
- **Non-inventory page improvements**: Scheduling, events, members, and settings pages received responsive improvements for consistent mobile experience

### Equipment Check Template Builder — UX Improvements (2026-03-22)

- **Template builder layout redesign**: Equipment check template builder reorganized for better visual hierarchy and workflow
- **Equipment check preview**: New preview mode shows how the check form will appear to members before saving the template
- **Save redirect fix**: Template builder now correctly redirects to the template list after saving instead of staying on the edit page
- **MissingGreenlet error fix**: Fixed async database access error when loading compartment data in the template builder
- **Input focus loss fix**: Fixed inputs in the template builder losing focus after each keystroke due to component re-rendering

**Edge Cases:**

| Scenario | Behavior |
|----------|----------|
| Preview with unsaved changes | Preview reflects current form state, not last saved state |
| Template with no compartments | Preview shows empty state with "Add compartments to get started" message |
| Rapid typing in item fields | Focus maintained correctly after re-render fix |

### Time Picker — Redesigned TimeQuarterHour Component (2026-03-22)

- **Separate hour/minute/AM-PM selects**: `TimeQuarterHour` component redesigned with three separate dropdown selects (hour 1-12, minute 00/15/30/45, AM/PM) replacing the previous single text input
- Applied across all time pickers: event forms, shift forms, scheduling templates

### Bug Fixes (2026-03-22)

- **Admin hours filter fix**: Fixed `??` (nullish coalescing) on filter values in admin hours page — replaced with `||` to properly coerce empty strings
- **Cross-tenant proxy authorization**: Fixed race condition and cross-tenant data access bugs in proxy voting authorization
- **JSON column mutation fixes**: Fixed three separate instances of SQLAlchemy JSON columns not persisting changes due to shallow copy mutations (attendee check-in, rollback history, election JSON data). All now use `copy.deepcopy()` pattern
- **Rollback notification error handling**: Rollback notification failures no longer cause 500 errors after a successful rollback operation
- **Audit event parameter fix**: Fixed `log_audit_event()` calls using incorrect parameter names across multiple endpoints
- **Compartment CRUD MissingGreenlet**: Fixed async database access error in equipment check compartment CRUD endpoints

### Code Quality (2026-03-22)

- **26 frontend test failures fixed**: All pre-existing test failures across the frontend test suite resolved
- **40 ESLint errors/warnings fixed**: Frontend ESLint output reduced from 40 errors/warnings to 0
- **Backend formatter pass**: Applied Black and isort formatting fixes across the entire backend codebase
- **Comment cleanup**: Removed comments that merely restate the code, per CLAUDE.md commenting guidelines
- **InventoryAdminHub tests updated**: Tests updated to match the redesigned admin hub component

### Equipment Check System — Full-Stack Vehicle & Equipment Inspections (2026-03-19)

- **Equipment check template builder**: Admin UI for creating structured checklist templates with nested compartments and items. Supports 7 check types: `pass_fail`, `present`, `functional`, `quantity`, `level`, `date_lot`, `reading`. Templates can be assigned per-apparatus or per-apparatus-type with optional position-based assignment. Drag-and-drop reordering of compartments and items
- **Vehicle check preset picker**: Pre-built templates for common vehicle inspection categories (engine, ladder, ambulance) that can be imported into the template builder
- **Phone-first equipment check form**: Hybrid mobile/desktop form for submitting equipment checks during a shift. Collects item results with pass/fail, quantities, readings, expiration dates, serial/lot numbers, and optional photo attachments (up to 3 per item, auto-optimized to WebP)
- **Equipment check reports page**: Three-tab reports interface — Compliance Dashboard (apparatus stats, pass rates, member compliance), Failure/Deficiency Log (paginated failures with filters), and Item Trend History (pass/fail trends by interval). Supports CSV and PDF export
- **Apparatus deficiency flag**: Apparatus records now track `has_deficiency` and `deficiency_since` fields. Equipment check failures auto-set the deficiency flag; passing checks auto-clear it
- **Failure notifications**: Failed equipment check items trigger in-app notifications (and optional email) to shift officers and configurable roles
- **Inline serial/lot number updates**: Submitting a check with new serial or lot numbers updates the template item's stored values for future reference
- **Photo attachments on check items**: Support for uploading photos per check item (JPEG, PNG, WebP), stored and served as optimized WebP

**Data Model Changes:**

| Table | New Columns/Tables | Description |
|-------|-------------------|-------------|
| `equipment_check_templates` | New table | Master template with name, timing (start/end of shift), type (equipment/vehicle/combined), assigned positions |
| `check_template_compartments` | New table | Named sections within a template (nested via `parent_compartment_id`) |
| `check_template_items` | New table | Individual check items with type, expiration tracking, serial/lot, quantity requirements |
| `shift_equipment_checks` | New table | Submitted check records linked to shifts |
| `shift_equipment_check_items` | New table | Individual item results within a submitted check |
| `apparatus` | `has_deficiency` (Boolean), `deficiency_since` (DateTime) | Deficiency tracking from equipment checks |

**API Routes:**

| Prefix | Description |
|--------|-------------|
| `POST /api/v1/equipment-checks/templates` | Template CRUD |
| `POST /api/v1/equipment-checks/templates/{id}/compartments` | Compartment management |
| `POST /api/v1/equipment-checks/compartments/{id}/items` | Item management |
| `GET /api/v1/equipment-checks/shifts/{shift_id}/checklists` | Get applicable checklists for a shift |
| `POST /api/v1/equipment-checks/shifts/{shift_id}/checks` | Submit equipment check |
| `GET /api/v1/equipment-checks/my-checklists` | Member's pending and recent checklists |
| `POST /api/v1/equipment-checks/checks/{id}/items/{item_id}/photos` | Photo upload |
| `GET /api/v1/equipment-checks/reports/*` | Compliance, failures, trends, CSV/PDF export |

**Edge Cases:**
- Templates with `template_type: vehicle` show the vehicle check preset picker; `equipment` templates show standard items
- Empty compartments are allowed (for future item population)
- Expired items (`has_expiration: true` with past `expiration_date`) auto-fail regardless of the submitted result
- Items below `required_quantity` auto-fail
- A single failed item marks the entire apparatus as deficient; the flag clears only when a subsequent full check passes all items
- Photo uploads are limited to 3 per item per check; larger files are rejected (max 10 MB each)
- Position-based assignment means only members assigned to those positions see the checklist on their shift

### Scheduling Module — Position Eligibility, Admin Sub-Pages & Timezone Fixes (2026-03-19)

- **Shift position eligibility system**: Operational ranks now define `eligible_positions` — a list of shift positions each rank is qualified for. When signing up for open shifts, members only see positions their rank allows. Dashboard shift signup validates against eligibility. Existing ranks backfilled with default eligible positions via migration
- **Rank eligible positions UI redesign**: Settings page shows a clear matrix of ranks × positions with toggle controls
- **Scheduling admin sub-pages**: Admin tabs (Templates, Patterns, Reports, Settings) extracted into dedicated routed pages under `/scheduling/templates`, `/scheduling/patterns`, `/scheduling/reports`, `/scheduling/settings` with back navigation and `ProtectedRoute` gating
- **Shift settings tabbed sub-navigation**: Settings page reorganized into tabbed sections for better organization
- **Structured position slots**: Shifts now define required and optional position slots with decline notifications
- **Open slot visibility**: When members decline or are removed, open slots are shown for re-assignment
- **Position editing in shift detail**: Officers can edit position assignments directly in the shift detail edit form
- **Dashboard shift display fixes**: Dashboard no longer shows shifts the user already signed up for, hides declined/cancelled shifts from "My Upcoming Shifts", and fixes the 422 error from sending invalid `general` position on signup
- **Shift signup re-enrollment**: Members who previously cancelled can now re-sign up for the same shift
- **Attendee count fix**: Cancelled and no-show assignments no longer inflate the displayed attendee count
- **Shift timezone fixes**: Fixed naive local times being sent as UTC when creating shifts from the scheduling page. Fixed template-based shift generation ignoring org timezone. Fixed naive datetime construction across 7 backend services
- **UTC response schema refactor**: Introduced `UTCResponseBase` class — all scheduling response schemas inherit from it to automatically stamp naive datetimes with UTC timezone markers

**Data Model Changes:**

| Table | New Columns | Description |
|-------|-------------|-------------|
| `operational_ranks` | `eligible_positions` (JSON) | List of shift positions this rank is qualified for |
| `shift_assignments` | `position_slot_id` (String, nullable) | Links assignment to a structured position slot |

**New Pages:**

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling/templates` | Scheduling Templates | `scheduling.manage` |
| `/scheduling/patterns` | Scheduling Patterns | `scheduling.manage` |
| `/scheduling/reports` | Scheduling Reports | `scheduling.manage` |
| `/scheduling/settings` | Scheduling Settings | `scheduling.manage` |
| `/scheduling/equipment-check-templates/new` | Equipment Check Template Builder | `equipment_check.manage` |
| `/scheduling/equipment-check-templates/:templateId` | Edit Equipment Check Template | `equipment_check.manage` |
| `/scheduling/equipment-check-reports` | Equipment Check Reports | `equipment_check.manage` |

**Edge Cases:**
- Ranks with no `eligible_positions` defined default to all positions being eligible (backward-compatible)
- Dashboard signup button only appears for shifts with open positions the member's rank qualifies for
- Previously cancelled signups are cleaned up before re-enrollment to avoid duplicate constraint violations
- Shift create from scheduling page now converts local times to UTC using org timezone before sending to API
- Template-generated shifts inherit timezone-correct start/end times

### Elections Module — Hardening, Audit Logging & Email Improvements (2026-03-19)

- **Comprehensive audit logging**: All election state changes (create, open, close, certify, cancel, extend, rollback) now generate audit log entries with actor, action, and metadata
- **Response model standardization**: All election response schemas now use `UTCResponseBase` for consistent datetime serialization with UTC timezone markers
- **Quorum fields**: Election responses now include `quorum_required` and `quorum_met` fields
- **Race condition fixes**: Proxy authorization and vote casting now use database-level locking to prevent concurrent modification. Cross-tenant data access blocked with organization_id filtering
- **JSON column mutation fixes**: Fixed `rollback_history` and `attendee check-in` not persisting due to in-place JSON mutation without `flag_modified()`. Uses `copy.deepcopy()` pattern
- **Ballot sending reliability**: Fixed ballot emails silently returning 0 recipients — root cause was `User.is_active` property not being queryable in SQLAlchemy filters; converted to `hybrid_property`. Added exception handling per-recipient in send loop to prevent partial delivery failures. Added diagnostic logging for skipped voters
- **Eligibility summary email**: After dispatching ballots, the secretary receives a summary email listing all skipped voters with reasons (no email, ineligible, already voted)
- **Secretary-facing error messages**: Election error messages now include actionable details (e.g., "Election has no candidates" instead of generic "cannot open election")
- **Election report email**: Officers can email election results as a formatted report
- **Upcoming business meetings section**: Election detail page shows upcoming business meetings for linking elections to meeting records
- **Linked meetings filter**: Elections linked to meetings now correctly show only upcoming meetings (not past ones)
- **Extend modal date display fix**: Fixed incorrect date formatting in the election extension modal
- **Safe error handling**: All elections endpoints wrapped with `safe_error_detail()` for consistent, sanitized error responses
- **Empty string form value fix**: Optional election form fields use `||` instead of `??` to coerce empty strings

**Edge Cases:**
- Ballot email send loop catches per-recipient exceptions so one failed email doesn't block remaining recipients
- Proxy authorization checks organization_id to prevent cross-tenant abuse
- Rollback history uses `copy.deepcopy()` before appending to prevent SQLAlchemy silent no-op
- Elections with only ballot items (no candidates) can be opened — `open_election` no longer requires candidates
- Eligibility summary email is sent only to the user who triggered the ballot dispatch
- If no voters are found after filtering, the API returns a descriptive error instead of a false success with 0 recipients

### Dark Mode & High-Contrast Hardening (2026-03-18)

- **Opaque backgrounds for all floating UI**: Overlays, dropdowns, drawer panels, and sticky elements now use opaque backgrounds in dark mode instead of transparent/semi-transparent backgrounds that caused content bleed-through
- **Dark mode variants across 25+ files**: Added missing `dark:` Tailwind variants for icon badges, stat cards, settings UI, form inputs, and table rows
- **High-contrast mode support**: Additional high-contrast variants for accessibility compliance

### Event Notifications — In-App Delivery (2026-03-17)

- **In-app notification delivery**: Event notifications (announcement, reminder, follow-up, missed_event, check_in_confirmation) now deliver via in-app notifications in addition to email. Notifications appear in the member's notification bell

### Time Picker Standardization (2026-03-17)

- **15-minute increment enforcement**: All time pickers across the application (event forms, shift forms, scheduling) now restrict to quarter-hour increments (`:00`, `:15`, `:30`, `:45`), consistent with the `DateTimeQuarterHour` component

### Check-In Timing Fix (2026-03-17)

- **QR display and self-check-in timing mismatch**: Fixed a bug where the QR code display page and the self-check-in page used different datetime sources for the check-in window, causing valid check-ins to be rejected as outside the window

### UTC Timezone Marker — API Response Schemas (2026-03-16)

- **Naive datetime UTC stamping in API responses**: All API response schemas now inherit from `UTCResponseBase` which automatically stamps naive `datetime` fields with UTC timezone info (`+00:00` suffix). This ensures JavaScript's `new Date()` correctly interprets times as UTC rather than local time, fixing the root cause of timezone display bugs across the frontend
- **Scheduling-specific fix**: Scheduling response schemas were the first to receive the fix, then extended to all modules via the shared base class
- **SQLAlchemy `load` event listener**: The existing ORM-level fix (stamping naive datetimes on load) is complemented by the schema-level fix for comprehensive coverage

**Edge Cases:**
- Response schemas with `Optional[datetime]` fields skip stamping when the value is `None`
- The `UTCResponseBase` validator runs as a `model_validator(mode="before")` so it processes raw dict data before Pydantic validation
- Existing frontend code using `formatDate()`/`formatDateTime()` utilities works correctly with both `Z` and `+00:00` suffixed timestamps

### Training Module — Recurring Sessions & Quarter-Hour Time Picker (2026-03-15)

- **Recurring training sessions**: Training sessions can now recur using the same recurrence infrastructure as events (daily, weekly, biweekly, monthly, monthly_weekday, annually, annually_weekday, custom patterns). Backend creates recurring events via `EventService` and links a `TrainingSession` to each occurrence. Selecting an existing course auto-populates training type, credit hours, instructor, expiration months, and max participants with a preview card
- **Quarter-hour time picker (`DateTimeQuarterHour`)**: Replaces browser `datetime-local` inputs (which ignore `step="900"`) with a custom component splitting date/time into a native date picker and a select dropdown restricted to `:00`, `:15`, `:30`, `:45`. New reusable UX component in `components/ux/DateTimeQuarterHour.tsx`
- **Quick duration buttons**: 1-hour, 2-hour, 4-hour, and 8-hour buttons after the date/time fields, matching the pattern in `EventForm` and `ElectionsPage`. Buttons appear once a start date is set and auto-populate end date/time
- **Course auto-populate**: Selecting an existing course in the session form auto-fills training type, credit hours, instructor, expiration months, and max participants with a details preview card
- **Location selector stale closure fix**: `updateField()` was using `{ ...formData }` which captured a stale closure reference. Switched to functional `setState: prev => ({ ...prev })` to prevent second call from overwriting first
- **Training pipeline save fix**: Added missing `program_requirements` relationship to `TrainingProgram` model and `program` back_populates to `ProgramRequirement`. Moved `/requirements/registries` and `/requirements/import/{registry_name}` routes before `/requirements/{requirement_id}` to fix route ordering (FastAPI was matching "registries" as a UUID)
- **UUID comparison fix**: Fixed 12 instances where UUID objects from Pydantic schemas were compared directly against `String(36)` database columns without `str()` conversion in `training_program_service.py`. With aiomysql, UUID objects aren't auto-coerced, causing queries to silently return no results

**Edge Cases:**
- Recurring training sessions create one event per occurrence with a linked training session record — deleting the parent event does not cascade-delete the training session
- Quarter-hour picker enforces `:00`/`:15`/`:30`/`:45` only; arbitrary minute values from imported data are rounded to the nearest quarter
- Course auto-populate fills all fields but does not lock them — users can override any auto-filled value
- Quick duration buttons are disabled until a start date is selected
- The stale closure bug only manifested when two `updateField()` calls fired in the same render cycle (e.g., setting `location_id` then clearing `location`)

### Scheduling Module — Template Positions & Timezone Fixes (2026-03-15)

- **Template positions carry to crew roster**: Shift templates with defined `positions` and `min_staffing` now persist these values to created shifts. Both direct creation and pattern-based generation pass template staffing requirements through. The ShiftDetailPanel falls back to shift-level positions when apparatus has none defined
- **Shift timezone display fix**: `ShiftReportsTab` was using UTC (`toISOString()`) instead of local timezone; now uses `getTodayLocalDate(tz)`. `ShiftDetailPanel` edit form was extracting time from the UTC ISO string instead of converting to local timezone via `Intl.DateTimeFormat`
- **`toTimeValue` local timezone fix**: The `toTimeValue` function was extracting `HH:MM` by string-splitting the ISO datetime on `'T'`, returning the UTC time portion. For a shift starting at 2:30 PM Eastern (18:30 UTC), the edit form would show 18:30 instead of 14:30. Now uses `Intl.DateTimeFormat` with the user's timezone for local `HH:MM`, and `localToUTC()` when saving edits
- **Alembic migration**: New migration adds `positions` (JSON) and `min_staffing` (Integer) columns to the `shifts` table

**Data Model Changes:**

| Table | New Columns | Description |
|-------|-------------|-------------|
| `shifts` | `positions` (JSON, nullable) | Position definitions inherited from template |
| `shifts` | `min_staffing` (Integer, nullable) | Minimum staffing level inherited from template |

**Edge Cases:**
- Shifts created before this migration have `NULL` for both columns — the UI falls back to apparatus-level positions
- `toTimeValue` with a missing or invalid datetime returns an empty string instead of crashing
- Template positions are copied at shift creation time; subsequent template edits do not retroactively update existing shifts

### Inventory — Size/Style Auto-Generation on Item Creation (2026-03-14)

- **Auto-generate size/style variants**: When creating a new uniform or PPE item, users can toggle "Generate Sizes & Styles" to select multiple standard sizes and garment styles. The backend creates one pool item per `size × color × style` combination, sets the `standard_size` and `style` enum fields on each generated item, and automatically groups them under a new `ItemVariantGroup`
- **Frontend chip-based multi-select**: New UI with chip-based multi-select for sizes (`STANDARD_SIZES`) and styles (`GARMENT_STYLES`), comma-separated colors input, live preview of item count, and automatic call to `createSizeVariants` endpoint
- **Backend schema extension**: `SizeVariantCreate` schema now includes `styles` list and `create_variant_group` flag. `SizeVariantCreateResponse` includes `variant_group_id`

**Edge Cases:**
- Empty styles list defaults to `['regular']` to always generate at least one variant per size/color
- Empty colors list defaults to `['default']` to always generate at least one variant per size/style
- Duplicate variant groups are prevented by checking for existing groups with the same base item name
- The live preview count updates immediately as sizes, styles, and colors change: `count = sizes.length × colors.length × styles.length`

### UTC Datetime Display — Root Cause Fix (2026-03-14)

- **Root cause fix for UTC datetime display bug**: MySQL `DATETIME` columns don't store timezone info, so aiomysql returns naive Python datetime objects. Pydantic serialized them without a `'Z'` or `'+00:00'` suffix. JavaScript's `new Date()` treats strings without timezone indicators as local time, making the frontend's UTC-to-local conversion a no-op — times appeared shifted by the user's UTC offset
- **SQLAlchemy `load` event listener**: Added a listener on `Base` that stamps all naive `DateTime(timezone=True)` columns with UTC tzinfo immediately after ORM hydration. Uses `set_committed_value()` instead of `object.__setattr__()` to properly integrate with SQLAlchemy's attribute tracking without marking the object dirty
- **ESLint timezone enforcement**: New custom ESLint rules ban `.toLocaleString()`, `.toLocaleDateString()`, `.toLocaleTimeString()`, `import { ... } from 'date-fns'`, and `new Date().toISOString().slice(0,10)`. Enforces use of `dateFormatting.ts` utilities with explicit timezone parameter
- **34 files updated**: All remaining `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString` calls replaced with `formatDate()`/`formatDateTime()`/`formatTime()`/`formatNumber()`/`formatCurrency()` utilities across admin hours, grants-fundraising, inventory, facilities, scheduling, compliance, reports, and platform analytics

**Edge Cases:**
- The `load` event listener only stamps columns declared with `DateTime(timezone=True)` — plain `DateTime` columns are left unchanged
- `set_committed_value()` does not trigger a flush or mark the instance as dirty, preventing unnecessary database writes
- `formatNumber()` replaces numeric `.toLocaleString()` calls (used for formatting quantities and currency) — this is a different use case from date formatting

### Prospective Members Pipeline — Pipeline Reports, Email UX & Days-in-Stage (2026-03-14)

- **Pipeline overview report with configurable stage grouping**: New report renderer (`PipelineOverviewRenderer`) shows prospect counts per pipeline stage. Configurable stage groups (via `ReportStageGroupsEditor`) allow combining multiple stages into labeled groups (e.g., "Early Stages" = Application + Interview). New `report_stage_groups` column on pipeline steps with migration
- **Drag-and-drop section reordering for pipeline emails**: Email section order in pipeline email configuration can now be rearranged via drag-and-drop. Reordering updates `section_order` array. O(1) lookup optimization for section rendering with narrower `React.memo` dependencies
- **Email preview panel**: Preview rendered email content before sending. Shows subject, sections, and styling as they will appear to the recipient
- **Days-in-stage server-side calculation**: Days-in-stage for prospects was previously hardcoded to 0. Now computed server-side by calculating the difference between the current time and the prospect's `updated_at` timestamp
- **Pipeline step hover state fix**: Inactive step buttons had identical base and hover colors (`text-theme-text-muted` for both), providing no visual feedback. Fixed to show a visible hover state
- **Auto-advance for all applicable stage types**: Auto-advance option (`auto_advance` boolean) extended to all applicable pipeline stage types, not just form submission and document upload
- **Automated email trigger reliability**: Fixed 4 separate issues preventing automated emails from sending when prospects advance to email stages: step_type mapping mismatch, auto-advance not triggering email, email config not loading, and missing email content validation

**Edge Cases:**
- Stage groups with zero prospects are still displayed in the report (with count 0) for completeness
- Drag-and-drop reordering preserves section content — only the display order changes
- Days-in-stage calculation uses `updated_at` (not `created_at`) so that moving a prospect to a new stage resets the counter
- Auto-advance to an email stage both advances the prospect AND sends the configured email in a single operation
- If automated email sending fails, the prospect is still advanced — email failure does not block stage progression

### Events Module — Series End Reminders & Check-In Fix (2026-03-14)

- **Series end email reminders**: When a recurring event series is nearing its end date, organizers receive an email reminder to extend or close the series
- **Recurring event creation crash fix**: Fixed crash when creating recurring events with certain recurrence patterns that generated dates beyond the series end date
- **Check-in modal fix**: Added missing `GET /api/v1/events/{id}/eligible-members` endpoint that the check-in modal was calling. Fixed modal overlay z-index so the check-in modal is always above the backdrop
- **EventForm timezone bug fix**: Fixed date arithmetic and conflict detection in `EventForm` to use timezone-aware calculations instead of raw UTC comparisons

**Edge Cases:**
- Series end reminders are sent 7 days before the last occurrence — if the series has already ended, no reminder is sent
- The eligible-members endpoint returns only members who haven't already checked in to the event
- Conflict detection now correctly identifies overlaps when events span midnight in the organization's timezone

### Non-Dismissable Modal Overlay Fix (2026-03-14)

- **Fix non-dismissable modal overlays across the app**: All modals with backdrop-click and relative z-index issues fixed. Affected modals: EventDetailPage (7 modals — RSVP, Cancel Event, Cancel Series, Record Times, Override Attendance, Delete Confirm, Save Template), and modals in inventory, scheduling, and prospective members modules. Added `onClick` handler on backdrop and `relative z-10` on content panel

**Edge Cases:**
- Nested modals (e.g., confirmation dialog inside a form modal) maintain correct stacking order via incremental `z-index`
- Clicking the backdrop of a form modal with unsaved changes triggers the standard discard confirmation before closing

### Code Quality & Deduplication (2026-03-14)

- **Backend error handling utilities**: New `ensure_found()` and `handle_service_errors()` helpers in `core/utils.py` replacing repetitive try/except/raise patterns across endpoint files. IP security endpoints fully refactored to use new utilities
- **Shared `PaginationParams`**: Extracted common pagination query parameters into a reusable dependency
- **Shared schema configs**: Extracted repeated Pydantic `model_config` patterns into shared `CAMEL_CASE_CONFIG`
- **`formatCurrency` consolidation**: Unified currency formatting across frontend modules into `utils/currencyFormatting.ts`
- **Frontend deduplication**: `LogoutConfirmModal` extracted into shared component; redundant utility functions consolidated
- **Ballot email diagnostics**: Admin election page now shows reasons why present members didn't receive a ballot email (e.g., no email address, ineligible, already voted)
- **Naive/aware datetime fix**: Fixed `can't subtract offset-naive and offset-aware datetimes` crash in prospective members list by adding `_ensure_utc()` helper to normalize naive timestamps before arithmetic

### Prospective Members Pipeline — Auto-Advance & Stage Regression (2026-03-14)

- **Auto-advance for form submission and document upload stages**: Pipeline stages of type `form_submission` or `document_upload` can now be configured to auto-advance the prospect when the form is submitted or documents are uploaded. New `auto_advance` boolean field in `FormStageConfig` and `DocumentStageConfig` interfaces, toggled via checkbox in StageConfigModal
- **Move prospects back to a previous stage**: Coordinators can now regress a prospect to the previous pipeline stage from the Applicant Detail Drawer. New `POST /api/v1/membership-pipeline/prospects/{id}/regress` endpoint. Activity logged as `prospect_regressed` with source and target stage details
- **Automated email trigger on stage advance**: When a prospect is advanced to an `automated_email` stage, the system now automatically sends the configured email. Email content is built from stage config: subject, welcome message, FAQ link, next meeting details, custom sections, and status tracker. All user inputs are HTML-escaped for security
- **Email pipeline reliability improvements**: 9 fixes across the email pipeline — SMTP credential decryption, async SMTP processing, org context injection, SSL/TLS support for Gmail/Office365/self-hosted, welcome email templates, onboarding email config persistence to org settings, route ordering for `/scheduled` endpoint, Redis claim cleanup on shutdown, and polling interval reduced from 5 minutes to 60 seconds

**Edge Cases:**
- Auto-advance only triggers when the stage condition is fulfilled; the `auto_advance` config flag must be explicitly set to `true` (defaults to `false`)
- Regression is blocked if the prospect is already at the first pipeline stage — the prospect is returned unchanged
- Regression resets the previous step's progress to `IN_PROGRESS`
- Email sending failures are logged and the email is marked `FAILED` with an error message; it does not block stage advancement
- Redis lock (TTL 120s) prevents duplicate emails from concurrent workers
- Stale Redis claims from crashed workers are automatically recovered instead of permanently blocking the email loop

### Prospective Members Pipeline — Activity Log Fix (2026-03-13)

- **Fix IntegrityError on prospect activity log**: Automated pipeline actions (e.g., stage advancement by the system) were setting `performed_by` to the string `'system'`, which violated the foreign key constraint to the `users` table. Fixed to use `None` instead, which the `nullable=True` column supports

### Events Module — Comprehensive Enhancements (2026-03-13)

- **Quick-create events**: Streamlined event creation flow with minimal required fields (title, date, time) and sensible defaults for all other fields
- **Rich text descriptions**: Event descriptions now support rich text formatting via a WYSIWYG editor
- **Split EventDetailPage**: Event detail page refactored into focused sub-components: `EventAttachmentsList`, `EventNotificationPanel`, `EventRSVPSection`, `EventRecurrenceInfo`
- **Calendar view**: New `CalendarView` component showing a monthly calendar grid with event dots, day highlighting, collapsible daily event lists, timezone support, and navigation between months
- **Event templates management page**: Dedicated `EventTemplatesPage` for creating, editing, toggling, and deleting event templates with list view, form modal, and delete confirmation
- **Event analytics dashboard**: New `EventAnalyticsPage` with summary cards (total events, RSVPs, check-ins, attendance rate, avg check-in time), event type distribution bar chart, monthly trends line chart, and top events by attendance table with date range filtering
- **RSVP history tracking**: Collapsible RSVP activity history feed on the event detail page showing all RSVP changes with timestamps
- **Dietary/accessibility RSVP fields**: RSVP form now collects dietary restrictions and accessibility requirements from attendees
- **Series overview & navigation**: Recurring event detail pages show series badge, "View All in Series" link, and series management actions
- **Directions link**: Event detail page includes a map/directions link for events with a location
- **Dashboard widget**: Events widget on the main dashboard showing upcoming events
- **Recurrence editing**: Edit recurrence pattern on existing events; "Edit All Future" updates only future occurrences
- **Recurrence exceptions**: Individual occurrences can be excluded from a recurring series without affecting other occurrences
- **Duplicate/bulk actions**: Duplicate an event with one click; bulk actions for managing multiple events
- **Draft/publish workflow**: Events can be saved as drafts and published when ready
- **Save as template**: Save any event configuration as a reusable template
- **Enhanced search**: Full-text search across event titles, descriptions, and locations
- **My Events filter**: Filter events to show only those the current user has RSVP'd to
- **Sort options**: Sort events by date, title, attendance, or creation date
- **Conflict detection**: Warning when creating events that overlap with existing events at the same location
- **Timezone labels**: All event times display with timezone abbreviation labels
- **Waitlist system**: Events at capacity automatically waitlist new RSVPs; waitlisted attendees are promoted when spots open
- **RSVP countdown**: Shows time remaining until RSVP deadline
- **CSV export**: Export event attendee list as CSV
- **Print roster**: Print-formatted attendee roster for on-site use
- **Series RSVP**: RSVP to all events in a recurring series at once
- **Inline RSVP**: RSVP directly from the events list without opening the detail page
- **Attendance display**: Visual attendance count and capacity bar on event cards
- **Template picker**: Quick-select from existing templates when creating a new event
- **Attachments display**: Dedicated attachments panel on event detail page
- **Capacity bar**: Visual progress bar showing RSVP count vs. capacity
- **Calendar export**: Export events to iCal/Google Calendar format
- **Non-respondent reminders**: Send targeted reminder notifications to members who haven't RSVP'd
- **CSV import**: Import events from CSV files for bulk event creation
- **Saved filter presets**: Save and recall frequently used event filter combinations
- **File upload UI**: Upload attachments (flyers, agendas, maps) directly to events
- **Event notification panel**: Send targeted notifications (announcements, reminders, follow-ups, missed-event alerts) to specific audiences (all, going, not responded, checked in, not checked in)

**Edge Cases:**
- Waitlisted attendees are promoted in RSVP order when spots open
- Draft events are not visible to non-admin users
- Conflict detection only warns — it does not block event creation (departments may intentionally schedule concurrent events)
- Recurrence exceptions are tracked per-occurrence; deleting the exception restores the occurrence
- CSV import validates required fields (title, date) and skips invalid rows with error reporting
- Calendar export respects the user's timezone setting
- Non-respondent reminders exclude members who have already responded (going, not going, or maybe)
- Template picker shows only active templates; deactivated templates are hidden but not deleted

### Medical Screening Module (2026-03-13)

- **New medical screening module**: Full-stack module for tracking medical screenings, physicals, drug tests, fitness assessments, and psychological evaluations for members and prospects
- **Screening types**: `PHYSICAL_EXAM`, `MEDICAL_CLEARANCE`, `DRUG_SCREENING`, `VISION_HEARING`, `FITNESS_ASSESSMENT`, `PSYCHOLOGICAL`
- **Screening statuses**: `SCHEDULED`, `COMPLETED`, `PASSED`, `FAILED`, `PENDING_REVIEW`, `WAIVED`, `EXPIRED`
- **Screening requirements**: Organization-level requirements with configurable frequency (months), role applicability (JSON), grace period, and active/inactive toggle
- **Screening records**: Individual records linked to either a user or prospect (not both), with scheduled/completed dates, expiration tracking, provider info, result data (JSON), and reviewer chain
- **Compliance tracking**: Per-user and per-prospect compliance summary endpoints showing which screenings are current, expiring, or overdue
- **Expiring screenings alert**: Query screenings expiring within a configurable window (1-365 days)
- **Frontend**: `MedicalScreeningPage` with compliance dashboard, screening record form, and requirement configuration form
- **Permissions**: `medical_screening.view`, `medical_screening.manage`
- **Feature flag**: `MODULE_MEDICAL_SCREENING_ENABLED`

**API Endpoints:**

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/medical-screening/requirements` | `view` | List requirements (filter: is_active, screening_type) |
| `GET` | `/api/v1/medical-screening/requirements/{id}` | `view` | Get requirement |
| `POST` | `/api/v1/medical-screening/requirements` | `manage` | Create requirement |
| `PUT` | `/api/v1/medical-screening/requirements/{id}` | `manage` | Update requirement |
| `DELETE` | `/api/v1/medical-screening/requirements/{id}` | `manage` | Delete requirement |
| `GET` | `/api/v1/medical-screening/records` | `view` | List records (filter: user_id, prospect_id, type, status) |
| `GET` | `/api/v1/medical-screening/records/{id}` | `view` | Get record |
| `POST` | `/api/v1/medical-screening/records` | `manage` | Create record |
| `PUT` | `/api/v1/medical-screening/records/{id}` | `manage` | Update record |
| `DELETE` | `/api/v1/medical-screening/records/{id}` | `manage` | Delete record |
| `GET` | `/api/v1/medical-screening/compliance/{user_id}` | `view` | User compliance summary |
| `GET` | `/api/v1/medical-screening/compliance/prospect/{prospect_id}` | `view` | Prospect compliance summary |
| `GET` | `/api/v1/medical-screening/expiring` | `view` | Expiring screenings (query: days=30) |

**Data Models:**

| Table | Key Columns |
|-------|-------------|
| `screening_requirements` | id, organization_id, name, screening_type, frequency_months, applies_to_roles (JSON), grace_period_days, is_active |
| `screening_records` | id, organization_id, requirement_id, user_id (nullable), prospect_id (nullable), screening_type, status, scheduled_date, completed_date, expiration_date, provider_name, result_summary, result_data (JSON), reviewed_by, reviewed_at, notes |

**Edge Cases:**
- A screening record must link to either `user_id` or `prospect_id`, never both — the service validates this constraint
- `frequency_months = NULL` indicates a one-time screening that does not recur
- Grace period (default 30 days) is applied to expiration calculations before marking non-compliant
- Expiring endpoint accepts `days` query parameter clamped between 1 and 365
- Screenings for prospects are preserved when the prospect is converted to a member (records are re-linked to the new user_id)

### Compliance Requirements Configuration (2026-03-13)

- **Compliance configuration page**: New `ComplianceRequirementsConfigPage` for configuring organization-wide compliance thresholds, profiles, and automated reporting
- **Threshold types**: `PERCENTAGE` (compliance based on % of requirements met) or `ALL_REQUIRED` (every requirement must be met)
- **Compliance profiles**: Named profiles targeting specific membership types and roles, with optional threshold overrides, required/optional requirement lists, priority ordering, and active/inactive toggle
- **Automated reporting**: Schedule compliance reports monthly, quarterly, or yearly with configurable email recipients and day-of-month
- **Report generation**: On-demand or scheduled report generation with status tracking (`PENDING` → `GENERATING` → `COMPLETED`/`FAILED`), email delivery, and stored report data (JSON)
- **Dashboard nav link**: Compliance configuration is now linked from the compliance officer dashboard

**API Endpoints:**

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/compliance/config` | `training.manage` | Get org compliance config |
| `PUT` | `/api/v1/compliance/config` | `settings.manage` | Create/update compliance config |
| `POST` | `/api/v1/compliance/config/initialize` | `settings.manage` | First-time setup |
| `GET` | `/api/v1/compliance/config/requirements` | `training.manage` | Available training requirements |
| `POST` | `/api/v1/compliance/config/profiles` | `settings.manage` | Create compliance profile |
| `PUT` | `/api/v1/compliance/config/profiles/{id}` | `settings.manage` | Update compliance profile |
| `DELETE` | `/api/v1/compliance/config/profiles/{id}` | `settings.manage` | Delete compliance profile |
| `POST` | `/api/v1/compliance/reports/generate` | `training.manage` | Generate report |
| `GET` | `/api/v1/compliance/reports` | `training.manage` | List stored reports |

**Data Models:**

| Table | Key Columns |
|-------|-------------|
| `compliance_configs` | id, organization_id (unique), threshold_type, compliant_threshold (100.0), at_risk_threshold (75.0), grace_period_days (0), auto_report_frequency, report_email_recipients (JSON), notify_non_compliant_members, notify_days_before_deadline (JSON) |
| `compliance_profiles` | id, config_id, name, membership_types (JSON), role_ids (JSON), threshold overrides, required/optional requirement_ids (JSON), priority, is_active |
| `compliance_reports` | id, organization_id, report_type, period_label/year/month, status, report_data (JSON), summary (JSON), emailed_to (JSON), generated_by, generation_duration_ms |

**Edge Cases:**
- First-time initialization via `/config/initialize` raises an error if config already exists — use `PUT /config` for updates
- Profiles with overlapping membership types or roles are resolved by priority ordering
- Profile threshold overrides (null = use org default) allow different compliance standards per role
- Report generation failures set status to `FAILED` with error_message; failed reports can be regenerated
- Grace period is applied to deadline calculations before marking members non-compliant
- `notify_days_before_deadline` is a JSON array allowing multiple notification lead times (e.g., [30, 14, 7])

### Pipeline Email Configuration Improvements (2026-03-13)

- **Custom section add/edit reliability**: Fixed custom section creation and editing in pipeline email stage configuration — sections now persist correctly when adding new ones or editing existing ones
- **Email config persistence from onboarding**: SMTP settings configured during onboarding are now persisted to the organization's settings, ensuring email functionality works after initial setup without reconfiguration

### Scheduled Email System Hardening (2026-03-13–14)

- **SMTP provider compatibility**: Fixed SMTP sending for Gmail (STARTTLS on port 587), Office 365 (STARTTLS on port 587), and self-hosted servers (SSL on port 465 or plain on port 25). New `EMAIL_USE_SSL` env var for explicit SSL mode selection
- **SMTP credential decryption**: Email service now correctly decrypts stored SMTP credentials before attempting connection; previously was sending encrypted strings as passwords
- **Missing org context**: Email processing now loads full organization context (name, settings, logo) before sending, preventing template rendering errors
- **Route ordering fix**: `GET /api/v1/email-templates/scheduled` moved before `GET /api/v1/email-templates/{template_id}` to prevent FastAPI from matching "scheduled" as a template ID
- **Scheduled email date handling**: Removed server-side UTC-based future checks that incorrectly rejected emails scheduled in the user's local timezone. Date picker now uses local date for min constraint instead of UTC
- **Scheduled email time display**: Scheduled emails now display times in the user's local timezone instead of raw UTC
- **Redis claim recovery**: Scheduled email background loop no longer gives up permanently when encountering a stale Redis claim from a crashed worker — it reclaims after TTL expiry
- **Redis key cleanup on shutdown**: Application shutdown now explicitly deletes the scheduled email Redis claim key
- **Message history cleanup**: Added message history cleanup, date filtering, and email validation to the scheduled email pipeline

**Edge Cases:**
- Gmail requires STARTTLS (not SSL) on port 587 with an app password — `EMAIL_USE_SSL=false` is the correct setting
- Office 365 uses the same STARTTLS pattern as Gmail on port 587
- Self-hosted SMTP servers may use SSL on port 465 (`EMAIL_USE_SSL=true`) or plain SMTP on port 25
- If a Redis claim from a crashed worker is found, the scheduler waits for TTL expiry then reclaims rather than exiting
- Organizations without configured SMTP settings skip email sending with a warning log instead of crashing

### Pipeline Stage Types — New Stage Types (2026-03-13)

- **`form_dropdown` stage type**: Links an existing form from the Forms module for applicant data collection. Stage config includes form selection via dropdown. Icon: ListChecks
- **`meeting` stage type**: Schedule an interview or orientation meeting with the applicant. Auto-links upcoming events matching the stage configuration. Includes "President Interview" quick preset. Icon: Calendar

### Code Quality & Build Fixes (2026-03-13)

- **Medical-screening module build fixes**: Resolved frontend build errors in the new medical-screening module
- **EventDetailPage test update**: Fixed test for updated capacity display format
- **Slug collision deduplication**: Server-side slug generation now appends numeric suffix for collisions
- **Accurate modal warning text**: Stage config modal shows correct warning when pipeline has active prospects
- **Reject extra fields**: Backend rejects unrecognized fields in pipeline stage config requests
- **Server-side validation for inline stage UIs**: Added backend validation for new stage type configurations
- **Compliance config wired into calculation**: Compliance calculation engine now reads from the configurable compliance config instead of hardcoded thresholds

### Finance Module — Budgets, Purchase Requests, Expenses & Approval Chains (2026-03-12)

- **New finance module**: Full-stack finance module (`/finance`) for internal operational finance workflows — budgets, purchase requests, expense reports, check requests, and dues management. Standalone from the grants-fundraising module
- **Configurable approval chains**: Multi-step approval workflows with chain resolution by entity type, amount range, and budget category. Step types include APPROVAL (requires human action) and NOTIFICATION (auto-advances with email). Supports POSITION, PERMISSION, SPECIFIC_USER, and EMAIL approver types — EMAIL enables external approvers via secure token links
- **Fiscal year management**: Create, activate, and lock fiscal years with constraint enforcement (one active per org). Budget tracking with amount_budgeted, amount_spent, and amount_encumbered
- **Budget categories**: Hierarchical category system with 13 default categories (APPARATUS, TRAINING, FACILITIES, etc.) and optional QuickBooks account mapping
- **Purchase request workflow**: Full lifecycle (DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → ORDERED → RECEIVED → PAID) with auto-numbering (PR-YYYY-0001), budget encumbrance on approval, and encumbrance-to-spent conversion on payment
- **Expense reports**: Multi-line-item expense reports with per-item budget linking, receipt URLs, and merchant tracking. Auto-numbered (ER-YYYY-0001)
- **Check requests**: Request workflow for check issuance with payee management and check number tracking (CK-YYYY-0001)
- **Dues management**: Dues schedule creation with frequency options (annual, semi-annual, quarterly, monthly), bulk member dues generation, late fee calculation, and waiver support
- **Finance dashboard**: Budget health gauges, pending approval queue widget, dues collection rates, and recent transaction feed
- **Permissions**: `finance.view`, `finance.manage`, `finance.approve`, `finance.configure_approvals`
- **Feature flag**: `MODULE_FINANCE_ENABLED` in backend config
- **Frontend**: 12 pages including dashboard, budgets, purchase requests, expense reports, check requests, dues management, approval chain settings, and fiscal year settings
- **Backend tests**: Comprehensive test suite covering CRUD, approval state machine transitions, and budget calculations

### Recurring Events — Monthly-by-Weekday & Annual Patterns (2026-03-12)

- **Monthly-by-weekday recurrence**: Events can recur on patterns like "2nd Tuesday of every month" or "last Friday of every month". New `recurrence_week` and `recurrence_day_of_week` database columns store the pattern
- **Annual recurrence**: Events can recur yearly on a specific date. Combined with monthly-by-weekday, this supports patterns like "first Monday in October every year"
- **Recurring event UI**: New recurrence pattern selector in EventForm with radio buttons for daily/weekly/monthly/monthly-by-weekday/annual patterns. Weekday picker auto-populates from the event date
- **Series management UX**: Event detail page shows recurring event badges, "View All in Series" link, and series management actions (edit all future, delete series). Events list shows recurrence indicator badges
- **Duplicate event prevention**: Creating recurring events now checks for existing events at the same time/location to prevent accidental duplicates
- **RecurringEventCreate type**: Fixed to support `exactOptionalPropertyTypes` with proper `undefined` union types on optional fields

**Edge Cases:**
- Monthly-by-weekday with "5th week" falls back to "last occurrence" when the month has fewer than 5 weeks
- Annual events on Feb 29 shift to Feb 28 in non-leap years
- Deleting a single occurrence from a series does not affect other occurrences
- Series with past occurrences: "edit all future" only modifies events after the current date

### Prospective Members Pipeline — Event Linking (2026-03-12)

- **Link events to applicants**: Coordinators can link upcoming events (interviews, orientations, meetings) to individual applicants in the pipeline. New `prospect_event_links` table with full CRUD API
- **Auto-link events to meeting stages**: When a pipeline stage of type `meeting` is activated for an applicant, the system automatically links the next upcoming event matching the stage configuration
- **Applicant detail drawer**: Shows linked events with date, time, type, and status. Coordinators can manually add/remove event links
- **President Interview preset**: New quick-setup preset in StageConfigModal for configuring a "President Interview" meeting stage with one click

**Edge Cases:**
- If no upcoming events match when a meeting stage activates, no link is created and the coordinator is prompted to schedule manually
- Linking an event that is subsequently cancelled shows a "Cancelled" badge on the applicant's event list
- Multiple applicants can be linked to the same event (e.g., group orientation)

### Minutes Module — Refactoring & Module Conventions (2026-03-12)

- **Module extraction**: Minutes pages (`MinutesPage`, `MinutesDetailPage`) moved from top-level `pages/` to `modules/minutes/` following module conventions. Original files now re-export from the module for backward compatibility
- **Dedicated module structure**: New `modules/minutes/` with `index.ts`, `routes.tsx`, `services/api.ts`, `store/minutesStore.ts`, and `types/minutes.ts`
- **Table name migration**: Alembic migration renames `meeting_action_items` table to match the expected model table name, fixing startup errors on fresh installs
- **Zustand store**: New `minutesStore` with loading/error states for minutes CRUD operations
- **Backend test suite**: Comprehensive `test_minute_service.py` covering CRUD, search, section operations, template management, and publish workflow

**Edge Cases:**
- Existing deployments with the old table name need to run the migration (`alembic upgrade head`) — the migration handles both rename and index recreation
- Deep links to `/minutes/:id` continue to work via the re-exported route definitions

### QR Check-In Timezone Fixes (2026-03-12)

- **Organization timezone in QR data**: QR check-in response now includes `organizationTimezone` (IANA timezone string) so the check-in window displays times in the organization's local timezone instead of UTC
- **ISO datetime string fix**: Check-in window was showing "N/A" because the backend was returning bare date/time strings instead of ISO 8601 format. Fixed to construct proper ISO datetime strings by combining event date with start/end times

**Edge Cases:**
- Organizations without a configured timezone default to UTC display
- Events spanning midnight (e.g., overnight training) show the correct check-in window across the date boundary
- Self check-in page gracefully handles missing timezone data by falling back to the browser's local timezone

### Timezone Standardization Across Frontend (2026-03-12)

- **34 files updated**: Standardized timezone-aware date/time formatting across all frontend pages using `dateFormatting.ts` utilities with optional `timezone` parameter
- **Affected modules**: Admin hours, grants-fundraising, inventory, onboarding, scheduling, compliance, events, member profile, platform analytics, skills testing, and elections
- **Pattern**: All `new Date().toLocaleString()` / `toLocaleDateString()` calls replaced with `formatDate()` / `formatDateTime()` / `formatTime()` utilities that accept an IANA timezone

**Edge Cases:**
- Pages that previously showed UTC times now show organization-local times — users may notice time "shifts" after the update
- `AutoSaveIndicator` and `AutoSaveNotification` components now show save timestamps in local time

### Ballot Email Notifications & Org Logo in Emails (2026-03-12)

- **Ballot email notifications**: Election creators can send ballot notification emails to eligible voters from the election detail page. Emails include election title, voting period, and a direct link to the ballot
- **Organization logo in all emails**: All email notifications (event requests, skills testing, member archive, scheduled tasks, cert alerts, election ballots, inventory, property returns) now include the organization's logo in the email header
- **DRY email utility**: Extracted shared `build_logo_html()` and `get_org_logo_url()` helper functions into `email_service.py` to eliminate duplicated logo-building code across 7 service files

**Edge Cases:**
- Organizations without an uploaded logo get a text-only header (no broken image)
- Logo URLs respect the `ALLOWED_ORIGINS` setting for correct absolute URL generation
- Email clients that block images still show the organization name as alt text

### Auth Cookie & Deployment Fixes (2026-03-12)

- **Secure cookie auto-detection**: Auth cookies now auto-detect the `Secure` flag from the `ALLOWED_ORIGINS` scheme — HTTPS origins set `Secure=True`, HTTP origins (LAN deployments) set `Secure=False`. Removes the need for manual `COOKIE_SECURE` configuration
- **LAN HTTP cookie fix**: Auth cookies were being dropped on LAN HTTP deployments because `Secure=True` was hardcoded. Now correctly serves cookies over plain HTTP when `ALLOWED_ORIGINS` uses `http://`
- **Nginx worker count**: Added `NGINX_WORKER_PROCESSES` env var (default: `auto`) to prevent Nginx from spawning excessive workers (36+) on high-core-count servers

**Edge Cases:**
- Mixed-scheme `ALLOWED_ORIGINS` (both HTTP and HTTPS) defaults to `Secure=False` for compatibility — log a warning
- Cookie `path` includes trailing slash (`/api/v1/auth/`) to ensure refresh endpoint receives the cookie on all browsers
- Deployments behind a TLS-terminating reverse proxy should set `ALLOWED_ORIGINS` to the HTTPS URL even though backend-to-proxy traffic is HTTP

### Events Settings Refactor & Form Redirect (2026-03-12)

- **Settings page refactored**: `EventsSettingsTab` extracted into 6 focused section components (`CategoriesSection`, `EmailSection`, `FormSection`, `OutreachSection`, `PipelineSection`, `VisibilitySection`) with shared types and deduplicated save logic
- **Form generation redirect**: After generating an event request form from Events Settings, the user is now redirected to the Forms page with the new form pre-selected, instead of staying on the settings page
- **Custom categories schema fix**: `custom_event_categories` field in the Pydantic schema now accepts objects (with `id`, `label`, `color` fields) instead of plain strings, matching what the frontend actually sends

**Edge Cases:**
- Existing custom categories stored as plain strings are automatically migrated to object format on next save
- The refactored settings page preserves unsaved changes when navigating between sections via the sidebar

### Settings Persistence — SQLAlchemy JSON Mutation Fix (2026-03-12)

- **Deep copy for JSON columns**: Organization settings updates now use `copy.deepcopy()` instead of `dict()` shallow copy when modifying nested JSON values, preventing silent write failures where SQLAlchemy didn't detect changes
- **Orphan cleanup**: Settings save endpoint now cleans up orphaned event types and categories that were removed from the settings but left in the database
- **Backend test suite**: New `test_event_settings.py` with 6 tests covering deep copy consistency, orphan cleanup, and concurrent save scenarios

**Edge Cases:**
- Shallow copy (`dict()`) of JSON columns shares nested dict references with SQLAlchemy's committed state — mutations appear to work in-memory but are never written to the database
- `flag_modified()` is an alternative to `deepcopy()` but requires remembering to call it after every mutation
- The `MutableDict.as_mutable(JSON)` type decorator auto-detects top-level key changes but still misses nested mutations

### Slugs Made Internal (2026-03-12)

- **Slugs removed from user-facing UIs**: Role slugs are now auto-generated server-side and hidden from role management, onboarding, and user profile pages. Previously, users could edit slugs directly, causing lookup failures when slugs were changed
- **Backend auto-generation**: `RoleService` generates slugs from role names on create/update using `slugify()`. Duplicate slugs get a numeric suffix

**Edge Cases:**
- Existing roles retain their current slugs — no migration needed
- API consumers that relied on user-provided slugs should use role IDs instead
- The `slug` field remains in the database and API responses for internal lookups but is not editable via the UI

### Code Quality & Build Fixes (2026-03-12)

- **94 TypeScript errors resolved**: Fixed wrong import paths, duplicate properties, unused variables, missing type annotations, and `noUncheckedIndexedAccess` violations across 18 source and test files
- **ESLint zero errors**: Resolved all ESLint errors and warnings across 59 files — 0 errors, 0 warnings
- **Form value `??` to `||` migration**: Replaced `??` (nullish coalescing) with `||` (logical OR) for form value coercion across 14+ files to prevent empty strings from being sent to the backend. Affected modules: events, scheduling, inventory, onboarding, prospective members, training, member profile
- **Python lint fixes**: Resolved flake8 violations (F401 unused imports, trailing whitespace, blank line formatting) in `elections.py`, `onboarding.py`, `organization_service.py`, `ip_security.py`, `sms_service.py`, `scheduled_tasks.py`
- **Import path fixes**: Corrected wrong import paths in admin-hours module components (`ActiveSessionsTab`, `AllEntriesTab`, `PendingReviewTab`)
- **`tsbuildinfo` gitignored**: Added TypeScript build info file to `.gitignore`
- **Events module fixes**: Fixed `custom_category` field handling, attachment mutation in event update, and test file alignment with schema changes

### CLAUDE.md Updates (2026-03-12)

- **Package version accuracy**: Updated Vite, Zod, Tailwind, Vitest, and other package versions to match actual `package.json` values
- **JSON column deep copy pitfall**: Added Pitfall #12 documenting the `dict()` shallow copy issue with SQLAlchemy JSON columns, with correct patterns using `copy.deepcopy()` and `flag_modified()`

### Comprehensive Security Audit & Remediation (2026-03-07)

- **25-issue security audit completed**: Full audit report (`SECURITY_AUDIT.md`) covering backend, frontend, infrastructure, and deployment. Issues prioritized across critical, high, medium, and low severity tiers
- **Critical #1 — Database SSL enforcement**: `get_db_connect_args()` now creates SSL context when `DB_SSL=True`; verified usage in `database.py`. Rate limiter was constructing its own Redis URL bypassing `REDIS_SSL` — now uses `settings.REDIS_URL` to respect TLS config
- **Critical #2 — Redis TLS enforcement**: `REDIS_URL` uses `rediss://` scheme when `REDIS_SSL=True`; all Redis consumers (cache, rate limiter, Celery broker) now route through the shared URL
- **Critical #3 — Insecure defaults blocked in production/staging**: Production and staging environments now always raise `RuntimeError` on startup if default secrets are detected. `SECURITY_BLOCK_INSECURE_DEFAULTS` (default `False`) can block development environments too when explicitly enabled
- **7 high-priority issues fixed**: (4) JWT algorithm allowlist restricted to HS256 only — reject `none`/RS256 tokens; (5) session invalidation on password change; (6) file upload path traversal blocked with `secure_filename()` + UUID prefix; (7) Jinja2 auto-escaping enforced globally with `SandboxedEnvironment`; (8) CORS origin validation uses exact match — no subdomain wildcards; (9) parameterized LIKE queries via `escape_like()` utility; (10) rate limiter thread-safety with `asyncio.Lock`
- **Medium issues fixed**: (11) HTTPS enforcement upgraded from WARNING to CRITICAL in production; (15) scheduling module migrated from manual axios setup to shared `createApiClient()` factory for consistent CSRF/auth; (16) onboarding CSRF token moved from localStorage to SameSite=Strict cookie (double-submit pattern); (17) auto-clear deprecated sensitive sessionStorage keys on module load; (18) strict regex validation for table names in startup `DROP TABLE` loop + parameterized `INFORMATION_SCHEMA` query; (19) `/health` endpoint minimized — returns only `status` + `ready` (no environment/version info)
- **Low issues fixed**: (20) removed `DEBUG=True` exposure in health endpoint; (21) added `Referrer-Policy: strict-origin-when-cross-origin` header; (22) added `X-Permitted-Cross-Domain-Policies: none` header
- **Magic byte validation for file uploads**: All file upload endpoints now validate file content against magic bytes (JPEG, PNG, GIF, WebP, PDF, CSV, DOCX, XLSX) to prevent disguised malicious files

### Inventory Module — Variant Groups, Equipment Kits & Size Preferences (2026-03-07)

- **Variant groups**: Items can be grouped as variants of a base product (e.g., "Turnout Coat" in sizes S/M/L/XL). Each variant tracks its own stock, serial numbers, and assignments while sharing a common description and category
- **Equipment kits**: Define named kits (e.g., "New Recruit PPE Kit") that bundle multiple inventory items. Issuing a kit assigns all component items in a single operation with individual tracking per component
- **Member size preferences**: Members can record their preferred sizes for garment categories (coat, pants, gloves, boots, helmet). Size preferences are surfaced during kit issuance and equipment ordering to streamline fulfillment
- **New data models**: `VariantGroup`, `EquipmentKit`, `EquipmentKitItem`, `MemberSizePreference` tables with full CRUD API endpoints
- **New enums**: `StandardSize` (XS through 5XL), `GarmentStyle` (regular, long, short, tall)

### Inventory Module — Reorder Points, Reorder Requests & SMS Alerts (2026-03-07)

- **Item-level reorder points**: Each pool item can define a `reorder_point` threshold. When available stock drops to or below this value, the item appears in the low-stock dashboard and triggers alerts
- **Reorder request workflow**: Full lifecycle — `pending` → `approved` → `ordered` → `received` — with audit logging at each transition. Admins can approve/deny requests, record order details (vendor, PO number, expected delivery), and mark items as received with quantity reconciliation
- **Low stock SMS alerts via Twilio**: When `TWILIO_ENABLED=True`, low-stock alerts are sent via SMS to configured recipients alongside existing email notifications. SMS includes item name, current stock, and reorder point
- **Inventory-by-location dashboard**: New location filter on the inventory dashboard showing item counts and stock levels grouped by storage location. Cascading Facility → Room → Storage Area selection
- **New API endpoints**: `POST/GET /api/v1/inventory/reorder-requests`, `PATCH /api/v1/inventory/reorder-requests/{id}`, `GET /api/v1/inventory/reorder-requests/{id}/history`

### Inventory Module Rewrite (2026-03-06)

- **Focused pages replace monolithic admin hub**: Individual pages for items, pool items, categories, maintenance, members, charges, return requests, equipment requests, write-offs, and reorder requests — each with dedicated URL and navigation
- **Type-specific views**: Pool items page with quantity tracking, variant group display, and bulk issuance. Individual items page with serial/barcode search and assignment history
- **ItemDetailPage**: Two-column layout with sidebar (barcode, quick info, assignment/issuance history) and main content (overview, history, maintenance, NFPA compliance). Accessible at `/inventory/items/:id`
- **Admin hub dashboard**: Summary statistics cards (total items, low stock, overdue checkouts, pending requests) with quick-link navigation to each admin sub-page
- **Storage areas room filter**: Storage areas page filters by `facility_room_id` to prevent rooms from leaking into station location pickers
- **Inventory test suite**: 25+ frontend tests covering page rendering, search, filters, and modal interactions
- **Modal overlay stacking fix**: Modal backdrop z-index corrected so content is always above the overlay
- **PDF label barcode rendering**: SVG barcodes now use `requestAnimationFrame` to ensure full rendering before `window.print()`. Added error handling and missing-item logging to barcode label generation

### Test Suite Improvements (2026-03-07)

- **vitest-axe for accessibility testing**: Automated WCAG compliance checks using axe-core. Example `Modal.a11y.test.tsx` demonstrates the pattern for component-level accessibility testing
- **hypothesis for property-based testing**: 14 property-based tests for Pydantic schema validation (`test_schema_property.py`) — generates random valid/invalid inputs to find edge cases
- **schemathesis for API contract testing**: Skeleton `test_api_contract.py` for automatic OpenAPI spec fuzzing. Validates that all documented endpoints handle edge-case inputs correctly
- **pytest-timeout**: 30-second default timeout on all backend tests to catch hanging async tests. Configurable per-test with `@pytest.mark.timeout(60)`
- **Coverage ratcheting**: Coverage thresholds enforce 80% lines/functions/statements and 75% branches. Ratchet script prevents coverage from decreasing between PRs
- **Code quality ESLint plugins**: `eslint-plugin-testing-library`, `eslint-plugin-jest-dom`, `eslint-plugin-vitest` added. Fixed remaining weak assertions (e.g., `toBeTruthy()` → `toBeInTheDocument()`)
- **Test infrastructure fixes**: Added pytest markers (`integration`, `unit`, `slow`, `docker`) to `pytest.ini`. Fixed 9 backend test failures across 5 files and 1 migration

### Visual Design Improvements (2026-03-07)

- **50 CSS and component enhancements**: Comprehensive visual polish across the entire application including consistent spacing, border-radius, shadow depth, and color usage
- **Theme-aware gradients**: All hardcoded gradient colors replaced with CSS variable-based theme classes
- **Card component standardization**: Unified card padding, border, and shadow styles across dashboard, inventory, facilities, and training pages
- **Mobile responsive improvements**: Touch targets enlarged to 44px minimum, improved spacing on mobile breakpoints
- **Typography refinement**: Consistent heading sizes, line heights, and font weights across all modules

### PDF Generation & Print Fixes (2026-03-07)

- **Barcode readiness race condition**: Print pages now wait for SVG barcode rendering via `requestAnimationFrame` before triggering `window.print()`, preventing blank barcodes on thermal labels
- **SVG barcodes fully rendered before print/export**: Added explicit render-complete callbacks for JsBarcode SVG output
- **Error handling for barcode label generation**: Missing items are logged with warnings instead of crashing the batch. Partial label sheets are generated for items that have valid barcodes
- **XSS fix in print export**: User-supplied item names and descriptions are HTML-escaped before insertion into print templates
- **Training report PDF export**: Fixed `format=pdf` parameter handling — training reports now correctly generate PDF output when requested instead of returning CSV

### Auth & Session Fixes (2026-03-07)

- **Concurrent token refresh replay detection**: When multiple API calls simultaneously receive 401 responses, they all shared a single refresh promise. However, the refresh endpoint's replay detection was flagging the second refresh attempt (using the same token) as a replay attack. Fixed by ensuring only one refresh request is made per token rotation cycle
- **useIdleTimer polling storm**: The idle timer was firing `checkActivity()` every 100ms instead of the configured interval, causing thousands of unnecessary API calls. Fixed interval calculation and added debouncing
- **WebSocket 403 rejections**: Module-specific WebSocket connections were missing auth credentials. Added `withCredentials: true` to WebSocket upgrade requests

### Facilities Module Rewrite (2026-03-06)

- **FacilitiesDashboard**: New landing page with summary statistics (total facilities, pending maintenance, upcoming inspections), recent activity feed, and facility card grid with search and type filtering
- **FacilityDetailPage**: Full-page layout with sidebar navigation to sections (overview, rooms, systems, maintenance, inspections, utilities, contacts, compliance). Replaces the previous tab-based single-page layout
- **Zustand store**: `useFacilitiesStore` manages facility CRUD, rooms, systems, maintenance, inspections, and dashboard data with proper loading/error states
- **CRUD components**: Dedicated form components for rooms, building systems, emergency contacts, and compliance checklists with proper TypeScript interfaces (no more `Record<string, unknown>`)
- **FacilityRoomPicker**: Reusable cascading picker (facility dropdown → room dropdown with info card) for cross-module room selection
- **Route restructuring**: `/facilities` (dashboard), `/facilities/:id` (detail), `/facilities/maintenance` (cross-facility), `/facilities/inspections` (cross-facility). Static routes ordered before parameterized routes to prevent conflicts

### Apparatus Module Fixes (2026-03-06)

- **Missing `min_staffing` field**: The apparatus model had `min_staffing` but the list endpoint was not returning full Apparatus records — only partial data. Fixed serialization to include `min_staffing`, breaking staffing calculations for shift scheduling
- **Broken setup checklist**: When the apparatus module was enabled, the setup checklist showed 0 apparatus even with vehicles configured. The checklist count query was not counting the correct table
- **geoip2 dependency**: Added `geoip2` package to fix missing-package warning at startup

### TypeScript Code Quality (2026-03-06)

- **Enum constants replace string literals across 17+ files**: Replaced hardcoded string comparisons with constants from `constants/enums.ts` (e.g., `status === 'active'` → `status === MemberStatus.ACTIVE`). Covers event types, member statuses, approval statuses, training types, scheduling statuses, and inventory conditions
- **Deduplicated enum type definitions**: Module-local enum types now re-export from `constants/enums.ts` instead of defining duplicates
- **`getErrorMessage()` utility replaces `instanceof Error`**: All `catch (err: unknown)` blocks now use `getErrorMessage(err, 'fallback')` instead of manual `instanceof Error` checks. Consistent error handling across 40+ files
- **Specific enum types replace generic `status: string`**: Component props and function signatures now use `MemberStatus`, `EventType`, `ApprovalStatus`, etc. instead of bare `string`

### Migration & Startup Fixes (2026-03-06)

- **Broken Alembic revision chain**: Multiple migration heads detected on startup due to broken `down_revision` references. Fixed revision chain to ensure linear history from initial migration to HEAD
- **Misleading migration logs**: Startup logged "Running migrations..." even when the database was already at HEAD, causing false alarm in multi-worker deployments. Now only logs when actual migrations are applied
- **Reduced startup noise**: Worker processes skip migration checks (only the first worker runs migrations). Suppressed redundant Redis connection and WebSocket manager log lines

### Security Middleware Fix (2026-03-06)

- **`UnboundLocalError` for `actual_receive` in SecurityMonitoringMiddleware**: The `actual_receive` variable was referenced before assignment when the middleware's body-inspection path was not taken. Moved variable initialization before the conditional block

### Lint & Code Quality (2026-03-06)

- **All outstanding lint errors resolved**: Fixed flake8 violations (F401, F811, E303, W291) across all modified Python files. Fixed ESLint violations across frontend. Zero lint errors in both backend and frontend

### Prospective Members — Desired Membership Type (2026-03-06)

- **Desired membership type selection**: Prospective member pipeline now includes a `desired_membership_type` field (regular or administrative). Displayed on the interest form, editable inline at any pipeline stage, and pre-filled during conversion to full member
- **Membership Interest Form template**: The form template includes the membership type dropdown so applicants can indicate their preference at initial interest submission

### Inventory — Cost Data & Item History (2026-03-06)

- **Cost data added to inventory views**: Item list and detail views now display purchase cost, replacement cost, and total cost recovery. Cost summary cards on the admin dashboard show total inventory value and cost recovery percentage
- **Item history `AttributeError` fix**: Fixed crash when loading item assignment/issuance history caused by accessing a relationship attribute on a detached SQLAlchemy instance

### Login Auth Flow & Cookie Delivery Fixes (2026-03-06)

- **Login auto-refresh loop caused by conflicting Set-Cookie headers**: The login endpoint called `_clear_auth_cookies()` before `_set_auth_cookies()`, adding delete headers (`Max-Age=0`, `SameSite=lax`) followed by set headers (`SameSite=strict`, `HttpOnly`) for the same cookie names. Browsers inconsistently processed the conflicting attributes, resulting in the `access_token` never being stored and a refresh loop that kicked users back to login
- **Post-login 401 cascade from cookie timing race**: After login, the browser may not have processed Set-Cookie headers before the dashboard fires ~15 parallel API calls, causing spurious 401s. Added cookie settle polling (`waitForLoginCookies`) and a post-login grace period with exponential backoff in the 401 interceptor
- **Temporary Bearer token bridge for post-login requests**: httpOnly auth cookies set by the login response may not be immediately available due to nginx proxy buffering or middleware response wrapping. Now temporarily uses the `access_token` from the login response body as an `Authorization: Bearer` header (the backend already supports this as a fallback), with automatic cleanup after 30 minutes
- **Bearer token bridge extended to module-specific axios instances**: The scheduling module and `createApiClient` factory each create their own axios instances with independent interceptors. These now also include the Bearer token bridge to prevent 401s on module-specific endpoints (`scheduling/*`, `admin-hours/*`) after login
- **Refresh token stored in memory alongside access token**: Cookies are never stored by the browser in some deployment configurations. The refresh token is now stored in memory with the access token, and all 401 interceptors send the refresh token in the request body (backend accepts it from body or cookie)
- **CSRF header missing on standalone refresh request**: The refresh request uses a standalone axios instance to avoid recursive 401 interception, but this bypassed the CSRF header. Now manually reads the `csrf_token` cookie and attaches `X-CSRF-Token` on refresh requests
- **Auth refresh 422 from empty body and cookie path mismatch**: `apiClient` was sending `{}` body on refresh, which Pydantic parsed against `TokenRefresh` (requires `refresh_token: str`) and rejected with 422. Also fixed cookie path from `/api/v1/auth` to `/api/v1/auth/` for correct sub-path matching. Made `TokenRefresh.refresh_token` optional as defense-in-depth
- **Login response now includes user data**: Eliminated the separate `GET /auth/me` call after login, preventing the race condition where the access token cookie isn't processed by the browser before the `/auth/me` request fires
- **Stale refresh token cookie cleanup on login**: Stale `refresh_token` cookies from previous sessions (different `SECRET_KEY`) persisted because the cookie path changed. Login now clears cookies for both path variants

### Security Middleware Fixes (2026-03-06)

- **SecurityHeaders and IPLogging middleware converted to pure ASGI**: Starlette's `BaseHTTPMiddleware` wraps responses through `call_next()`, which can strip Set-Cookie headers when multiple `BaseHTTPMiddleware` layers are stacked. This was the root cause of httpOnly auth cookies set by the login endpoint being lost before reaching the browser. Converted both middleware classes to pure ASGI to leave original response headers untouched
- **SecurityMonitoringMiddleware receive lambda TypeError**: The `receive` lambda used to re-wrap the request body was synchronous, causing `TypeError` when downstream handlers called `await request.body()`. Changed to an async callable as required by ASGI
- **Unbounded in-memory growth in SecurityMonitoringService**: Added periodic eviction of stale tracking keys (`_api_calls`, `_login_attempts`, `_session_ips`, `_data_transfers`) and trimming of the in-memory alerts list to prevent memory exhaustion under sustained traffic
- **Unbounded in-memory growth in public portal security caches**: Added automatic `cleanup_rate_limit_cache()` calls when `rate_limit_cache` or `ip_rate_limit_cache` exceed their key limits

### Elections Module Improvements (2026-03-06)

- **Candidates not showing in ballot preview and voting page**: Ballot items created from templates were missing the `position` field, causing candidate-to-ballot-item matching to fail. Fixed template-created ballot items, preview matching, and voting page matching to all use position-based or title-based fallback
- **Position field added to ballot item creation**: BallotBuilder now includes a position dropdown (from `election.positions`) when `vote_type` is `candidate_selection`. Templates also set the position field automatically
- **Ballot preview enhanced with prospective members and election context**: Ballot preview now shows meeting date, prospective member/candidate info cards on approval-type items, write-in input placeholders, security notice footer, and election configuration summary
- **BallotBuilder redesigned with modern card-based UI and drag-and-drop**: Replaced flat numbered list with interactive cards using `@dnd-kit` for drag-and-drop reordering with keyboard accessibility, expandable inline editing, color-coded type badges, two-step delete confirmation, and template popover
- **Limit one ballot item per position**: Track which positions already have ballot items, filter dropdowns to show only unused positions, and show validation error toast on duplicate attempts
- **Write-in candidate auto-fill**: When "Write-in candidate" is checked, auto-fills name with "Write-in Candidate" if empty and clears any linked member
- **Election position input converted to dropdown with rank suggestions**: Position field now loads the organization's operational ranks (Chief, Captain, etc.) as dropdown suggestions with type-ahead filtering
- **Position dropdown added to candidate edit form**: The edit form previously only showed name and statement fields, preventing users from moving a candidate to a different position
- **Template popover repositioned above button**: Changed from downward to upward opening to prevent clipping inside the card content area
- **Proxy voting toggle added to Election Settings**: Enable/disable proxy voting org-wide with max proxies per person. Fixed GET/PATCH `/elections/settings` endpoints to return flat field names matching frontend expectations
- **Election integrity chain and security hardening**: Added ballot hash chaining, server-side voter eligibility enforcement, and election settings page

### Events Module Improvements (2026-03-06)

- **Attendance duration calculation for auto-checkout**: Added `finalize_event_attendance()` that calculates duration for all checked-in members who didn't check out (the default when `require_checkout` is false). Auto-finalizes when a secretary records actual end time. Updates linked training records with calculated hours
- **Duplicate RSVP bug in form-event integration**: `_process_event_registration` now checks for existing RSVPs before creating new ones, updating to GOING status if one exists
- **Events page UX improvements**: Added search bar filtering by title/location, Upcoming/Past toggle for all users, pagination, user RSVP status badge on event cards, and fixed cancelled event badge colors for light mode
- **Event detail action button reorganization**: Organized 9+ manager action buttons into primary actions (RSVP, QR Code, Edit, Check In) plus a "More" dropdown for secondary actions (Duplicate, Record Times, Finalize Attendance, Monitoring, Create Meeting, Cancel, Delete)
- **ESLint warning reduction**: Wrapped `fetchEvents` in `useCallback`, replaced eslint-disable with proper `useCallback` on ElectionsSettingsPage, added void prefix to async onClick handlers

### Facilities Module Improvements (2026-03-06)

- **NFPA compliance fields added**: 8 fire-critical system types (exhaust extraction, cascade air, decontamination, bay door, air quality monitor, PPE cleaning, alerting system, shore power), certification/testing fields on FacilitySystem, inspector fields on FacilityInspection, NFPA 1500/1585 zone classification (hot/transition/cold) on FacilityRoom, and 16 NFPA-aligned maintenance types seeded
- **Facility type auto-matched to organization type**: "EMS Station" selected for EMS-only orgs instead of always defaulting to "Fire Station"
- **Auto-assign "Operational" status on facility creation**: No longer requires explicit status selection
- **Add Facility modal enhanced**: Now includes status dropdown, phone, and email fields
- **Facility onboarding data flow fixed**: Location record now linked to auto-created facility during onboarding so headquarters appears in Events location picker and QR check-in. County and founded year fields added to onboarding form
- **Container startup crash from facilities module**: Multiple cascading issues fixed: (1) FK reference from `roles` to `positions` table, (2) SET NULL FK columns missing `nullable=True` across ~50 columns in 8 model files, (3) fundraising migration in `MIGRATION_ONLY_FILES` causing "Table already exists", (4) lookup tables with NOT NULL `organization_id` preventing system seed data, (5) missing seed data causing "No facility types available" on create, (6) full migration chain fix with nullable `org_id` from creation and backfill seed migration
- **Facility type/status auto-assignment fallback and validation**: Falls back to any active type/status for the org if "Fire Station"/"Operational" not found. Raises clear `ValueError` (400) instead of DB crash (500) if none exist
- **Route ordering bug**: `GET /{facility_id}` was defined before static routes like `/maintenance`, causing FastAPI to match "maintenance" as a facility_id. Moved parameterized routes to end of router
- **Auto-seed missing system defaults**: Safety net in `_ensure_system_defaults()` creates system types/statuses if missing (handles stamped migrations without data insertion)
- **Null address data in facilities onboarding**: Falls back to mailing address when `physical_address_same=False` but physical address fields are `None`
- **Room → Location integration**: Rooms now auto-sync a linked Location record, making them available to Events, Storage, and other modules via the location picker. Each room gets a display code for QR check-in support
- **FacilityListItem schema expanded**: Added county, fax, and `address_line2` fields. FacilityDetailPanel updated to display county and fax in view mode
- **Type safety improvements**: Replaced all `Record<string, unknown>` types with proper TypeScript interfaces matching backend schemas. Removed all `as unknown as` type casts. Created reusable `FacilityRoomPicker` component for cross-module room selection
- **FacilityDetailPanel enhanced with tabbed sub-sections**: Rooms, Building Systems, and Emergency Contacts (previously only rooms were accessible). Zone classification badges and condition color coding added

### Backend Startup & Onboarding Fixes (2026-03-06)

- **Onboarding organization 422 from empty strings**: Form fields initialize as empty strings. `??` (nullish coalescing) passes `""` through to the backend where Pydantic validators reject it. Changed to `|| undefined` so empty strings become `undefined` and are omitted from JSON. ZIP code validation also strengthened to match backend regex
- **Onboarding error messages showing empty or garbled content**: FastAPI returns 422 validation errors as arrays of `{loc, msg}` objects. `toAppError()` assumed `detail` was always a string, producing `[object Object]`. Now detects array detail and formats as "field: reason". Empty/whitespace error messages render `null` instead of an empty red alert box
- **Global error handler for Pydantic 422 validation arrays**: `toAppError()` in `errorHandling.ts` now properly formats FastAPI's array-style validation errors

### Integration Services (2026-03-06)

- **Integration services secured, expanded, and implemented**: Hardened integration service layer with proper auth, expanded configuration options, and implemented core integration functionality

### ESLint & Code Quality (2026-03-06)

- **Pre-existing ESLint warnings resolved across pages**: Reduced warning count from 22 to 18 with proper `useCallback` wrapping and void-prefixed async handlers

### Unraid Duplicate Cleanup (2026-03-05)

- **Consolidated unraid/ directory from 16 to 11 files**: Removed 5 duplicate/superseded files — deleted `QUICK-START.md` (superseded by `QUICK-START-UPDATED.md`, which was renamed to `QUICK-START.md`), deleted `DOCKER-COMPOSE-SETUP.md` (content covered by other guides), deleted `ICON-REQUIREMENTS.txt` (already in `COMMUNITY-APP-SUBMISSION.md`), merged `check-frontend-config.sh` and `rebuild-frontend.sh` into `validate-deployment.sh` as `--diagnose-frontend` and `--rebuild-frontend` flags. Reduces ~1,100 lines of duplication. Updated all cross-references in `README.md`, `docs/deployment/unraid.md`, `unraid/README.md`, and `unraid/UNRAID-INSTALLATION.md`

### Onboarding & Auth State Fixes (2026-03-05)

- **Onboarding reset not clearing auth state after step 7**: When the system owner is created at step 7, auth cookies are now set. Previously, if a user navigated away and returned, the stale auth state from the cookie conflicted with the onboarding flow. The reset now properly clears `has_session` and auth cookies before restarting
- **Hardcoded condition options in inventory**: The item condition dropdown was using a hardcoded list instead of the enum values from the backend. Fixed to use the `ItemCondition` enum consistently
- **getUserPermissions test failure**: Fixed test that was failing due to a mock not matching the updated permission response schema

### Inventory Improvements (2026-03-05)

- **Charges UI, return requests, alerts, quarantine**: Added charges/fees tracking for damaged or lost items, member return request workflow, configurable stock alerts with email notifications, and quarantine status for items pending inspection
- **Pool item enhancements — cost recovery, size variants, bulk issuance, allowances**: Pool items now support cost recovery tracking (replacement cost per unit), size variant management (S/M/L/XL with per-size stock), bulk issuance to multiple members at once, and per-member issuance allowances with override capability
- **Mobile-friendly card views and FAB**: Inventory browse and admin pages now use responsive card layouts on mobile with a floating action button (FAB) for quick actions (add item, scan barcode, import CSV)
- **Client-side barcode label printing for thermal printers**: Added Dymo (2.25×1.25″) and Rollo (4×6″) thermal printer support with Code128 barcode generation. Labels include item name, barcode, serial number, and organization logo. Print preview with per-label and batch modes
- **Empty string clearing bug (`??` vs `||`)**: Fixed `??` (nullish coalescing) being used where `||` (logical OR) was needed across inventory pages. `??` only catches `null`/`undefined`, not empty strings `""`, causing form fields that were cleared to retain empty string values instead of falling back to defaults
- **Fix inventory page 422 errors and WebSocket 403 rejections**: Inventory admin page was sending malformed payloads due to optional fields being sent as empty strings. WebSocket connection was rejected with 403 due to missing auth token in the upgrade request

### Training Enhancements (2026-03-05)

- **Recertification tracking, competency matrix, instructor management, effectiveness scoring, multi-agency training, xAPI integration**: Major training module expansion adding automated recertification reminders with configurable lead times, department-wide competency heat-map, instructor qualification and availability tracking, training effectiveness scoring (Kirkpatrick model), multi-agency joint training coordination, and xAPI (Tin Can) learning record integration

### Compliance Officer Dashboard (2026-03-05)

- **ISO readiness, attestations, and NFPA 1401 record quality**: New compliance officer dashboard with ISO 9001/14001/45001 readiness scoring, configurable attestation workflows (annual compliance sign-offs), and NFPA 1401 record quality analysis for training documentation
- **Expanded compliance officer tests from 20 to 95**: Test coverage across 12 test classes for the new compliance dashboard features

### Facilities Module Bug Fixes (2026-03-05)

- **6 critical bugs fixed**: (1) Acronym display showing `undefined` for facilities without acronyms, (2) name validation rejecting valid facility names with special characters, (3) maintenance create/update `MissingGreenlet` error from synchronous relationship access in async context, (4) facility list not loading due to missing `address_line1`/`zip_code` in list response schema, (5) inspection form crash on facilities with no inspection history, (6) utility cost chart rendering error when no data exists

### Grants & Fundraising Module (2026-03-05)

- **Full-stack Grants & Fundraising module**: Complete implementation including grant application management (AFG, SAFER, FP&S, USDA), fundraising campaign engine with goal tracking, donor management mini-CRM, grant note system, pipeline stages, and financial reporting
- **Fix GrantNote model crash**: Renamed reserved `metadata` attribute that conflicted with SQLAlchemy's internal `metadata` property on `Base`, causing `AttributeError` at import time
- **Fix camelCase serialization, relationship loading, schema mismatches**: Backend schemas were missing `alias_generator=to_camel` on several response models, causing the frontend to receive snake_case keys. Fixed eager loading on grant-donor relationships to prevent N+1 queries
- **Stage history typed status enum, progress bar UX, test coverage**: Replaced raw string stage statuses with a typed `StageStatus` enum, improved the pipeline progress bar with color-coded segments and hover tooltips, added comprehensive test coverage

### Reports Module (2026-03-05)

- **Reports showing raw rank_code instead of display name**: The reports rank column was displaying the internal `rank_code` (e.g., `FF1`, `LT`) instead of the human-readable `rank_name` (e.g., `Firefighter I`, `Lieutenant`). Fixed by joining the ranks table in the report query

### Prospective Members (2026-03-05)

- **Interview view for prospective members**: New interview detail view showing applicant information, interview questions, scheduled date/time, interviewer assignments, and notes — accessible from the prospect detail drawer
- **Stage history showing all pipeline stages for new prospects**: New prospects were incorrectly showing history entries for all pipeline stages instead of just their current stage. Fixed to only create a history entry for the initial stage on prospect creation

### TypeScript & Build Fixes (2026-03-05)

- **Remove unused imports in TrainingEnhancementsTab**: Fixed TypeScript build errors caused by unused imports after the training enhancements were refactored
- **Fix exactOptionalPropertyTypes and unused imports in grants-fundraising**: Multiple TypeScript errors from `exactOptionalPropertyTypes` strict check — `|| undefined` patterns fail because `undefined` is not assignable to optional properties. Replaced with conditional spreads and proper type narrowing
- **Replace all `|| undefined` patterns with safe alternatives across 69 files**: Systematic fix for `|| undefined` anti-pattern that violates `exactOptionalPropertyTypes`. Replaced with conditional object spreads (`...(val ? { key: val } : {})`), ternaries with `null`, or proper type narrowing
- **Fix pre-existing TypeScript errors in grants-fundraising module**: Resolved type errors in campaign, donor, and grant page components that predated the grants module merge

### Production Code Quality (2026-03-05)

- **Comprehensive code review fixes**: Input validation schema for event settings, store summary error handling, import cleanup across multiple files
- **12 data point mismatches fixed**: Cross-layer audit fixing mismatches between models, schemas, services, and TypeScript types across inventory, training, facilities, and grants modules

### Error Handling & Clipboard (2026-03-05)

- **"Copy error details to clipboard" not working**: The error boundary's copy button was using `navigator.clipboard.writeText()` without the required `clipboard-write` permission and without fallback. Added `document.execCommand('copy')` fallback for contexts where the Clipboard API is unavailable (e.g., non-HTTPS, iframes)

### Unraid App Removal (2026-03-05)

- **App removal on Unraid requiring full restart**: Removing The Logbook from Unraid Community Applications left orphaned Docker volumes and network configurations that required a full Unraid restart to clean up. Added proper cleanup hooks to the Unraid template XML

### Onboarding Auth Cookie Fix (2026-03-04)

- **httpOnly auth cookies on system owner creation**: The onboarding system owner creation endpoint (Step 7) now sets httpOnly auth cookies via `_set_auth_cookies()`, matching the login endpoint pattern. Previously, tokens were returned in the response body but cookies were never set, causing `loadUser()` → 401 → cleared `has_session` → auth state lost for remaining onboarding steps (8–10) and the final redirect to `/dashboard` failed via `ProtectedRoute → /login`

### Organization Profile — Physical Address (2026-03-04)

- **Physical address in organization profile API and settings UI**: The organization model already had physical address columns (populated during onboarding), but they were never exposed in the profile API or displayed in Organization Settings. Added `PhysicalAddressUpdate` schema, physical address fields to `OrganizationProfileUpdate`, and a new Physical Address section in the Settings General tab with a "Same as mailing address" toggle

### Custom Event Categories (2026-03-04)

- **Custom event categories — full-stack integration**: Organizations can now define custom event categories with name and color badge. Backend: new `custom_category` column on events table with index + migration, visibility settings via `visible_custom_categories`, and category filtering in `list_events`. Frontend: category dropdown in EventForm, category filter tabs on EventsPage, and toggle controls in Events Settings visibility section
- **Event Administration settings redesign**: Replaced collapsible sections with sidebar + content panel layout to match Organization Settings page. Desktop sidebar navigation with section descriptions; mobile horizontal scrollable tabs. Each section rendered in themed card panel with consistent header styling
- **Outreach types auto-ID**: Outreach Event Types form now auto-generates the ID from the label, removing the separate ID input field. Email Notifications and Email Templates consolidated into a single Email Configuration section

### Admin Hours camelCase Fix (2026-03-04)

- **AdminHoursSummary.byCategory snake_case → camelCase**: The backend schema uses `alias_generator=to_camel`, so the API returns camelCase. Updated the `AdminHoursSummary` type definition and all 3 consuming components (`SummaryTab`, `AdminHoursPage`, `MemberProfilePage`) to use camelCase property names (`categoryId`, `categoryName`, `totalHours`, etc.)

### Facility Address Display Fix (2026-03-04)

- **Facility address fields not displaying**: Frontend `Facility` interface and all component code used snake_case (`address_line1`, `zip_code`, `facility_number`), but the backend Pydantic schema's `alias_generator=to_camel` returns camelCase. All multi-word fields resolved to `undefined` at runtime. Updated all frontend facility types to camelCase and added missing `address_line1`/`zip_code` to `FacilityListItem` backend schema

### Theme & Styling Fixes (2026-03-04)

- **EventRequestStatusPage theme compliance**: Replaced all hardcoded gray/color classes with manual `dark:` prefixes to theme-aware CSS variable classes (`bg-theme-surface`, `text-theme-text-primary`, `border-theme-surface-border`), so the page respects light, dark, and high-contrast modes
- **Apparatus list page gradient fix**: Replaced hardcoded `via-red-900` with theme-aware `via-theme-bg-via` CSS variable class. The hardcoded dark red gradient was always rendering `#7f1d1d` regardless of theme, making the apparatus page look different in light mode

### TypeScript Build Fix (2026-03-04)

- **TS2345 category color state**: `useState` for `newCategoryColor` was initialized with `DEFAULT_CATEGORY_COLOR`, which had a narrow literal type of only the first color option. Added `CategoryColor` union type and annotated the constant to widen the inferred state type

### WebSocket CSRF Fix (2026-03-04)

- **WebSocket CSRF dependency error on `/api/v1/inventory/ws`**: The `verify_csrf_token` dependency was applied globally to the API router but failed on WebSocket connections because it expected a `Request` object. Changed parameter type to `HTTPConnection` (base class of both `Request` and `WebSocket`) and added early return for WebSocket scope, since CSRF protection is HTTP-specific and the WebSocket endpoint already uses JWT authentication

### ResponseValidationError Fix (2026-03-04)

- **ProspectResponse metadata field returning SQLAlchemy MetaData object**: The schema used `alias="metadata"` which caused Pydantic's `from_attributes` to read `obj.metadata` (SQLAlchemy's MetaData object) instead of `obj.metadata_` (the actual JSON column). Switched to `serialization_alias` so Pydantic reads the correct attribute but still outputs `"metadata"` in JSON

### Docker Build Fixes (2026-03-04)

- **Frontend Docker build failure**: Fixed `vite-plugin-pwa` peer dependency conflict with Vite 7. Root cause: no `package-lock.json` existed in the frontend Docker context, causing npm to resolve dependencies from scratch each build
- **Resilient Dockerfile**: Frontend Dockerfile now uses `npm install --legacy-peer-deps` to handle both version mismatches and peer dependency conflicts. Lock file made optional via glob pattern
- **Backend `.dockerignore`**: Added `backend/.dockerignore` to reduce Docker build context from 343MB

### Alembic Migration Fixes (2026-03-04)

- **Duplicate revision ID causing graph walk failure**: Fixed Alembic migration graph walk failure caused by duplicate revision IDs. Added `.stale` file recovery to migration cleanup and fixed regex deprecation warnings
- **Type-annotated migration format support**: 11 migration files used Alembic's newer `revision: str = "..."` format which the regex patterns didn't match, making those files invisible and causing 4 apparent broken chain references
- **SQLAlchemy relationship overlap warnings**: Fixed `back_populates` on `Event.recurrence_children`/`recurrence_parent` and `StorageArea.parent`/`children` self-referential relationships that caused `SAWarning` at startup

### Form-to-Pipeline Integration Hardening (2026-03-04)

- **13 form-to-pipeline improvements**: Complete form-to-pipeline integration hardening including server-side validation, label-based fallback for all integration types, O(N) cleanup query fix, form validation before save, step update lifecycle fix, and field compatibility checks
- **Form data not flowing to prospective member pipeline**: Fixed multiple issues where form submissions were not appearing in the prospective members pipeline — including field mapping failures on reprocessed submissions
- **Duplicate prospect detection**: Added duplicate prospect detection with email notification when a prospect with the same email already exists
- **Pipeline form validation**: Added field compatibility checks before save — warns when form fields don't match expected pipeline field mappings
- **Form deletion protection**: Forms linked to active pipelines are now protected from deletion with clear error messaging
- **form.integration_type**: Added direct label-mapping path for pipeline integrations, simplifying form-to-pipeline configuration

### Reports Module Expansion (2026-03-04)

- **12 report types in dedicated feature module**: Expanded the Reports module from inline views into a dedicated feature module with 12 report types covering training, attendance, membership, apparatus, inventory, compliance, and more

### Email Template Enhancements (2026-03-04)

- **Configurable default CC/BCC per email template**: Each email template now supports default CC and BCC addresses. BCC support added for scheduled emails
- **Email template enum sync test**: Added sync test to prevent drift between code-defined and DB-defined email template type enums. Fixed missing `duplicate_application` enum value in the database
- **Email template 500 error fix**: Fixed 500 error on email templates endpoint caused by missing `duplicate_application` value in DB enum

### Modal Click-Through Fix (2026-03-04)

- **Modal backdrop intercepting clicks on dialog buttons**: Fixed the `Modal` component backdrop intercepting click events that should reach dialog buttons, causing delete confirmations and other actions to be unresponsive

### Major Toolchain Upgrades (2026-03-03)

- **React 18 → 19**: Upgraded React and react-dom to version 19; updated refs to use callback-based patterns where needed; fixed test utilities for React 19 compatibility
- **Vitest 3 → 4**: Upgraded Vitest to version 4 and Zod to version 4; updated test patterns for new Vitest APIs
- **ESLint v8 → v9 with flat config**: Migrated from `.eslintrc.json` to `eslint.config.js` (flat config format); updated all `@typescript-eslint` packages for ESLint 9 compatibility
- **Tailwind CSS v3.4 → v4.2**: Migrated from Tailwind v3 to v4 with CSS-first configuration; removed `tailwind.config.js`; updated 200+ component files with v3→v4 class name changes; rebuilt `index.css` with `@theme` directives
- **Safe patch dependency updates**: Updated 20+ frontend dependencies to latest safe patch versions

### Forms Module Enhancements (2026-03-02)

- **Integration health dashboard**: New dashboard showing integration processing status, result display per submission, and ability to reprocess failed integrations
- **Form dropdown selector and field mapping UI**: Redesigned integration configuration with dropdown-based form selection and visual field mapping interface
- **Survey results panel**: New `FormResultsPanel` component with per-field aggregation for survey-style forms (charts, counts, response summaries)
- **Form builder UX improvements**: Highlight incomplete fields with visual indicators; improved novice user experience with guided tooltips and simplified interface
- **Industry-standard form builder**: Upgraded FormBuilder and FormRenderer with drag-and-drop reordering (@dnd-kit), field duplication, conditional visibility, calculated fields, and hidden fields
- **Public form fixes**: Fixed doubled `/v1` in public form API URL causing 404 errors; removed forced name/email section from public forms (now optional per form configuration)
- **Forms permission fix**: Fixed Forms page visibility — now uses `forms.view` permission instead of `settings.manage`, making forms accessible to non-admin users with proper permissions
- **Theme compatibility**: Fixed form editor background and tab text colors for light/dark theme compatibility

### Prospective Members Pipeline Improvements (2026-03-02)

- **Comprehensive pipeline management**: Added bulk stage operations, stage duplication, inline stage editing, pipeline export/import, and analytics dashboard to PipelineSettingsPage
- **Event linking to pipeline stages**: Stages can now link to specific events; applicant detail drawer shows linked event information
- **Automated email stage type**: New `automated_email` stage type sends configurable email templates to applicants when they reach a stage; includes email template selection, variable interpolation, and send delay configuration
- **Form dropdown stage type**: New `form_dropdown` stage type links a form from the Forms module to a pipeline stage for applicant data collection
- **Meeting stage type**: New `meeting` stage type for scheduling interviews or orientation meetings with applicants
- **Status page toggle**: Pipeline stages can now optionally appear on the public application status page
- **Stage reorder fix**: Fixed intermittent 500 error on pipeline stage reorder endpoint caused by race condition in sort order calculation; also fixed 422 error on step reorder

### Inventory CSV Import (2026-03-02)

- **CSV import with template**: New ImportInventory page for bulk importing inventory items via CSV upload; includes downloadable sample CSV template with all supported fields
- **Backend validation**: Import endpoint validates CSV headers, data types, category references, and duplicate serial numbers before processing
- **Frontend tests**: Added comprehensive test coverage for the import flow

### Email Template Redesign (2026-03-02)

- **2-column tabbed layout**: Redesigned email template page from 3-column layout to 2-column tabbed layout for improved usability on smaller screens

### Events Module Fix (2026-03-02)

- **Events settings page fix**: Fixed events settings page not loading due to 422 validation errors in the API endpoint; refactored endpoint request/response handling

### Bug Fixes (2026-03-02)

- **Circular chunk dependency**: Fixed Vite manual chunk configuration that caused circular dependency between vendor chunks, resulting in `useLayoutEffect` runtime error
- **Stale lockfile**: Fixed stale frontend `package-lock.json` missing `@dnd-kit` dependencies after form builder upgrade

### Testing Checklist (2026-03-02)

- **Comprehensive testing coverage audit**: Updated TESTING_CHECKLIST.md with detailed coverage for all modules including forms, pipeline, inventory, scheduling, and elections
- **35 recommendation audit**: Reviewed and documented implementation status of all 35 testing recommendations with specific file references and action items

### Mobile Member ID Scanner (2026-03-02)

- **Camera-based member ID scanning**: New `MemberIdScannerModal` component lets admins scan a member's QR/barcode ID card to instantly look up and select them during inventory checkout, replacing manual name search
- **Mobile toolbar layout fix**: Fixed mobile toolbar layout so the "Scan Member ID" button is accessible alongside search and filter controls

### ARIA Accessibility & 610 New Tests (2026-03-02)

- **ARIA accessibility improvements**: Added `aria-label`, `aria-labelledby`, `aria-describedby`, `role` attributes across modals, forms, buttons, badges, and interactive elements (ElectionBallot, ElectionResults, CandidateManagement, ProxyVoting, FieldRenderer, FormBuilder, SubmissionViewer, ConfirmDialog, ReturnItemsModal, VoterOverride, AllEntriesTab, PageTransition, SuccessAnimation, EventTypeBadge, RSVPStatusBadge, PrivacyNotice)
- **610 new frontend tests**: Added comprehensive test suites for services (`authService`, `communicationsServices`, `documentsService`, `electionService`, `eventServices`, `formsServices`, `userServices`, `errorTracking`), stores (`adminHoursStore`, `apparatusStore`, `membershipStore`), and utilities (`apiCache`, `dateFormatting`, `eventHelpers`, `lazyWithRetry`, `passwordValidation`, `storeHelpers`)
- **Security dependency updates**: Updated backend `requirements.txt` with 10 security-related package updates

### Frontend Architecture Overhaul (2026-03-02)

- **exactOptionalPropertyTypes enabled**: Enabled `exactOptionalPropertyTypes` across entire frontend (57 files updated), preventing accidental `undefined` assignment to optional properties
- **API service split**: Split monolithic `services/api.ts` (5,330 lines) into 13 domain-specific service files (`adminServices`, `apiClient`, `authService`, `communicationsServices`, `documentsService`, `electionService`, `eventServices`, `facilitiesServices`, `formsServices`, `inventoryService`, `meetingsServices`, `trainingServices`, `userServices`)
- **Route module extraction**: Extracted all inline route definitions from `App.tsx` into dedicated module `routes.tsx` files (action-items, admin, documents, events, facilities, forms, integrations, inventory, minutes, notifications, settings, training, elections, membership, apparatus, admin-hours, communications); `App.tsx` reduced from ~500 lines to a thin orchestrator
- **Additional strict TypeScript flags**: Enabled `noImplicitReturns`, `noImplicitOverride`, `allowUnreachableCode: false`, `allowUnusedLabels: false`
- **Module component decomposition**: Decomposed large page components into focused sub-components:
  - `AdminHoursManagePage` → `ActiveSessionsTab`, `AllEntriesTab`, `CategoriesTab`, `PendingReviewTab`, `SummaryTab`
  - `ApparatusDetailPage` → `ApparatusDetailHeader`, `ApparatusOverviewTab`, `DocumentsTab`, `EquipmentTab`, `FuelLogsTab`, `MaintenanceTab`, `OperatorsTab`
  - `ShiftSettingsPanel` → `ApparatusTypeDefaultsCard`, `DepartmentDefaultsCard`, `PositionNamesCard`, `ResourceTypeDefaultsCard`, `TemplatesOverviewCard`, `PositionListEditor`
- **Lazy loading standardization**: All module route files use `lazyWithRetry()` for consistent chunk-loading resilience
- **Module registry expansion**: Updated `types/modules.ts` with missing modules and metadata for all 20+ feature modules

### Backend Modernization (2026-03-02)

- **Python typing modernization**: Applied `pyupgrade --py313-plus` across 56 backend files — replaced `Optional[X]` with `X | None`, `List[X]` with `list[X]`, `Dict[K,V]` with `dict[K,V]`, `Tuple` with `tuple`, and legacy `Union` types
- **IP spoofing vulnerability fix**: Hardened `X-Forwarded-For` header parsing in security middleware to prevent IP spoofing; only trusts the rightmost untrusted IP
- **Deprecated API cleanup**: Removed deprecated `on_event` startup/shutdown handlers in favor of lifespan context manager; fixed deprecated `datetime.utcnow()` calls in core modules

### Module Architecture Improvements (2026-03-02)

- **Type safety for module APIs**: Added full TypeScript typing to `prospective-members/services/api.ts` and `scheduling/services/api.ts` with proper request/response types
- **Public-portal and scheduling module structures**: Completed module directory structures with barrel exports, route files, and type definitions
- **Error handling unification**: Unified error handling patterns across all module Zustand stores with consistent `toAppError()` / `getErrorMessage()` usage

### MissingGreenlet Fixes (2026-03-02)

- **Remaining services fixed**: Added `selectinload()` eager loading across all remaining backend services that accessed lazy-loaded SQLAlchemy relationships in async contexts
- **Email template endpoints**: Fixed MissingGreenlet on email template create/update/list operations
- **Template timestamp refresh**: Added explicit timestamp refresh on `create_template` to prevent MissingGreenlet when serializing response

### Email Template Enhancements (2026-03-02)

- **Default templates added**: Added missing default email templates for ballot notifications, event reminders, and training due alerts
- **Organization logo in all templates**: All email templates now include the organization's logo in the header
- **Email scheduling**: Added ability to schedule email sends for a future date/time
- **Election ballot variables**: Template preview includes election-specific variables (ballot title, candidates, voting deadline)
- **Live org data in preview**: Template preview now loads real organization data instead of placeholder values
- **Member dropdown for test emails**: Preview panel includes a member selector to send test emails to specific members
- **Template variable fixes**: Fixed variable interpolation in template preview rendering

### Mobile & PWA Improvements (2026-03-02)

- **PWA shortcuts**: Added shortcut links to the PWA manifest for quick access to Dashboard, Events, and Scheduling
- **Push notification claims corrected**: Removed misleading push notification feature claims from mobile module; clarified that notifications are email + in-app only
- **Mobile module repair**: Fixed broken `usePullToRefresh` hook, wired pull-to-refresh into Dashboard, corrected feature capability claims

### Email Notification Templates & Management (2026-03-01)

- **Email Templates Management Page**: Full admin page for creating, editing, previewing, and deleting email notification templates with per-type sample context data for realistic previews
- **10 new email template types**: Added `event_reminder`, `shift_reminder`, `training_due`, `certification_expiring`, `election_opened`, `admin_hours_approved`, `admin_hours_rejected`, `maintenance_due`, `membership_renewal`, and `welcome_new_member` template types from application audit
- **MySQL ENUM migration**: New Alembic migration syncs the `email_template_type` database ENUM with the Python model to prevent insertion errors when using newly added template types

### Admin Hours Enhancements (2026-03-01)

- **Edit pending entries**: Members can now edit their pending admin hours entries before approval (update duration, category, notes)
- **Active sessions management**: New UI for viewing and managing active clock-in sessions; fixed stale sessions response bug where sessions from other users could appear
- **Naive vs aware datetime fix**: Fixed crash when comparing timezone-naive and timezone-aware datetime objects in active sessions display
- **MissingGreenlet fix**: Added `selectinload()` eager loading for relationships in admin hours service to prevent async lazy-load errors

### Shift & Scheduling Improvements (2026-03-01)

- **Expanded shift editing**: Officers can now edit shift times, apparatus assignment, color, notes, and custom creation times directly from the shift detail panel
- **Inline position change**: New inline UI for changing member position assignments on shift cards without opening a modal

### Training Registry & Imports (2026-03-01)

- **Standalone registry generator tool**: New CLI tool (`scripts/generate_registry.py`) for generating training requirement registries from NFPA, NREMT, and Pro Board standards with `--list` flag to show existing registries
- **Source field on imports**: Training requirement imports now include a `source` field in the API schema with source filter support
- **Source URL citations**: Registry imports display `source_url` citation links for traceability
- **Last-updated dates**: Registry imports show `last_updated` timestamps and source info in the UI

### Member ID Card Improvements (2026-03-01)

- **Rank display name**: ID card now shows the rank display name (e.g., "Lieutenant") instead of the slug (e.g., "lieutenant")
- **Preserved rank casing**: Rank labels maintain proper casing from the database rather than being transformed
- **Generated date footer**: ID card footer now includes the date the card was generated for verification

### CSS & Design System Overhaul (2026-03-01)

- **873 inline styles migrated**: Hard-coded inline styles across the frontend migrated to shared CSS component classes for maintainability and theme consistency
- **Focus ring standardization**: Hard-coded focus ring colors migrated to a CSS theme variable (`--focus-ring`) across 39 frontend files
- **Semantic color restoration**: Fixed semantic color damage from PR #491's blanket color replacement (restored status colors, severity indicators, and contextual badges)

### Bug Fixes (2026-03-01)

- **Session idle timeout blocking logins**: Fixed MySQL timezone mismatch causing idle timeout checks to evaluate all sessions as expired, blocking all logins
- **Login 500 on transient DB failures**: Login endpoint now handles transient database connection failures gracefully instead of returning HTTP 500
- **PlatformAnalyticsPage crash**: Fixed crash when `module.recordCount` is undefined by adding defensive null checks
- **Missing modules**: Standard modules (Dashboard, Membership, Scheduling, etc.) now default to enabled; Settings UI redesigned with module cards
- **OrganizationSettings.redacted() AttributeError**: Fixed crash in settings redaction method; also closed auth secret leak that could expose sensitive configuration
- **Elections module**: Fixed type errors, missing required fields, CSS visual issues, and code quality problems across election pages

### Database & Infrastructure (2026-03-01)

- **MySQL outage resilience**: Improved connection pool resilience to transient MySQL outages with automatic reconnection and health check queries
- **Deprecated auth plugin removed**: Removed `mysql_native_password` auth plugin flag from Docker Compose, using MySQL 8's default `caching_sha2_password` instead
- **Backend formatting**: Applied Black formatting to 9 additional backend files with pre-existing violations

### Scheduling Module Refactor (2026-02-28)

#### Architecture Overhaul
The scheduling module has been refactored from a monolithic 1,200-line page component into a proper modular architecture:

- **Dedicated module directory**: `frontend/src/modules/scheduling/` with services, store, components, and barrel export
- **Scheduling Zustand store** (`schedulingStore.ts`): Centralized state management for shifts, templates, patterns, members, and apparatus with async actions
- **Dedicated API service** (`modules/scheduling/services/api.ts`): All scheduling API calls moved out of the global `services/api.ts` into a module-scoped axios client using the shared `createApiClient` factory
- **ShiftSettingsPanel component**: New scheduling configuration panel for notification preferences, shift rules, and coverage settings
- **SchedulingNotificationsPanel component**: Notification management for shift reminders and scheduling alerts
- **InlineConfirmAction UX component**: New reusable component for inline confirmation actions (e.g., "Are you sure?" before destructive operations), with comprehensive tests
- **Scheduling store tests**: Unit tests for store state management and async actions
- **SchedulingPage slimmed**: Main page reduced from ~1,200 lines to a thin orchestrator that delegates to the store and sub-components

### Code Quality & Review Improvements (2026-02-28)

#### Shared API Client Factory
- **`createApiClient()` utility** (`utils/createApiClient.ts`): New factory function that creates pre-configured axios instances with interceptors (auth refresh, CSRF, caching). Eliminates ~300 lines of duplicated axios setup across module services (admin-hours, apparatus, prospective-members, public-portal)
- All module API services now use `createApiClient()` instead of manually configuring interceptors

#### 20+ Review Fixes Across Security, A11y, and Code Quality
- **Facilities & admin hours endpoints**: Added `require_permission` guards on unprotected admin endpoints
- **Organization settings**: Restricted PATCH endpoints to org-scoped fields, preventing unintended updates to billing/internal fields
- **Training endpoints**: Added input validation for pagination parameters and sanitized error details
- **HIPAA cache exclusions**: Expanded `UNCACHEABLE_PREFIXES` in `apiCache.ts` with `/admin-hours/`, `/facilities/`, `/organizations/` endpoints
- **Date formatting**: Enhanced `dateFormatting.ts` utilities with improved timezone handling, graceful fallbacks for invalid dates, and expanded test coverage
- **Error handling**: Improved `toAppError()` type narrowing for non-Error thrown values
- **Idle timer**: Fixed potential memory leak in cleanup path
- **Analytics & error tracking**: Defensive null checks for edge cases
- **Modal accessibility**: Added `aria-labelledby` and `aria-describedby` attributes
- **AppLayout accessibility**: Skip-to-content and skip-to-navigation links for keyboard users
- **LoadingSpinner**: Added `role="status"` and `aria-label` for screen readers
- **Login page**: Added `aria-live="polite"` region for error messages
- **ProtectedRoute**: Improved loading/error state accessibility
- **Prettier config**: Added `.prettierrc.json` for consistent formatting across the frontend

### Mobile Responsiveness Improvements (2026-02-28)

- **Pagination**: Responsive layout collapses page numbers to prev/next on small screens
- **Settings page**: Responsive grid for settings sections, collapsible on mobile
- **User settings**: Mobile-friendly form layout
- **Dashboard**: Improved card grid for small viewports
- **Apparatus list**: Responsive card/table layout toggle
- **Member profile**: Mobile-friendly profile sections
- **Inventory pages**: Responsive table with horizontal scroll on mobile
- **Scheduling reports**: Mobile-friendly report cards
- **Prospective pipeline**: Kanban and table views adapt to screen width
- **Ballot builder**: Improved touch targets for election ballot items
- **Field editor**: Mobile-friendly form field editor
- **Admin hours manage**: Responsive management dashboard
- **Global CSS**: Added `scrollbar-gutter: stable` and improved responsive utility classes

### Frontend Deployment Cache Refresh (2026-02-28)

#### Proactive Version Detection
- **`useAppUpdate` hook**: Monitors app version via a build timestamp injected into `index.html` as a `<meta>` tag. Periodically checks the deployed `index.html` for a newer version. Includes tests
- **`UpdateNotification` component**: When a new version is detected, displays a non-intrusive notification bar prompting the user to refresh. Includes tests
- **Nginx `X-App-Version` header**: Frontend nginx config now sends a version header for cache-busting verification
- **Vite build plugin**: Injects `BUILD_TIMESTAMP` into the HTML at build time via a custom Vite plugin

### Security Hardening — Continued (2026-02-28)

#### Brute-Force Protection (Backend & Frontend)
- **Progressive rate limiting**: Login endpoint now applies increasing delays after repeated failures (exponential backoff)
- **IP-based lockout**: Configurable lockout after N failed attempts from the same IP
- **Per-user lockout**: Separate tracking for per-username failed attempts
- **Frontend rate limiting**: Login and forgot-password pages now enforce client-side submission rate limiting with countdown timers, preventing rapid-fire login attempts
- **Auth store rate limiting**: `authStore` tracks last attempt timestamp and enforces minimum intervals between login attempts

#### IDOR & Open Redirect Fixes
- **Documents endpoint**: Added organization-scoped validation to prevent cross-org document access
- **Training endpoints**: Added authorization checks ensuring users can only access training data within their organization
- **API redirect validation**: Response interceptor now validates redirect URLs against allowed origins, preventing open redirect attacks
- **API cache security**: Added `/documents/` and `/training/` to `UNCACHEABLE_PREFIXES`

#### Security Alert Persistence & Audit
- **Security alerts persisted to database**: New `SecurityAlert` model and migration (`20260228_0100_add_security_alerts_table.py`) stores alerts with severity, type, description, source IP, and resolution status
- **`rehash_chain` endpoint**: Exposed API endpoint to rebuild the audit log hash chain for integrity verification after archival
- **Audit archival**: Scheduled task that archives audit logs older than a configurable threshold while maintaining hash chain integrity
- **Audit log export**: New endpoint for exporting audit logs with date range filters and format options
- **Audit deletion logging**: All audit log deletion operations are themselves logged for accountability
- **Hardened file logs**: File-based log rotation with secure permissions and restricted access paths

### Navigation Fixes (2026-02-28)

- **Module enablement**: SideNavigation and TopNavigation now dynamically show/hide menu items based on module enablement settings from organization configuration
- **Navigation sync**: TopNavigation items synced with SideNavigation to ensure consistent page access from both navigation modes
- **Logo navigation**: Fixed logo click behavior to navigate to the dashboard instead of an incorrect route
- **Emergency contacts**: Added emergency contacts section to the account/profile page

### Member ID Card Improvements (2026-02-28)

- **Rank and member since year**: ID card details section now shows the member's rank and the year they joined
- **Barcode in membership number box**: Barcode display combined into the membership number section for a cleaner layout
- **Org logo fix**: Organization logo now correctly displays on the ID card using the proper image URL resolution

### Design & Accessibility Audit (2026-02-28)

- **Light/dark theme audit**: Comprehensive review and fix of color contrast across all pages in both light and dark modes
- **High-contrast mode**: Verified compatibility with the high-contrast theme
- **Mobile audit**: Verified responsive behavior across breakpoints for all pages
- **`useMediaQuery` hook**: New hook for responsive behavior in components (replaces inline `window.matchMedia` calls)
- **Form field renderer**: Improved contrast and focus states for form inputs across themes
- **QR code pages**: Fixed contrast issues on event QR code and self-check-in pages
- **Onboarding pages**: Fixed theme variable usage for consistent appearance
- **Error boundary**: Improved dark mode styling

### Test Stability (2026-02-28)

- **132 pre-existing test failures → 0**: Fixed all test failures across 14 test files including EventForm, ActiveSkillTestPage, EventCreatePage, EventDetailPage, EventEditPage, EventQRCodePage, EventSelfCheckInPage, EventsPage, SchedulingPage, SkillsTestingPage, and authStore tests
- **Mock data alignment**: Test mock data updated to match current API response shapes and enum values
- **Vitest config**: E2E tests excluded from the Vitest runner (they run separately via Playwright)

### Data Integrity Fixes (2026-02-28)

- **Enum synchronization**: Frontend `enums.ts` constants synchronized with backend enum values for event types, membership types, and scheduling statuses
- **Election schemas**: Added missing ballot-related Pydantic schemas for proper API validation
- **Scheduling schemas**: Added missing fields to scheduling response schemas
- **Training models**: Added missing relationship columns for skills testing integration
- **Members page**: Fixed type-safe access to membership statistics
- **Minutes page**: Fixed optional property access patterns

### Backend Formatting & Cleanup (2026-02-28)

- **Black formatting**: Applied consistent Black formatting across 35 backend files
- **Missing imports**: Fixed missing `Depends` import in multiple endpoint files
- **Code organization**: Improved service method signatures and error handling patterns across scheduling, training, inventory, and organization services

### Digital Member ID Card (2026-02-28)

#### New Feature: Member Identification Cards with QR Code and Barcode
A new page at `/member-id` that displays a digital member ID card for each member, suitable for on-screen display, printing, and scanning.

- **QR code**: Encodes the member's unique ID for quick lookup via phone camera or QR scanner
- **Barcode**: Code128 barcode for compatibility with handheld barcode scanners
- **Barcode scanner support**: Built-in scanner page that reads barcodes and navigates to the member's profile
- **Print-optimized styles**: Dedicated `@media print` stylesheet produces a wallet-sized card with department logo, member photo, name, rank, badge number, and membership type
- **Keyboard shortcuts**: `Ctrl+P` to print, `Esc` to close the scanner
- **Responsive layout**: Card renders at ID card proportions on mobile and desktop

### Skills Testing Enhancements (2026-02-28)

#### Statement Criteria Type
- **New criterion type: `statement`** — Allows open-ended text-box responses on skill sheets (e.g., "Describe the patient's chief complaint"). Evaluators can require or optionally score statement responses
- **Global time limit units changed from seconds to minutes** for more intuitive configuration

#### Test Visibility Controls
- **Admin-controlled visibility**: Training officers can toggle which completed tests are visible to the candidate member vs. visible only to officers
- **Visibility column** on the tests list with toggle switch for officers

#### Practice Mode
- **Non-graded practice tests**: Members can take tests in practice mode without affecting their official records
- **Practice test UX flow**: Reordered start page, email results option, discard results, and retake flow
- **Practice badge**: Clear visual indicator distinguishing practice tests from official evaluations

#### Point-Based Scoring
- **Weighted scoring**: Criteria can now carry variable point values (not just binary pass/fail), enabling more nuanced skill evaluation
- **Section point subtotals**: Each section displays points earned vs. points possible
- **Overall percentage**: Calculated from total points rather than simple criterion count

#### Post-Completion Review & Detail View
- **Post-completion review screen**: After completing a test, examiners see a full review with section-by-section notes before finalizing
- **Full detail view for completed tests**: Replaces the previous summary-only view with expandable section details, individual criterion scores, and examiner notes
- **Auto-stop clock**: Timer automatically stops when the test is completed, preventing inflated elapsed times
- **UTC timezone fix**: Completed test times now display in the user's local timezone instead of raw UTC

#### Test Management
- **Delete test records**: Training officers can now permanently delete test records (with confirmation dialog)
- **Non-critical criteria display fix**: Criteria not marked as critical no longer show "FAIL" status when unchecked — they display as "Not Completed" to avoid confusion

#### Skills Testing Navigation
- Admin sidebar now includes direct links to Skills Testing sub-pages
- Regular users see a "My Skills Tests" link under Training

### Dashboard Improvements (2026-02-28)

- **Split shift display**: Dashboard now shows two separate sections — "My Upcoming Shifts" (assigned to you) and "Open Shifts" (available for signup), replacing the previous single list
- **Shift signup error extraction**: Error messages from failed shift signups now correctly extract and display the server-provided detail instead of showing generic errors
- **Vehicle linking on templates**: Shift templates can now be linked to actual department vehicles (from the Apparatus module), replacing the previous free-text vehicle field

### Fire Department Shift Pattern Presets (2026-02-28)

#### New Feature: Built-In Shift Rotation Patterns
Pre-configured shift patterns commonly used by fire departments, selectable via a presets dropdown in the pattern creation form:

| Preset | Pattern | Description |
|--------|---------|-------------|
| **24/48** | 1 on / 2 off | Most common US fire department rotation |
| **48/96** | 2 on / 4 off | Common in Western US departments |
| **Kelly Schedule** | 24 on / 24 off / 24 on / 24 off / 24 on / 96 off | 9-day cycle, three platoons |
| **California 3-Platoon** | 24 on / 24 off / 24 on / 48 off | Modified Kelly for 3 platoons |
| **ABCAB** | 3 days with varying on/off | 5-day rotation used by some departments |

- **Custom pattern builder**: For departments with non-standard rotations, a custom builder allows defining arbitrary on/off day sequences with visual preview
- **Pattern preview calendar**: Shows a 30-day preview of the generated schedule before committing

### Admin Hours Improvements (2026-02-28)

- **Prominent clock-out card**: Active session banner replaced with a full-width card showing elapsed time, category, and a prominent "Clock Out" button — harder to miss than the previous slim banner
- **Pagination**: Entries list supports pagination for departments with high volume
- **Filters**: Filter entries by status (pending/approved/rejected), category, member, and date range
- **Bulk approve**: Select multiple pending entries and approve them in one action
- **CSV export**: Export filtered admin hours data to CSV for external reporting
- **Validation improvements**: Better error messages for overlapping sessions and invalid date ranges
- **Dashboard integration**: Admin hours summary widget on the main Dashboard page
- **Reports integration**: Admin hours data included in the Reports page
- **Member Profile integration**: Individual member's admin hours visible on their profile page
- **Department Overview integration**: Aggregate admin hours statistics in the Department Overview

### Security Hardening (2026-02-28)

#### Encryption at Rest
- **AES-256 encryption** for sensitive database fields using `ENCRYPTION_KEY` and `ENCRYPTION_SALT` environment variables
- Encrypted fields include emergency contacts, medical information, and other PII

#### Docker Hardening
- **Read-only root filesystems** on application containers with explicit tmpfs mounts for writable paths
- **`no-new-privileges`** security option on all containers
- **Dropped capabilities** — containers run with minimal Linux capabilities

#### Network & Infrastructure
- **Content Security Policy tightening**: Removed overly permissive directives, added strict `script-src` and `style-src` policies
- **Redis ACL restrictions**: Redis now uses ACL-based authentication instead of simple password, limiting command access
- **Redis bind to container network**: No longer listens on all interfaces
- **Removed `upgrade-insecure-requests`** CSP directive from frontend nginx config (caused issues in mixed HTTP/HTTPS environments)

#### Vulnerability Fixes
- **XSS fix in email sending**: User-supplied values in email templates are now HTML-escaped before rendering
- **Critical vulnerability patches**: Security audit across frontend, backend, and infrastructure addressing injection vectors, missing input validation, and unsafe deserialization

### HIPAA Language Corrections (2026-02-28)

- Replaced self-declared "HIPAA compliant" claims with accurate language: "features aligned to HIPAA requirements" and "HIPAA compliance requires external review and cannot be self-declared"
- Updated across codebase: README, wiki, security documentation, frontend UI text, and marketing copy

### Dynamic Import Fix — lazyWithRetry (2026-02-28)

- **New utility: `lazyWithRetry()`** (`utils/lazyWithRetry.ts`) wraps `React.lazy()` with retry logic for chunk load failures after deployments
- When a deployment changes asset hashes, users with cached `index.html` get 404 errors on JS chunks. `lazyWithRetry` catches these failures and retries the import up to 3 times with cache-busting query parameters
- All lazy-loaded route-level pages now use `lazyWithRetry()` instead of bare `React.lazy()`

### Platform Analytics Fix (2026-02-28)

- **camelCase serialization**: Platform analytics response schemas now use `alias_generator=to_camel` and `populate_by_name=True`, matching the frontend's expected field names
- Fixes the Platform Analytics dashboard for IT admins showing empty/error state

### Bug Fixes (2026-02-28)

- **Auto-default shift officer**: When creating a shift, if a member is assigned the "Officer" position, they are automatically set as the shift officer
- **Scheduling module hardening**: Added type safety, error message sanitization via `safe_error_detail()`, input validation, and shift conflict detection
- **Runtime error fixes**: Null-safe analytics access, eager-load timestamps on models, safe stats object access — prevents crashes on pages with missing data
- **AdminSummary type fix**: Fixed type mismatch between backend response and frontend interface that caused build failure
- **ResponseValidationError fix**: Added `db.refresh()` after `db.flush()` to ensure SQLAlchemy populates computed columns before Pydantic serialization
- **Fix Invalid Date display**: `formatTime()` and `formatDate()` now handle bare time strings (e.g., "08:00:00") and null values without producing "Invalid Date"
- **Docker Compose env fix**: Optional service environment variables (MinIO, Elasticsearch, Mailhog) now use `:-` default syntax instead of `:?` required syntax, preventing startup failures when optional profiles are inactive

### Admin Hours Logging Module (2026-02-27)

#### New Feature: Administrative Hours Tracking with QR Code Clock-In/Clock-Out
A standalone module for tracking administrative work hours (committee meetings, building maintenance, fundraising, etc.) via QR code scanning or manual entry, with configurable approval workflows.

##### Backend
- **AdminHoursCategory** and **AdminHoursEntry** models with Alembic migration
- **AdminHoursService** with clock-in/out, manual entry, and approval workflow
- REST API endpoints under `/api/v1/admin-hours`
- Permissions: `admin_hours.view`, `admin_hours.log`, `admin_hours.manage`
- Configurable approval thresholds and auto-approve settings per category

##### Frontend
- Full `admin-hours` module (types, API service, Zustand store, routes)
- **AdminHoursManagePage**: category CRUD, pending review queue, all entries, summary dashboard
- **AdminHoursPage**: personal hours log, active session indicator, manual entry form
- **AdminHoursQRCodePage**: printable QR code per category for posting at work locations
- **AdminHoursClockInPage**: QR scan landing page with clock-in/clock-out flow
- Sidebar navigation entries for both members and admins

##### API Endpoints (under `/api/v1/admin-hours/`)
- `GET    /categories` — List categories
- `POST   /categories` — Create category
- `PATCH  /categories/{id}` — Update category
- `DELETE /categories/{id}` — Delete category
- `POST   /clock-in` — Clock in to a category
- `POST   /clock-out` — Clock out of active session
- `POST   /manual-entry` — Submit manual hours entry
- `GET    /entries` — List entries (with filters)
- `GET    /my-entries` — List personal entries
- `PATCH  /entries/{id}/approve` — Approve entry
- `PATCH  /entries/{id}/reject` — Reject entry
- `GET    /summary` — Hours summary dashboard

##### Database Models
- **AdminHoursCategory**: name, description, auto-approve settings, approval threshold minutes
- **AdminHoursEntry**: user, category, clock_in/clock_out timestamps, duration, status (pending/approved/rejected), notes, approver

### Member Categories for Training Requirements (2026-02-27)

#### Enhancement: Targeted Training Requirements by Membership Type
- Add `required_membership_types` JSON column to `training_requirements` table so requirements can target specific member categories (Active, Administrative, Probationary, Life, Retired, Honorary)
- Add member category checkboxes in the Edit Requirement modal, shown when "Applies to all members" is unchecked
- Display selected member categories in requirement cards and expanded details
- Update backend filtering in `training_service` and `training_module_config` to respect `required_membership_types` when evaluating which requirements apply

#### Enhancement: Permanent Delete for Training Requirements
- Change `DELETE /training/requirements/{id}` from soft-delete (`active=False`) to permanent delete (`db.delete`) with updated confirmation messaging
- Alembic migration for the new column

### QR Code & Analytics Improvements (2026-02-27)

- **Relabel "Analytics" to "QR Code Analytics"**: Navigation items in side nav, top nav, and Events Admin Hub tab now accurately reflect that the analytics page shows QR code check-in metrics only
- **Fix QR code display on Locations & Rooms page**: Rooms now show a toggleable QR code for their kiosk display URL (uses `qrcode.react` QRCodeSVG)
- **Fix clipboard copy fallback**: Added `document.execCommand('copy')` fallback when `navigator.clipboard` is unavailable (e.g., non-HTTPS contexts)
- **Fix stale closure in EventQRCodePage**: Refresh interval no longer captures outdated `fetchQRData` callback

### Centralized Backend Logging (2026-02-27)

- **New `app/core/logging.py`**: Centralized logging configuration with text/JSON output, file rotation, stdlib interception (routes uvicorn/sqlalchemy/alembic through Loguru), Sentry SDK initialization, and request-scoped correlation IDs via ContextVar
- **Request correlation**: UUID4 request IDs attached to every log entry for tracing requests across services
- **Request duration tracking**: INFO-level completion logs with method, path, status code, and duration in milliseconds
- **Updated `main.py`**: Uses `setup_logging()`/`setup_sentry()` instead of inline configuration

### Shift Pattern & Scheduling Fixes (2026-02-27)

- **Weekday convention mismatch fix**: Frontend sends JS weekday numbers (0=Sun) but backend used Python's `date.weekday()` (0=Mon). Weekly patterns now generate shifts on the correct days
- **Template error clarity**: Distinguishes between "no template linked to pattern" and "linked template was deleted"
- **Duplicate guard relaxed**: Shift overlap check now compares date + start_time, allowing multiple shift types per day (e.g., day shift and night shift)
- **Shift conflict detection**: Backend prevents duplicate assignment of a member to the same shift and detects overlapping time conflicts
- **Shift officer assignment**: Officer dropdown added to Create Shift modal and ShiftDetailPanel edit form
- **Understaffing badges**: Calendar shift cards show amber warning triangle when `attendee_count < min_staffing`
- **Template colors on calendar**: Shifts carry `color` from their template; calendar cards use inline styling with fallback to hour-based classes
- **UniqueConstraint on ShiftAssignment**: `(shift_id, user_id)` constraint with IntegrityError catch for concurrent requests
- **Overlap query hardening**: Scoped to ±1 day of `shift_date` to prevent false positives
- **Pattern generation enrichment**: Generated shifts now include apparatus details, min_staffing, and color
- **Dashboard shift fix**: Changed from `getMyShifts()` (user-only) to `getShifts()` to show all org shifts
- **`formatTime()` fix**: Bare time strings like "08:00:00" no longer produce Invalid Date
- **Vehicle type on Standard templates**: Vehicle type dropdown now shown for Standard category (was Specialty only)
- **EMS renamed to EMT**: Position label updated across all files
- **Route ordering fix**: `/shifts/open` moved before `/shifts/{shift_id}` to prevent route shadowing
- **Data enrichment**: All shift responses now populate `shift_officer_name`, `attendee_count`, `user_name` on assignments/swaps/time-off, and embedded shift data on my-assignments
- **`exclude_unset` on PATCH**: Clients can now explicitly clear optional fields (notes, apparatus_id)

### Elections Module Fixes & Enhancements (2026-02-27)

- **Fix election detail page not loading**: Route param mismatch (`/:id` vs `useParams<{ electionId }>`) caused `fetchElection()` to never fire — page hung on loading
- **Fix election stalling for ballot-item elections**: `open_election` now allows elections with only ballot items (approval votes, resolutions) to proceed without requiring candidates
- **Fix close_election error messages**: Returns descriptive error instead of misleading "Election not found" for wrong-status elections
- **Meeting link**: Elections can be linked to formal meeting records via `meeting_id` FK with Alembic migration; meeting selector dropdown in creation form
- **Voter overrides**: `VoterOverrideManagement` component for secretary to grant voting eligibility overrides
- **Proxy voting**: `ProxyVotingManagement` component for proxy voting authorization management
- **API response fix**: `getVoterOverrides` now correctly handles `{ overrides: [...] }` response shape

### Organization Settings Enhancement (2026-02-27)

- **Email settings**: Platform selector (Gmail, Outlook, Custom SMTP), OAuth credentials, SMTP encryption fields, exposed as `PATCH /settings/email`
- **File storage settings**: Provider selector (Google Drive, OneDrive, S3, Local) with provider-specific configuration, exposed as `PATCH /settings/file-storage`
- **Authentication settings**: Provider-specific config fields (LDAP, SAML, OAuth), exposed as `PATCH /settings/auth`
- These settings were originally only configurable during onboarding; now accessible in Organization Settings for post-setup changes
- Secret fields use password inputs with show/hide toggle
- Info banners note settings were initially set during onboarding

### Code Quality & Security (2026-02-27)

#### ESLint & TypeScript Cleanup
- Fix 565 floating/misused promise ESLint warnings across 99 files (added `void` operator, wrapped async handlers)
- Add generic type parameters to 94 axios calls to eliminate `no-unsafe-return` warnings
- Replace non-null assertions with safe alternatives (nullish coalescing, optional chaining, guards)
- Replace `any` types with `unknown` or proper types across services, tests, and utilities
- Fix `react-refresh/only-export-components` warnings
- Result: **0 ESLint errors, 0 warnings**

#### Security & Routing Fixes
- Add CSRF double-submit token to module API clients (apparatus, prospective-members, public-portal)
- Fix `FieldEditor` number min/max inputs bound to wrong state
- Move `/application-status/:token` route outside `ProtectedRoute` for unauthenticated access
- Add permission gates to apparatus create/edit (`apparatus.manage`) and forms/integrations routes (`settings.manage`)
- Fix token refresh race condition in apparatus API client
- Fix `usePWAInstall` memory leak (event listener never removed)
- Complete incomplete enums: `on_leave` in UserStatus, all values in StageType and ApplicantStatus

### Public Outreach Event Request Pipeline (2026-02-26)

#### New Feature: Community Event Request System
A complete pipeline for community members to request public outreach events (fire safety demos, station tours, CPR classes, career talks). Requests flow through a flexible, department-configurable workflow before becoming scheduled calendar events.

##### Event Request Pipeline Core
- **Public Request Form**: Generated via the Forms module with EVENT_REQUEST integration; includes contact info, event type, description, audience details, venue preference, and flexible date preferences
- **Flexible Date Selection**: Requesters express preferences ("a Saturday morning in March") rather than committing to exact dates; three modes — specific dates, general timeframe, or fully flexible
- **Configurable Outreach Types**: Departments define their own outreach event types (e.g., Fire Safety Demo, Station Tour, CPR/First Aid Class) via Settings — not hardcoded
- **Simplified Status Flow**: `submitted → in_progress → scheduled → completed` with `postponed`, `declined`, and `cancelled` branches
- **Configurable Pipeline Tasks**: Department-defined checklist items (review request, assign coordinator, confirm date, plan content, arrange volunteers, prepare equipment) that can be completed in any order
- **Task Reorder**: Up/down arrows in Settings to control default task display order; departments can add custom steps like Chief approval or volunteer signup emails
- **Auto-Transition**: Completing the first pipeline task automatically moves the request from `submitted` to `in_progress`

##### Coordinator Assignment & Workflow
- **Default Coordinator**: Departments configure a default assignee (e.g., Public Outreach Officer) who auto-receives all new requests with email notification
- **Reassignment**: Coordinators can reassign requests to other org members from the request detail view
- **Comment Thread**: Replaces single-note field with a threaded comment system; multiple team members leave notes over time, displayed alongside status changes in a unified activity feed

##### Scheduling with Room Booking
- **Schedule Dialog**: Coordinators set a confirmed date/time and optionally select a room/location when transitioning to "Scheduled"
- **Calendar Event Creation**: Scheduling automatically creates an Event record linked to the request, appearing on the department calendar
- **Double-Booking Prevention**: Room selection validates against `LocationService.check_overlapping_events()` — prevents scheduling conflicts
- **Confirmed Date Display**: Requesters see the confirmed date on the public status page once scheduled

##### Postpone & Cancel
- **Postpone Status**: New `POSTPONED` status with optional rescheduled date or open-ended TBD
- **Department Cancel**: Coordinators can cancel requests at any active stage
- **Requester Self-Cancel**: Community members cancel their own request from the public status page via their status token
- **Resume Work**: Postponed requests can be moved back to `in_progress` to resume planning

##### Email Notifications & Templates
- **Configurable Email Triggers**: Per-status-change toggles (on_submitted, on_scheduled, on_postponed, on_completed, on_declined, on_cancelled, days_before_event)
- **Auto-Notify**: Assignee notified on new request; requester notified on status changes (when enabled)
- **Email Template CRUD**: Departments create reusable email messages (e.g., "How to Find Our Building", "Volunteer Signup Instructions") with template variables (`{{contact_name}}`, `{{outreach_type}}`, `{{event_date}}`)
- **Manual Send**: Coordinators send any template to the requester from the request detail view
- **Auto-Trigger Support**: Templates can be linked to pipeline triggers (e.g., auto-send directions 7 days before event)

##### Public Status Page
- **Token-Based Access**: Each request gets a unique status URL for the requester — no login required
- **Progress Stepper**: Visual 4-step stepper (Submitted → In Progress → Scheduled → Completed)
- **Postponed Display**: Shows postponed state with tentative reschedule date or "TBD" messaging
- **Optional Pipeline Progress**: Department-configurable toggle to show/hide pipeline task progress on public page (progress bar + task checklist)
- **Self-Service Cancel**: Requester can cancel with an optional reason from the status page

##### Admin Settings (Events Settings Tab)
- **Event Type Visibility**: Toggle which event types show as primary filter tabs vs. grouped under "Other"
- **Outreach Types Configuration**: Add/remove custom outreach event types
- **Default Coordinator Picker**: Dropdown of all org members for auto-assignment
- **Public Progress Visibility Toggle**: Show/hide planning progress on public status page
- **Minimum Lead Time**: Configurable days-in-advance requirement (default 21 days / 3 weeks)
- **Pipeline Task Management**: Add, remove, and reorder checklist tasks
- **Email Trigger Toggles**: Enable/disable notifications per status change
- **Email Template Management**: Create, edit, delete reusable email templates
- **Form Generation**: One-click public form creation in the Forms module

##### Admin Request Queue (Event Requests Tab)
- **Status Filter Chips**: Filter by status with count badges
- **Request List**: Summary rows with contact, type, date preference, audience size, assignee, and task progress
- **Expandable Detail**: Full request info with contact, event details, date preferences, description, special requests
- **Task Checklist**: Interactive pipeline task toggles in the detail view
- **Assignment UI**: Assign/reassign coordinator dropdown
- **Schedule Dialog**: Date/time picker + room selector with double-booking check
- **Postpone Dialog**: Reason field + optional tentative date
- **Comment Thread**: Inline comment input with enter-to-submit
- **Copy Status Link**: One-click clipboard copy of the requester's status URL
- **Send Email**: Template picker with send button from the request detail
- **Activity Log**: Unified timeline of status changes, task completions, assignments, comments, and emails sent

##### API Endpoints (14 endpoints under `/api/v1/event-requests/`)
- `POST   /public` — Submit public request (no auth)
- `GET    /status/{token}` — Check status by token (no auth)
- `POST   /status/{token}/cancel` — Requester self-cancel (no auth)
- `GET    /` — List requests (auth, `events.manage`)
- `GET    /{id}` — Get request detail (auth)
- `PATCH  /{id}/status` — Update status (auth)
- `PATCH  /{id}/assign` — Assign coordinator (auth)
- `POST   /{id}/comments` — Add comment (auth)
- `PATCH  /{id}/schedule` — Schedule with date + room (auth)
- `PATCH  /{id}/postpone` — Postpone request (auth)
- `PATCH  /{id}/tasks` — Toggle pipeline task (auth)
- `POST   /{id}/send-email` — Send template email (auth)
- `GET    /email-templates` — List templates (auth)
- `POST   /email-templates` — Create template (auth)
- `PATCH  /email-templates/{id}` — Update template (auth)
- `DELETE /email-templates/{id}` — Delete template (auth)
- `GET    /types/labels` — Get outreach type labels (no auth)
- `POST   /generate-form` — Generate public form (auth)

##### Database Models
- **EventRequest**: Core request model with flexible date fields (`date_flexibility`, `preferred_timeframe`, `preferred_time_of_day`), `task_completions` JSON, confirmed event fields (`event_date`, `event_end_date`, `event_location_id`), composite indexes on `(organization_id, status)` and `(organization_id, outreach_type)`
- **EventRequestActivity**: Audit trail for all actions — status changes, task completions, comments, assignments, email sends
- **EventRequestEmailTemplate**: Per-org reusable email templates with trigger configuration and days-before scheduling

##### Frontend Components
- **EventsSettingsTab** (`frontend/src/pages/EventsSettingsTab.tsx`) — Full settings interface with outreach types, pipeline tasks, default assignee, email triggers, templates, form generation
- **EventRequestsTab** (`frontend/src/pages/EventRequestsTab.tsx`) — Admin queue with expandable detail, task checklist, assignment, comments, scheduling, postpone, email send
- **EventRequestStatusPage** (`frontend/src/pages/EventRequestStatusPage.tsx`) — Public token-based status page with stepper, progress bar, cancel

##### Documentation
- **Changelog**: This entry
- **Troubleshooting**: Added Public Outreach Request Pipeline section to `docs/TROUBLESHOOTING.md` with common issues and sample public education materials
- **Wiki**: Updated `wiki/Module-Events.md` with outreach request pipeline reference; added `wiki/Public-Programs.md` how-to guide with sample programs
- **Training Guide**: Updated `docs/training/04-events-meetings.md` with public outreach section
- **Wiki Sidebar**: Added Public Programs link to sidebar navigation
- **Docs Index**: Updated `docs/README.md` with new documentation entries

### Skills Testing Module (2026-02-25)

#### New Feature: Digital Psychomotor Skills Evaluations
- **Skill Sheet Templates**: Reusable evaluation templates with sections, criteria, scoring configuration (passing percentage, critical criteria enforcement, time limits), versioning (draft → published → archived), and duplication
- **Skills Test Sessions**: Full test administration workflow — create test, select template + candidate, score criteria in real time, complete with automatic pass/fail calculation
- **Critical Criteria (Auto-Fail)**: Required criteria that trigger automatic failure regardless of score, mirroring NREMT psychomotor evaluation rules
- **Scoring Engine**: Automatic calculation of section scores, overall percentage, critical criteria compliance, elapsed time, and pass/fail determination
- **Template Versioning**: Auto-incrementing version numbers on structural changes; historical tests reference the version they were administered under
- **Summary Dashboard**: Department-wide statistics — total templates, published count, total tests, tests this month, pass rate, and average score
- **12 API Endpoints** under `/api/v1/training/skills-testing/`:
  - Templates: list, create, get, update, delete (archive), publish, duplicate
  - Tests: list, create, get, update (save progress), complete
  - Summary: department-wide statistics
- **Database Models**: `SkillTemplate` and `SkillTest` with composite indexes on `(organization_id, status)` and `(organization_id, category)` / `(template_id, candidate_id)`
- **Pydantic Schemas**: Full CRUD schemas with nested section/criteria structures, denormalized response fields (template name, candidate/examiner names), and computed counts
- **Audit Logging**: All template and test operations logged via `log_audit_event`
- **Organization Scoping**: All queries scoped to current user's organization
- **Permissions**: Template management requires `training.manage`; test creation open to all authenticated users

#### Frontend (Skills Testing UI)
- **Skills Testing Page**: Tabbed interface (Templates / Tests / Summary) with responsive layout
- **Template Management**: Full CRUD with section/criteria builder, inline editing, drag-and-drop ordering
- **Test Administration**: Real-time scoring interface with section-by-section criteria checkboxes, running score display, timer, and critical criteria tracking
- **Results View**: Score breakdown by section, missed steps highlighted, pass/fail determination with critical criteria details
- **Summary Dashboard**: Six stat cards showing department-wide testing metrics
- **TypeScript Types**: Complete type definitions for all skills testing entities
- **API Integration**: Axios service layer with all 12 endpoints
- **Zustand Store**: State management for templates, tests, filters, and UI state
- **Routing**: Three routes under `/training/skills-testing` (templates, tests, summary)

#### Documentation
- **Feature Specification**: `docs/SKILLS_TESTING_FEATURE.md` — Full requirements document with data models, UI/UX screens, API endpoints, and implementation phases
- **Training Guide**: `docs/training/09-skills-testing.md` — End-user training document with realistic NREMT Trauma Assessment walkthrough example
- **Troubleshooting**: Added Skills Testing section to `docs/TROUBLESHOOTING.md`
- **Changelog**: This entry
- **Wiki**: Updated Module-Training wiki page with skills testing section and API endpoints
- **Documentation Index**: Updated `docs/README.md` and `docs/training/README.md`

### Dependency Updates, Security Hardening & UX Improvements (2026-02-24)

#### Backend Dependency Updates (Python 3.13 Compatibility)
- **cryptography** 43.0.3 → 44.0.0 (Python 3.13 support)
- **greenlet** 3.3.1 → 3.3.2
- **hiredis** 3.0.0 → 3.1.0
- **python-ldap** 3.4.4 → 3.4.5
- **psutil** 6.1.1 → 7.0.0
- **Pillow** 11.1.0 → 11.3.0 (image processing)
- **argon2-cffi** 23.1.0 → 25.1.0 (password hashing)
- **reportlab** 4.2.5 → 4.3.0 (PDF/label generation)
- **pysaml2** 7.5.0 → 7.5.4 (SAML authentication)
- **pytest-asyncio** 0.24.0 → 0.25.0
- **black** 24.10.0 → 25.1.0 (code formatter)
- **flake8** 7.1.1 → 7.2.0 (linter)

#### Frontend Dependency Updates
- **@typescript-eslint/eslint-plugin** and **@typescript-eslint/parser** 8.21.0 → 8.56.1 (fixes TypeScript 5.9 compatibility; old versions required `<5.8.0`)
- **@vitest/coverage-v8** and **@vitest/ui** 3.0.0 → 3.2.4 (aligned with vitest 3.2.4; fixes `npm install` ERESOLVE failure)
- **esbuild** override 0.25.0 → 0.27.0 (match Vite 7.3.1 peer dependency)
- **postcss** 8.5.0 → 8.5.6 (match Vite 7.3.1 peer dependency, eliminate dual instances)
- **react-hook-form** 7.54.2 → 7.71.1 (deduplicate with @hookform/resolvers)
- **jsdom** (root) ^24.1.3 → ^26.0.0 (align with frontend)
- **@types/dompurify** moved from `dependencies` to `devDependencies`
- Removed redundant `vite` override from `frontend/package.json` (root handles it)

#### Security Fixes (Insider Threat Analysis — 19 Findings)
- **Token storage**: Removed localStorage JWT storage; authentication now uses httpOnly cookies exclusively
- **WebSocket security**: WebSocket endpoint now validates user is active (not just JWT signature)
- **Permission enforcement**: Added `require_permission` to user list, role query, and profile endpoints that were previously open to any authenticated user
- **Error log injection**: Replace raw dict with Pydantic schema + 4KB context size limit on error log endpoint
- **Cross-org auth prevention**: Scoped authentication query to organization to prevent cross-org authentication
- **CSRF protection**: Wired up `verify_csrf_token` as global dependency on `api_router`
- **Onboarding lockdown**: Block onboarding session creation if organization already exists
- **Docker security**: Removed insecure default values from `docker-compose.yml`; credentials now require `.env` configuration
- **Voting token**: Moved voting token from URL query param to request body (prevents token leakage in server logs)
- **File upload safety**: File extension now derived from detected MIME type, not user-supplied filename
- **Error tracking**: Strip query params from URLs in error tracking to prevent token leaks
- **SQL injection prevention**: Escape backticks in DDL table/column names; drop tables individually
- **Mass assignment prevention**: Added explicit field allowlists to `setattr` update loops in elections, events, external training, and inventory endpoints

#### Docker & Infrastructure
- **MinIO env vars**: Changed MinIO service environment variables from `:?` (required) to `:-` (default) syntax. Docker Compose validates `:?` variables even for inactive profiles (`with-s3`), causing startup failures for users who don't need S3 storage. MinIO credentials are now optional with sensible defaults.
- **Memory resource limits**: Added `deploy.resources.limits` and `reservations` to all docker-compose services

#### Bug Fixes
- **Training compliance mismatch**: Dashboard "Training Compliance" showed 0% while Training Admin showed 100% due to different data sources. Extracted shared `compute_org_compliance_pct()` used by both endpoints.
- **Waiver off-by-one**: Fixed rolling period waiver adjustment calculation (12-month rolling period spanning 13 calendar months now correctly adjusts denominator)
- **Facilities 500 error**: Fixed `ResponseValidationError` on `GET /api/v1/facilities` where the service returned `(items, total)` tuple but the endpoint returned it directly without unpacking
- **Auto-create facility**: Onboarding now auto-creates a "Station 1" facility from the organization's physical address
- **Circular chunk dependency**: Fixed Vite manual chunk splitting that caused `React.memo` to be undefined at runtime due to circular dependency between vendor chunks
- **Stale asset 404s**: Added `Cache-Control: no-cache` headers to `index.html` so browsers always fetch fresh asset references after deployments
- **Runtime null safety**: Comprehensive audit and fix of patterns that could cause runtime crashes from undefined data (API response arrays, optional chaining, fallback defaults across 10+ components)
- **TypeScript strict null checks**: Resolved all `tsc` build errors caused by strict null/undefined checks across 56 frontend source files
- **Migration startup crashes (Unraid)**: Multiple fixes for Alembic migration failures on Unraid's union filesystem (shfs): retry with backoff, stale `__pycache__` cleanup, SQL-based stamp fallback, diagnostic logging
- **Public portal timestamp overflow**: `datetime.isoformat()` produced 32-char strings exceeding `String(26)` columns; replaced with `strftime` helper
- **Inventory barcode**: Fixed barcode not showing in edit form after label generation; fixed Total Value not reflecting purchase price
- **Audit logging**: Fixed `log_audit_event()` call in `update_organization_profile` using wrong parameter names
- **Login page dark mode**: Fixed white text on white background in dark mode by using theme-aware gradient background
- **Migration collision**: Resolved revision ID collision between storage_areas and write-offs migrations

#### Training & Waiver Enhancements
- **New Member waiver type**: Added `NEW_MEMBER` to waiver type enums for long-service members exempt from requirements
- **Permanent waivers**: End date is now optional; permanent waivers show purple "Permanent" badge; calculation layer maps null end_date to far-future sentinel
- **Waiver multi-select**: "Applies To" field converted from single-select to checkboxes (Training, Meetings, Shifts can be combined)
- **Auto-set Training Type**: Selecting a Requirement Type now auto-populates Training Type and Due Date Type (e.g., certification → cert_period)
- **Smart field visibility**: Year and Frequency fields are hidden when not relevant to the selected due date type

#### Accessibility & UX
- **Alt text**: Added meaningful alt text to all avatar/logo images
- **Skip-to-content**: Fixed skip-to-content link targeting empty element outside React root
- **Focus-visible**: Added `focus-visible` styles to suppress focus rings on mouse clicks
- **High-contrast theme**: New accessibility theme with pure black/white, yellow focus rings, and stronger borders
- **ARIA form validation**: Added `aria-describedby` linking validation errors to inputs, with `aria-invalid` and `role="alert"`
- **Print CSS**: Added `@media print` hiding navigation, resetting backgrounds, showing link URLs, preventing page breaks
- **Bulk selection & export**: Added checkboxes and CSV export for member list and events list
- **PWA install prompt**: Added install prompt on Dashboard with `beforeinstallprompt` handler
- **Recent Activity feed**: New Dashboard section showing latest notification entries in timeline layout
- **Command Palette**: Ctrl+K shortcut for search, navigation, and admin actions
- **26 new UX components**: Skeleton loading, Breadcrumbs, Pagination, EmptyState, ConfirmDialog, Tooltip, ProgressSteps, TopProgressBar, SuccessAnimation, DateRangePicker, FileDropzone, InlineEdit, AutoSaveIndicator, WhatsNew modal, SortableHeader, Collapsible, PageTransition, and 6 new hooks (keyboard shortcuts, relative time, unsaved changes, pull-to-refresh, optimistic updates, form auto-focus)

#### Inventory Module
- **My Equipment cards**: Cards now show item name, quantity, category badge, and assignment date
- **Dashboard fixes**: Active Checkouts, Maintenance Due, and Low Stock alerts now use accurate queries
- **Maintenance tracking tab**: New tab with overdue/due-soon/in-maintenance sections and Log Maintenance modal
- **Storage Areas**: New feature with hierarchical model (rack/closet → shelf → box), full CRUD, tree view, and integration with Add/Edit Item modals
- **Detail chips**: Inventory list items now show size, color, and asset tag as compact colored chips
- **Broader search**: Backend search now matches barcode, manufacturer, model, size, and color

#### Code Quality & Performance
- **useAutoSave hook**: Fixed interval reset on every keystroke and broken JSON.stringify comparison
- **Vite chunk splitting**: Manual chunk splitting for vendor-react, vendor-router, vendor-ui, vendor-charts, vendor-date, vendor-state bundles
- **Lazy-load DOMPurify**: Dynamic import on form submit instead of bundle-time import
- **ESLint no-console**: Added warn rule on `console.log` (allow warn/error)
- **Strict index access**: Enabled `noUncheckedIndexedAccess` in tsconfig for stricter null safety
- **Centralized constants**: Extracted hardcoded values to `constants/config.ts` (API_TIMEOUT_MS, DEFAULT_PAGE_SIZE, etc.)
- **Pre-commit hooks**: Added Python linting (black, flake8, isort) to pre-commit hooks for backend files

#### Testing
- **Frontend unit tests**: ErrorBoundary, Modal component tests; authStore (12 cases), errorHandling (9 cases)
- **E2E tests**: Playwright tests for navigation, dashboard, and auth flows
- **Backend tests**: Auth/security, inventory service (30 tests), security middleware (CSRF, rate limiter, input sanitization)
- **Alembic migration tracking**: New `docs/ALEMBIC_MIGRATIONS.md` documenting complete chain of 114 migrations

#### Documentation
- **Insider threat analysis report**: Comprehensive report identifying 19 security findings with recommended fixes and prioritization

### Training Compliance & Waiver Management (2026-02-23)

#### Training Module Enhancements
- **LOA–Training Waiver auto-linking**: Creating a Leave of Absence now automatically creates a linked training waiver with matching dates. Changes to the leave's dates sync to the waiver. Deactivating the leave also deactivates the linked waiver. Opt out per-leave with the `exempt_from_training_waiver` flag.
- **Rank & station snapshot on training records**: `rank_at_completion` and `station_at_completion` are now captured automatically when a training record is created or a submission is approved.
- **Bulk training record creation**: New `POST /training/records/bulk` endpoint accepts up to 500 records per request with per-record error reporting and duplicate detection.
- **Duplicate detection**: Single and bulk record creation now warns when a record with the same member + course name (case-insensitive) + completion date (±1 day) already exists.
- **Compliance summary card**: Member profile page now shows a compliance indicator (green/yellow/red) with requirements met/total, hours this year, active certs, and expiring certs.
- **Certification expiration alerts**: Tiered in-app and email notifications at 90, 60, 30, and 7 days before expiration with escalation to officers. Expired certs trigger escalation to training, compliance, and chief officers.
- **Program enrollment notifications**: Members now receive in-app notifications when enrolled in a training program and when they complete a program.
- **Compliance calculations document**: New `docs/training-compliance-calculations.md` documents every formula, edge case, and integration point for training compliance.

#### Waiver Management
- **Waiver Management Page** (`/members/admin/waivers`): New unified page for managing all waivers (training, meetings, shifts). Three tabs: Active Waivers, Create Waiver, and All Waivers (history). Create form supports "Applies To" selector for choosing All (LOA + auto training waiver), Training Only, or Meetings & Shifts Only.
- **Training Waivers officer tab**: New tab in the Training Admin Dashboard showing all training waivers with summary cards (Active/Future/Expired/Total), status badges, filterable by status and member search, and source tracking (Auto LOA vs Manual).
- **Navigation**: Waivers link added under Members in the sidebar.

#### Membership Module Enhancements
- **Member Admin Edit page** (`/members/admin/edit/:userId`): Full admin member editing with all fields, rank/station dropdowns, status management, and role assignment.
- **Member self-edit**: Members can now edit their own limited profile fields (phone, email, address, emergency contacts) from their profile page.
- **Photo upload**: Profile photo upload with image preview and crop.
- **Delete member modal**: Confirmation dialog for member deletion with clear warnings about irreversible data loss.
- **Audit history page** (`/members/admin/history/:userId`): View complete change history for a member with timestamped entries showing who made each change.
- **Data consistency fixes**: Added missing `list_ids`, `committee_ids`, `group_ids` fields; removed unused `photo_url` column; wired up delete modal across admin views.

#### Rank Validation
- **Rank validation endpoint**: New `GET /users/rank-validation` surfaces active members whose rank does not match any of the organization's configured operational ranks.
- **Admin visibility**: Rank mismatches are surfaced in the Members Admin Hub for training officers and administrators to review and correct.

#### UI & UX
- **15-minute time increments**: All date/time pickers in the application now enforce 15-minute step increments (`step="900"`), including the check-in/check-out override pickers which previously allowed 1-minute granularity.

#### Database Migration
- **`20260223_0100`**: Adds `rank_at_completion` and `station_at_completion` to `training_records`; adds `exempt_from_training_waiver` and `linked_training_waiver_id` to `member_leaves_of_absence`.

### Inventory Module Hardening & Comprehensive Overhaul (2026-02-22)

#### Inventory Module Overhaul
- **Pool / quantity-tracked items**: New `tracking_type` field (`individual` | `pool`) on `InventoryItem`. Pool items support `issue_from_pool` and `return_to_pool` workflows with quantity tracking.
- **Item issuances**: New `item_issuances` table and full CRUD lifecycle for tracking pool item issue/return with user, quantity, reason, and condition-on-return.
- **Batch operations**: `batch_checkout` and `batch_return` endpoints support multiple items in a single request with per-item error reporting. Silent condition fallback removed — invalid conditions are now rejected.
- **Category management**: New `PATCH /inventory/categories/{id}` endpoint for updating category name/description.
- **Departure clearance**: Full lifecycle (`initiate_clearance` → `resolve_line_item` → `complete_clearance`) for tracking property return when members depart.
- **Notification netting**: Offsetting actions (assign then unassign, checkout then return) automatically cancel pending notifications instead of creating duplicates.
- **Label generation**: `POST /inventory/labels/generate` now accepts a typed `LabelGenerateRequest` body with item IDs, label size, and label type.
- **Thermal printer labels**: Added support for Dymo (2.25×1.25″) and Rollo (4×6″) label sizes using Code128 barcodes via ReportLab.
- **AssignmentType validation**: `POST /inventory/items/{id}/assign` now validates `assignment_type` against the enum and returns 400 on invalid values.
- **Lookup by code**: Returns a list of matching items instead of a single result, handling duplicate barcodes/serial numbers gracefully.

#### Inventory Security & Data Integrity Hardening
- **Row-level locking**: Added `_get_item_locked()` helper using `SELECT FOR UPDATE`. Applied to `update_item`, `unassign_item`, `return_to_pool`, and `checkin_item` to prevent concurrent-modification races.
- **Expected-user guard**: `unassign_item` accepts optional `expected_user_id` parameter; batch operations pass this to prevent stale-read races where a concurrent assign could cause unassignment of the wrong user.
- **Read-only overdue query**: `get_overdue_checkouts` no longer performs a bulk `UPDATE` on every call. Overdue status is computed at read time. New `mark_overdue_checkouts` method added for scheduled tasks.
- **Clearance IDOR fix**: `resolve_line_item` now requires and validates `clearance_id`, preventing resolution of line items from a different clearance via URL manipulation.
- **Org-scoped unique constraints**: Removed global `unique=True` from `barcode` and `asset_tag` columns. Added composite `UniqueConstraint("organization_id", "barcode")` and `UniqueConstraint("organization_id", "asset_tag")` for proper multi-tenant isolation.
- **Alembic migration** (`20260222_0200`): Drops old global unique indexes, creates org-scoped unique constraints, and re-creates non-unique single-column indexes for bare-column lookups.
- **LIKE injection prevention**: Member search in `get_members_inventory_summary` now escapes `%`, `_`, and `\` in user-supplied search strings.
- **Kwargs injection prevention**: `create_maintenance_record` now uses a whitelist (`_MAINTENANCE_ALLOWED_FIELDS`) to filter incoming kwargs, preventing overwrite of `id`, `organization_id`, or other protected fields.

#### Inventory Performance
- **Lookup optimization**: `lookup_by_code` combined from 3 serial queries (barcode → serial → asset_tag) into 1 query with `OR`, reducing round-trips by 2/3.
- **Removed unnecessary eager loads**: `return_to_pool` and `checkin_item` no longer use `selectinload` for the item relationship — the item is fetched separately with a row lock.

#### Inventory Test Coverage
- **40 new tests** in `test_inventory_extended.py` covering: departure clearance lifecycle, notification netting, batch operations, label generation, category updates, pool item validation, and edge cases.
- All `resolve_line_item` test calls updated for new `clearance_id` parameter.

#### Frontend — Inventory & Scan Fixes
- **Scan modal error handling**: Differentiated 404 (item not found) from network errors with distinct user messages.
- **Camera scan memory leak**: Fixed stale closure in `useCallback` + `setInterval` by using a ref pattern (`handleCodeScannedRef`).
- **Member detail race condition**: `handleScanComplete` now awaits `loadMembers()` before fetching member detail, preventing stale data display.

### Event System Enhancements (2026-02-22)

#### Event Reminders
- **End-to-end reminder system**: Events support configurable `reminder_schedule` (array of minutes-before values). Reminders are sent via the notification system at the scheduled times.
- **Multiple reminder times**: Events can have multiple reminders (e.g., 24 hours before, 1 hour before).

#### Event Notifications
- **Post-event validation**: Event organizers receive a notification after an event ends, prompting them to review and finalize attendance.
- **Post-shift validation**: Shift officers receive a notification after their shift ends to validate attendance records.

#### Event UI Improvements
- **Past events tab**: The `/events` page now hides past events by default. Managers see a **Past Events** tab to browse historical events.
- **Attendee management**: Event detail page now supports adding/removing attendees directly.
- **Removed `eligible_roles`**: Simplified event model by removing the unused `eligible_roles` field.

### Notification System Enhancements (2026-02-22)

- **Time-of-day preferences**: Users can configure preferred notification delivery windows.
- **Notification expiry**: Notifications now support `expires_at` field; expired notifications are automatically hidden.
- **User notification inbox**: New in-app notification center for viewing and managing notifications.
- **Database migration** (`20260221_0800`): Added `action_url` column to `notification_logs`.
- **Database migration** (`20260221_0700`): Added `category` and `expires_at` columns to `notification_logs`.

### UI & Dark Mode Fixes (2026-02-22)

- **Dark mode modal backgrounds**: Fixed `bg-theme-surface` → `bg-theme-surface-modal` across 9 modal/dialog files for proper dark mode contrast.
- **Record Official Event Times modal**: Fixed dark mode styling.
- **Members Admin modals**: Refactored to use shared `Modal` component; added rank and station dropdowns replacing free-text inputs.
- **Training Admin**: Reorganized into 3 sub-pages with inner tabs for better navigation.

### Backend Quality & Security Fixes (2026-02-22)

#### Security Fixes
- Fixed security vulnerabilities, dead code, and silent error handling identified in comprehensive audit.
- Fixed quality issues across frontend and backend from audit.

#### DateTime Consistency
- Replaced all `datetime.utcnow()` calls with `datetime.now(timezone.utc)` across the entire backend (deprecated in Python 3.12+).
- Fixed offset-naive vs offset-aware datetime comparison bugs across event, training, and scheduling services.

#### Facilities Module
- Fixed facilities module bugs and added missing CRUD operations for locations and equipment.

#### Module Settings
- Fixed module selections not persisting from onboarding wizard to organization settings page.

### Badge Number Consolidation & Field Restrictions (2026-02-21)

#### Consolidate `badge_number` into `membership_number`
- **Database migration** (`20260221_0200`): Copies existing `badge_number` values into `membership_number` where NULL, then drops the `badge_number` column and its unique index.
- **Backend**: Removed `badge_number` from the User model, all Pydantic schemas (`UserBase`, `AdminUserCreate`, `UserUpdate`, `UserListResponse`, `UserResponse`), and all service/endpoint logic across auth, onboarding, training, inventory, forms, reports, and member status modules.
- **Frontend**: Renamed all `badge_number` / `departmentId` references to `membership_number` across types, services, pages, and components. UI labels updated from "Badge #" / "Department ID" to "Member #" / "Membership Number".
- **CSV imports**: `badge_number` is still accepted as a column alias for backward compatibility in training record imports.
- **Property return reports**: Dict key `member_badge_number` renamed to `member_number`; HTML template updated from "Badge #" to "Member #".

#### Restrict rank, station, and membership number edits
- **Backend**: Users without `members.manage` permission now receive a 403 error when attempting to update `rank`, `station`, or `membership_number` via the profile update endpoint. Previously rank was silently dropped and station had no restriction.
- **Frontend**: The rank, station, and membership number fields on the User Settings page are now disabled (grayed out) for users without `members.manage` permission.

#### Documentation & test fixes
- Updated all onboarding documentation (ONBOARDING.md, ONBOARDING_FLOW.md, wiki/Onboarding.md) to use `membership_number` instead of `badge_number`, correct endpoint `/system-owner` instead of `/admin-user`, correct route `/positions` instead of `/roles`, and correct `total_steps: 10`.
- Updated training documentation (01-membership.md) to remove badge_number as a separate field.
- Updated troubleshooting docs to reference "Duplicate Membership Number Error" instead of badge number.
- Fixed `test_onboarding_e2e.sh` to use the correct API endpoint and field names.
- Fixed stale placeholder text in 3 frontend search inputs and 4 backend docstrings/descriptions.

### Training Waiver Consistency & Meeting Attendance Fixes (2026-02-21)

#### Shared Training Waiver Service
- **New `training_waiver_service.py`**: Created a centralized service for all training waiver/leave-of-absence calculations. Merges data from both `training_waivers` (training-specific, supports per-requirement targeting) and `member_leaves_of_absence` (department-wide leaves from Member Lifecycle UI) into a uniform `WaiverPeriod` representation.
- **Consistent waiver adjustments across all compliance views**: Previously, training requirement adjustments for leaves of absence were only applied in the member's My Training self-view (`GET /my-training`). Now the same proportional adjustment formula (`adjusted = base × active_months / total_months`) is applied consistently in:
  - Compliance Matrix (`GET /training/compliance-matrix`)
  - Competency Matrix / Heat Map (`GET /training/competency-matrix`)
  - Individual Training Reports (`GET /training/reports/user/{id}`)
  - Per-Requirement Progress (`GET /training/requirements/progress/{id}`)
  - Program Enrollment Progress recalculation
- **Batch-fetch pattern**: Org-wide views (compliance matrix, competency matrix) use `fetch_org_waivers()` to load all waivers in a single query, avoiding N+1 database calls.
- **Requirement types adjusted**: Hours, Shifts, and Calls requirements are reduced proportionally. Courses and Certifications are not adjusted (they are binary completions).

#### Meeting Attendance — Leave of Absence Exclusion
- **Attendance Dashboard**: Meetings that fall within a member's active Leave of Absence are now automatically excluded from the attendance denominator. Officers no longer need to manually grant per-meeting waivers for members on formal leave. New `meetings_on_leave` field added to the dashboard response.
- **Voting Eligibility**: `MembershipTierService.get_meeting_attendance_pct()` now accounts for Leave of Absence periods when calculating attendance percentage for voting eligibility checks.

#### Documentation
- **New `TRAINING_WAIVERS.md`**: Comprehensive how-to guide covering: step-by-step UI workflow for creating leaves of absence, waiver calculation details (15-day threshold, overlapping deduplication, requirement types affected), all compliance views where adjustments are applied, API reference for both Member Leaves and Training Waivers endpoints, meeting attendance impact, example scenario, and FAQ.

#### Database Column Type Consistency
- **DateTime timezone awareness**: Added `timezone=True` to all DateTime columns across `election.py`, `event.py`, `minute.py`, and `training.py` models to ensure consistent UTC storage.
- **Enum migration**: Created migration `20260221_0100_fix_column_type_consistency.py` to convert `waiver_type` and `leave_type` columns from plain String to proper database ENUM types, matching the SQLAlchemy model definitions.

#### CI Pipeline
- **New `.github/workflows/ci.yml`**: Added GitHub Actions CI pipeline with backend linting (flake8), frontend build validation (TypeScript + Vite), and Python syntax checking.

### Dependency Updates & Hardcoded Value Elimination (2026-02-20)

#### Dependency Version Bumps (minor/patch only)

Safe, non-breaking upgrades to current stable versions.

**Backend (requirements.txt):**
- fastapi 0.115.6 → 0.129.0
- uvicorn 0.34.0 → 0.41.0
- pydantic 2.10.5 → 2.12.5
- pydantic-settings 2.7.1 → 2.13.1
- sqlalchemy 2.0.36 → 2.0.46
- alembic 1.14.0 → 1.18.4
- greenlet 3.1.1 → 3.3.1
- PyJWT 2.10.1 → 2.11.0
- jinja2 3.1.5 → 3.1.6
- sentry-sdk 2.20.0 → 2.53.0
- celery 5.4.0 → 5.6.2
- mypy 1.14.0 → 1.19.1

**Frontend (package.json):**
- lucide-react ^0.469.0 → ^0.575.0
- @vitejs/plugin-react ^4.3.4 → ^5.1.4 (Vite 7 alignment)
- typescript ^5.7.3 → ^5.9.3

**Intentionally skipped** (need dedicated migration effort):
React 19, React Router 7, ESLint 10, Tailwind 4, Zod 4, redis 7, bcrypt 5,
cryptography 46, Pillow 12, pytest 9, pytest-asyncio 1.3, black 26.

#### Centralized Constants — Eliminate Hardcoded Strings

Created single-source-of-truth constant files to replace ~110 hardcoded string
literals scattered across 43 files.

**New files:**
- `backend/app/core/constants.py` — centralized role group slugs, folder slugs,
  analytics event types, audit event types
- `frontend/src/constants/enums.ts` — 15 TypeScript const objects mirroring all
  backend Python enums (UserStatus, ElectionStatus, RSVPStatus, EventType,
  FormStatus, FieldType, TrainingStatus, VoteType, ConnectionStatus,
  FeatureStatus, HealthStatus, MembershipType, StageType, ApplicantStatus,
  CheckInWindowType)

**Backend changes (20 files):**
- Replaced scattered `["admin", "quartermaster", "chief"]` arrays (appeared in
  4 files) with `ADMIN_NOTIFY_ROLE_SLUGS` constant
- Replaced `["chief", "president", "vice_president", "secretary"]` (2 files)
  with `LEADERSHIP_ROLE_SLUGS`
- Replaced operational/administrative role arrays with `OPERATIONAL_ROLE_SLUGS`
  and `ADMINISTRATIVE_ROLE_SLUGS`
- Replaced ~50 string literal comparisons with Python enum members
  (e.g. `"completed"` → `TrainingStatus.COMPLETED.value`,
  `"going"` → `RSVPStatus.GOING`, `"section_header"` → `FieldType.SECTION_HEADER.value`)
- Replaced hardcoded folder slugs (`"facilities"`, `"events"`) with
  `FOLDER_FACILITIES`, `FOLDER_EVENTS`
- Replaced hardcoded analytics/audit event types with named constants

**Frontend changes (17 files):**
- Replaced ~60 string literal comparisons with constant references
  (e.g. `'active'` → `UserStatus.ACTIVE`, `'closed'` → `ElectionStatus.CLOSED`,
  `'approval'` → `VoteType.APPROVAL`, `'section_header'` → `FieldType.SECTION_HEADER`)

#### CSS Variable Cleanup — Eliminate Hardcoded Colors

**New CSS variables** (light + dark mode):
- `--toast-success`, `--toast-error`, `--toast-icon-secondary`
- `--toast-warning-bg`, `--toast-warning-text`
- `--status-passed`, `--status-failed`, `--status-pending`

**Components updated:**
- `App.tsx` — toast icon colors now use CSS variables
- `useIdleTimer.ts` — idle warning toast now uses CSS variables
- `tailwind.config.js` — new variables registered as theme colors

### Security & Stability Audit (2026-02-20)

Full codebase audit of all changes from 2026-02-19/20 identified and fixed 63 issues
across security, data integrity, accessibility, and reliability.

#### Critical Fixes — Security
- **Training records authorization**: `POST /records` and `PATCH /records/{id}` now require `training.manage` permission. Previously any authenticated user could fabricate training records for any member.
- **IDOR in scheduling requests**: Cancel button on swap/time-off requests now checks `req.user_id === currentUser.id`. Previously any member could cancel any other member's pending requests.
- **Permission enumeration**: `GET /permissions` and `GET /permissions/by-category` now require authentication. Previously exposed all permission names to anonymous users.
- **Mass-assignment prevention**: `PATCH /users/{id}/profile` now uses an explicit allowlist of safe fields instead of blind `setattr()` loop. Prevents potential overwrite of `password_hash`, `organization_id`, or `deleted_at`.

#### Critical Fixes — Data Integrity
- **Dashboard admin summary auth bypass**: Replaced raw `axios.get()` with authenticated `api` instance. Admin summary was always failing silently because the auth token was never sent.
- **Multi-tenant data leak in dashboard**: Minutes action items queries now filter by `organization_id` via `MeetingMinutes` join. Previously counted action items across all organizations.
- **Onboarding reset wrong table**: Changed `DELETE FROM user_roles` to `DELETE FROM user_positions` (the actual physical table name). Reset was silently failing, leaving stale junction rows.
- **str vs UUID comparison always False**: `remove_role_from_user` now uses `str(role.id) == str(role_id)`. Previously the endpoint always returned 404.
- **str vs UUID comparison always True**: `update_contact_info` self-check now uses `str(current_user.id) == str(user_id)`. Previously regular users could never update their own contact info.

#### Critical Fixes — MissingGreenlet / Async ORM
- **Training dashboard officer detection**: Replaced `current_user.roles` lazy access with eagerly-loaded `selectinload(User.roles)` query. Officers were silently treated as regular members; role-scoped requirements were never matched.
- **Welcome emails**: Captured `new_user.email`, `first_name`, `last_name`, `username` into local variables before commit. Background task was accessing expired ORM attributes.
- **Event cancellation notifications**: Captured `event.rsvps` into local list before `db.commit()`. Attendees were never notified of cancellations.
- **Training session finalization**: Captured `event.title`, `event.start_datetime`, `training_session.course_name` before commit and updated `_notify_training_officers` to accept scalar values instead of ORM objects.
- **Audit logging after commits**: Captured `role.name`, `user.username`, `user.full_name`, `member.full_name`, `program.name` before `db.commit()` across `add_role_to_user`, `delete_user`, and `enroll_member` endpoints.
- **Rank permission check**: Replaced lazy `current_user.roles` access with eagerly-loaded query in `update_user_profile`.

#### High — Reliability Fixes
- **Historical import savepoints**: Wrapped individual row `db.add()` in `async with db.begin_nested()` (savepoint). Previously one failed row poisoned the entire session.
- **hours_completed sum None guard**: Added `or 0` to all `sum(r.hours_completed ...)` generators in `training_service.py`. Previously crashed with `TypeError` when any record had `NULL` hours.
- **Biannual cert matching**: Added fallback `course_name.ilike()` filter when `training_type` is None. Previously any unrelated cert could falsely satisfy a requirement.
- **SubmitTrainingPage error state**: Added `loadError` state so the page shows a "Try Again" button instead of an eternal loading spinner when config API fails.
- **MemberProfilePage null guards**: Added `?.` and `?? []` guards on `response.enabled_modules` and `response.permanent_assignments` to prevent crashes when API returns unexpected shape.

#### Infrastructure
- **Nginx CSP header**: Added `Content-Security-Policy` header with restrictive defaults (`default-src 'self'`, `frame-ancestors 'none'`).
- **Nginx header inheritance**: Re-added security headers in `/api` and `/docs` location blocks (nginx doesn't inherit `add_header` from parent).
- **Migration MySQL compatibility**: Wrapped `DROP TYPE IF EXISTS` statements in try/except for MySQL compatibility in departure clearance and inventory notification migrations.

#### Accessibility (WCAG 2.1)
- **ShiftDetailPanel**: Added Escape key listener to close the panel.
- **MyTrainingPage**: Added `aria-expanded` to section toggle buttons.
- **ModuleSelection**: Added `role="button"`, `tabIndex={0}`, and keyboard handlers to module cards.
- **OrganizationSetup**: Added `aria-expanded` to SectionHeader buttons.

#### Theme / Dark Mode
- **MemberProfilePage**: Replaced light-mode-only badge colors (`bg-green-100 text-green-800`, `bg-red-50 text-red-700`) with dark-compatible variants (`bg-green-500/10 text-green-400`, `bg-red-500/10 text-red-400`).
- **MembersAdminPage**: Fixed role badges and error banners using light-mode-only colors.

### UI Improvements (2026-02-20)

#### Login Page
- **Larger logo**: Increased logo container from 96px to 144px tall (50% larger) for better visibility on the login page. Fallback icon scaled proportionally.

#### Member Deletion
- **New `DELETE /users/{user_id}` endpoint**: Soft-deletes a member by setting `deleted_at` timestamp. Requires `members.manage` permission. Prevents self-deletion. Audit-logged.
- **Delete button on Members page**: The existing trash can icon buttons (mobile and desktop) are now wired to the new delete endpoint with a confirmation prompt. Hidden for the current user's own row.
- **Delete button on Members Admin page**: Text "Delete" action button added alongside "Edit Info" and "Manage Roles".
- **Frontend service method**: Added `userService.deleteUser()` for the new endpoint.

### Fixed - Runtime Error Guards (2026-02-20)

#### Comprehensive Frontend Audit
Full audit of all frontend pages, components, hooks, stores, and services identified and fixed potential JavaScript runtime crashes from unguarded property access on API response data.

#### Pages Fixed
- **ImportMembers.tsx**: `rows[0].map()` now guards against empty CSV file uploads — previously crashed with "Cannot read property 'map' of undefined"
- **SchedulingPage.tsx**: `template.start_time_of_day` now checks template exists before access — previously crashed when no shift templates were configured
- **TrainingApprovalPage.tsx**: `data.attendees.map()` now falls back to empty array — previously crashed if API returned missing attendees
- **AnalyticsDashboardPage.tsx**: `metrics.deviceBreakdown`, `.hourlyActivity`, and `.checkInTrends` now use `|| {}` / `|| []` fallbacks — previously crashed if API returned partial metrics data
- **ElectionDetailPage.tsx**: `forensicsReport.anomaly_detection`, `.voting_timeline`, and `.audit_log` nested access now guarded with null checks — previously crashed if forensics report had missing sections
- **DocumentsPage.tsx**: `d.name.toLowerCase()` now checks `d.name` exists — previously crashed on documents with null name field

#### Components Fixed
- **ElectionResults.tsx**: `positionResult.candidates.map()` now uses `|| []` fallback — previously crashed if candidates array was missing from API response

#### Stores Fixed
- **prospectiveMembersStore.ts**: `pipeline.stages.find()` now uses `|| []` fallback — previously crashed if pipeline had no stages array

#### Member Profile Crash Fix
- **MemberProfilePage.tsx**: Fixed crash caused by `user.first_name[0]` when `first_name` was null/empty — added optional chaining and fallback to username initial
- **Nginx proxy buffer warning**: Increased `proxy_buffer_size` to 8k for `/api/v1/branding` to eliminate upstream response header warnings

### Fixed - Data Integrity & Backend Errors (2026-02-20)

#### Unique Badge Number Enforcement
- **Database constraint**: Added unique badge number per organization (`idx_user_org_badge_number`). Previously duplicate badge numbers could be silently created.
- **API validation**: Member creation endpoint now returns 409 Conflict for duplicate badge numbers with a clear error message.

#### Training Session Creation
- **Fixed broken training session creation**: The `POST /api/v1/training/sessions` endpoint was failing due to missing foreign key cascade on `training_attendees.session_id`
- **Removed dead nav link**: The "Certifications" link in navigation pointed to a non-existent route
- **Fixed TypeScript errors**: Resolved build errors in `CreateTrainingSessionPage.tsx`

#### Role/Position Endpoint Crash
- **Fixed `GET /api/v1/roles` crash**: `AttributeError: role_id` caused by incorrect column reference in the roles query

#### Data Connection Fixes
- **Locations**: Location dropdown in member creation now properly loads and saves location assignments
- **Roles**: Role assignment during member creation now correctly maps role IDs
- **Member creation**: Fixed field mapping mismatches between frontend form and backend API

#### Dashboard Zero-Member Fix
- **Fixed dashboard showing 0 members**: Admin summary queries were joining across organizations, causing count mismatches. Isolated queries to current organization.

#### Login & Authentication Fixes
- **Fixed login 500 error**: Added `User.roles` as synonym for `positions` relationship after taxonomy refactor, preventing `AttributeError` on login
- **Fixed 401 on organization save**: Stale session after database reset caused authentication failures

### Fixed - Scheduling Module (2026-02-20)

#### Shift Template Improvements
- **Auto-generated shift labels**: Shift names are now auto-generated from apparatus + shift type (e.g., "Engine 1 — Day Shift") instead of requiring manual entry
- **Day/Night/24hr defaults**: Default shift templates updated to Day Shift (07:00–19:00), Night Shift (19:00–07:00), and 24-Hour Shift (07:00–07:00)
- **Auto-computed end dates**: End date automatically calculates based on shift times (next day for overnight shifts)
- **Removed rank-based positions**: Captain/Lieutenant removed from shift position options since they are ranks, not staffing seats

#### Member Form & Location Fixes
- **Fixed member form dropdowns**: Status, rank, and membership type dropdowns now populate correctly
- **Fixed location wizard auto-fill**: Address fields in the location creation wizard now auto-populate when editing

### Added - Expanded Scheduling & Events (2026-02-20)

#### Event System Enhancement
- **Resource types**: Events can now specify required resources (apparatus, equipment, facilities)
- **Pre-built templates**: Added event templates for common event types (training, meetings, drills, community events)

#### Shift Templates & Positions
- **Configurable shift templates**: New settings tab for managing shift templates with custom positions per template
- **Vehicle-type staffing defaults**: Templates auto-populate position requirements based on apparatus type (engine, ladder, ambulance, etc.)
- **Template categories**: Shift templates organized by category for easier management

### Improved - Mobile & Accessibility (2026-02-20)

#### Mobile Optimization
- **Responsive table views**: Major pages optimized for mobile and tablet with card-based layouts on small screens
- **Scheduling module UX**: Calendar views, shift forms, and assignment panels redesigned for touch-friendly mobile use
- **Rendering performance**: Reduced unnecessary re-renders in scheduling components

#### Onboarding Accessibility
- **Section 508 compliance**: Improved across all onboarding pages (ARIA labels, keyboard navigation, focus management, screen reader support)
- **Dark mode toggle**: Enabled on all onboarding pages
- **Progress indicator width**: Fixed inconsistent width across onboarding steps
- **Color contrast fixes**: Amber/yellow info boxes and labels updated for light background readability
- **Alert colors**: Refactored to use CSS theme system instead of hardcoded Tailwind classes

### Added - Taxonomy Refactor (2026-02-20)

#### Role → Position Rename
- **Renamed `roles` to `positions`** throughout the system with backward-compatible `roles` synonym on the User model
- **Operational ranks**: Added Fire Chief, Assistant Chief, Deputy Chief, Battalion Chief, Captain, Lieutenant, Engineer/Driver, Firefighter
- **Membership types**: Added member, associate, honorary, life, probationary, retired, social, volunteer, prospect
- **Prospect model**: New model for prospective member tracking
- **Position templates**: Added Administrative Member, Regular Member, and expanded onboarding position list

### Infrastructure & DevOps (2026-02-20)

#### Database Reliability
- **MySQL advisory lock**: Serializes Alembic migrations across multiple workers to prevent race conditions
- **Race condition fix**: Fast-path DB init no longer fails when multiple workers start simultaneously
- **Migration chain fixes**: Corrected broken Alembic `down_revision` references that caused "multiple heads" errors

#### Docker & Deployment
- **Unraid compose fixes**: Removed hardcoded subnet to avoid network conflicts; fixed build context paths to match installation docs
- **MinIO env vars**: Fixed MinIO environment variables breaking `docker compose` for users with simple `.env` files
- **`.env.example` documentation**: Documented differences between `.env.example` (minimal) and `.env.example.full` (all options)

#### Build Fixes
- **LocationsPage**: Fixed stray closing `</div>` tag that broke the production build
- **Login page inputs**: Fixed white-on-white text in input fields
- **Select dropdowns**: Fixed unreadable white-on-white text in native `<select>` elements

### Added - Pool Item Issuance for Inventory (2026-02-19)

#### Two Tracking Modes
- **New `tracking_type` field on inventory items**: Items can now be `"individual"` (serial-numbered, assigned 1:1 to a member — existing behavior) or `"pool"` (quantity-tracked, units issued/returned from a shared pool)
- **New `quantity_issued` field**: Tracks how many units from a pool item are currently issued to members, separate from the on-hand `quantity`

#### Pool Issuance Model & Endpoints
- **New `item_issuances` table**: Tracks who received units from a pool item, when, how many, and whether they've been returned — parallel to `item_assignments` for individual items
- **`POST /api/v1/inventory/items/{item_id}/issue`**: Issue units from a pool item to a member; decrements on-hand quantity, creates an issuance record
- **`POST /api/v1/inventory/issuances/{issuance_id}/return`**: Return issued units; increments on-hand quantity, supports partial returns
- **`GET /api/v1/inventory/items/{item_id}/issuances`**: List who currently has units from a pool item (or full history with `?active_only=false`)
- **`GET /api/v1/inventory/users/{user_id}/issuances`**: List all pool items issued to a specific member

#### User Dashboard Integration
- The user inventory endpoint (`GET /api/v1/inventory/users/{user_id}/inventory`) now includes an `issued_items` array alongside existing `permanent_assignments` and `active_checkouts`

#### Frontend API Support
- Added `inventoryService.issueFromPool()`, `.returnToPool()`, `.getItemIssuances()`, `.getUserIssuances()` methods
- Added `ItemIssuance`, `UserIssuedItem` TypeScript interfaces
- Updated `InventoryItem` and `InventoryItemCreate` interfaces with `tracking_type` and `quantity_issued` fields

### Security Hardening (2026-02-18)

#### Path Traversal Fix in Event Attachments (Critical)
- **Fixed path traversal vulnerability** in `GET /api/v1/events/{id}/attachments/{id}/download`: file paths from the database are now resolved with `os.path.realpath()` and validated against the expected `ATTACHMENT_UPLOAD_DIR` before serving via `FileResponse` — prevents arbitrary file access if database data is ever compromised

#### External Training Provider Credential Encryption (High)
- **API keys and secrets now encrypted at rest** using AES-256 (Fernet) for external training providers (Vector Solutions, Target Solutions, Lexipol, etc.)
- Credentials are encrypted on create (`POST /api/v1/external-training/providers`) and update (`PATCH /api/v1/external-training/providers/{id}`) before storage
- Credentials are decrypted transparently when building API request headers in `ExternalTrainingSyncService`
- Backward-compatible: if decryption fails (pre-existing plaintext values), the service falls back to using the raw value

#### Document Upload MIME Validation (High)
- **Added magic-byte MIME type validation** for document uploads (`POST /api/v1/documents/upload`) using `python-magic` to detect the true file type from content bytes, rather than trusting the HTTP `Content-Type` header
- Allowed types: PDF, Word, Excel, PowerPoint, text, CSV, images (JPEG/PNG/GIF/WebP), and ZIP archives
- The stored `file_type` in the database now reflects the detected MIME type instead of the client-supplied header

#### MinIO Default Credentials Removed (Medium)
- **Removed insecure default credentials** for MinIO in `docker-compose.yml` — `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` now require explicit configuration via `.env` (will error on startup if not set)

### Added - Location Kiosk Display for Tablets (2026-02-18)

#### Public Kiosk Display System
- **New page: Location Kiosk Display (`/display/:code`)**: Public, unauthenticated page designed for tablets left in rooms. Automatically shows the current event's QR code for member check-in and cycles to the next event when it starts.
- **Display codes**: Each location gets a unique, non-guessable 8-character display code (alphanumeric, ambiguous chars removed). Codes are auto-generated on location creation and backfilled for existing locations.
- **Auto-refresh**: Kiosk page polls the backend every 30 seconds for event updates. Shows connection status indicator and live clock.
- **Multi-event support**: When multiple events overlap in the same room, the display auto-rotates between them every 10 seconds with dot indicators.
- **Idle state**: When no events are active, shows a clean "No Active Events" screen with messaging that QR codes will appear automatically.
- **New public API endpoint**: `GET /api/public/v1/display/{code}` — returns location name and current events with QR check-in data. No authentication required. Only exposes non-sensitive data (event name, type, time — no descriptions or member data).
- **Kiosk URL on Locations page**: Each room card now shows its kiosk display URL (`/display/{code}`) with one-click copy to clipboard.

#### Security Model
- The display page is intentionally public — it shows the same information you'd see on a printed flyer taped to a door (event name, room, time, QR code).
- Authentication happens on the **scanning member's device** when they check in via `POST /events/{id}/self-check-in`.
- Display codes use `secrets.choice()` for cryptographic randomness. The 8-character code space (32^8 = ~1.1 trillion combinations) makes brute-force enumeration impractical.

### Added - Unified Location Architecture (2026-02-18)

#### Location ↔ Facility Bridge
- **`facility_id` FK on Location model**: When the Facilities module is enabled, each Location record can optionally reference a Facility for deep building management data (maintenance, inspections, utilities, etc.). The `locations` table becomes the universal "place picker" for all modules regardless of which module is active.
- **Locations as single source of truth**: Events, Training, and Meetings all reference `locations.id` — turning Facilities on or off doesn't break any location references.

#### Training Location Integration
- **`location_id` FK on TrainingRecord model**: Training records can now reference wizard-created locations instead of relying on free-text strings. The existing `location` text field is preserved as a fallback for "Other Location" entries.
- **Location dropdown on Create Training Session page**: Replaces the free-text location input with a proper dropdown that loads from `locationsService.getLocations()`, matching the pattern used by EventForm. Includes "Other (off-site / enter manually)" option for non-standard venues.
- **Selected location details**: When a location is selected, shows address, building, floor, and capacity information below the dropdown.
- **Review step updated**: The training session review step now shows the selected location name from the dropdown instead of raw text.

#### Location Setup Wizard Enhancement
- **Address fields in list endpoint**: The `GET /locations` API now returns `address`, `city`, `state`, `zip`, and `facility_id` in the list response, enabling richer display in dropdowns and cards.

### Fixed - Training Admin Dashboard Disconnect (2026-02-18)

#### Compliance Matrix Rewrite
- **Root cause**: The compliance matrix endpoint used broken matching logic — it tried to match training records to requirements by `course_id` (which doesn't exist on requirements) or exact `course_name == requirement.name` (which never matches for hours-based requirements like "Annual Training Requirement")
- **Requirement-type-aware matching**: The compliance matrix now evaluates each member × requirement using the correct strategy per requirement type:
  - **HOURS**: Sums completed training hours matching `training_type` within the frequency date window, compares to `required_hours`
  - **COURSES**: Checks if all required `course_id`s have completed records
  - **CERTIFICATION**: Matches by `training_type`, name substring, or certification number
  - **SHIFTS/CALLS**: Counts matching records within the date window
  - **Others**: Falls back to `training_type` or name-based matching
- **Frequency-aware date windows**: All compliance evaluations now use proper date windows (annual, biannual, quarterly, monthly, one-time) instead of ignoring the requirement's frequency
- **Active-only filtering**: The compliance matrix now only shows active requirements (previously showed all, including inactive ones)

#### Competency Matrix (Heat Map) Fix
- **Same fixes applied**: The competency matrix service (`CompetencyMatrixService`) now uses the same frequency-aware, type-aware evaluation logic
- **Hours requirements properly evaluated**: Previously just checked for any matching record; now sums hours and compares to `required_hours`

#### Training Service Consistency
- **`check_requirement_progress()` fixed**: Now uses proper frequency-aware date windows for biannual, quarterly, monthly, and one-time requirements (previously fell back to `start_date`/`due_date` which may not be set)

#### Officer Dashboard Compliance
- **Improved compliance calculation**: The Training Officer Dashboard now calculates member compliance based on actual requirement completion (hours against requirements) rather than only checking for expired certifications

### Fixed - My Training Page & Build Errors (2026-02-18)

#### My Training Page Cleanup
- **Removed "Average Rating" stat card**: The Avg Rating box on the My Training overview was not useful for members and has been removed
- **Removed "Shifts" stat card**: The Shifts count (shift completion reports) was not relevant to the My Training overview and has been removed
- **Renamed "Annual Requirements" to "Requirements"**: Label is now generic since the system supports all requirement frequencies

#### Requirements Compliance Fix
- **Fixed requirements showing N/A**: The My Training requirements compliance calculation was filtering to annual-frequency requirements only. Biannual, quarterly, monthly, and one-time requirements were excluded, causing the stat to show "N/A" when only non-annual requirements existed
- **All frequencies now included**: The backend requirements query now includes all active requirements with frequency-appropriate evaluation windows (annual=calendar year, biannual=2-year window, quarterly=current quarter, monthly=current month, one-time=all-time)

#### Rank Permission Restriction
- **Rank changes restricted**: Member rank can now only be changed by users with `members.manage` permission (Chief, membership coordinator) or admin wildcard. Regular members can no longer change their own rank through profile editing
- **Added `rank` field to User type**: The frontend `User` interface was missing the `rank` field, causing TypeScript build errors in `CreateTrainingSessionPage.tsx`

#### Additional Build Fixes
- **Missing `BookOpen` import**: Added missing `BookOpen` lucide-react icon import in `MinutesPage.tsx` that caused TypeScript build failure

### Fixed - TypeScript Build Errors (2026-02-18)

#### API Service Layer Completeness
- **Missing scheduling methods**: Added 30+ methods to `schedulingService` including shift calls (CRUD), shift assignments (CRUD + confirm), swap requests (CRUD + review), time-off requests (CRUD + review), shift attendance (get/update/delete), templates (CRUD), patterns (CRUD + generate), and reports (member hours, coverage, call volume, availability)
- **Missing event settings methods**: Added `getModuleSettings()` and `updateModuleSettings()` to `eventService` for the Events Settings page
- **Missing OAuth methods**: Added `getGoogleOAuthUrl()` and `getMicrosoftOAuthUrl()` to `authService` for SSO login flows
- **Missing organization method**: Added `previewNextMembershipId()` to `organizationService` for membership ID preview during member creation
- **Missing role method**: Added `getUserPermissions()` to `roleService` for the User Permissions page
- **Missing training approval methods**: Added `getApprovalData()` and `submitApproval()` to `trainingSessionService`
- **Missing member creation field**: Added `membership_id` to `createMember` type parameter
- **New service exports**: Added `memberStatusService` (archived members, property returns, tier management), `prospectiveMemberService` (pipelines, prospects, election packages), and `scheduledTasksService` (list/run background tasks) with `ScheduledTask` type

#### Type Definitions
- **Missing user types**: Added `ArchivedMember`, `OverdueMember`, `MembershipTier`, `MembershipTierBenefits`, `MembershipTierConfig`, `PropertyReturnReport` to `types/user.ts`
- **Missing user field**: Added `membership_number` to `User` interface for member list display

### Fixed - CSS Accessibility & Theme Consistency (2026-02-17)

#### Onboarding Module Theme Migration
- **23 onboarding files refactored**: Converted all hardcoded Tailwind color classes to CSS theme variables across the entire onboarding module
- **Converted patterns**: `bg-slate-900` → `bg-theme-bg-from`, `text-white` → `text-theme-text-primary`, `bg-white/10` → `bg-theme-surface`, `border-white/20` → `border-theme-surface-border`, `text-slate-300` → `text-theme-text-secondary`, `text-slate-400` → `text-theme-text-muted`, `bg-slate-800/50` → `bg-theme-surface-secondary`, input styling standardized to `bg-theme-input-bg border-theme-input-border`
- **Preserved semantic colors**: All accent/status colors (red, green, blue, purple, amber, etc.) for buttons, badges, alerts, and interactive states left intentionally unchanged

### Added - New Application Pages (2026-02-17)

#### Scheduling Module
- **ShiftCallsPanel**: Component for managing calls attached to shifts with create/update/delete
- **ShiftAssignmentsPage**: Full shift assignment management with swap requests and time-off handling
- **ShiftAttendancePage**: Shift attendance tracking with bulk update support
- **ShiftTemplatesPage**: Shift template and pattern management with auto-generation from patterns
- **SchedulingReportsPage**: Scheduling reports including member hours, coverage, call volume, and availability

#### Member & Admin Pages
- **MemberLifecyclePage**: Archived member management, overdue property returns, membership tier configuration, and property return report previews
- **EventsSettingsPage**: Event module configuration (event types, defaults, QR codes, cancellation policies)
- **UserPermissionsPage**: Individual user permission and role assignment viewer
- **TrainingApprovalPage**: Token-based training session approval workflow
- **ScheduledTasksPage**: View and manually trigger scheduled background tasks
- **ProspectiveMembersPage** (standalone): Pipeline management, prospect creation, election packages

### Changed - Navigation & Structure (2026-02-17)
- **Module restructuring**: Admin hubs with clean member/admin navigation separation
- **User profile editing**: Self-service and admin profile editing capabilities
- **Training navigation**: Training sub-items added to sidebar and top navigation; `/training` routes to `MyTrainingPage`
- **Pipeline settings nav**: Added Pipeline Settings entry for prospective members
- **Full nav coverage**: All missing pages added to navigation menus
- **Membership ID settings**: Added Membership ID Number settings to Organization Settings
- **Department timezone**: All date/time displays now use department's local timezone instead of UTC
- **Dashboard training hours**: Fixed Dashboard showing 0 training hours despite completed courses
- **Role assignment fix**: Fixed role assignment permissions for Officers and Vice President roles
- **Training pipeline fix**: Fixed save error, added knowledge tests and milestone reorder

### Added - System-Wide Theme Support (2026-02-15)

#### Theme System
- **ThemeProvider context**: New `ThemeContext` with support for light, dark, and system (auto-detect) themes
- **CSS custom properties**: Theme colors defined as CSS variables in `:root` (light) and `.dark` (dark), enabling centralized theme management instead of per-component hardcoding
- **Tailwind dark mode**: Configured `darkMode: 'class'` with custom `theme-*` color utilities that reference CSS variables
- **Theme toggle**: Added theme cycle button (Dark → Light → System) to both TopNavigation and SideNavigation
- **Theme persistence**: Saves preference to `localStorage`, defaults to dark mode, respects `prefers-color-scheme` in system mode
- **AppLayout**: Background gradient now uses CSS variables, automatically adapting to the selected theme

#### Dashboard Redesign
- **Member-focused dashboard**: Replaced admin-oriented dashboard (setup status, getting started guide) with member-focused content
- **Hours tracking cards**: Shows total, training, standby, and administrative hours for the current month
- **Notifications widget**: Displays recent notifications with unread indicators and mark-as-read functionality
- **Upcoming shifts widget**: Shows the member's upcoming shifts for the next 30 days with date, time, and officer info
- **Training progress**: Retained training enrollment progress with deadlines and next steps
- **Added API methods**: `schedulingService.getMyShifts()` and `schedulingService.getMyAssignments()` for member-specific shift data

### Fixed - UI Issues (2026-02-15)

#### Footer & Layout
- **Dashboard footer**: Fixed footer floating mid-page by using flexbox sticky footer pattern (`flex-col` + `flex-1` + `mt-auto`)

#### Election Module Dark Theme
- **CandidateManagement**: Converted from invisible light theme to dark theme with proper contrast
- **BallotBuilder**: Converted secretary ballot creation interface to dark theme
- **ElectionBallot**: Converted voter-facing ballot interface to dark theme
- **ElectionResults**: Converted results display to dark theme
- **MeetingAttendance**: Converted attendance tracker to dark theme

#### Election Timezone Handling
- **Frontend**: Replaced `.toISOString().slice(0,16)` with local datetime formatting helper to prevent UTC conversion of `datetime-local` input values
- **Backend**: Changed `datetime.utcnow()` to `datetime.now()` in election service comparisons to match user-entered naive datetimes

### Fixed - Duplicate Index Definitions Crashing Startup (2026-02-15)

#### Database Model Fixes
- **Location model crash fix**: Removed duplicate `ix_locations_organization_id` index that crashed `Base.metadata.create_all()` on MySQL — the `organization_id` column had both `index=True` (auto-generating the index) and an explicit `Index("ix_locations_organization_id", ...)` in `__table_args__` with the same name, causing a `Duplicate key name` error on every fresh database initialization
- **VotingToken model crash fix**: Same issue — `token` column had `index=True` plus an explicit `Index("ix_voting_tokens_token", ...)` in `__table_args__`, causing startup failure after locations table was fixed
- **Redundant index cleanup**: Removed `index=True` from 5 additional columns across `apparatus.py`, `facilities.py`, `inventory.py`, `ip_security.py`, and `public_portal.py` that had redundant (but differently-named) explicit indexes in `__table_args__`, preventing double-indexing
- **Fast-path init log accuracy**: Fixed dropped table count in `_fast_path_init()` to exclude the skipped `alembic_version` table
### Fixed - Docker & Deployment (2026-02-15)

#### Database Consistency
- **Unified database engine**: All standard deployments (main, Unraid, build-from-source) now use MySQL 8.0. MariaDB is reserved exclusively for ARM/Raspberry Pi via the `docker-compose.arm.yml` override
- **Unraid compose files**: Changed `unraid/docker-compose-unraid.yml` and `unraid/docker-compose-build-from-source.yml` from `mariadb:10.11` to `mysql:8.0` with proper MySQL 8.0 healthchecks and command flags
- **Minimal profile**: Removed MariaDB image override from `docker-compose.minimal.yml` — now uses the base MySQL image with resource-constrained settings
- **Healthcheck improvements**: Unraid compose files now use robust two-step healthcheck (ping + SELECT 1) with `start_period: 60s` matching the main compose pattern

#### Unraid Deployment
- **Updated all Unraid documentation** (UNRAID-INSTALLATION.md, README.md, QUICK-START-UPDATED.md, DOCKER-COMPOSE-SETUP.md, BUILD-FROM-SOURCE-ON-UNRAID.md): Replaced MariaDB references with MySQL, corrected container names to `logbook-db`
- **XML template**: Updated `the-logbook.xml` to reference MySQL, removed hardcoded 192.168.1.10 IP addresses from DB_HOST and REDIS_HOST defaults
- **Build-from-source**: Fixed frontend `VITE_API_URL` from absolute URL to `/api/v1` for proper nginx proxying

#### Wiki Documentation
- **Updated 8 wiki files**: Replaced MariaDB references with MySQL 8.0 across Deployment-Guide, Deployment-Unraid, Development-Backend, Home, Installation, Quick-Reference, Troubleshooting, and Unraid-Quick-Start wiki pages

#### New Features
- **AWS deployment guide** (`docs/deployment/aws.md`): Comprehensive guide covering EC2 simple deployment, EC2 + RDS + ElastiCache production setup, security groups, VPC networking, S3 backups, CloudWatch monitoring, cost estimation, and troubleshooting
- **Docker build verification script** (`scripts/verify-docker-build.sh`): 40-check validation covering Docker Compose config, Dockerfile validation, TypeScript compilation, Python syntax, database consistency, environment config, and service naming
- **Proxmox deployment guide** (`docs/deployment/proxmox.md`): Complete guide for LXC and VM deployment on Proxmox VE with Docker, including networking, backups, reverse proxy, and migration from Unraid
- **Synology NAS deployment guide** (`docs/deployment/synology.md`): Complete guide for deploying on Synology NAS via Docker Compose SSH or Container Manager UI, including DSM reverse proxy with SSL, Hyper Backup integration, port conflict resolution, and resource management
- **Fixed dangling references**: Removed references to non-existent `deploy/aws/` CloudFormation templates and `infrastructure/terraform/providers/aws/` directory, replaced with links to the new AWS deployment guide

### Fixed - TypeScript Build Errors (2026-02-15)

- **useTraining.ts**: Fixed `getStatistics` and `getProgress` method names to match actual `trainingService` API (`getUserStats`, `getRequirementProgress`)
- **PipelineDetailPage.tsx**: Extended `ProgramDetails` interface to accept `ProgramWithDetails` fields
- **ReportsPage.tsx**: Fixed `unknown` not assignable to `ReactNode` by using `!!` boolean coercion
- **ShiftReportPage.tsx**: Fixed `program_name` property access to `program?.name`
- **DocumentsPage.tsx**: Added missing `Upload` import from lucide-react
- **membership/types/index.ts**: Removed duplicate `User` import
- **election.ts**: Removed duplicate `ballot_items` property from `ElectionUpdate` interface
- Full `tsc --noEmit` now passes clean with zero errors

### Fixed - Codebase Quality & Error Handling (2026-02-15)

#### Error Handling Improvements
- **Type-safe error handling**: Replaced all `catch (err: any)` with `catch (err: unknown)` across 40+ frontend files, using `getErrorMessage()` and `toAppError()` utilities from `utils/errorHandling.ts`
- **`toAppError()` check ordering**: Fixed check order to evaluate Axios/HTTP errors (with `.response`) before `Error` instances and plain `AppError` objects, ensuring HTTP status codes and API detail messages are correctly extracted
- **Silent exception handlers**: Added proper logging to previously empty `catch` blocks in `backend/app/utils/cache.py` and `backend/app/api/v1/endpoints/events.py`
- **`createMockApiError()` test utility**: Fixed to return error object directly instead of a Promise, so `mockRejectedValue()` works correctly in tests

#### Unused Code & Import Cleanup
- **Removed unused imports/variables** in `ImportMembers.tsx` (`_XCircle`, `_AlertTriangle`, `_X`), `CreateTrainingSessionPage.tsx` (unused setter), `EventSelfCheckInPage.tsx` (`_alreadyCheckedIn`), `EventDetailPage.tsx` (`user: _user`), `TrainingOfficerDashboard.tsx` (duplicate `FileTextIcon`)
- **Removed `console.log`/`console.error` statements** across 40+ frontend files for production readiness

#### Backend Fixes
- **Makefile**: Fixed all backend targets to use `pip`/`pytest`/`alembic` instead of incorrect `npm` commands
- **Documents service**: Consolidated duplicate service pattern — all methods now return objects directly or raise `HTTPException`, eliminating inconsistent `(result, error)` tuple returns
- **Documents endpoint**: Updated to match new service API (no more tuple unpacking)
- **Public portal endpoints**: Implemented real database queries for `/api/public/v1/organization/stats` (active member count, apparatus count) and `/api/public/v1/events/public` (future public education events)
- **Duplicate dependency**: Removed duplicate `redis==5.2.1` entry from `requirements.txt`
- **Dockerfile healthcheck**: Fixed to validate HTTP response status

#### Frontend Fixes
- **ExternalTrainingPage**: Implemented `EditProviderModal` with full form fields (name, API URL, API key, description, sync settings)
- **ErrorBoundary**: Integrated with `errorTracker` service for error reporting
- **LoginPage**: Replaced OAuth TODO placeholder with actual API call to `/api/v1/auth/oauth-config`
- **EventSelfCheckInPage**: Simplified check-in flow to always treat successful `selfCheckIn` response as success; fixed "Check-In" → "Check-in" case mismatch

#### Configuration & Tooling
- **Backend linting**: Added `.flake8` (max-line-length=120, excludes alembic) and `mypy.ini` (python 3.11, ignore missing imports)
- **ESLint**: Changed 5 `no-unsafe-*` rules from `"off"` to `"warn"` in `.eslintrc.json`
- **`package.json`**: Removed non-existent `"mobile"` workspace

### Fixed - Members Page & Dark Theme Unification (2026-02-15)

#### Members Page
- **Zero-count bug**: Fixed `/api/v1/users` endpoint to handle missing organization settings gracefully; dashboard stats fallback changed from hardcoded 1 to 0

#### Dark Theme Unification
- **Centralized dark gradient**: Moved background gradient from per-page declarations to `AppLayout`, eliminating duplicate gradient CSS across 23 pages
- **17 light-themed pages converted**: Converted all remaining light-themed authenticated pages to consistent dark theme (white text, translucent cards, dark form inputs)
- **48 pages updated**: Unified dark theme across all authenticated pages for consistent visual experience

### Fixed - Role Sync & Onboarding Bugs (2026-02-15)

#### Role System
- **Frontend-backend role sync**: Added Administrator, Treasurer, Safety Officer to backend `DEFAULT_ROLES`; added Assistant Secretary, Meeting Hall Coordinator, Facilities Manager to frontend `RoleSetup.tsx`
- **Removed membership-tier entries from onboarding**: Tier roles (probationary, active, senior, life) removed from onboarding role selection as they are membership stages, not assignable roles

#### Onboarding Fixes
- **Prospective members module**: Added `prospective_members` to available modules list in onboarding
- **SQLAlchemy JSON mutation detection**: Fixed `_mark_step_completed()` dict mutation being silently lost by SQLAlchemy (in-place dict modification not tracked); now creates new dict to trigger change detection
- **Prospective members route prefix**: Fixed API route prefix mismatch preventing module endpoints from loading

### Improved - Database Startup Reliability (2026-02-15)

#### Fast-Path Initialization Hardening
- **Self-healing database startup**: Added three recovery mechanisms — fast-path retry after 2s on failure, schema repair via `create_all(checkfirst=True)` if validation finds missing tables, and `FK_CHECKS` re-enabled in `finally` block to prevent stuck states
- **Resource-constrained environment optimizations**: Single connection for all DDL, batched `DROP TABLE`, `checkfirst=False` on `create_all()`, `NullPool` for migration engine, and MySQL DDL flags (`innodb_autoinc_lock_mode=2`, `innodb_file_per_table=1`)
- **Slimmed init SQL**: Reduced `001_initial_schema.sql` to only create `alembic_version` table (removed 7 redundant tables that are now created by `create_all()`)
- **Dynamic schema validation**: `validate_schema()` now dynamically checks all 127+ expected tables from SQLAlchemy metadata instead of hardcoding 5 table names
- **Progress logging**: Logs progress every 25 tables during `create_all()` for visibility on slow environments
- **Init timeout increased**: Raised `create_all()` timeout from 600s to 1200s with `checkfirst=False` and `SET FOREIGN_KEY_CHECKS=0` for slow environments
- **Leftover table cleanup**: `_fast_path_init()` now dynamically discovers and drops ALL tables (except `alembic_version`) before `create_all()`, preventing "Duplicate key name" errors from partial previous boots

#### Docker & Health Check Fixes
- **MySQL health check false-positive fix**: Changed healthcheck from `-h localhost` (Unix socket, which connects to temporary init server on port 0) to `-h 127.0.0.1 --port=3306` (TCP), preventing premature "healthy" status during MySQL initialization
- **Backend start_period**: Increased to 600s with 10 retries to accommodate slow first-boot scenarios
- **Connection retries**: Increased from 20 (~4 min) to 40 (~10 min) to exceed MySQL first-time init duration (~6 min)
- **Startup reliability**: Six fixes — health check `start_period` 5s→300s, Docker dependency changed to `service_healthy`, schema validation raises `RuntimeError` instead of silently continuing, onboarding endpoints handle missing tables gracefully, nginx proxy timeouts added, `50x.html` auto-retry error page added

#### Backend Startup Fixes
- **Silent migration failure**: Moved `_fast_path_init()` outside forgiving try/except that swallowed all exceptions, added schema validation after fast-path, made validation failures crash the app
- **Fast-path timeout**: Added 10-minute timeout to `_fast_path_init()` to prevent hung `create_all()` from freezing the backend forever
- **Axios client timeout**: Added 30-second timeout to frontend Axios API client
- **Duplicate Alembic revision IDs**: Fixed two pairs of migrations sharing the same revision IDs (20260212_0300 and 20260212_0400), causing Alembic to crash with "overlaps with other requested revisions"
- **Backend crash on cold MySQL init**: Increased connection retries to cover MySQL's ~6 min first-time initialization
- **NameError fix**: Moved `get_current_user` above `PermissionChecker` classes in `dependencies.py` — function was defined after classes that reference it in `Depends()` default arguments

### Added - Hierarchical Document Folder System (2026-02-15)

#### Per-Member Document Folders
- **Folder access control**: Added `FolderVisibility` enum (organization/leadership/owner) and access control columns (`visibility`, `owner_user_id`, `allowed_roles`) to `DocumentFolder`
- **Member Files system folder**: Auto-creates per-member subfolders on first access; members can only see their own folder
- **My folder endpoint**: `GET /documents/my-folder` returns the current user's personal folder
- **Access enforcement**: Folder visibility checks enforced on list, view, upload, and download endpoints

#### Per-Apparatus Document Folders
- **Apparatus file organization**: "Apparatus Files" system folder with per-vehicle subfolders named by unit number
- **Categorized sub-folders**: Photos, Registration & Insurance, Maintenance Records, Inspection & Compliance, Manuals & References
- **Lazy creation**: Folder hierarchy created on first access via `GET /apparatus/{id}/folders`

#### Per-Facility & Per-Event Document Folders
- **Facility folders**: Per-facility folders with Photos, Blueprints & Permits, Maintenance Records, Inspection Reports, Insurance & Leases, Capital Projects sub-folders
- **Event folders**: Per-event folders created automatically for file attachments
- **New endpoints**: `GET /facilities/{id}/folders` and `GET /events/{id}/folder`
- **Migration**: Seeds all three new system folders for existing organizations

### Added - Form & Security Enhancements (2026-02-15)

#### Forms Module
- **File upload field**: Drag-and-drop file upload support in `FieldRenderer` for form fields of type `file`
- **Signature capture pad**: Canvas-based signature input with mouse and touch support for form fields of type `signature`

#### Security Improvements
- **Password rehashing on login**: Automatically rehashes password when argon2 parameters change, keeping passwords up to date with latest security settings
- **Async database audit logging**: Blocked IP security events now logged asynchronously to the database instead of only to file logs
- **Training enrollment permission check**: Added `training.view_all` permission check to enrollment endpoint
- **TypeScript type safety**: Fixed `any` types in `AccessLogsTab` and `APIKeysTab` with proper TypeScript interfaces

### Added - Testing & Quality (2026-02-15)

#### New Test Suites
- **Alembic migration chain tests**: 9 tests validating no duplicate revision IDs, no forked chains, single base/head, no orphan migrations, and valid `down_revision` references (`test_alembic_migrations.py`)
- **Changelog regression tests**: 29-test suite (`test_changelog_fixes.py`) covering duplicate index detection, dependency ordering, documents service API, public portal queries, fast-path init logic, frontend error handling, Makefile correctness, migration chain integrity, and model import completeness

#### Bug Fixes Found During Testing
- **Missing facilities model import**: Fixed `models/__init__.py` to include facilities models — without this fix, `create_all()` would silently skip 20 facility tables
- **pytest-asyncio scope mismatch**: Fixed `asyncio_default_fixture_loop_scope` from "function" to "session" in `pytest.ini` to match session-scoped async fixtures
- **Standalone enum verification function**: Added `verify_enum_consistency()` to `test_enum_consistency.py` for CI/pre-commit integration

### Added - Shift Module Enhancement: Full Scheduling System (2026-02-14)

#### Shift Templates & Recurring Patterns
- **Shift templates**: `POST /api/v1/scheduling/templates` — define reusable shift definitions (Day Shift, Night Shift, Weekend Duty) with start/end times, duration, positions, min staffing, and calendar color
- **Shift patterns**: `POST /api/v1/scheduling/patterns` — create recurring schedules with support for four pattern types: `daily`, `weekly`, `platoon` (A/B/C rotation), and `custom`
- **Auto-generation**: `POST /api/v1/scheduling/patterns/{id}/generate` — generates shifts for a date range from a pattern template, with automatic assignment creation for pre-assigned members
- **Template CRUD**: Full create/read/update/delete for shift templates with active/inactive toggle

#### Duty Roster & Shift Assignments
- **Assign members**: `POST /api/v1/scheduling/shifts/{id}/assignments` — assign members to shifts with position designation (officer, driver, firefighter, EMS, captain, lieutenant, probationary, volunteer)
- **Confirm/decline**: `POST /api/v1/scheduling/assignments/{id}/confirm` — members confirm their own shift assignments
- **Assignment statuses**: `assigned`, `confirmed`, `declined`, `no_show`
- **My assignments**: `GET /api/v1/scheduling/my-assignments` — personal view of upcoming shift assignments

#### Shift Swap Requests
- **Request swap**: `POST /api/v1/scheduling/swap-requests` — members request to swap shifts, optionally targeting a specific shift or member
- **Officer review**: `POST /api/v1/scheduling/swap-requests/{id}/review` — approve or deny swap requests with notes
- **Cancel request**: `POST /api/v1/scheduling/swap-requests/{id}/cancel` — requestor can cancel pending requests
- **Status tracking**: `pending`, `approved`, `denied`, `cancelled` with full audit trail

#### Time-Off / Unavailability
- **Request time off**: `POST /api/v1/scheduling/time-off` — members submit time-off requests with date range and reason
- **Officer review**: `POST /api/v1/scheduling/time-off/{id}/review` — approve or deny with notes
- **Availability check**: `GET /api/v1/scheduling/availability` — view which members have approved time off in a date range, for scheduling decisions
- **Cancel request**: `POST /api/v1/scheduling/time-off/{id}/cancel` — cancel pending requests

#### Shift Call Recording
- **Record calls**: `POST /api/v1/scheduling/shifts/{id}/calls` — log incidents/calls during shifts with incident number, type, dispatch/on-scene/cleared times, responding members
- **Call details**: Track `cancelled_en_route`, `medical_refusal`, and per-call responding member list
- **Call CRUD**: Full create/read/update/delete for shift call records

#### Shift Reporting & Analytics
- **Member hours report**: `GET /api/v1/scheduling/reports/member-hours` — per-member shift count and total hours for a date range
- **Coverage report**: `GET /api/v1/scheduling/reports/coverage` — daily staffing levels showing assigned vs. confirmed vs. minimum required
- **Call volume report**: `GET /api/v1/scheduling/reports/call-volume` — call counts by type with average response times, groupable by day/week/month
- **My shifts**: `GET /api/v1/scheduling/my-shifts` — personal shift history and upcoming assignments

#### New Permissions & Roles
- **`scheduling.assign`**: Assign members to shifts (officers and above)
- **`scheduling.swap`**: Request and manage shift swaps (all members)
- **`scheduling.report`**: View shift reports and analytics (officers and above)
- **Scheduling Officer role**: New system role with full scheduling permissions for dedicated scheduling coordinators

#### New Models
- `ShiftTemplate` — reusable shift definitions with positions and min staffing
- `ShiftPattern` — recurring schedule definitions with platoon rotation support
- `ShiftAssignment` — duty roster assignments with position and confirmation status
- `ShiftSwapRequest` — swap request workflow with officer review
- `ShiftTimeOff` — time-off request workflow with approval
- **Migration**: `20260214_2200` creates 5 new tables with indexes

### Added - Facilities Module: Building & Property Management (2026-02-14)

#### Core Facilities Management
- **Facility CRUD**: Create, edit, archive facilities with types, statuses, addresses, GPS coordinates, year built, square footage
- **Facility types**: 10 default types (Fire Station, EMS Station, Training Center, Administrative Office, Meeting Hall, Storage Building, Maintenance Shop, Communications Center, Community Center, Other)
- **Facility statuses**: 6 default statuses with color coding (Operational, Under Renovation, Under Construction, Temporarily Closed, Decommissioned, Other)
- **Photos & documents**: Attach photos and documents to facilities with metadata
- **Systems tracking**: Track building systems (HVAC, electrical, plumbing, etc.) with install dates and warranty info

#### Facility Maintenance
- **Maintenance scheduling**: `POST /api/v1/facilities/{id}/maintenance` — log maintenance records with type, priority, scheduling, and cost tracking
- **20 default maintenance types**: HVAC, Generator, Fire Alarm, Sprinkler, Roof, Elevator, Bay Door, Pest Control, and more with recommended frequencies
- **Inspections**: Track facility inspections with pass/fail, findings, and follow-up

#### Extended Facilities Features
- **Utility tracking**: Track utility accounts (electric, gas, water, sewer, internet, phone, trash) with billing cycles and meter readings
- **Key & access management**: Track physical keys, key fobs, access cards, codes, and gate remotes with assignment to members
- **Room/space inventory**: Catalog rooms with type, capacity, equipment, and availability
- **Emergency contacts & shutoffs**: Record emergency contacts by type (fire, police, utility, building) and shutoff locations (water, gas, electric, HVAC, sprinkler)
- **Capital improvement projects**: Track renovation/construction/equipment projects with budget, timeline, and contractor info
- **Insurance policies**: Manage building, liability, flood, earthquake, and equipment policies with coverage amounts and renewal dates
- **Occupant/unit assignments**: Track tenant/unit assignments for multi-use facilities
- **ADA/compliance checklists**: Create compliance checklists (ADA, fire code, building code, OSHA, environmental) with individual checklist items and due dates

#### Permissions & Roles
- **6 permissions**: `facilities.view`, `facilities.create`, `facilities.edit`, `facilities.delete`, `facilities.maintenance`, `facilities.manage`
- **Facilities Manager role**: System role with VIEW, CREATE, EDIT, MAINTENANCE permissions for day-to-day building management
- **Onboarding integration**: Facilities module added to onboarding available modules list

#### Seed Data & Migration
- **Migration**: `20260214_1900` creates 9 core facility tables; `20260214_2100` creates 11 extended feature tables
- **Seed migration**: `20260214_2000` seeds default facility types, statuses, and maintenance types

### Added - Apparatus Module Hardening (2026-02-14)

#### Security & Quality Improvements
- **Tenant isolation**: All queries filter by `organization_id` — no cross-organization data leakage
- **Pagination**: All list endpoints support `skip`/`limit` with total count
- **Error handling**: Consistent error responses with proper HTTP status codes
- **Soft-delete**: `is_archived`/`archived_at`/`archived_by` pattern for apparatus records
- **Historic repair entries**: Maintenance records support attachments and repair history

### Added - Secretary Attendance Dashboard & Meeting Waivers (2026-02-14)

#### Secretary Attendance Dashboard
- **Attendance dashboard**: `GET /api/v1/meetings/attendance/dashboard` — secretary/leadership view showing every active member's meeting attendance %, meetings attended, waived, absent, membership tier, and voting eligibility
- **Period filtering**: `period_months` parameter for configurable look-back window (default 12 months)
- **Meeting type filter**: Optionally filter by meeting type (e.g. `business` only)
- **Voting eligibility**: Shows whether each member is eligible to vote and the reason if blocked (tier restrictions or attendance below minimum)

#### Meeting Attendance Waivers
- **Grant waiver**: `POST /api/v1/meetings/{meeting_id}/attendance-waiver` — secretary, president, or chief excuses a member from a meeting
- **Waiver effect**: The member cannot vote in this meeting, but their attendance percentage is not penalized
- **Attendance calculation updated**: Waived meetings are excluded from both numerator and denominator of the attendance percentage
- **List waivers**: `GET /api/v1/meetings/{meeting_id}/attendance-waivers` — view all waivers for a meeting
- **Audit trail**: Every waiver is logged as `meeting_attendance_waiver_granted` with `warning` severity
- **Migration**: `20260214_1300` adds `waiver_reason`, `waiver_granted_by`, `waiver_granted_at` to meeting_attendees

### Added - Auto-Enrollment on Prospective Member Conversion (2026-02-14)

#### Probationary Training Pipeline Auto-Enrollment
- **Auto-enroll on transfer**: When a prospective member is converted to a full member, they are automatically enrolled in the organization's default probationary training program
- **Program detection**: Looks for `settings.training.auto_enroll_program_id` first, then falls back to any active program with "probationary" in the name
- **Manual enrollment**: `POST /api/v1/training/enrollments` — training officer can enroll any member into any training pipeline (probationary, driver training, AIC, etc.)
- **Administrative conversion**: Works for both prospective→operational and administrative→operational conversions
- **Transfer response**: Includes `auto_enrollment` field showing the program enrolled into

### Added - Incident-Based Training Progress Tracking (2026-02-14)

#### Call Type Tracking in Shift Completion Reports
- **Call type matching**: When a requirement specifies `required_call_types` (e.g. `["transport", "cardiac"]`), shift completion reports now count only calls matching those types
- **Call type running totals**: `progress_notes.call_type_totals` tracks per-type counts (e.g. `{"transport": 8, "cardiac": 3}`)
- **Call type history**: `progress_notes.call_type_history` records each shift report's matching types and counts
- **Customizable by training officer**: Requirements can specify minimum calls by type (e.g. 15 total calls, 10 transports, 5 shifts) via `required_calls`, `required_call_types`, `required_shifts`, `required_hours` on `TrainingRequirement`

### Added - Scheduled Tasks / Cron Configuration (2026-02-14)

#### Cron Task Runner
- **List tasks**: `GET /api/v1/scheduled/tasks` — lists all available scheduled tasks with recommended cron schedules
- **Run task**: `POST /api/v1/scheduled/run-task?task={task_id}` — manually trigger any scheduled task
- **Recommended schedule**:
  - **Daily 6:00 AM**: `cert_expiration_alerts` — tiered certification expiration reminders
  - **Weekly Monday 7:00 AM**: `struggling_member_check` — detect members falling behind
  - **Weekly Monday 7:30 AM**: `enrollment_deadline_warnings` — warn approaching deadlines
  - **Monthly 1st 8:00 AM**: `membership_tier_advance` — auto-advance membership tiers

### Added - Struggling Member Detection & Notifications (2026-02-14)

#### Pipeline Progress Monitoring
- **Behind-pace detection**: Flags members who have used >50% of their enrollment time but completed <25% of requirements
- **Deadline approaching**: Flags members within 30 days of deadline at <75% completion (critical if within 7 days)
- **Stalled requirements**: Detects requirements with no progress updates in 30+ days
- **Auto-notification**: Training officers receive in-app alerts about struggling members (critical/warning severity)
- **Deadline warnings**: Automatic warnings at 30, 14, and 7 days before enrollment deadline
- **Large department support**: Proactively surfaces struggling members who might otherwise go unnoticed

### Added - Membership Stage Requirements Editor (2026-02-14)

#### Tier Configuration Management
- **Get config**: `GET /api/v1/users/membership-tiers/config` — view current tier configuration
- **Update config**: `PUT /api/v1/users/membership-tiers/config` — training/compliance/secretary can edit membership requirements for each stage
- **Configurable per-tier settings**: voting eligibility, meeting attendance % required for voting, training exemptions, office-holding eligibility, years-of-service for auto-advancement
- **Validation**: Ensures all tiers have `id` and `name`, attendance percentages are 0-100
- **Audit trail**: Config changes logged as `membership_tier_config_updated` with `warning` severity

### Added - Training Calendar Integration & Double-Booking Prevention (2026-02-14)

#### Training Session Calendar View
- **Calendar endpoint**: `GET /api/v1/training-sessions/calendar` — returns training sessions with linked Event data (dates, times, locations, training metadata) for calendar display
- **Date range filtering**: `start_after` / `start_before` query parameters for fetching sessions in a date window
- **Training type filter**: Filter calendar by `training_type` (certification, continuing_education, etc.)
- **Double-booking prevention**: Training sessions with a `location_id` are checked against the organization's event calendar — prevents scheduling a training session at a location already booked by another event
- **Shared calendar**: Training events appear on the organization-wide event calendar alongside all other events
- **Hall coordinator filtering**: `GET /api/v1/events?exclude_event_types=training` — hall coordinators can hide training events from their view while double-booking prevention still applies across all event types
- **`location_id` field**: Added to `TrainingSessionCreate` schema for location-aware training sessions
- **Event relationship**: Explicit `event` and `course` relationships added to `TrainingSession` model for eager loading

### Added - Competency Matrix / Heat Map Dashboard (2026-02-14)

#### Department Readiness Dashboard
- **Competency matrix**: `GET /api/v1/training/competency-matrix` — generates a member vs. requirement matrix showing certification/training status for every member
- **Color-coded statuses**: `current` (green), `expiring_soon` (yellow, within 90 days), `expired` (red), `not_started` (gray)
- **Readiness percentage**: Summary block with total members, requirements, and overall department readiness score
- **Filterable**: Optional `requirement_ids` and `user_ids` query parameters to focus on specific requirements or members
- **Gap identification**: Helps training officers identify where gaps exist and create targeted training plans

### Added - Certification Expiration Alert Pipeline (2026-02-14)

#### Tiered Expiration Reminders
- **Process alerts**: `POST /api/v1/training/certifications/process-alerts` — scans all certification records and sends tiered reminders
- **Four tiers**: 90-day, 60-day, 30-day, and 7-day warnings before expiration
- **Escalation**: Expired certifications trigger an escalation email CC'd to training officer, compliance officer, and chief
- **CC on escalation**: 30-day → training officers CC'd; 7-day → training + compliance officers; expired → + chief officer
- **Idempotent**: Each tier is tracked per-record (`alert_90_sent_at`, `alert_60_sent_at`, etc.) — will not re-send
- **Alert tracking columns**: `alert_90_sent_at`, `alert_60_sent_at`, `alert_30_sent_at`, `alert_7_sent_at`, `escalation_sent_at` on training_records

### Added - Peer Skill Evaluation Sign-Offs (2026-02-14)

#### Configurable Evaluator Permissions
- **Check evaluator**: `POST /api/v1/training/skill-evaluations/{skill_id}/check-evaluator` — verifies whether the current user is authorized to sign off on a skill
- **Role-based**: `allowed_evaluators.type = "roles"` — e.g. only `shift_leader` can sign off on AIC skills, `driver_trainer` for driver trainees
- **User-specific**: `allowed_evaluators.type = "specific_users"` — explicitly named users who may evaluate
- **Default fallback**: `null` → any user with `training.manage` permission can sign off
- **Training officer configurable**: Training officer or chief sets the `allowed_evaluators` JSON on each `SkillEvaluation` record
- **`allowed_evaluators` column**: New JSON column on skill_evaluations table

### Added - Meeting Quorum Enforcement (2026-02-14)

#### Organization-Configurable Quorum
- **Get quorum status**: `GET /api/v1/minutes/{minutes_id}/quorum` — calculates and returns current quorum status for a meeting
- **Configure quorum**: `PATCH /api/v1/minutes/{minutes_id}/quorum-config` — set per-meeting quorum type and threshold
- **Organization defaults**: `organization.settings.quorum_config` — default quorum rules applied to all meetings (type: "count" or "percentage", threshold value)
- **Check-in driven**: Quorum is calculated from attendees marked `present: true` in the meeting's attendee list
- **Per-meeting override**: Individual meetings can override the org default with `quorum_type` and `quorum_threshold` columns
- **Auto-update**: `update_quorum_on_checkin()` recalculates quorum each time an attendee checks in or is removed
- **`quorum_threshold`/`quorum_type` columns**: New columns on meeting_minutes table

### Added - Bulk Voter Override for Elections (2026-02-14)

#### Secretary Bulk Override
- **Bulk override**: `POST /api/v1/elections/{election_id}/voter-overrides/bulk` — secretary can grant voting overrides to multiple members in a single request
- **Reason required**: A reason (10–500 characters) is required for every bulk override
- **Enhanced audit logging**: Each override is individually logged with `warning` severity, and a summary audit event captures the full batch with all user IDs
- **Existing override protection**: Members who already have an override are skipped (not duplicated)

### Added - Migration 20260214_1200 (2026-02-14)

#### Schema Changes
- `meeting_minutes.quorum_threshold` (Float, nullable) — configurable quorum threshold per meeting
- `meeting_minutes.quorum_type` (String(20), nullable) — "count" or "percentage"
- `skill_evaluations.allowed_evaluators` (JSON, nullable) — configurable evaluator permissions
- `training_records.alert_90_sent_at` through `alert_7_sent_at` (DateTime, nullable) — certification alert tracking
- `training_records.escalation_sent_at` (DateTime, nullable) — escalation alert tracking

### Added - Proxy Voting for Elections (2026-02-14)

#### Proxy Voting System
- **Organization opt-in**: Proxy voting is a department choice — enabled via `organization.settings.proxy_voting.enabled`; disabled by default
- **Authorize a proxy**: `POST /api/v1/elections/{election_id}/proxy-authorizations` — secretary designates one member to vote on behalf of another, with a reason
- **Proxy types**: `single_election` (one-time for this election) or `regular` (standing proxy, noted for reference)
- **Cast proxy vote**: `POST /api/v1/elections/{election_id}/proxy-vote` — the designated proxy casts a vote; eligibility and double-vote prevention apply to the *delegating* (absent) member
- **Hash trail**: Each proxy vote records `is_proxy_vote=true`, `proxy_voter_id` (who physically voted), `proxy_delegating_user_id` (on whose behalf), and `proxy_authorization_id`; the `voter_hash` identifies the delegating member so the audit trail shows who voted on whose behalf
- **Ballot email CC**: When ballot emails are sent, the proxy holder is automatically CC'd on the delegating member's ballot notification
- **List authorizations**: `GET /api/v1/elections/{election_id}/proxy-authorizations` — view all active and revoked authorizations
- **Revoke authorization**: `DELETE /api/v1/elections/{election_id}/proxy-authorizations/{id}` — revoke before the proxy votes; cannot revoke after the vote is cast
- **Forensics integration**: The election forensics report includes a `proxy_voting` section with all authorizations and proxy votes cast
- **Full audit trail**: `proxy_authorization_granted`, `proxy_authorization_revoked`, `proxy_vote_cast`, and `proxy_vote_double_attempt` audit events
- **`proxy_authorizations` column**: New JSON column on the elections table
- **Vote columns**: `is_proxy_vote`, `proxy_voter_id`, `proxy_authorization_id`, `proxy_delegating_user_id` added to votes table
- **Migration**: `20260214_1100` adds proxy voting columns

### Added - Secretary Voter Override for Elections (2026-02-14)

#### Voter Eligibility Overrides
- **Secretary override**: `POST /api/v1/elections/{election_id}/voter-overrides` — grants a member voting rights for a specific election, bypassing tier-based and meeting attendance restrictions
- **Reason required**: Every override must include a reason (e.g. "Excused absence approved by board vote")
- **Full audit trail**: Each override records the member, reason, granting officer name, and timestamp; logged as a `voter_override_granted` audit event with `warning` severity
- **List overrides**: `GET /api/v1/elections/{election_id}/voter-overrides` — view all overrides for an election
- **Remove override**: `DELETE /api/v1/elections/{election_id}/voter-overrides/{user_id}` — revoke an override before the member votes
- **Scope**: Overrides skip tier voting eligibility and attendance percentage checks only; they do NOT bypass election-level eligible_voters lists, position-specific role requirements, or double-vote prevention
- **`voter_overrides` column**: New JSON column on the elections table
- **Migration**: `20260214_1000` adds `voter_overrides` column to elections table

### Added - Membership Tiers, Voting Attendance Rules & Training Exemptions (2026-02-14)

#### Membership Tier System
- **Configurable membership tiers**: Organization settings > `membership_tiers` defines an ordered list of tiers (default: Probationary, Active, Senior, Life) with years-of-service thresholds
- **Tier benefits per level**: Each tier can grant `training_exempt`, selective `training_exempt_types`, `voting_eligible`, `voting_requires_meeting_attendance` with configurable `voting_min_attendance_pct` and look-back `voting_attendance_period_months`, `can_hold_office`, and extensible `custom_benefits`
- **`membership_type` field on User**: Stores the member's current tier (e.g. `"probationary"`, `"life"`); defaults to `"active"`
- **Manual tier change**: `PATCH /api/v1/users/{user_id}/membership-type` — leadership can promote/adjust a member's tier with a reason
- **Auto-advancement**: `POST /api/v1/users/advance-membership-tiers` — batch-advance all eligible members based on years of service from `hire_date`; idempotent, designed for periodic triggering

#### Voting Eligibility — Meeting Attendance
- **Tier-based voting rules**: The election system now checks the member's tier benefits before allowing votes; probationary members (default config) cannot vote
- **Attendance-gated voting**: If a tier has `voting_requires_meeting_attendance: true`, the system calculates the member's meeting attendance percentage over the configured look-back period and rejects the vote if below the minimum (e.g. 50% over 12 months)
- **Attendance calculation**: Uses the `MeetingAttendee` model — counts meetings marked present vs. total meetings in the organization during the period

#### Training Exemptions
- **Tier-based exemptions**: Members at a tier with `training_exempt: true` (e.g. Life Members) have all requirements treated as met in compliance checks
- **Selective exemptions**: `training_exempt_types` allows exempting only specific requirement types (e.g. `["continuing_education"]`) while keeping others enforced

#### Migration
- `20260214_0900` adds `membership_type` (VARCHAR 50, default "active") and `membership_type_changed_at` columns to users table

### Added - Configurable Drop Notification Messages (2026-02-14)

#### Email Template & Recipient Configuration
- **Default MEMBER_DROPPED email template**: Auto-created for each organization with template variables (`{{member_name}}`, `{{reason}}`, `{{item_count}}`, etc.) — fully editable via the Email Templates settings page
- **CC/BCC support**: `EmailService.send_email()` now supports `cc_emails` and `bcc_emails` parameters
- **Configurable CC recipients**: Organization settings > `member_drop_notifications.cc_roles` controls which roles are CC'd (default: admin, quartermaster, chief)
- **Static CC emails**: `member_drop_notifications.cc_emails` allows adding extra email addresses always CC'd on drop notifications
- **Personal email support**: New `personal_email` field on user profiles for post-separation contact; `member_drop_notifications.include_personal_email` controls whether it receives the drop notification (default: true)
- **Template variable reference**: 10 available variables for the member_dropped template type, documented in the template editor
- **Migration**: `20260214_0800` adds `personal_email` column to users table

### Added - Member Archive & Reactivation (2026-02-14)

#### Member Archiving Lifecycle
- **New `archived` status**: Added to UserStatus enum — represents a dropped member who has returned all property
- **Auto-archive on last item return**: When a dropped member returns their last assigned/checked-out item, they are automatically transitioned to `archived` status
- **Manual archive endpoint**: `POST /api/v1/users/{user_id}/archive` — allows leadership to archive a dropped member manually (e.g. items written off)
- **Reactivation endpoint**: `POST /api/v1/users/{user_id}/reactivate` — restores an archived member to `active` status when they rejoin the department
- **Archived members list**: `GET /api/v1/users/archived` — lists all archived members for legal requests or reactivation lookup
- **Audit trail**: All archive/reactivation events logged with full event data
- **Admin notification**: Admins, quartermasters, and chiefs notified by email when auto-archive occurs
- **`archived_at` column**: Tracks the exact timestamp of archiving on the user record
- **Profile preservation**: Archived members' full profile, training history, and inventory records remain accessible
- **Migration**: `20260214_0700` adds `archived` enum value and `archived_at` column

#### Duplicate Member Prevention
- **Prospect creation check**: Creating a prospect with an email matching an archived member returns 409 with reactivation guidance
- **Prospect transfer check**: Transferring a prospect to membership is blocked if email matches any existing user (archived or active), with clear messaging about reactivation
- **Admin user creation check**: Creating a member via admin endpoint returns 409 with match details and reactivation URL if email matches an archived member
- **Pre-submission lookup**: `POST /api/v1/membership-pipeline/prospects/check-existing` — checks email and name against all existing members before prospect entry
- **Match types**: Cross-references by email (exact) and by first+last name (case-insensitive)

### Added - Property Return Report & Member Drop Statuses (2026-02-14)

#### Member Drop Statuses
- **New UserStatus values**: `dropped_voluntary` and `dropped_involuntary` added to the UserStatus enum
- **Status change endpoint**: `PATCH /api/v1/users/{user_id}/status` with `members.manage` permission
- **Drop reason in notification**: The `reason` field provided by leadership is now included in the property return letter sent to the dropped member (both HTML and plain text versions)
- **Audit logging**: All status changes logged with severity `warning` for drops
- **Migration**: `20260214_0500` adds new enum values to users, email_templates, and notification_rules tables

#### Property Return Report (Auto-Generated)
- **Automatic trigger**: When a member status changes to dropped, a formal property-return letter is generated
- **Printable HTML letter**: Professional letterhead format with department name, member address block (window-envelope compatible), and formal language
- **Item inventory table**: Lists every assigned and checked-out item with serial number, asset tag, condition, type (assigned/checked out), and dollar value
- **Total assessed value**: Summed from `current_value` or `purchase_price` of all items
- **Return instructions**: Three methods documented (in person, by appointment, by mail/courier) with tracking advice
- **Involuntary notice**: Additional legal-recovery paragraph automatically included for involuntary drops
- **Configurable deadline**: Return deadline in days (1-90, default 14) set per status change
- **Custom instructions**: Optional extra paragraph for department-specific notes
- **Document storage**: Report automatically saved to the Documents module (Reports folder) as a generated document
- **Email delivery**: Report emailed to the member's address on file (toggleable via `send_property_return_email`)
- **Plain text fallback**: Text version included for email clients that don't render HTML
- **Preview endpoint**: `GET /api/v1/users/{user_id}/property-return-report` to preview before dropping a member

#### Property Return Reminders (30-Day / 90-Day)
- **Automatic reminders**: 30-day and 90-day reminders sent to dropped members who still have outstanding items
- **Dual notification**: Reminder emailed to the member AND a summary sent to admin/quartermaster/chief users
- **Duplicate prevention**: Each reminder type (30-day, 90-day) sent only once per member via `property_return_reminders` tracking table
- **Escalation language**: 90-day reminder includes a "FINAL NOTICE" with recovery action warning
- **Process endpoint**: `POST /api/v1/users/property-return-reminders/process` — designed for daily cron/scheduler or manual trigger
- **Overdue dashboard**: `GET /api/v1/users/property-return-reminders/overdue` — lists all dropped members with outstanding items, days since drop, item details, and which reminders have been sent
- **Status tracking**: `status_changed_at` and `status_change_reason` columns added to users table for accurate drop-date tracking
- **Migration**: `20260214_0600` adds user columns and `property_return_reminders` table

#### Notification & Email Template Support
- **MEMBER_DROPPED trigger**: Added to NotificationTrigger enum for notification rules
- **MEMBER_DROPPED template type**: Added to EmailTemplateType for admin-customizable templates

### Added - Training Module Expansion (2026-02-14)

#### Self-Reported Training
- **Member Submission Page**: Members can submit external training for officer review at `/training/submit`
- **Officer Review Page**: Training officers review, approve, reject, or request revisions at `/training/submissions`
- **Configurable Approval Workflow**: Auto-approve under X hours, require manual approval, set review deadlines
- **Customizable Form Fields**: Per-field visibility, required flags, and custom labels (14 configurable fields)
- **Notification Settings**: Configurable notifications for submission and decision events
- **TrainingRecord Auto-Creation**: Approved submissions automatically create official training records
- **Database**: `self_report_configs` and `training_submissions` tables with migration `20260214_0200`

#### Shift Completion Reports
- **Shift Report Form**: Officers file detailed reports on trainee shift experiences at `/training/shift-reports`
- **Performance Tracking**: 1-5 star rating, areas of strength, areas for improvement, officer narrative
- **Skills Observed**: Track specific skills with demonstrated/not-demonstrated status
- **Auto-Pipeline Progress**: Reports linked to enrollments automatically update requirement progress for SHIFTS, CALLS, and HOURS requirement types
- **Trainee Acknowledgment**: Trainees can review and acknowledge reports with comments
- **Three-Tab Interface**: New Report, Filed Reports (by officer), My Reports (received as trainee)
- **Database**: `shift_completion_reports` table with migration `20260214_0300`
- **API**: 9 endpoints under `/api/v1/training/shift-reports/`

#### Training Reports
- **Training Progress Report**: Pipeline enrollment progress, requirement completion rates, member advancement status
- **Annual Training Report**: Comprehensive annual breakdown of training hours, shift hours, courses, calls, performance ratings, training by type
- **Date Range Picker**: Customizable reporting periods with preset buttons (This Year, Last Year, Last 90 Days, Custom) and date inputs
- **Report Period Display**: Selected period shown in report results modal header

#### Member Training Page ("My Training")
- **Personal Training Page** at `/training/my-training`: Aggregated view of all training data for each member
- **Collapsible Sections**: Training hours summary, certifications, pipeline progress, shift reports, training history, submissions
- **Stat Cards**: Total hours, records, shifts, average rating at a glance
- **Certification Alerts**: Expired and expiring-soon badges with days-until-expiry
- **Navigation**: Quick action links from Training Dashboard and member profile

#### Member Visibility Configuration
- **TrainingModuleConfig Model**: 14 boolean visibility toggles per organization controlling what members see
- **Officer Settings Tab**: Officers can toggle each data category on/off from the My Training page
- **Granular Control**: Independently control training history, hours, certifications, pipeline progress, requirement details, shift reports, shift stats, performance ratings, strengths, improvement areas, skills observed, officer narrative, submission history, and report export
- **Default-Off Fields**: Officer narrative and report export are hidden from members by default
- **Officer Override**: Officers and administrators always see the full dataset regardless of settings
- **Database**: `training_module_configs` table with migration `20260214_0400`
- **API**: 4 endpoints under `/api/v1/training/module-config/`

#### Documentation Updates
- **TRAINING_PROGRAMS.md**: Added sections for self-reported training, shift completion reports, member training page, member visibility configuration, training reports, and new database schemas
- **TROUBLESHOOTING.md**: Added Training Module section with 7 troubleshooting scenarios covering self-reported training, shift reports, my training page, visibility settings, and training reports
- **CHANGELOG.md**: Comprehensive changelog entry for all training module features

### Added - Events Module Enhancements (2026-02-14)

#### Recurring Events & Templates
- **Recurrence Patterns**: Support for daily, weekly, monthly, and yearly recurrence with configurable intervals, end dates, and occurrence limits
- **Event Templates**: Create and apply reusable event templates for common event configurations
- **Recurrence Pattern Models**: `EventRecurrence` and `EventTemplate` database models with full schema support
- **Frontend Types**: Complete TypeScript types for recurrence patterns, templates, and event duplication

#### Event Creation & Editing
- **Dedicated EventCreatePage**: Full-featured event creation page with `EventForm` component (extracted from EventsPage for better code organization)
- **Event Edit/Delete UI**: `EventEditPage` with pre-populated form, delete confirmation, and cancel notifications
- **Event Duplication**: Duplicate existing events from the detail page with all settings carried over
- **EventForm Component**: Reusable form component with all event fields, validation, and type safety

#### Event Attachments
- **Upload Endpoint**: `POST /events/{id}/attachments` for file uploads with metadata
- **Download Endpoint**: `GET /events/{id}/attachments/{attachment_id}` for file retrieval
- **Delete Endpoint**: `DELETE /events/{id}/attachments/{attachment_id}` for file removal

#### Event Operations
- **Booking Prevention**: Prevent double-booking of locations for overlapping event times
- **RSVP Overrides**: Admin override for RSVP limits and deadline enforcement
- **Event Notifications**: Cancel notifications sent when events are deleted
- **Organization Timezone**: Timezone support added to auth flow and date formatting utilities

#### Test Coverage
- **5 Test Files**: Comprehensive test coverage for `EventForm`, `EventCreatePage`, `EventDetailPage`, `EventEditPage`, and `EventsPage`
- **1,865+ Test Lines**: Full component testing with mock API responses, form interactions, and edge cases

### Fixed - TypeScript & Backend Quality (2026-02-14)

#### TypeScript Build Fixes
- **All Build Errors Resolved**: Fixed all TypeScript compilation errors across the entire frontend codebase
- **17 'as any' Assertions Removed**: Replaced all unsafe `as any` type assertions with proper typing across 7 files (apparatus API, AddMember, EventDetailPage, EventQRCodePage tests, MinutesDetailPage, test setup, errorHandling utility)
- **Broken JSX Fixed**: Repaired broken JSX in `DocumentsPage` and `MinutesPage` caused by merged duplicate code blocks
- **Duplicate Type Identifier Fixed**: Resolved duplicate `User` type export in membership types

#### Backend Quality Fixes
- **Python Backend Incongruities**: Fixed broken dependency injection, duplicate models, and missing permissions across 29 files
  - Fixed `models/__init__.py` with unified model registry
  - Added `core/permissions.py` with comprehensive permission definitions
  - Fixed meetings and minutes endpoints with correct DI patterns
  - Fixed document service and schemas
- **Mutable Default Arguments**: Fixed mutable default values (`[]`, `{}`) across all backend models (analytics, apparatus, email_template, error_log, integration, membership_pipeline, user) using `default_factory`
- **Documents Schema**: Made `file_name` optional and added missing folder fields in document schemas

#### Startup & Runtime Fixes
- **Polling Loop Fix**: Fixed infinite polling loop in onboarding check page
- **Type Safety**: Fixed type safety issues in onboarding hooks (`useApiRequest`) and `OnboardingCheck` page
- **API Client**: Fixed onboarding API client service method signatures

#### Events Module Bug Fixes
- **Runtime Crashes**: Fixed critical events module bugs causing runtime crashes and missing data
- **Event Endpoints**: Simplified and fixed event API endpoints (reduced broken logic)
- **Location Model**: Fixed location model relationship definitions
- **Event Service**: Fixed event service with proper error handling and data loading

#### Code Cleanup
- **Events Module Deduplication**: Removed duplicate code in `EventCheckInMonitoringPage` and `EventsPage`, extracted shared types to `event.ts`
- **Minute Model**: Added missing relationship for event linking

### Added - Meeting Minutes & Documents Module (2026-02-13)

#### Meeting Minutes Backend
- **Database Models**: `MeetingMinutes`, `MinutesTemplate`, `MinutesSection` with UUID primary keys, organization scoping, and foreign keys to events
- **8 Meeting Types**: `business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other` — each with tailored default section templates
- **Dynamic Sections System**: Minutes use a flexible JSON sections array (`order`, `key`, `title`, `content`) replacing hardcoded content fields — sections can be added, removed, and reordered
- **Template System**: `MinutesTemplate` model with configurable sections, header/footer configs, meeting type defaults, and `is_default` flag per type
- **Default Section Presets**:
  - Business (9 sections): call to order, roll call, approval of previous, treasurer report, old/new business, etc.
  - Trustee (11 sections): adds financial review, trust fund report, audit report, legal matters
  - Executive (11 sections): adds officers' reports, strategic planning, personnel matters, executive session
  - Annual (12 sections): adds annual report, election results, awards & recognition
- **Minutes Lifecycle**: `draft` → `review` → `approved` status progression with edit protection for approved minutes
- **Publish Workflow**: Approved minutes can be published to the Documents module as styled HTML with organization branding
- **Event Linking**: Minutes can be linked to events via `event_id` foreign key
- **Search**: Full-text search across title and section content with SQL LIKE injection protection

#### Documents Backend
- **Document Management**: `Document` and `DocumentFolder` models with folder hierarchy, tagging, and file metadata
- **7 System Folders**: SOPs, Policies, Forms & Templates, Reports, Training Materials, Meeting Minutes, General Documents — auto-created on first access, non-deletable
- **Custom Folders**: Users can create, update, and delete custom folders alongside system folders
- **Document Types**: `policy`, `procedure`, `form`, `report`, `minutes`, `training`, `certificate`, `general`
- **Source Tracking**: Documents track their origin (`upload`, `generated`, `linked`) and source reference ID

#### API Endpoints
- **Minutes**: 10 endpoints — CRUD, list, search, templates CRUD, publish
- **Documents**: 5 endpoints — folders CRUD, document list/get/delete
- **Permissions**: `meetings.view` for read access, `meetings.manage` for write operations

#### Frontend Pages
- **MinutesPage.tsx**: Meeting type filtering with color-coded badges, template selector in create modal (auto-selects default template per meeting type), search, quick stats dashboard
- **MinutesDetailPage.tsx**: Dynamic section editor with rich text, section reordering (up/down), add/delete sections, publish button for approved minutes, "View in Documents" link for published minutes
- **DocumentsPage.tsx**: Folder-based browsing, document viewer modal with server-rendered HTML, grid/list view toggle, custom folder management, document count badges

#### Database Migrations
- Migration `add_meeting_minutes`: Creates `meeting_minutes` table with all fields and indexes
- Migration `20260213_0800`: Adds `minutes_templates`, `document_folders`, `documents` tables with dynamic sections support
- Migration `a7f3e2d91b04`: Extends MeetingType ENUM with `trustee`, `executive`, `annual` on both tables

### Security - Meeting Minutes Module Review (2026-02-13)

#### Fixes Applied
- **HIGH: Audit log parameter mismatch** — 6 audit log calls in minutes and documents endpoints used wrong parameter names (`action=`, `details=` instead of `event_type=`, `event_data=`), causing silent `TypeError` at runtime. Fixed all calls to use correct `log_audit_event()` signature
- **MEDIUM: SQL LIKE pattern injection** — Search inputs in `minute_service.py` (2 methods) and `document_service.py` (1 method) passed directly into `%{search}%` without escaping `%` and `_` wildcards. Fixed by escaping all three special characters before interpolation
- **LOW: Unbounded query limits** — List and search endpoints accepted arbitrary `limit` values. Added `min(limit, 100)` for list endpoints and `min(limit, 50)` for search

#### Verified Secure
- Multi-tenancy via `organization_id` scoping on all queries
- Permission checks (`meetings.view`/`meetings.manage`) on all endpoints
- Status-based edit protection (approved minutes cannot be modified)
- HTML generation uses `html.escape()` for all user content
- System folder protection (cannot delete system folders)
- Pydantic validation on all request schemas

### Fixed - Migration Chain Integrity (2026-02-13)

- **Broken Alembic migration chain**: Three minutes/documents migrations had incorrect `down_revision` values creating orphaned migration heads
  - `add_meeting_minutes`: Fixed `down_revision` from `None` to `'20260212_0400'`
  - `20260213_0800`: Fixed `down_revision` from `'20260212_1200'` (wrong revision ID) to `'add_meeting_minutes'`
  - `a7f3e2d91b04`: Fixed `down_revision` from `None` to `'20260213_0800'`

### Enhanced - Email Ballot Voting Page (2026-02-12)

#### Token-Based Ballot Page (`BallotVotingPage.tsx`)
- **Public ballot page** at `/ballot?token=xxx` — no authentication required, accessed via "Vote Now" link in email
- **Full ballot display**: Shows all ballot items with item numbers, titles, descriptions
- **Voting options per item**: Approve/Deny for approval items, candidate selection for elections, write-in for custom entries, or abstain
- **Submit Ballot button** at bottom of page with review prompt
- **Confirmation modal**: Shows summary of all choices (item title + selected option) before final submission
- **"Change Ballot" / "Cast Ballot"** options in confirmation — member can go back and modify or confirm
- **Success confirmation**: Green checkmark with submission summary (votes cast, abstentions)
- **Error handling**: Clear messages for expired tokens, already-submitted ballots, invalid links

#### Backend: Bulk Ballot Submission
- **`POST /ballot/vote/bulk?token=xxx`** endpoint: Submits all ballot item votes atomically in one transaction
- **Write-in support**: Creates write-in candidates on the fly when member enters a custom name
- **Approve/Deny candidates**: Auto-created for approval-type ballot items
- **Abstain handling**: Items marked as abstain are skipped (no vote recorded)
- **Token lifecycle**: Token marked as used after full ballot submission, preventing reuse
- **HMAC-SHA256 signatures** on every vote for tamper detection
- **Audit logging**: Full ballot submission logged with vote count and abstention count

#### Email Template Updates
- **"Vote Now" button** (was "Cast Your Vote") — centered, prominent blue button
- **Ballot URL** now points to frontend `/ballot` page instead of API endpoint

### Enhanced - Ballot Builder, Meeting Attendance & Member Class Eligibility (2026-02-12)

#### Meeting Attendance Tracking
- **Attendance management endpoints**: `POST /elections/{id}/attendees` (check in), `DELETE /elections/{id}/attendees/{user_id}` (remove), `GET /elections/{id}/attendees` (list)
- **`attendees` JSON column** on Election model to track who is present at meetings
- **Audit logging**: All attendance check-ins and removals are logged to the tamper-proof audit trail

#### Member Class Eligibility System
- **Extended `_user_has_role_type()`** with member class categories: `regular` (active non-probationary), `life` (life_member role), `probationary` (probationary status)
- **Per-ballot-item eligibility**: Each ballot item can specify which member classes may vote (e.g., only regular + life members for membership approvals)
- **Attendance requirement**: Ballot items can require meeting attendance (`require_attendance` flag) — voters must be checked in to participate
- **Combined checks**: Voting eligibility now evaluates both member class AND attendance for each ballot item

#### Ballot Templates API
- **7 pre-configured templates**: Probationary to Regular, Admin Member Acceptance, Officer Election, Board Election, General Resolution, Bylaw Amendment, Budget Approval
- **`GET /elections/templates/ballot-items`** endpoint returns templates with title/description placeholders
- **One-click creation**: Secretary selects a template, fills in the name/topic, and the ballot item is created with correct eligibility rules

#### Ballot Builder UI (`BallotBuilder.tsx`)
- **Template picker**: Visual grid of available templates with eligibility badges
- **Custom item form**: Create custom ballot items with configurable type, vote type, voter eligibility, and attendance requirements
- **Reorder and remove**: Drag items up/down, remove unwanted items
- **Live preview**: Shows title preview as secretary types the name/topic

#### Meeting Attendance UI (`MeetingAttendance.tsx`)
- **Check-in interface**: Search members by name or badge number, one-click check-in
- **Attendance display**: Green pills showing checked-in members with timestamps
- **Attendance percentage**: Shows percentage of organization members present
- **Remove capability**: Remove accidentally checked-in members

#### Database Migration
- Migration `20260212_0400`: Adds `attendees` JSON column to elections table

### Enhanced - Elections Audit Logging & Ballot Forensics (2026-02-12)

#### Tamper-Proof Audit Logging
- **Full audit trail integration**: All election operations now log to the tamper-proof `audit_logs` table with blockchain-style hash chains
- **14 event types**: `election_created`, `election_opened`, `election_closed`, `election_deleted`, `election_rollback`, `vote_cast`, `vote_cast_token`, `vote_double_attempt`, `vote_double_attempt_token`, `vote_soft_deleted`, `vote_integrity_check`, `ballot_emails_sent`, `runoff_election_created`, `forensics_report_generated`
- **Loguru structured logging**: All election operations emit structured log messages with election IDs, positions, and outcomes for operational monitoring

#### Ballot Forensics
- **Forensics aggregation endpoint** (`GET /elections/{id}/forensics`): Single API call returning vote integrity, deleted votes, rollback history, token access logs, audit trail, anomaly detection (suspicious IPs), and voting timeline
- **Anomaly detection**: Flags IP addresses with suspiciously high vote counts; provides per-hour voting timeline for detecting ballot stuffing patterns
- **BALLOT_FORENSICS_GUIDE.md**: Step-by-step playbook for investigating disputed elections with 5 scenario walkthroughs, complete API reference, and audit event reference table

### Enhanced - Elections Module Low-Priority Improvements (2026-02-12)

#### Vote Integrity & Audit Trail
- **Vote Signatures**: HMAC-SHA256 cryptographic signatures on every vote for tampering detection. New `verify_vote_integrity()` endpoint validates all signatures and reports any anomalies
- **Soft-Delete for Votes**: Votes are never hard-deleted — `deleted_at`, `deleted_by`, and `deletion_reason` columns maintain full audit trail. All queries filter out soft-deleted votes
- **Vote Integrity Verification Endpoint**: `GET /elections/{id}/integrity` returns signature validation results (PASS/FAIL, tampered vote IDs)
- **Soft-Delete Vote Endpoint**: `DELETE /elections/{id}/votes/{vote_id}` marks votes as deleted with reason, preserving audit trail

#### Voting Methods
- **Ranked-Choice (Instant-Runoff) Voting**: Full IRV implementation with iterative elimination rounds. Voters rank candidates; lowest-ranked candidate eliminated each round until majority winner found
- **Approval Voting**: Voters can approve multiple candidates; percentages calculated based on unique voters rather than total ballot count
- **Vote Rank Support**: `vote_rank` field on votes (schema, model, migration) for ranked-choice ballots

#### Bulk & Multi-Position Improvements
- **Atomic Bulk Voting**: `POST /elections/{id}/vote/bulk` now uses database savepoints — either all votes succeed or none are committed
- **Multi-Position Token Tracking**: Token-based voting tracks `positions_voted` per token; tokens are only marked as "used" when all positions are voted on

#### Frontend Components
- **Voter-Facing Ballot UI** (`ElectionBallot.tsx`): Full voting interface supporting simple, ranked-choice, and approval voting methods. Shows eligibility status, per-position voting, and confirmation
- **Candidate Management UI** (`CandidateManagement.tsx`): Admin interface for adding, editing, accepting/declining, and removing candidates with position grouping and write-in support
- **ElectionDetailPage Integration**: Ballot and candidate management sections embedded in the election detail page

#### Database Migration
- Migration `20260212_0300`: Adds `vote_signature`, `deleted_at`, `deleted_by`, `deletion_reason`, `vote_rank` to votes table; `positions_voted` to voting_tokens table; `ix_votes_deleted_at` index

### Security - Elections Module Deep Review (2026-02-12)

#### Critical Fixes (4)
- **SEC-C1: Remove status from ElectionUpdate** — Prevents bypassing `/open`, `/close`, `/rollback` validation logic by directly PATCHing the status field on DRAFT elections
- **SEC-C2: Add IntegrityError handling to `cast_vote_with_token()`** — Token-based anonymous voting now catches database constraint violations instead of returning 500 errors
- **SEC-C3: Fix anonymous vote eligibility check** — `check_voter_eligibility()`, `_get_user_votes()`, and `has_user_voted()` now query by `voter_hash` for anonymous elections instead of `voter_id` (which is NULL)
- **SEC-C4: Fix `datetime.now()` to `datetime.utcnow()`** — Results visibility check now uses consistent UTC time, preventing timezone-dependent early/late result disclosure

#### Medium Fixes (6)
- **SEC-M3: Add enum validation** — `voting_method`, `victory_condition`, and `runoff_type` are now validated against allowed values via Pydantic field validators
- **SEC-M4: Validate candidate positions** — Candidate creation now rejects positions not defined in the election's positions list
- **SEC-M5: HTML-escape rollback email content** — Election titles, performer names, reasons, and user names are HTML-escaped in rollback notification emails
- **SEC-M6: Block results visibility toggle for OPEN elections** — `results_visible_immediately` can no longer be toggled while voting is active, preventing strategic voting via live result disclosure
- **Guard `close_election()` to require OPEN status** — Prevents closing DRAFT or CANCELLED elections that were never opened
- **Frontend: Hide results visibility toggle for open elections** — Matches backend restriction

#### Updated
- **ELECTION_SECURITY_AUDIT.md** — Updated scores (7.1/10 → 9.0/10), marked all critical/high items as fixed, added new test recommendations, added audit history

### Added - Prospective Members: Withdraw & Election Package Integration (2026-02-12)

#### Withdraw / Archive Feature
- **Withdraw Action**: Active or on-hold applicants can be voluntarily withdrawn from the pipeline with an optional reason
- **Withdrawn Tab**: New tab on the main page showing all withdrawn applications with date, reason, and reactivate option
- **Withdrawn Stats Card**: Stats bar shows withdrawn count when greater than zero
- **Reactivation from Withdrawn**: Coordinators can reactivate withdrawn applications back to their previous pipeline stage
- **Confirmation Dialogs**: Withdraw action requires confirmation in both the detail drawer and table action menu

#### Election Package Integration
- **Auto-Created Packages**: When an applicant advances to an `election_vote` stage, the system automatically creates an election package bundling their data
- **Configurable Package Fields**: Stage config lets coordinators choose what applicant data to include (email, phone, address, DOB, documents, stage history)
- **Package Review UI**: Election package section in the applicant detail drawer with status badge, applicant snapshot, and editable fields
- **Coordinator Notes**: Draft packages can be edited with coordinator notes and a supporting statement for voters
- **Submit for Ballot**: "Mark Ready for Ballot" button transitions package from draft to ready for the secretary
- **Cross-Module Query**: `electionPackageService` provides endpoints for the Elections module to discover ready packages
- **Recommended Ballot Item**: Each package includes pre-configured ballot item settings from the stage's election config (voting method, victory condition, anonymous voting)
- **Package Status Tracking**: Five statuses (draft, ready, added_to_ballot, elected, not_elected) with appropriate UI for each

### Added - Prospective Members Module (2026-02-12)

#### Pipeline Management
- **Configurable Pipeline Builder**: Drag-and-drop stage builder with four stage types (form submission, document upload, election/vote, manual approval)
- **Pipeline Stages**: Each stage has a name, description, type, and optional per-stage inactivity timeout override
- **Dual View Modes**: Toggle between kanban board (drag-and-drop columns) and table view (sortable, paginated) for managing applicants
- **Server-Side Pagination**: Efficient pagination for large applicant lists with configurable page sizes
- **Bulk Actions**: Select multiple applicants to advance, hold, or reject in batch

#### Applicant Lifecycle
- **Status Tracking**: Six applicant statuses — active, on_hold, withdrawn, converted, rejected, inactive
- **Stage Progression**: Advance applicants through pipeline stages with action menu or drag-and-drop
- **Detail Drawer**: Slide-out panel showing full applicant details, notes, stage history, and activity timestamps
- **Conversion Flow**: Convert successful applicants to administrative member or probationary member via conversion modal

#### Inactivity Timeout System
- **Configurable Timeouts**: Pipeline-level default timeout with presets (3 months, 6 months, 1 year, never) or custom days
- **Per-Stage Overrides**: Individual stages can override the pipeline default for stages that naturally take longer (e.g., background checks)
- **Two-Phase Warnings**: Visual indicators at configurable warning threshold (amber at warning %, red at critical/approaching timeout)
- **Automatic Deactivation**: Applications automatically marked inactive when no action occurs within the timeout period
- **Notification Controls**: Toggle notifications for coordinators and/or applicants when approaching timeout
- **Active/Inactive Tabs**: Main page splits into Active and Inactive tabs with badge counts
- **Reactivation**: Coordinators can reactivate inactive applications; applicants can self-reactivate by resubmitting interest form
- **Auto-Purge**: Optional automatic purging of inactive applications after configurable period (default 365 days) to reduce stored private data
- **Manual Purge**: Bulk purge with confirmation modal and security messaging about permanent data deletion
- **Stats Annotations**: Statistics explicitly note what is included/excluded (active applicants only; inactive, rejected, withdrawn excluded from conversion rates)

#### Cross-Module Integration
- **Forms Integration**: Pipeline stages of type `form_submission` link to the Forms module for structured data collection
- **Elections Integration**: Pipeline stages of type `election_vote` link to the Elections module for membership votes
- **Notifications Integration**: Configurable alerts for stage changes, inactivity warnings, and timeout events

#### Onboarding & Permissions
- **Optional Module**: Added to onboarding module registry as optional, Core category module
- **Role Permissions**: Secretary and Membership Coordinator roles granted manage permissions by default
- **RBAC Integration**: `prospective_members.view` and `prospective_members.manage` permissions

#### Frontend Architecture
- **Module Structure**: Full standalone module at `frontend/src/modules/prospective-members/` with types, services, store, components, and pages
- **Zustand Store**: Comprehensive state management with server-side pagination, active/inactive tabs, loading states, and all CRUD operations
- **Route Encapsulation**: `getProspectiveMembersRoutes()` registered in App.tsx with lazy-loaded pages
- **7 Components**: PipelineBuilder, PipelineKanban, PipelineTable, ApplicantCard, ApplicantDetailDrawer, ConversionModal, StageConfigModal

### Added - Forms Module (2026-02-12)

#### Custom Forms Engine
- **Form Builder**: Full form management with 15+ field types (text, textarea, email, phone, number, date, time, datetime, select, multiselect, checkbox, radio, file, signature, section_header, member_lookup)
- **Form Lifecycle**: Draft, Published, and Archived states with publish/archive workflows
- **Starter Templates**: Pre-built templates for Membership Interest Form and Equipment Assignment Form
- **Field Configuration**: Labels, placeholders, help text, validation patterns, min/max constraints, required flags, field width (full/half/third)
- **Field Reordering**: Drag-and-drop field ordering via reorder endpoint
- **Submission Management**: View, filter, and delete submissions with pagination

#### Public-Facing Forms
- **Public Form URLs**: Each form gets a unique 12-character hex slug for public access (`/f/:slug`)
- **No-Auth Submission**: Public forms accept submissions without authentication
- **Public Form Page**: Clean, light-themed form page for external visitors with all field types rendered
- **QR Code Generation**: Downloadable QR codes (PNG/SVG) in the sharing modal for printing and placing in physical locations
- **Organization Branding**: Public forms display the organization name and form description

#### Cross-Module Integrations
- **Membership Integration**: Public form submissions can feed into the membership module for admin review
- **Inventory Integration**: Internal forms with member lookup can assign equipment via the inventory module
- **Field Mappings**: Configurable JSON field mappings between form fields and target module fields
- **Integration Management UI**: Add, view, and delete integrations per form in the admin interface

#### Form Security
- **Input Sanitization**: All form submission data is HTML-escaped, null-byte stripped, and length-limited before storage
- **Type Validation**: Email format + header injection check, phone character validation, number range validation
- **Option Validation**: Select/radio/checkbox values validated against allowed options (prevents arbitrary value injection)
- **Rate Limiting**: Public form views (60/min/IP) and submissions (10/min/IP) with lockout periods
- **Honeypot Bot Detection**: Hidden field in public forms silently rejects bot submissions with fake success response
- **Slug Validation**: Form slugs validated against strict hex pattern to prevent path traversal
- **DOMPurify**: Frontend sanitization of all server-provided text content for defense-in-depth XSS protection

#### Backend Architecture
- **Database Models**: Form, FormField, FormSubmission, FormIntegration with UUID primary keys
- **Alembic Migrations**: Two migrations for forms tables and public form extensions
- **FormsService**: Comprehensive service layer with sanitization, validation, integration processing
- **API Endpoints**: 16+ REST endpoints for form CRUD, field management, submissions, integrations, member lookup
- **Public API**: Separate `/api/public/v1/forms/` router with no authentication
- **Permissions**: `forms.view` and `forms.manage` integrated with RBAC system

### Added - Module UIs (2026-02-11)

#### Fully-Built Module Pages
- **Events Page**: Full event management with create/edit modals, event type filtering (business meeting, public education, training, social, fundraiser, ceremony), RSVP settings, reminders, QR code check-in links
- **Inventory Page**: Tabbed items/categories management with CRUD modals, item types (uniform, PPE, tool, equipment, vehicle, electronics, consumable), status tracking (available, assigned, checked out, in maintenance, lost, retired), condition tracking, search and filtering
- **Training Dashboard**: Three-tab layout (courses, requirements, certifications), expiring certification alerts (90-day window), links to officer dashboard, requirements management, programs, and session creation
- **Documents Page**: Folder-based document management with 6 default categories (SOPs, Policies, Forms & Templates, Reports, Training Materials, General Documents), grid/list view toggle, upload and folder creation modals
- **Scheduling Page**: Week/month calendar views, shift templates (day, night, morning), calendar navigation, shift creation with date ranges and staffing requirements
- **Reports Page**: Reports catalog with categories (member, training, event, compliance), report cards with descriptions and availability status
- **Minutes Page**: Meeting minutes management with type filtering (business, special, committee, board), quick stats dashboard, create modal, search and filter
- **Elections Page**: Election management with detail view sub-page

#### Navigation System
- **Persistent Side Navigation**: Fixed 256px sidebar (collapsible to 64px) with submenu support for Operations, Governance, Communication, and Settings sections
- **Top Navigation**: Horizontal header bar alternative with responsive mobile hamburger menu
- **Configurable Layout**: Users choose between top or left sidebar navigation during onboarding; preference stored in sessionStorage
- **Accessibility**: ARIA labels, focus traps for mobile menu, "Skip to main content" link, keyboard navigation

#### Dashboard
- **Stats Dashboard**: Displays total members, active members, documents count, setup percentage, recent events, and pending tasks
- **Dashboard Stats API**: `GET /api/v1/dashboard/stats` endpoint returns organization statistics
- **Training Widget**: Shows top 3 active training enrollments with progress

### Added - Roles & Permissions (2026-02-10)

#### New System Roles (8 additional roles)
- **Officers** (Priority 70): General officer role with broad operational access — scheduling, inventory, events, forms management
- **Quartermaster** (Priority 85): Department inventory, equipment, and gear assignment management
- **Training Officer** (Priority 65): Training programs, sessions, certifications, and related event management
- **Public Outreach Coordinator** (Priority 65): Public education and outreach event management
- **Meeting Hall Coordinator** (Priority 60): Meeting hall and location booking management
- **Membership Coordinator** (Priority 55): Member records, applications, onboarding/offboarding, role assignment
- **Communications Officer** (Priority 55): Website, social media, newsletters, and notification management
- **Apparatus Manager** (Priority 50): Fleet tracking, maintenance logging, and equipment checks

#### Role System Improvements
- **Unified Role Initialization**: `DEFAULT_ROLES` in `permissions.py` is now the single source of truth for all role definitions, replacing scattered role creation logic
- **Wildcard Permission Fix**: Permission check now correctly handles wildcard (`*`) permissions for IT Administrator role

### Fixed - Onboarding (2026-02-09)

#### State Persistence
- **Role Permissions Persistence**: Role permission customizations now persist across page navigation via Zustand store with localStorage; previously, navigating away from the Role Setup page reset all permissions to defaults
- **Module Configuration Persistence**: Module permission configs (`modulePermissionConfigs`) now save to the Zustand store instead of using a fake setTimeout; available roles are dynamically read from `rolesConfig` instead of being hardcoded
- **Orphaned Role ID Filtering**: When restoring module permission configs, role IDs are now validated against available roles — prevents "undefined" display when a previously-configured role is removed in the Role Setup step
- **Icon Serialization**: Role icons are serialized to string names for localStorage storage and deserialized back to React components on restore via `ICON_MAP`

#### Authentication & Navigation
- **Auth Token Key Fix**: Fixed critical redirect loop caused by AppLayout checking `localStorage.getItem('auth_token')` instead of the correct `'access_token'` key — this caused hundreds of API requests per second as the app bounced between login and dashboard
- **Branding Persistence**: Organization name and logo now transfer correctly from onboarding to the main application layout via sessionStorage

### Fixed - Infrastructure (2026-02-09)

#### Docker Graceful Shutdown
- **Exec Form CMD**: Backend Dockerfile and all Docker Compose files now use exec form (`["uvicorn", ...]`) instead of shell form, ensuring uvicorn receives SIGTERM signals directly
- **Stop Grace Period**: Added `stop_grace_period: 15s` to all Docker Compose configurations (main, minimal, Unraid) to allow in-flight requests to complete
- **Init Process**: Added `init: true` to backend services as a signal-forwarding safety net
- **Unraid Compose Files**: Updated both `docker-compose-unraid.yml` and `docker-compose-build-from-source.yml` with graceful shutdown settings

#### Backend Fixes
- **Apparatus Module Whitelist**: Fixed module slug mismatch for apparatus/public outreach in the module configuration whitelist

### Fixed - Authentication & Login (2026-02-11)

#### Login Flow
- **Login 401 Fix**: `get_user_from_token()` compared a UUID object against a `String(36)` database column causing type mismatch in aiomysql — fixed to query by token string only
- **Account Lockout Persistence**: Failed login counter was flushed but rolled back when HTTPException was raised — changed to explicit `commit()` so lockout increments persist
- **Token Refresh Type Mismatch**: `UUID(payload["sub"])` didn't match `String(36)` column — kept as string for correct comparison
- **Session Revocation Fix**: Same UUID-vs-String mismatch in session revocation resolved
- **Session Creation**: Onboarding endpoint created bare JWT with no UserSession row — now uses `create_user_tokens()` which creates the session record
- **Login Redirect**: Login page now redirects to `/dashboard` instead of `/` for authenticated users
- **ProtectedRoute Race Condition**: Route component now checks localStorage first and shows spinner while validating token, preventing flash of login page

#### Auth UX
- **Concurrent Token Refresh**: Multiple simultaneous 401 responses now share a single refresh promise instead of each triggering independent refresh calls — prevents replay detection from logging users out
- **Welcome Page Detection**: Welcome page now detects when onboarding is already completed and redirects appropriately
- **Logout Confirmation Modal**: New modal with ARIA attributes, Escape key support, and background scroll lock warns about unsaved changes before logging out

### Added - Login Page (2026-02-11)

- **Organization Branding**: Unauthenticated `GET /auth/branding` endpoint returns org name and logo; login page displays logo with "Sign in to [Org Name]" heading
- **Footer**: Copyright footer with org name and "Powered by The Logbook" text matching onboarding style
- **Logo Shape**: Updated logo container from circular to rounded square

### Added - Startup Optimization (2026-02-11)

- **Fast-Path Database Initialization**: Fresh databases now use `create_all()` instead of running 39+ Alembic migrations sequentially, reducing first-boot time from ~20 minutes to seconds
- **Onboarding Completion Fix**: Added explicit `await db.commit()` in admin-user endpoint — previously relied on auto-commit but frontend immediately called `/complete`
- **Audit Logger Savepoint**: Onboarding `/complete` endpoint was failing with 500 error due to audit logger commit conflicts — added savepoint isolation
- **End-to-End Test Script**: Comprehensive bash script (`test_onboarding_e2e.sh`) validating complete onboarding flow: startup, session management, organization creation, admin user setup, login/auth, and database verification

### Security - Election System (2026-02-10)

- **Double-Voting Prevention**: Added 4 partial unique indexes on the votes table to prevent duplicate votes at the database level — guards against race conditions and direct DB manipulation
- **Election Results Timing**: Results now require both `status=CLOSED` AND `end_date` to have passed before revealing vote counts — prevents premature result leaks during active elections
- **Integrity Error Handling**: `cast_vote()` now catches `IntegrityError` with a user-friendly message instead of a 500 error
- **Security Audit**: Comprehensive election security audit documented in `ELECTION_SECURITY_AUDIT.md` (rating: 7.1/10) — identified and resolved critical double-voting gap, catalogued anonymous voting strengths (HMAC-SHA256)

### Added - UX Improvements (2026-02-10)

#### Week 1: Core Usability
- **Password Reset Flow**: New Forgot Password and Reset Password pages
- **Live Dashboard Stats**: Replaced hardcoded dashboard values with live API data and skeleton loaders
- **User Settings Page**: Full settings page with account, password, and notification tabs
- **Dead Navigation Links Fixed**: Reports and Settings links now route correctly

#### Week 2: Safety
- **Logout Confirmation**: Modal warns about unsaved changes before logging out

#### Week 3: Onboarding Polish
- **Module Features Visible**: Module cards now display the first 3 features upfront with "+ X more" hint instead of hiding behind "More info" button
- **Breadcrumb Progress Indicator**: Step names with green checkmarks replace the simple step counter
- **Simplified Organization Setup**: Relaxed ZIP validation, form sections expanded by default
- **Focus Trap Hook**: Reusable `useFocusTrap` hook for WCAG-compliant mobile menus

#### Week 4: Contextual Help
- **Help Link Component**: Reusable `HelpLink` with 3 variants (icon/button/inline), tooltip support, configurable positioning
- **Integrated Help Tooltips**: Added to Dashboard, Organization Setup, and Reports pages

#### Additional UX Fixes
- **Membership Type Field**: Dropdown (prospective/probationary/regular/life/administrative) in admin user creation with prospective member warning banner
- **Administrator Terminology**: Clarified distinction between IT Administrator (system admin) and Administrative Member (membership type)
- **Validation Toast Fix**: `validateForm()` now returns errors directly instead of reading stale state, fixing "0 errors" toast message

### Fixed - Backend (2026-02-10)

#### SQLAlchemy Async Fixes
- **Organization Creation Greenlet Error**: Added `await db.refresh(org)` after flush to prevent lazy-loading of `organization_type.value` in async context
- **Admin User Creation Greenlet Error**: Eagerly loaded `roles` relationship before appending to avoid lazy loading in async context
- **Migration Dependency Chain**: Fixed `down_revision` pointer in vote constraints migration from non-existent ID to correct parent
- **Tax ID Field**: Added `tax_id` to onboarding Pydantic schema, service method, and API endpoint — frontend was sending it but backend rejected it with 422

#### Test Infrastructure
- **MySQL Test Database**: Tests now use actual MySQL database instead of SQLite for realistic testing
- **Transaction Management**: Replaced `commit()` calls with `flush()` for test compatibility; fixed audit logger transaction management
- **Comprehensive Onboarding Test Suite**: Full integration test coverage for onboarding flow
- **Database Initialization Fixture**: Shared test fixture for consistent database state
- **Async SQLAlchemy Review**: Full codebase audit of 32 `flush()` calls documented in `ASYNC_SQLALCHEMY_REVIEW.md` — 87.5% safe, 0 critical issues

### Added - Frontend (2026-02-08)

#### Onboarding UX Improvements
- **Unsaved Changes Warning**: Added `useUnsavedChanges` and `useFormChanged` hooks to prevent accidental data loss during navigation
  - Warns before browser refresh/close with unsaved changes
  - Blocks in-app navigation with confirmation dialog
  - Location: `frontend/src/modules/onboarding/hooks/useUnsavedChanges.ts`

- **Password Requirements Always Visible**: Password requirements now display before user starts typing
  - Shows all requirements (length, uppercase, lowercase, numbers, special characters)
  - Initially displays with unchecked indicators
  - Updates in real-time as user types
  - Location: `frontend/src/modules/onboarding/pages/AdminUserCreation.tsx`

- **Section Completion Checkmarks**: Organization setup form now shows visual completion status
  - Green checkmarks appear when required fields are filled
  - Red asterisks removed when section is complete
  - Provides instant feedback on form progress
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **Sticky Continue Button (Mobile)**: Continue button stays visible at bottom on mobile devices
  - Uses responsive Tailwind classes (`sticky bottom-0 md:relative`)
  - Improves UX on long forms by keeping primary action visible
  - Applied to NavigationChoice and OrganizationSetup pages

#### Onboarding Validation Enhancements
- **Inline Address Validation**: Error messages now appear directly under address form fields
  - Previously only showed summary errors at bottom
  - Improves user experience by showing exactly which field has an issue
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **URL Auto-HTTPS**: Website URLs automatically prepend `https://` if no protocol specified
  - Triggers on blur event
  - Prevents common user error of omitting protocol
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **Improved ZIP Code Error Message**: Now shows expected format
  - Old: "Invalid ZIP code"
  - New: "Invalid ZIP code format. Expected: 12345 or 12345-6789"

#### Onboarding Progress & Consistency
- **Standardized Progress Indicators**: All onboarding pages now show consistent "Step X of 10"
  - Updated DepartmentInfo, ModuleSelection, NavigationChoice pages
  - Provides clear expectation of onboarding length

- **Enhanced Database Initialization Messaging**: Onboarding check page now explains 1-3 minute startup delay
  - Shows database connection retry attempts during MySQL initialization
  - Displays migration count and progress
  - Explains which tables are being created (users, training, events, elections, inventory, etc.)
  - Provides context for first-time startup delays
  - Location: `frontend/src/modules/onboarding/pages/OnboardingCheck.tsx`

### Removed - Frontend (2026-02-08)

- **Auto-save Notification**: Removed misleading auto-save indicators from OrganizationSetup page
  - Zustand state changes are not true "auto-saves" to backend
  - Prevents user confusion about when data is actually persisted

- **Redundant Session Storage Calls**: Removed unnecessary `sessionStorage` writes in DepartmentInfo
  - Data already persisted via Zustand store with localStorage
  - Simplified state management approach

### Fixed - Backend (2026-02-08)

#### Configuration Errors
- **Fixed Settings Configuration Reference** (`backend/app/utils/startup_validators.py`)
  - Changed `settings.MYSQL_DATABASE` → `settings.DB_NAME` (lines 64, 199)
  - Resolves error: `'Settings' object has no attribute 'MYSQL_DATABASE'`
  - Enum validation now works correctly on startup

#### Migration Errors
- **Fixed Duplicate Migration** (`backend/alembic/versions/20260206_0301_add_missing_training_tables.py`)
  - Migration was creating tables (`skill_evaluations`, `skill_checkoffs`, `shifts`, etc.) already created in migration `20260122_0015`
  - Converted to conditional migration that checks if tables exist before creating
  - Prevents error: `(1050, "Table 'skill_evaluations' already exists")`
  - Maintains backwards compatibility with existing deployments

#### API Errors
- **Fixed Organization Creation Error** (`backend/app/api/v1/onboarding.py`)
  - Endpoint was accessing `data.description` but `OrganizationSetupCreate` schema doesn't have that field
  - Changed `description=data.description` → `description=None` (line 1322)
  - Resolves error: `'OrganizationSetupCreate' object has no attribute 'description'`

### Technical Improvements

#### New Hooks & Utilities
- `useUnsavedChanges(options)`: Warns before leaving page with unsaved changes
- `useFormChanged(currentData, initialData)`: Detects if form data has changed from initial values

#### Migration System
- Improved migration error handling with conditional table creation
- Better backwards compatibility for existing installations

#### State Management
- Cleaned up redundant storage operations
- Improved consistency between Zustand store and backend persistence

## [1.0.0] - 2026-02-06

### Initial Release
- Full onboarding flow (10 steps)
- Organization setup with comprehensive fields
- Admin user creation
- Module selection system
- Role-based permission system
- Training module
- Events & RSVP module
- Elections & voting module
- Inventory management
- And more...

---

## Release Notes Format

Each release includes:
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Vulnerability patches

For full details on any release, see the commit history in the Git repository.
