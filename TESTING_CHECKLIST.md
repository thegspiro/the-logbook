# The Logbook — Production Readiness Testing Checklist

## 1. Authentication & Session Management

| ID | Test | Expected Outcome |
|---|---|---|
| AUTH-01 | Log in with valid username + password | Redirected to dashboard, access + refresh tokens stored |
| AUTH-02 | Log in with valid email + password | Same as AUTH-01 (email accepted as username) |
| AUTH-03 | Log in with incorrect password | Error message "Invalid credentials", no token issued |
| AUTH-04 | Log in with non-existent username | Same generic error as AUTH-03 (no user enumeration) |
| AUTH-05 | Submit 6 rapid login attempts with wrong password | Account locked for 30 minutes, lockout message shown |
| AUTH-06 | Attempt login during lockout period | Clear message that account is temporarily locked |
| AUTH-07 | Log in after lockout period expires | Login succeeds normally |
| AUTH-08 | Log in with account status INACTIVE | Access denied with appropriate message |
| AUTH-09 | Log in with account status SUSPENDED | Access denied with appropriate message |
| AUTH-10 | Log in with account status ARCHIVED | Access denied with appropriate message |
| AUTH-11 | Session idle for 15+ minutes (HIPAA timeout) | Automatically logged out, redirected to login |
| AUTH-12 | Click "Forgot Password", submit valid email | Success message shown regardless of whether email exists (no enumeration) |
| AUTH-13 | Click "Forgot Password", submit non-existent email | Same success message as AUTH-12 |
| AUTH-14 | Use password reset link within expiry window | Able to set new password, redirected to login |
| AUTH-15 | Use password reset link after expiry | Clear error that link has expired |
| AUTH-16 | Reuse a password reset link after successful reset | Link is invalidated, shows expired message |
| AUTH-17 | Change password from User Settings | Requires current password, validates strength, succeeds |
| AUTH-18 | Change password to one of last 12 used passwords | Rejected with "password previously used" message |
| AUTH-19 | Set password shorter than 12 characters | Rejected with min-length message |
| AUTH-20 | Set password without uppercase/lowercase/number/special | Rejected with complexity message |
| AUTH-21 | Set password with sequential chars ("abc123") | Rejected with pattern warning |
| AUTH-22 | Set password with repeated chars ("aaabbb") | Rejected with repetition warning |
| AUTH-23 | Set password matching common password list ("Firefighter1!") | Rejected with common password warning |
| AUTH-24 | Log out | Tokens cleared, redirected to login, back button doesn't re-enter |
| AUTH-25 | Access any protected route without a token | Redirected to login page |
| AUTH-26 | Access protected route with expired access token | 401 returned, refresh attempted automatically |
| AUTH-27 | Refresh token rotation: use refresh token twice | Second use fails (token was rotated on first use) |
| AUTH-28 | Google OAuth login flow (if configured) | Redirected to Google, callback creates/links account |
| AUTH-29 | Microsoft OAuth login flow (if configured) | Redirected to Microsoft, callback creates/links account |
| AUTH-30 | Register new account (when REGISTRATION_ENABLED=true) | Account created in pending/approval state |
| AUTH-31 | Register when REGISTRATION_ENABLED=false | Registration form not shown or endpoint returns 403 |
| AUTH-32 | Verify password expiration enforcement after 90 days | User forced to change password on login |

## 2. Member Management

| ID | Test | Expected Outcome |
|---|---|---|
| MEM-01 | View member list as regular member | Members visible, contact info hidden if org setting disabled |
| MEM-02 | View member list as admin (members.manage) | Full member list with all details |
| MEM-03 | Create new member with all required fields | Member created, welcome email sent with temp password |
| MEM-04 | Create new member with duplicate email | Error message about duplicate email |
| MEM-05 | Create new member with duplicate username | Error message about duplicate username |
| MEM-06 | Create member with auto-generated membership ID | ID follows configured format (prefix + sequence) |
| MEM-07 | Edit member profile (name, rank, station) | Changes saved and reflected on profile |
| MEM-08 | Edit own profile as regular member | Can update own contact info and preferences |
| MEM-09 | Edit another member's profile without permission | 403 Forbidden |
| MEM-10 | Update member contact info (phone, email, address) | Saved; emergency contacts updated |
| MEM-11 | View member profile page with all sections | Profile, assignments, training history, inventory visible |
| MEM-12 | Change member status: Active → Inactive | Status change logged in audit, member can't log in |
| MEM-13 | Change member status: Active → Dropped (Voluntary) | Drop notification email sent, property return notice generated |
| MEM-14 | Change member status: Active → Dropped (Involuntary) | Drop email sent with CC to configured leadership roles |
| MEM-15 | Auto-archive: dropped member returns all items + clearance complete | Member auto-transitions to ARCHIVED |
| MEM-16 | Reactivate archived member | Status restored to ACTIVE, can log in again |
| MEM-17 | Bulk import members via CSV | Members created, temp passwords generated, summary shown |
| MEM-18 | Bulk import with invalid CSV data (missing required fields) | Errors listed per row, valid rows still importable |
| MEM-19 | View member list with search filter | Results filter by name, rank, station |
| MEM-20 | View member list filtered by status | Only members of selected status shown |
| MEM-21 | Contact info visibility when org disables it | Phone/email/address hidden from non-admin members |

## 3. Role & Permission Management

| ID | Test | Expected Outcome |
|---|---|---|
| ROLE-01 | View all roles (roles.view permission) | Role list with user counts displayed |
| ROLE-02 | Create custom role with specific permissions | Role created, permissions saved |
| ROLE-03 | Edit custom role permissions | Permissions updated for all users with that role |
| ROLE-04 | Delete custom role | Role removed, users lose those permissions |
| ROLE-05 | Attempt to delete system role | Rejected with "system role cannot be deleted" |
| ROLE-06 | Clone an existing role | New role created with same permissions, different name |
| ROLE-07 | Assign role to user | User gains all permissions of that role |
| ROLE-08 | Remove role from user | User loses permissions of that role |
| ROLE-09 | User with multiple roles | Permissions aggregated (union of all role permissions) |
| ROLE-10 | Wildcard permission (`*`) grants all access | User with `*` can access every endpoint |
| ROLE-11 | Module wildcard (`training.*`) | User can do all training actions but not other modules |
| ROLE-12 | Access endpoint without required permission | 403 Forbidden with clear message |
| ROLE-13 | View permissions organized by category | Grouped list (admin, users, training, etc.) |

## 4. Events Module

| ID | Test | Expected Outcome |
|---|---|---|
| EVT-01 | Create event with all fields (title, type, location, dates, RSVP settings) | Event created, appears in list |
| EVT-02 | Create recurring event (weekly, monthly) | Multiple event instances generated |
| EVT-03 | Edit event details after creation | Changes saved, attendees notified if configured |
| EVT-04 | Cancel event with reason | Event marked cancelled, cancellation email sent |
| EVT-05 | Delete event | Event removed (or soft-deleted) |
| EVT-06 | RSVP "Going" to event | RSVP recorded, count updated |
| EVT-07 | RSVP "Not Going" to event | RSVP recorded with appropriate status |
| EVT-08 | RSVP "Maybe" to event | RSVP recorded |
| EVT-09 | Change RSVP response | Updated response replaces previous |
| EVT-10 | RSVP to event at max capacity | Wait-listed or rejected with capacity message |
| EVT-11 | RSVP with guest(s) when guests allowed | Guest count recorded |
| EVT-12 | RSVP past deadline | Rejected with "RSVP deadline passed" |
| EVT-13 | QR code check-in within time window | Check-in recorded, timestamp logged |
| EVT-14 | QR code check-in outside time window (strict mode) | Check-in rejected |
| EVT-15 | Self check-in from member's device | Check-in recorded via self-service page |
| EVT-16 | Admin override: add attendee manually | Attendee added with admin attribution |
| EVT-17 | View event attendance report | List of attendees with check-in times |
| EVT-18 | View event as regular member (no manage permission) | Can see event details, RSVP, but not edit |
| EVT-19 | Event check-in monitoring page (admin) | Live view of check-ins updating |
| EVT-20 | Event with role-based eligibility | Only members with matching roles see/can RSVP |
| EVT-21 | Record actual start/end times for event | Actual times saved alongside scheduled times |

## 5. Training Module

| ID | Test | Expected Outcome |
|---|---|---|
| TRN-01 | View personal training dashboard (My Training) | Shows progress, upcoming requirements, completed courses |
| TRN-02 | Browse course library | All courses listed with search/filter |
| TRN-03 | Create training course (training.manage) | Course created with hours, category, description |
| TRN-04 | Edit training course | Changes saved |
| TRN-05 | Delete training course | Course removed (or soft-deleted) |
| TRN-06 | Submit training record for self | Record created in pending state |
| TRN-07 | Submit training record with file attachment | File uploaded and linked to record |
| TRN-08 | Approve training submission (training officer) | Status → Completed, hours credited |
| TRN-09 | Reject training submission with reason | Status → Rejected, member notified |
| TRN-10 | Create training requirement (annual, state, hours-based) | Requirement created, assigned to applicable members |
| TRN-11 | View requirement progress across department | Dashboard shows compliance % per requirement |
| TRN-12 | Create training program with sequential phases | Program created with phases, milestones |
| TRN-13 | Enroll member in training program | Enrollment created, progress tracking begins |
| TRN-14 | Complete all program requirements | Member marked as program-completed |
| TRN-15 | Withdraw member from program | Enrollment status → Withdrawn |
| TRN-16 | Create training session with date/time/instructor | Session appears on calendar |
| TRN-17 | Record session attendance | Attendees logged with hours |
| TRN-18 | Training waiver request and approval | Waiver granted, requirement marked exempt |
| TRN-19 | External training import and mapping | External records mapped to internal courses |
| TRN-20 | Certification expiration alert (90/60/30/7 day) | Tiered alerts sent to members and training officers |
| TRN-21 | Struggling member detection | Members falling behind flagged, notifications sent |
| TRN-22 | View member training history page | Chronological list of all training with details |

## 6. Inventory Module

| ID | Test | Expected Outcome |
|---|---|---|
| INV-01 | Create inventory category | Category created with name, type, thresholds |
| INV-02 | Create individual-tracked item (with serial number) | Item created, status AVAILABLE |
| INV-03 | Create pool-tracked item (quantity-based, e.g. T-shirts) | Item created with quantity, unit of measure |
| INV-04 | Assign individual item to member | Item status → ASSIGNED, appears on member dashboard |
| INV-05 | Unassign (return) individual item | Item status → AVAILABLE, removed from member |
| INV-06 | Issue pool item to member (e.g. 1 Medium T-shirt) | Pool quantity decremented, issuance record created |
| INV-07 | Return pool item from member | Pool quantity restored, issuance marked returned |
| INV-08 | Partial pool item return | Issuance quantity reduced, remaining stays open |
| INV-09 | Issue pool item when insufficient stock | Error: "Insufficient stock" with available count |
| INV-10 | Check out individual item (temporary) | Item status → CHECKED_OUT |
| INV-11 | Check in individual item | Item status → AVAILABLE, condition recorded |
| INV-12 | Batch checkout via barcode scan (camera) | Camera activates, barcodes scan to list, confirm assigns all |
| INV-13 | Batch checkout via manual code entry | Type code manually, item added to list |
| INV-14 | Batch return via barcode scan | Items scanned, confirm returns all |
| INV-15 | Batch operation with mix of pool + individual items | Each handled correctly (issue vs assign) |
| INV-16 | Batch scan — unknown barcode | Error shown for that item, others still processable |
| INV-17 | View member's inventory (dashboard) | All assigned items, issued items, checkouts visible |
| INV-18 | Create maintenance record for item | Record created with type, date, cost, notes |
| INV-19 | View maintenance history for item | Chronological list of all maintenance |
| INV-20 | Retire an item | Item status → RETIRED, no longer assignable |
| INV-21 | Low stock alert threshold | Items below threshold appear in alert list |
| INV-22 | Inventory summary report | Stats: total items, by status, by condition, value |
| INV-23 | Delayed notification: issue item, wait 1+ hour | Consolidated email sent to member with item list |
| INV-24 | Delayed notification: issue + return same item within 1 hour | Actions net out, no email sent (or empty sections omitted) |
| INV-25 | Delayed notification: issue 3 items, return 1 within hour | Email shows net 2 issued items only |
| INV-26 | Delayed notification: email contains department property language | Email includes reminder that items are department property |
| INV-27 | Lookup item by barcode | Returns correct item with details |
| INV-28 | Lookup item by serial number | Returns correct item |
| INV-29 | Lookup item by asset tag | Returns correct item |
| INV-30 | Departure clearance: initiate for dropped member | Clearance created with snapshot of all outstanding items |
| INV-31 | Departure clearance: resolve line items (returned, damaged, waived) | Each line disposition updated, counts recalculated |
| INV-32 | Departure clearance: complete with all items resolved | Status → COMPLETED, triggers auto-archive check |
| INV-33 | Departure clearance: force-close with outstanding items | Status → CLOSED_INCOMPLETE with notes |

## 7. Scheduling Module

| ID | Test | Expected Outcome |
|---|---|---|
| SCH-01 | Create shift template (name, time, positions) | Template saved for reuse |
| SCH-02 | Create shift instance from template | Shift created with date, positions to fill |
| SCH-03 | Assign member to shift position | Member appears on shift, notified |
| SCH-04 | Remove member from shift | Position opened back up |
| SCH-05 | Submit swap request | Request created in pending state |
| SCH-06 | Approve swap request | Members swapped, both notified |
| SCH-07 | Deny swap request | Request rejected, requester notified |
| SCH-08 | Record shift attendance | Attendance logged with actual times |
| SCH-09 | Submit shift completion report | Report saved with call details |
| SCH-10 | View weekly/monthly schedule | Calendar view with all shifts |
| SCH-11 | Publish schedule to members | Members notified of published schedule |
| SCH-12 | Coverage validation | Warning if minimum staffing not met |

## 8. Elections Module

| ID | Test | Expected Outcome |
|---|---|---|
| ELC-01 | Create election with positions and dates | Election in DRAFT status |
| ELC-02 | Add candidates to positions | Candidates listed on ballot |
| ELC-03 | Open election for voting | Status → OPEN, eligible members notified |
| ELC-04 | Cast vote (simple majority) | Vote recorded, anonymous |
| ELC-05 | Cast vote (ranked choice) | Rankings recorded |
| ELC-06 | Attempt to vote twice | Rejected: "Already voted" |
| ELC-07 | Vote via email ballot link (token-based) | Ballot page loads without authentication, vote recorded |
| ELC-08 | Vote with expired/invalid ballot token | Access denied |
| ELC-09 | Close election and calculate results | Results computed, displayed (respecting voting method) |
| ELC-10 | View election results (public after close) | Results visible to eligible members |
| ELC-11 | Rollback election (admin) | Election reopened, results cleared |
| ELC-12 | Delete draft election | Election removed |
| ELC-13 | Voter eligibility: only members with matching roles can vote | Non-eligible members can't access ballot |

## 9. Meetings & Minutes

| ID | Test | Expected Outcome |
|---|---|---|
| MTG-01 | Create meeting with date, time, location | Meeting appears in list |
| MTG-02 | Record meeting attendance | Attendees logged |
| MTG-03 | Quorum calculation | Quorum status shown based on attendance |
| MTG-04 | Create meeting minutes with agenda items | Minutes saved in draft state |
| MTG-05 | Add action items to minutes (assignee, due date) | Action items created and tracked |
| MTG-06 | Approve/publish minutes | Minutes status → Approved, visible to members |
| MTG-07 | Track action item completion | Items marked complete/overdue |
| MTG-08 | Action item reminders (3 day, 1 day, overdue) | Notifications sent to assignees |
| MTG-09 | View unified action items page | All action items across meetings in one view |
| MTG-10 | Archive old minutes | Minutes moved to archive, still searchable |

## 10. Documents Module

| ID | Test | Expected Outcome |
|---|---|---|
| DOC-01 | Create folder structure | Folders created with hierarchy |
| DOC-02 | Upload document to folder | File stored, metadata saved |
| DOC-03 | Download document | File downloaded correctly |
| DOC-04 | Upload document with restricted access (leadership only) | Only users with leadership roles can view |
| DOC-05 | Search documents by name/content | Results returned with matches |
| DOC-06 | Delete document | Document removed (or soft-deleted) |
| DOC-07 | Upload very large file (> 50MB) | Rejected with size limit message |
| DOC-08 | Upload potentially dangerous file type (.exe, .bat) | Rejected or sanitized based on whitelist |
| DOC-09 | Role-based folder visibility | Folders respect allowed_roles setting |

## 11. Custom Forms Module

| ID | Test | Expected Outcome |
|---|---|---|
| FRM-01 | Create form with form builder (all 16 field types) | Form saved with all field configurations |
| FRM-02 | Reorder form fields | Field order persisted |
| FRM-03 | Add field validation rules (required, min/max, pattern) | Validation enforced on submission |
| FRM-04 | Submit form as authenticated member | Submission saved with user attribution |
| FRM-05 | Submit public form (no auth, via slug URL) | Submission saved with anonymous attribution |
| FRM-06 | File upload field in form (10MB limit) | File uploaded and attached to submission |
| FRM-07 | Signature pad field | Signature captured and saved as image |
| FRM-08 | Member lookup field (autocomplete) | Search returns matching members |
| FRM-09 | View form submissions (admin) | All submissions listed with data |
| FRM-10 | Submit form with conditional fields | Only visible fields based on conditions are validated |
| FRM-11 | Delete form | Form removed, submissions optionally retained |
| FRM-12 | Public form with invalid/expired slug | 404 page shown |

## 12. Facilities Module

| ID | Test | Expected Outcome |
|---|---|---|
| FAC-01 | Create facility with address, type, status | Facility record created |
| FAC-02 | Add building systems (HVAC, electrical, plumbing) | Systems listed under facility |
| FAC-03 | Create maintenance record for facility | Record logged with type, date, cost |
| FAC-04 | Record inspection with pass/fail | Inspection saved, compliance updated |
| FAC-05 | Track utility accounts and readings | Readings stored chronologically |
| FAC-06 | Manage access keys (issue, return, track) | Key inventory maintained per facility |
| FAC-07 | Add rooms to facility | Room catalog maintained |
| FAC-08 | Capital project tracking | Projects with budget, status, timeline |
| FAC-09 | Insurance policy management | Policies tracked with expiration dates |
| FAC-10 | Compliance checklist completion | Checklist items marked complete/incomplete |
| FAC-11 | Upload facility photos and documents | Files stored and viewable |
| FAC-12 | Emergency contacts per facility | Contacts listed and accessible |
| FAC-13 | Shutoff location documentation | Utility shutoffs mapped for emergency reference |

## 13. Apparatus / Fleet Module

| ID | Test | Expected Outcome |
|---|---|---|
| APP-01 | Create apparatus record (type, unit number, VIN) | Record created |
| APP-02 | Assign crew positions (captain, driver, firefighter) | Positions filled, visible on apparatus |
| APP-03 | Create maintenance record | Maintenance logged with type, cost |
| APP-04 | Record apparatus inspection | Inspection pass/fail with notes |
| APP-05 | Track equipment per apparatus | Equipment inventory per vehicle |
| APP-06 | Change apparatus status (in service, out of service) | Status updated across system |

## 14. Notifications, Messages & Email

| ID | Test | Expected Outcome |
|---|---|---|
| NOT-01 | View in-app notifications list | Notifications displayed chronologically |
| NOT-02 | Mark notification as read | Read status updated |
| NOT-03 | Delete notification | Notification removed from list |
| NOT-04 | Department message: send to all members | Message appears on every member's dashboard |
| NOT-05 | Department message: target specific roles | Only targeted role members see message |
| NOT-06 | Department message: target specific statuses | Only targeted status members see message |
| NOT-07 | Department message: require acknowledgment | Members must click "Acknowledge" |
| NOT-08 | Pin/unpin department message | Pinned messages stay at top |
| NOT-09 | Set message expiration | Message auto-hides after expiry |
| NOT-10 | Update notification preferences (user settings) | Email/in-app preferences saved |
| NOT-11 | Email template: view and edit (admin) | Template loaded with variables, editable |
| NOT-12 | Email template: preview with sample data | Preview rendered with replaced variables |
| NOT-13 | Email template: ensure default templates created for new org | Welcome, password reset, member dropped, inventory change templates exist |
| NOT-14 | Welcome email sent on new member creation | Email with temp password delivered |
| NOT-15 | Property return email on member drop | Email with outstanding items list sent |
| NOT-16 | Inventory change email (consolidated, 1-hour delay) | Single email per member with net changes |

## 15. Dashboard & Reports

| ID | Test | Expected Outcome |
|---|---|---|
| DSH-01 | Member dashboard shows upcoming events | Next events listed with RSVP status |
| DSH-02 | Member dashboard shows training progress | Requirement completion visible |
| DSH-03 | Member dashboard shows upcoming shifts | Next scheduled shifts displayed |
| DSH-04 | Member dashboard shows department messages | Active messages visible, pinned first |
| DSH-05 | Member dashboard shows assigned inventory | Items assigned/issued to member listed |
| DSH-06 | Admin dashboard shows summary stats | Member count, event count, training compliance |
| DSH-07 | Analytics dashboard (analytics.view permission) | Charts and metrics across modules |
| DSH-08 | Generate reports (reports.view permission) | Report data exported correctly |
| DSH-09 | Error monitoring page (admin) | Error logs listed with details |
| DSH-10 | Scheduled tasks page: list all tasks | All tasks shown with schedule info |
| DSH-11 | Scheduled tasks page: manually trigger task | Task runs, result returned |

## 16. Organization & Settings

| ID | Test | Expected Outcome |
|---|---|---|
| SET-01 | View organization settings (settings.view) | All settings displayed |
| SET-02 | Update organization name, contact info | Settings saved |
| SET-03 | Enable/disable modules (training, inventory, etc.) | Module routes and nav items appear/disappear |
| SET-04 | Configure contact info visibility | Members see/don't see each other's contact info |
| SET-05 | Configure membership ID format (prefix, auto-generate) | Next member gets formatted ID |
| SET-06 | Preview next membership ID | Preview matches expected format |
| SET-07 | Department setup checklist | Shows completion status of setup steps |
| SET-08 | Theme switching (light / dark / system) | UI theme changes appropriately |
| SET-09 | Navigation layout preference (top / side) | Layout switches correctly |

## 17. Membership Pipeline (Prospective Members)

| ID | Test | Expected Outcome |
|---|---|---|
| PIP-01 | Configure pipeline stages | Stages saved in order |
| PIP-02 | Add prospective member/applicant | Applicant enters first stage |
| PIP-03 | Move applicant through stages | Progress tracked, dates recorded |
| PIP-04 | Approve applicant → becomes full member | Account created, welcome email sent |
| PIP-05 | Reject applicant | Status updated, reason recorded |
| PIP-06 | Upload application documents | Files attached to applicant record |
| PIP-07 | View pipeline overview | Visual pipeline with applicants per stage |

## 18. Public/Unauthenticated Routes

| ID | Test | Expected Outcome |
|---|---|---|
| PUB-01 | Access `/f/:slug` (public form) | Form renders without login |
| PUB-02 | Submit public form | Submission saved |
| PUB-03 | Access `/ballot` with valid token | Ballot renders, voting works |
| PUB-04 | Access `/ballot` without token | Access denied |
| PUB-05 | Access `/display/:code` (location kiosk) | Kiosk display renders without login |
| PUB-06 | Access any protected route without auth | Redirected to login |

## 19. Security Testing

| ID | Test | Expected Outcome |
|---|---|---|
| SEC-01 | SQL injection in login fields (`' OR 1=1 --`) | Rejected; SQLAlchemy ORM prevents injection |
| SEC-02 | SQL injection in search/filter parameters | Parameterized queries prevent injection |
| SEC-03 | XSS in text input fields (`<script>alert('xss')</script>`) | Script tags escaped, not executed |
| SEC-04 | XSS in form builder field labels | HTML escaped on render |
| SEC-05 | XSS in department message body | Content sanitized before display |
| SEC-06 | XSS in meeting minutes rich text | Sanitized on save and render |
| SEC-07 | CSRF: POST request from external origin without valid token | Rejected (CORS blocks cross-origin) |
| SEC-08 | CORS: request from unauthorized origin | Blocked by CORS policy |
| SEC-09 | Path traversal in file upload filenames (`../../etc/passwd`) | Filename sanitized, path confined to upload dir |
| SEC-10 | Path traversal in document download endpoint | Rejected, serves only from approved paths |
| SEC-11 | Access another user's profile data via API (IDOR) | Org-scoped queries prevent cross-tenant access |
| SEC-12 | Access another org's data by manipulating org_id | All queries filter by authenticated user's org_id |
| SEC-13 | JWT token manipulation (change user_id in payload) | Signature verification fails, request rejected |
| SEC-14 | Use access token as refresh token (and vice versa) | Token type checked, request rejected |
| SEC-15 | Rate limiting on login endpoint | After 5 attempts per minute, requests blocked |
| SEC-16 | Rate limiting on forgot-password endpoint | After 5 attempts per minute, requests blocked |
| SEC-17 | Rate limiting on registration endpoint | After 5 attempts per minute, requests blocked |
| SEC-18 | Geo-blocked country IP access | Request blocked with appropriate message |
| SEC-19 | Security headers present on all responses | HSTS, X-Content-Type-Options, X-Frame-Options, CSP all present |
| SEC-20 | Content-Security-Policy prevents inline scripts | Inline `<script>` tags blocked by CSP |
| SEC-21 | X-Frame-Options: DENY prevents iframe embedding | Page cannot be loaded in iframe |
| SEC-22 | Audit log captures all security-sensitive actions | Login, logout, password change, role change, permission change all logged |
| SEC-23 | Audit log hash chain integrity | Verify chain: each entry's hash matches recalculated hash |
| SEC-24 | Audit log tamper detection | Modify a log entry → integrity check fails |
| SEC-25 | File upload: executable file disguised as image | MIME type validation rejects mismatched content |
| SEC-26 | API docs disabled in production (`ENABLE_DOCS=false`) | /docs and /redoc return 404 |
| SEC-27 | Password not logged in audit trail | Plaintext passwords never appear in any log |
| SEC-28 | Sensitive data encrypted at rest (AES-256) | PHI/PII fields encrypted in database |
| SEC-29 | Error responses don't leak stack traces in production | Generic error message returned, details logged server-side |
| SEC-30 | Session hijack detection (IP/UA change) | Warning logged, optionally session invalidated |
| SEC-31 | Concurrent session management | Verify behavior when same user logs in from two devices |
| SEC-32 | Brute force detection on API keys (public portal) | Rate limiting per API key enforced |
| SEC-33 | Verify HTTPS enforcement in production config | HTTP requests redirected to HTTPS |
| SEC-34 | Verify Redis password is set in production | Connection requires authentication |
| SEC-35 | Verify database SSL is enabled in production | Connection encrypted |

## 20. Accessibility Testing

| ID | Test | Expected Outcome |
|---|---|---|
| A11Y-01 | Keyboard-only navigation: login page | All fields, buttons reachable via Tab; Enter submits |
| A11Y-02 | Keyboard-only navigation: main dashboard | All interactive elements reachable |
| A11Y-03 | Keyboard-only navigation: modal open/close | Modal traps focus, Escape closes, focus returns to trigger |
| A11Y-04 | Keyboard-only navigation: dropdown menus | Arrow keys navigate options, Enter selects |
| A11Y-05 | Keyboard-only navigation: form builder (reorder fields) | Fields reorderable via keyboard |
| A11Y-06 | Screen reader: login page | Labels read correctly for username/password fields |
| A11Y-07 | Screen reader: navigation menu | All nav items announced with proper labels |
| A11Y-08 | Screen reader: modal dialogs | `role="dialog"`, `aria-modal="true"`, title announced |
| A11Y-09 | Screen reader: form validation errors | Errors announced via `aria-describedby` association |
| A11Y-10 | Screen reader: loading states | `aria-live="polite"` regions announce loading/loaded |
| A11Y-11 | Screen reader: data tables | Tables use proper `<th>` headers, scope attributes |
| A11Y-12 | Screen reader: icon-only buttons | All icon buttons have `aria-label` |
| A11Y-13 | Screen reader: skip to main content link | "Skip to main content" link present and functional |
| A11Y-14 | Color contrast: light theme | All text meets WCAG AA contrast ratio (4.5:1 normal, 3:1 large) |
| A11Y-15 | Color contrast: dark theme | Same contrast requirements met in dark mode |
| A11Y-16 | Color contrast: error states | Red error text/borders meet contrast on background |
| A11Y-17 | Color-only information | No info conveyed by color alone (icons/text accompany) |
| A11Y-18 | Focus indicators visible | Blue ring visible on all focused elements |
| A11Y-19 | Focus indicators in dark mode | Focus ring visible against dark backgrounds |
| A11Y-20 | Zoom to 200% | Page remains usable, no content cut off, no horizontal scroll |
| A11Y-21 | Zoom to 400% | Critical content still accessible |
| A11Y-22 | Reduced motion preference respected | Animations disabled when `prefers-reduced-motion: reduce` |
| A11Y-23 | Form labels associated with inputs | Every `<input>` has a `<label>` with matching `for`/`id` |
| A11Y-24 | Required fields indicated | Required fields have visual indicator AND `aria-required="true"` |
| A11Y-25 | Error summary on form submission | After failed submit, errors summarized and focus moved to first error |
| A11Y-26 | Landmark regions present | `<main>`, `<nav>`, `<header>`, `<footer>` used correctly |
| A11Y-27 | Page titles unique per route | Each page has a distinct `<title>` |
| A11Y-28 | Heading hierarchy correct (h1 → h2 → h3) | No skipped heading levels |
| A11Y-29 | Image alt text | All meaningful images have alt text; decorative ones have `alt=""` |
| A11Y-30 | Touch targets (mobile) | All interactive elements at least 44x44px |
| A11Y-31 | Autocomplete attributes on form fields | Login fields have `autocomplete="username"` / `autocomplete="current-password"` |
| A11Y-32 | ARIA live regions for dynamic content | Toast notifications, search results use `aria-live` |

## 21. Edge Cases & Stress Testing

| ID | Test | Expected Outcome |
|---|---|---|
| EDGE-01 | Create member with Unicode characters in name (accents, CJK) | Saved and displayed correctly (utf8mb4) |
| EDGE-02 | Very long text in description fields (10,000+ chars) | Saved without truncation (TEXT column) |
| EDGE-03 | Empty string vs null in optional fields | Handled consistently, no crashes |
| EDGE-04 | Concurrent edits to same record (two admins) | Last write wins or conflict detection |
| EDGE-05 | Delete category with existing items | Prevented or items reassigned |
| EDGE-06 | Delete user who is assigned inventory items | Items unassigned or transfer prompted |
| EDGE-07 | Delete user who has open action items | Action items orphaned gracefully |
| EDGE-08 | Network disconnect during form submission | Error shown, data not duplicated on retry |
| EDGE-09 | Browser back button after logout | Doesn't show authenticated content |
| EDGE-10 | Multiple browser tabs with same session | Actions in one tab reflected in others |
| EDGE-11 | PWA install and offline behavior | App installable, offline graceful degradation |
| EDGE-12 | Very large member list (1000+ members) | Pagination works, no timeout |
| EDGE-13 | Very large event attendance (500+ RSVPs) | List renders without performance issues |
| EDGE-14 | Timezone handling: org in different timezone | All dates display in org's timezone |
| EDGE-15 | Date boundary: event spanning midnight | Start/end dates handled correctly |
| EDGE-16 | Leap year date handling (Feb 29) | No errors on leap year dates |
| EDGE-17 | Special characters in search queries | No SQL injection, search works correctly |
| EDGE-18 | API response for deleted/non-existent resource | Clean 404 with message, no stack trace |
| EDGE-19 | Session timeout during long form fill | Form data preserved or user warned before timeout |
| EDGE-20 | Rapid-fire button clicks (double submit) | Action only executes once |

## 22. Improvements & Future-Proofing Recommendations

| ID | Area | Recommendation | Priority | Status |
|---|---|---|---|---|
| IMP-01 | **Security** | Implement token blacklist/revocation on logout (Redis-backed) — currently tokens remain valid until expiry | High | **Implemented** |
| IMP-02 | **Security** | Move rate limiting from in-memory to Redis for multi-instance deployments | High | **Implemented** |
| IMP-03 | **Security** | Remove `'unsafe-inline'` from CSP; migrate to nonce-based inline styles | High | **Partially — `unsafe-inline` still in `style-src`** |
| IMP-04 | **Security** | Add antivirus/malware scanning on file uploads (ClamAV integration) | High | **Not Implemented** |
| IMP-05 | **Security** | Enforce TOTP 2FA for all admin-role accounts | High | **Partially — TOTP exists but not enforced for admins** |
| IMP-06 | **Security** | Implement automated audit log integrity verification as a scheduled task | Medium | **Implemented** |
| IMP-07 | **Security** | Add request size limiting middleware to prevent oversized payloads | Medium | **Implemented** |
| IMP-08 | **Security** | Add request ID headers (`X-Request-ID`) for distributed tracing | Medium | **Implemented** |
| IMP-09 | **Accessibility** | Run automated axe-core or Lighthouse CI in CI/CD pipeline on every build | High | **Not Implemented** |
| IMP-10 | **Accessibility** | Add `autocomplete` attributes to all form fields (login, profile, address) | High | **Partially — login and password fields done, address/profile fields missing** |
| IMP-11 | **Accessibility** | Ensure all data tables have proper `<caption>` and `scope` attributes | Medium | **Partially — `<th>` used in 30+ files but no `<caption>` elements** |
| IMP-12 | **Accessibility** | Add visible focus indicators to custom components (not just native elements) | High | **Implemented** |
| IMP-13 | **Accessibility** | Implement error summary component: on form error, focus moves to summary at top | Medium | **Not Implemented** |
| IMP-14 | **Accessibility** | Add `aria-current="page"` to active navigation item | Low | **Implemented** |
| IMP-15 | **Accessibility** | Ensure all dynamic content updates announce via `aria-live` regions | Medium | **Implemented** |
| IMP-16 | **Frontend** | Add client-side form state persistence (localStorage) to survive accidental refresh/timeout | Medium | **Not Implemented** |
| IMP-17 | **Frontend** | Implement optimistic UI updates for common actions (RSVP, check-in) | Low | **Implemented** |
| IMP-18 | **Frontend** | Add skeleton loading screens instead of spinners for better perceived performance | Low | **Partially — `Skeleton` components exist but limited adoption** |
| IMP-19 | **Frontend** | Implement service worker caching strategy for static assets (PWA offline) | Medium | **Implemented** |
| IMP-20 | **Backend** | Add database connection encryption (`DB_SSL=true`) as required in production config validation | High | **Partially — `DB_SSL` setting exists but defaults to `false` with no production enforcement** |
| IMP-21 | **Backend** | Add container memory/CPU limits in docker-compose production profile | Medium | **Implemented** |
| IMP-22 | **Backend** | Enable Elasticsearch security (`xpack.security.enabled=true`) in production | Medium | **Implemented** |
| IMP-23 | **Backend** | Add automated GeoIP database update mechanism | Low | **Not Implemented** |
| IMP-24 | **Backend** | Implement database-level row security or connection-per-tenant for stronger isolation | Low | **Not Implemented** |
| IMP-25 | **Backend** | Add request timeout middleware (e.g. 30s max per request) | Medium | **Not Implemented** |
| IMP-26 | **Email** | Add email bounce handling and delivery tracking | Medium | **Not Implemented** |
| IMP-27 | **Email** | Add unsubscribe mechanism for non-critical notifications (CAN-SPAM compliance) | Medium | **Not Implemented** |
| IMP-28 | **Testing** | Add end-to-end tests (Playwright/Cypress) covering critical flows: login, member create, event RSVP, training submit | High | **Partially — 3 E2E specs (auth, dashboard, navigation) but missing member create, event RSVP, training submit** |
| IMP-29 | **Testing** | Add load testing (k6/Locust) to verify performance under expected concurrent user count | Medium | **Not Implemented** |
| IMP-30 | **Monitoring** | Set up uptime monitoring and alerting (health endpoint checks) | High | **Partially — `/health` and `/health/detailed` endpoints exist; external monitoring/alerting not configured** |
| IMP-31 | **Monitoring** | Configure Sentry for frontend + backend error tracking | High | **Partially — Backend Sentry configured; frontend Sentry not integrated** |
| IMP-32 | **Infrastructure** | Document disaster recovery plan: database backup restoration, failover procedures | High | **Partially — deployment docs mention backups but no dedicated DR plan** |
| IMP-33 | **Infrastructure** | Set up automated database backups with off-site storage | High | **Partially — backup script with cloud support exists but automation/scheduling not configured** |
| IMP-34 | **Frontend** | Lazy-load heavy module pages (elections, facilities, apparatus) to reduce initial bundle size | Medium | **Implemented** |
| IMP-35 | **Frontend** | Add `rel="noopener noreferrer"` to all external links for security | Low | **Implemented** |

## 23. Implementation Status Review (2026-03-02)

### Summary

Of the 35 recommendations in Section 22:

- **Fully Implemented:** 14 (IMP-01, IMP-02, IMP-06, IMP-07, IMP-08, IMP-12, IMP-14, IMP-15, IMP-17, IMP-19, IMP-21, IMP-22, IMP-34, IMP-35)
- **Partially Implemented:** 11 (IMP-03, IMP-05, IMP-10, IMP-11, IMP-18, IMP-20, IMP-28, IMP-30, IMP-31, IMP-32, IMP-33)
- **Not Implemented:** 10 (IMP-04, IMP-09, IMP-13, IMP-16, IMP-23, IMP-24, IMP-25, IMP-26, IMP-27, IMP-29)

### Detailed Findings

#### Fully Implemented

| ID | Evidence |
|---|---|
| **IMP-01** | Token revocation on logout is implemented via session-based validation. `auth_service.py:554` checks for an active `UserSession` row on every request; logout deletes the session, immediately invalidating the token. Refresh token replay detection is also in place (`auth_service.py:236`). |
| **IMP-02** | Rate limiting uses Redis sliding-window when available (`security_middleware.py:386`, `security.py:656`). Falls back to in-memory only when Redis is unreachable. |
| **IMP-06** | Audit log integrity verification runs as a scheduled task (`scheduled_tasks.py:997`). Weekly archival includes chain verification, and a dedicated endpoint exists at `GET /security-monitoring/audit-log/integrity`. A startup integrity check also runs in `main.py:1184`. |
| **IMP-08** | `X-Request-ID` headers are generated/propagated in `IPLoggingMiddleware` (`security_middleware.py:840`), bound to Loguru context for correlation (`logging.py:23`), and attached to all responses (`security_middleware.py:872`). |
| **IMP-12** | Focus indicators are comprehensively implemented in `styles/index.css` with `focus-visible` rings on all interactive elements, high-contrast mode enhancements, and Tailwind `focus:ring-*` classes on buttons, inputs, selects, etc. |
| **IMP-14** | `aria-current="page"` is used in `TopNavigation.tsx`, `SideNavigation.tsx`, `Breadcrumbs.tsx`, `SettingsPage.tsx`, `Pagination.tsx`, `ProgressSteps.tsx`, and multiple tab-based pages. |
| **IMP-15** | `aria-live` regions are used extensively (~30+ locations) for loading states, error alerts, status messages, and toast notifications across pages and components. |
| **IMP-17** | An `useOptimisticUpdate` hook exists at `hooks/useOptimisticUpdate.ts` providing a generic optimistic update pattern with rollback on failure. |
| **IMP-19** | PWA service worker is configured in `vite.config.ts` with `workbox` settings. API routes use `NetworkOnly` strategy (HIPAA compliance), and static assets are precached. |
| **IMP-21** | Both `docker-compose.yml` and `docker-compose.minimal.yml` include `deploy.resources.limits` and `deploy.resources.reservations` for memory on all services (MySQL, Redis, backend, frontend). |
| **IMP-22** | `xpack.security.enabled=true` is set in `docker-compose.yml` for the Elasticsearch service. |
| **IMP-34** | All heavy module routes use `lazyWithRetry()` for code-splitting within their route files (e.g., `elections/routes.tsx`, `facilities/routes.tsx`, `apparatus/routes.tsx`). Wrapped in `<Suspense>` for async loading. |
| **IMP-35** | All external links (verified across 8 files including `HelpLink.tsx`, `FormsPage.tsx`, `TrainingProgramsPage.tsx`, onboarding pages) include `rel="noopener noreferrer"`. |
| **IMP-07** | Request body size is limited at the Nginx layer (`client_max_body_size 50M` in `infrastructure/nginx/nginx.conf:105`). Individual endpoints enforce stricter limits: documents at 50MB, email templates at 10MB, images per type. |

#### Partially Implemented

| ID | What's Done | What's Missing |
|---|---|---|
| **IMP-03** | CSP header is set in `security_middleware.py:338-358` with `script-src 'self'` (no inline scripts). Nginx configs also apply matching CSP. | `'unsafe-inline'` remains in `style-src`, `style-src-elem`, and `style-src-attr` due to Tailwind CSS runtime injection. Migration to nonce-based styles requires changes to how Tailwind generates styles. |
| **IMP-10** | Login form has `autoComplete="username"` and `autoComplete="current-password"`. Forgot password has `autoComplete="email"`. Reset password has `autoComplete="new-password"`. User settings password fields are also covered. | Address fields in member creation forms lack `autocomplete` attributes (e.g., `address-line1`, `address-level2`, `postal-code`). Profile edit forms should add `given-name`, `family-name`, `tel`, etc. |
| **IMP-05** | TOTP 2FA infrastructure exists — models (`user.py` has `totp_secret`, `totp_enabled`), schemas (`auth.py`), and endpoints (`auth.py`) support TOTP setup/verification. | 2FA is opt-in, not enforced for admin accounts. No middleware or login-flow gate requires admins to enable TOTP. |
| **IMP-11** | Tables across 30+ files use proper `<th>` elements for headers. | No `<caption>` elements found on any data table. No `scope` attributes on `<th>` elements. |
| **IMP-18** | `Skeleton`, `SkeletonCard`, and `SkeletonPage` components exist in `components/ux/Skeleton.tsx`. Used in a handful of pages (`EventsPage`, `Members`, `NotificationsPage`, `EmailTemplatesPage`). | Most pages still use spinner-based loading. Skeleton components should be adopted more widely. |
| **IMP-20** | `DB_SSL` config option exists in `config.py:43` (`DB_SSL: bool = False`). | Defaults to `false` and the database URL construction in `config.py:62` doesn't append SSL parameters when `DB_SSL=true`. No production startup validation warns if SSL is disabled. |
| **IMP-28** | Playwright is configured with 5 browser/device targets. 3 E2E specs exist: `auth.spec.ts` (login page), `dashboard.spec.ts`, `navigation.spec.ts`. | Missing critical-flow E2E tests: member creation, event RSVP, training submission, and inventory operations. |
| **IMP-30** | Comprehensive `/health` and `/health/detailed` endpoints exist in `main.py:1451` checking database, Redis, schema, security config, and startup status. Returns `503` on unhealthy. Docker healthcheck script exists at `database/healthcheck.sh`. | No external uptime monitoring or alerting service (PagerDuty, UptimeRobot, etc.) is configured to call these endpoints. |
| **IMP-31** | Backend Sentry is fully configured: `sentry-sdk` in `requirements.txt`, `setup_sentry()` in `logging.py` with FastAPI, Loguru, and SQLAlchemy integrations, enabled via `SENTRY_ENABLED` + `SENTRY_DSN` env vars. | Frontend has no Sentry integration. No `@sentry/react` in `package.json`, no `Sentry.init()` call, no `ErrorBoundary` integration with Sentry. |
| **IMP-32** | `scripts/backup.sh` includes restore functionality. Deployment docs (`docs/DEPLOYMENT.md`, wiki pages) mention backup procedures. | No dedicated disaster recovery plan document covering full failover procedures, RTO/RPO targets, or step-by-step recovery runbooks. |
| **IMP-33** | `scripts/backup.sh` (397 lines) supports MySQL dump, file backups, compression with SHA256 checksums, and cloud upload to S3/Azure/GCS. Includes restore and list commands. | No automated scheduling configured (crontab entry documented but not set up). Off-site cloud storage requires manual env var configuration. |

#### Not Implemented

| ID | Notes |
|---|---|
| **IMP-04** | No ClamAV or antivirus integration found. File uploads have MIME type validation and image content verification (`image_validator.py`) but no malware scanning. Security docs mention this as a recommended enhancement. |
| **IMP-09** | No axe-core, Lighthouse CI, or automated accessibility testing in the CI pipeline (`.github/workflows/ci.yml`). No `@axe-core/playwright` integration in E2E tests. |
| **IMP-13** | No error summary component that aggregates form errors and shifts focus to the top of the form on validation failure. Individual field errors are shown inline only. |
| **IMP-16** | No localStorage-based form draft persistence. Forms lose all data on page refresh or session timeout. |
| **IMP-23** | GeoIP service exists (`geoip.py`, `ip_security_service.py`) but there is no automated mechanism to download/update the MaxMind GeoIP database. |
| **IMP-24** | Multi-tenant isolation is handled at the application layer (queries filter by `organization_id`). No database-level row security policies or connection-per-tenant setup. |
| **IMP-25** | No request timeout middleware. Long-running requests are not capped. Individual HTTP client calls (e.g., `email_test_helper.py`) have timeouts, but there's no global per-request timeout. |
| **IMP-26** | No email bounce handling or delivery tracking. Email is sent via `fastapi-mail` with no webhook or feedback loop for bounces/complaints. |
| **IMP-27** | No unsubscribe headers (`List-Unsubscribe`) or unsubscribe mechanism for notification emails. |
| **IMP-29** | No load testing scripts (k6, Locust, or similar) found in the repository. |

### Additional Recommendations

Based on this review, here are newly identified areas for improvement beyond the original 35:

| ID | Area | Recommendation | Priority |
|---|---|---|---|
| IMP-36 | **Testing** | Add accessibility testing to E2E suite — integrate `@axe-core/playwright` to automatically check pages for WCAG violations during Playwright runs | High |
| IMP-37 | **Testing** | Expand E2E coverage to at least 5 more critical flows: member creation, event RSVP, training record submission, inventory assignment, and role management | High |
| IMP-38 | **Frontend** | Add `autocomplete` attributes to remaining profile/address forms (`given-name`, `family-name`, `tel`, `street-address`, `address-level2`, `postal-code`) per WCAG 1.3.5 — login and password forms already done | Medium |
| IMP-39 | **Frontend** | Add `<caption>` elements to all data tables (or `aria-label` / `aria-labelledby` alternatives) for screen reader context | Medium |
| IMP-40 | **Frontend** | Integrate `@sentry/react` for frontend error tracking with `Sentry.ErrorBoundary` wrapping the app root | High |
| IMP-41 | **Frontend** | Implement form draft auto-save (localStorage) for long forms: event creation, training records, meeting minutes, and form builder | Medium |
| IMP-42 | **Frontend** | Adopt `Skeleton` loading components in remaining high-traffic pages: Dashboard, MemberProfilePage, TrainingPages, InventoryPage | Low |
| IMP-43 | **Infrastructure** | Configure automated backup scheduling (cron or Kubernetes CronJob) and integrate with the existing `scripts/backup.sh` for off-site cloud storage | Medium |
| IMP-44 | **Backend** | Add `DB_SSL` enforcement in production — when `ENVIRONMENT=production`, validate that `DB_SSL=true` and append SSL parameters to the database URL | High |
| IMP-45 | **Backend** | Add a global request timeout middleware (e.g., 30s) to prevent long-running requests from consuming server resources | Medium |
| IMP-46 | **Monitoring** | Set up external uptime monitoring (e.g., UptimeRobot, Datadog) to poll `/health` endpoint with alerting on failures | Medium |
| IMP-47 | **Security** | Enforce TOTP 2FA at the login flow for users with admin roles — add a middleware or login-gate that redirects admins to 2FA setup if not configured | High |
| IMP-48 | **Security** | Plan CSP nonce migration — evaluate extracting Tailwind to build-time CSS to remove `'unsafe-inline'` from `style-src` | Medium |
| IMP-49 | **Infrastructure** | Create a dedicated `DISASTER_RECOVERY.md` with RTO/RPO targets, step-by-step database restore procedures, and failover runbook | High |
| IMP-50 | **Email** | Add `List-Unsubscribe` header to non-critical notification emails for CAN-SPAM compliance | Medium |
