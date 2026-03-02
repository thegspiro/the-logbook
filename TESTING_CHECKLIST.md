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
| AUTH-33 | LDAP login flow (if LDAP_ENABLED=true) | Credentials validated against LDAP directory, account linked |
| AUTH-34 | SAML SSO login flow (if configured) | Redirected to IdP, assertion validates, session created |
| AUTH-35 | MFA/TOTP setup from user settings | QR code displayed, TOTP secret stored, backup codes generated |
| AUTH-36 | Login with valid TOTP code after password | MFA challenge shown, correct code grants access |
| AUTH-37 | Login with invalid TOTP code | MFA rejected, access denied |
| AUTH-38 | Login with TOTP backup code | Access granted, backup code consumed (single-use) |
| AUTH-39 | CSRF token present on state-changing requests | X-CSRF-Token header sent on POST/PUT/PATCH/DELETE |
| AUTH-40 | CSRF token missing on state-changing request | Request rejected with 403 |
| AUTH-41 | Concurrent refresh token race condition | Shared refreshPromise prevents duplicate refresh calls |
| AUTH-42 | `has_session` flag cleared on logout | Page refresh after logout does not attempt loadUser API call |

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
| MEM-22 | View member digital ID card | Card displays photo, name, rank, station, QR code, barcode |
| MEM-23 | Print member ID card | Print-friendly layout renders correctly |
| MEM-24 | Scan member QR code from ID card (camera) | Camera activates, QR decoded, navigates to member profile |
| MEM-25 | Scan member barcode (Code128 membership number) | Barcode decoded, member looked up by membership number |
| MEM-26 | Scan invalid/unknown QR code | Error message shown, scanner remains active |
| MEM-27 | View member audit history timeline | Chronological log of all changes with event type filtering |
| MEM-28 | Filter member audit history by event type | Only selected event types shown (profile_update, status_change, role_change, etc.) |
| MEM-29 | Member audit history pagination (Load More) | Additional entries loaded without resetting scroll position |
| MEM-30 | View own ID card as regular member | Own card accessible without special permission |
| MEM-31 | View another member's ID card without permission | 403 Forbidden (requires members.view or members.manage) |

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
| EVT-22 | Event reminder emails sent at configured intervals | Reminders sent per event's reminder_schedule (scheduled task) |
| EVT-23 | Post-event validation notification | Organizer prompted to validate attendance after event ends |
| EVT-24 | View past events tab | Historical events listed with attendance data |
| EVT-25 | Event settings tab (admin) | Event module settings configurable (types, outreach settings, etc.) |

## 4a. Event Requests / Public Outreach Pipeline

| ID | Test | Expected Outcome |
|---|---|---|
| EREQ-01 | Submit public outreach event request | Request created in pipeline, assigned default status |
| EREQ-02 | View event request pipeline (admin) | All requests listed with status, assignee, dates |
| EREQ-03 | Advance request through pipeline stages | Status transitions recorded with timestamps |
| EREQ-04 | Assign request to a coordinator | Assignee updated, coordinator notified |
| EREQ-05 | Complete pipeline checklist tasks | Task completion recorded, progress tracked |
| EREQ-06 | Add comment to event request | Comment saved with author attribution |
| EREQ-07 | Schedule event request with room booking | Event scheduled, room reserved if available |
| EREQ-08 | Postpone event request with new date | Postponement recorded, requestor notified |
| EREQ-09 | Cancel event request (public-facing) | Request cancelled, cancellation communicated to requestor |
| EREQ-10 | Send template email to requestor | Email sent using configured template with variables replaced |
| EREQ-11 | View public event request status (unauthenticated) | Requestor can check status without logging in |
| EREQ-12 | Configure pipeline settings (task list, defaults) | Settings saved, applied to new requests |
| EREQ-13 | Community engagement tab: view outreach metrics | Metrics displayed for event coordinators |

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
| TRN-23 | Training module config: update visibility settings (training officer) | Config saved, member-facing views respect visibility |
| TRN-24 | Training module config: read visibility as regular member | Config returned without modify permission |
| TRN-25 | View My Training aggregated page | Shows requirement progress, waivers, submissions, shift reports |
| TRN-26 | Competency matrix / heat map (training officer) | Department-wide grid: members vs. requirements, color-coded by status |
| TRN-27 | Competency matrix filter by specific requirements | Matrix shows only selected requirements |
| TRN-28 | Competency matrix filter by specific members | Matrix shows only selected members |
| TRN-29 | Historical training import via CSV (multi-step wizard) | CSV uploaded, unmatched courses mapped, preview shown, import confirmed |
| TRN-30 | Historical import with unmatched courses | Wizard offers mapping to existing courses or creating new ones |
| TRN-31 | Historical import preview with warnings | Rows with issues highlighted, valid rows still importable |
| TRN-32 | Shift completion report: submit for trainee | Report created, pipeline progress auto-updated for shift/call/hour requirements |
| TRN-33 | Shift completion report: review workflow (when report_review_required=true) | Report enters pending_review status, requires officer approval |
| TRN-34 | Shift completion report: approve/reject review | Status updated, trainee sees only approved reports |
| TRN-35 | Shift completion report: trainee views own reports | Only approved reports shown if review workflow is enabled |
| TRN-36 | Shift completion report: trainee acknowledges report | Acknowledgment recorded with timestamp |
| TRN-37 | Enrollment deadline warning (scheduled task) | Members approaching enrollment deadlines receive notifications |
| TRN-38 | Leave of absence exempts member from training requirements | Months with active leave excluded from rolling-period calculations |
| TRN-39 | External training provider: create with credentials | Provider created, credentials encrypted at rest |
| TRN-40 | External training provider: test connection | Connection verified, success/failure reported |
| TRN-41 | External training sync: trigger manual sync | Records fetched from provider, mapped to internal courses |
| TRN-42 | External training: category mapping configuration | External categories mapped to internal training categories |
| TRN-43 | External training: user mapping configuration | External user IDs mapped to internal member IDs |
| TRN-44 | External training: bulk import from file | Bulk records imported with summary of successes/failures |
| TRN-45 | Compliance matrix tab: view department compliance percentages | Per-requirement compliance % displayed |

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
| INV-34 | Create storage area (rack, shelf, box) under a location/room | Storage area created with type and parent hierarchy |
| INV-35 | Create nested storage area (box inside a shelf inside a rack) | Hierarchy maintained, displayed in tree view |
| INV-36 | Assign inventory item to a storage area | Item linked to storage location, visible in storage view |
| INV-37 | View storage area tree with contained items | Hierarchical view renders, items listed under correct area |
| INV-38 | Delete storage area containing items | Prevented or items reassigned before deletion |
| INV-39 | Property return reminder: 30-day overdue | Reminder email sent to dropped member with outstanding items |
| INV-40 | Property return reminder: 90-day overdue | Escalation reminder sent, leadership notified |
| INV-41 | Property return reminder: no duplicate reminders | Same threshold reminder not sent twice for same member |

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
| SCH-13 | View open shifts available for signup | Open shifts listed, member can volunteer |
| SCH-14 | Sign up for open shift | Member assigned to position, notified |
| SCH-15 | View My Shifts tab | Personal upcoming shifts displayed |
| SCH-16 | View shift detail panel | Full shift info: positions, assigned members, notes |
| SCH-17 | Scheduling reports page | Shift statistics and coverage reports |
| SCH-18 | Post-shift validation notification (scheduled task) | Officer prompted to validate attendance after shift ends |
| SCH-19 | Member on leave excluded from shift scheduling | Leave-of-absence members not assigned or shown as available |

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
| ELC-14 | Proxy voting: designate proxy voter | Proxy recorded, proxy can vote on behalf of member |
| ELC-15 | Voter override: admin manually marks voter as eligible/ineligible | Override applied, voter access updated |

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
| MTG-11 | Attendance dashboard: secretary/leadership view | Per-member attendance %, meetings attended/waived, voting eligibility |
| MTG-12 | Attendance dashboard: filter by meeting type | Only selected meeting types included in calculations |
| MTG-13 | Quorum calculation with waived members excluded | Waived members excluded from quorum denominator |
| MTG-14 | Voting eligibility based on attendance threshold | Members below attendance threshold marked ineligible with reason |

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
| NOT-17 | Scheduled email: create email scheduled for future delivery | Email saved in pending state with scheduled timestamp |
| NOT-18 | Scheduled email: processed at scheduled time | Scheduled task sends email when due time arrives |
| NOT-19 | Scheduled email: cancel before delivery | Email cancelled, not sent |
| NOT-20 | Event reminder email sent per event's reminder_schedule | Reminders sent at configured intervals before event start |
| NOT-21 | Property return reminder: 30-day and 90-day thresholds | Tiered reminders sent to dropped members with outstanding items |

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
| DSH-12 | Platform analytics page (IT admin, settings.manage) | User adoption, module usage, system health metrics displayed |
| DSH-13 | Platform analytics: login trend chart | Daily login counts over last 30 days |
| DSH-14 | Platform analytics: module usage breakdown | Per-module activity counts (events, training, inventory, etc.) |

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
| SET-10 | Theme switching: high-contrast mode | High-contrast CSS class applied, enhanced contrast visible |
| SET-11 | Theme switching: system preference auto-detect | Theme follows OS light/dark preference via media query |
| SET-12 | Onboarding wizard: first-time organization setup | Multi-step wizard guides through org, navigation, email, modules |
| SET-13 | Onboarding wizard: auto-save progress | Partially completed steps saved, resumable on return |
| SET-14 | Onboarding wizard: skip optional steps | Optional steps skippable without blocking completion |
| SET-15 | Onboarding wizard: complete all steps | Onboarding marked complete, full app accessible |
| SET-16 | Department setup checklist: tracks completion per category | Steps show complete/incomplete across org setup, members, modules |
| SET-17 | Configure operational ranks (CRUD) | Ranks created, edited, deactivated per organization |
| SET-18 | Reorder operational ranks | Sort order updated, reflected in member forms |
| SET-19 | Operational ranks auto-seeded for new organization | Default ranks (Firefighter, Lieutenant, Captain, etc.) created on first access |
| SET-20 | Configure membership tiers | Tier definitions saved with years-of-service thresholds |
| SET-21 | Membership tier auto-advancement (scheduled task) | Members promoted to higher tiers based on years of service |

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
| PUB-07 | Public event request status page (no auth) | Requestor can view their request status |

## 19. Skills Testing Module

| ID | Test | Expected Outcome |
|---|---|---|
| SKL-01 | Create skill template with sections and criteria | Template saved in DRAFT status with all fields |
| SKL-02 | Edit skill template (add/remove sections, criteria) | Changes saved, version tracked |
| SKL-03 | Publish skill template | Status → PUBLISHED, visible to evaluators |
| SKL-04 | Archive skill template | Status → ARCHIVED, no longer usable for new tests |
| SKL-05 | Filter templates by status (draft/published/archived) | Only matching templates shown |
| SKL-06 | Filter templates by category | Only matching category shown |
| SKL-07 | Template visibility: officers see all, members see all_members only | Visibility filtering applied based on user role |
| SKL-08 | Start skill test session from published template | Test session created with all criteria from template |
| SKL-09 | Score individual criteria during test (pass/fail) | Score recorded per criterion |
| SKL-10 | Add notes to criteria during test | Notes saved alongside score |
| SKL-11 | Complete skill test session | Test finalized with overall pass/fail result |
| SKL-12 | View skill test history for a member | All past tests listed with results |
| SKL-13 | View skill testing summary statistics | Aggregate pass rates, test counts, trends displayed |
| SKL-14 | Access skill testing without training.manage permission | Read-only access, cannot create templates or grade tests |

## 20. Admin Hours Module

| ID | Test | Expected Outcome |
|---|---|---|
| ADH-01 | Create admin hours category (admin_hours.manage) | Category created with name, description, active status |
| ADH-02 | Edit admin hours category | Category updated |
| ADH-03 | Deactivate admin hours category | Category hidden from new entries, existing entries preserved |
| ADH-04 | Clock in via QR code scan | Clock-in recorded with timestamp, active session started |
| ADH-05 | Clock out via QR code scan | Clock-out recorded, session duration calculated |
| ADH-06 | Clock in manually (category, date, start time) | Manual entry created |
| ADH-07 | Clock out of active session manually | Session closed with end time |
| ADH-08 | View active clock-in sessions (admin) | All currently clocked-in members listed |
| ADH-09 | Auto-close stale sessions exceeding max duration | Stale sessions auto-closed after configurable hour limit |
| ADH-10 | Submit manual hours entry for approval | Entry created in pending state |
| ADH-11 | Approve admin hours entry (admin_hours.manage) | Entry approved, hours credited |
| ADH-12 | Reject admin hours entry with reason | Entry rejected, submitter notified |
| ADH-13 | Bulk approve multiple entries | All selected entries approved at once |
| ADH-14 | View personal admin hours summary | Total hours by category, period, and status |
| ADH-15 | Export admin hours data | CSV or report generated |
| ADH-16 | Edit previously submitted entry | Entry updated, re-enters approval workflow if required |
| ADH-17 | View admin hours QR code page | QR code displayed for clock-in scanning |

## 21. Locations Module

| ID | Test | Expected Outcome |
|---|---|---|
| LOC-01 | Create location with address and details | Location record created with all fields |
| LOC-02 | Edit location (name, address, capacity, building/floor/room) | Changes saved |
| LOC-03 | Deactivate location | Location hidden from active lists, historical data preserved |
| LOC-04 | Filter locations by active status | Only matching locations shown |
| LOC-05 | Associate location with a facility | Facility linkage saved |
| LOC-06 | Location display code generated | Unique display code assigned for kiosk use |
| LOC-07 | Location kiosk page renders without auth (`/display/:code`) | Public kiosk display shows location info, upcoming events |
| LOC-08 | Location kiosk with invalid display code | 404 or error page shown |
| LOC-09 | View events at a specific location | Events filtered by location |
| LOC-10 | Location used as event venue | Location selectable when creating events |

## 22. Member Leaves of Absence

| ID | Test | Expected Outcome |
|---|---|---|
| LOA-01 | Create leave of absence for a member (officer) | Leave created with type, reason, start/end dates |
| LOA-02 | Create open-ended leave (no end date) | Permanent leave created, member exempt until deactivated |
| LOA-03 | Update leave dates/reason | Leave record updated |
| LOA-04 | Deactivate (end) a leave of absence | Leave marked inactive, member returns to normal obligations |
| LOA-05 | View own leaves of absence | Personal leave history displayed |
| LOA-06 | View all leaves as officer | Organization-wide leaves listed |
| LOA-07 | Leave exempts member from training requirements | Months with active leave excluded from rolling-period requirement calculations |
| LOA-08 | Leave with exempt_from_training_waiver override | Training requirements remain active despite leave |
| LOA-09 | Leave auto-links to training waiver | Linked waiver ID stored, training module respects exemption |
| LOA-10 | Create leave without officer permission | 403 Forbidden (requires members.manage or equivalent) |

## 23. Public Portal Module

| ID | Test | Expected Outcome |
|---|---|---|
| PP-01 | Enable public portal for organization | Portal config created/updated, enabled=true |
| PP-02 | Disable public portal | All public API endpoints return 503 |
| PP-03 | Create API key for public portal | Key generated, hashed version stored, plaintext shown once |
| PP-04 | Update API key (name, rate limit, expiry) | Key metadata updated |
| PP-05 | Revoke API key | Key disabled, requests with that key rejected |
| PP-06 | Authenticate public API request with valid API key | Request authenticated, data returned |
| PP-07 | Authenticate public API request with invalid/revoked key | 401 Unauthorized |
| PP-08 | Configure data whitelist (fields visible per category) | Only whitelisted fields returned in public API responses |
| PP-09 | Bulk update data whitelist | Multiple field permissions updated at once |
| PP-10 | Rate limiting per API key | Requests exceeding per-key rate limit blocked |
| PP-11 | IP-based rate limiting on public API | Requests exceeding per-IP limit blocked |
| PP-12 | Public API: fetch organization info | Organization name, description returned (respecting whitelist) |
| PP-13 | Public API: fetch public events | Upcoming public events returned |
| PP-14 | Public API: fetch organization stats | Member count, event stats returned (respecting whitelist) |
| PP-15 | View public portal access logs | Request logs listed with IP, key, endpoint, timestamp |
| PP-16 | View public portal usage statistics | Request counts, top endpoints, error rates displayed |
| PP-17 | Anomaly detection on public API access | Unusual access patterns flagged in security monitoring |
| PP-18 | Configure CORS allowed origins for public portal | Only whitelisted origins can make requests |

## 24. Integrations Module

| ID | Test | Expected Outcome |
|---|---|---|
| INT-01 | View integration catalog | All available integrations listed with status (available/coming_soon) |
| INT-02 | Auto-seed integration catalog for new organization | Default integrations created on first access |
| INT-03 | Enable Google Calendar integration | Integration enabled, configuration saved |
| INT-04 | Enable Slack integration with webhook URL | Webhook configured, test notification sent |
| INT-05 | Enable CSV Import/Export integration | Data import/export functionality activated |
| INT-06 | Disable an active integration | Integration disabled, syncing stopped |
| INT-07 | View integration configuration details | Current config displayed with connection status |
| INT-08 | Integration with invalid credentials | Error shown, integration remains disabled |

## 25. Scheduled Tasks & Automation

| ID | Test | Expected Outcome |
|---|---|---|
| TASK-01 | Cert expiration alerts (daily, 6:00 AM) | Tiered alerts sent: 90/60/30/7-day + expired escalation |
| TASK-02 | Struggling member check (weekly, Monday 7:00 AM) | Members falling behind on programs flagged, notifications sent |
| TASK-03 | Enrollment deadline warnings (weekly, Monday 7:30 AM) | Members approaching enrollment deadlines warned |
| TASK-04 | Membership tier auto-advancement (monthly, 1st 8:00 AM) | Members promoted based on years of service |
| TASK-05 | Action item reminders (daily, 7:00 AM) | 3-day, 1-day, and overdue reminders sent to assignees |
| TASK-06 | Inventory notification processing (every 15 min) | Consolidated emails sent for changes older than 1 hour |
| TASK-07 | Event reminders (every 30 min) | Reminders sent per event's reminder_schedule setting |
| TASK-08 | Post-event validation (every 30 min) | Organizers prompted to validate attendance after event ends |
| TASK-09 | Post-shift validation (every 30 min) | Officers prompted to validate attendance after shift ends |
| TASK-10 | Audit log archival (weekly, Sunday 2:00 AM) | Integrity checkpoint created, chain verified, old logs archived |
| TASK-11 | Scheduled email processing (every 5 min) | Pending emails sent when due time arrives |
| TASK-12 | Task runs for all organizations in system | Multi-org task execution processes each org independently |
| TASK-13 | Task failure in one org doesn't block others | Error logged for failed org, remaining orgs still processed |

## 26. Security Monitoring

| ID | Test | Expected Outcome |
|---|---|---|
| SMON-01 | View security status dashboard (audit.view) | Overall status, log integrity, alert counts displayed |
| SMON-02 | View security alerts with filtering | Alerts filterable by threat level and type |
| SMON-03 | Acknowledge security alert | Alert marked as acknowledged, removed from active list |
| SMON-04 | Log integrity verification | Hash chain verified, results reported |
| SMON-05 | Query audit logs with date/type/user filters | Matching log entries returned |
| SMON-06 | Export audit logs | Audit data exported for compliance review |
| SMON-07 | Intrusion detection status | IDS metrics and alert counts displayed |
| SMON-08 | Data exfiltration monitoring | Unusual data access patterns flagged |
| SMON-09 | Security status view logged in audit trail | Viewing security dashboard itself is audited |

## 27. Security Testing (Penetration)

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
| SEC-36 | Public portal API key brute force | Rate limiting prevents key enumeration |
| SEC-37 | Public portal data whitelist bypass | Non-whitelisted fields never returned regardless of request crafting |
| SEC-38 | Verify httpOnly flag on auth cookies | Access/refresh tokens not readable via JavaScript (document.cookie) |
| SEC-39 | Verify Secure flag on auth cookies in production | Cookies only sent over HTTPS |
| SEC-40 | Verify SameSite=Strict on auth cookies | Cookies not sent on cross-site requests |
| SEC-41 | CSRF double-submit validation | X-CSRF-Token header must match csrf_token cookie value |
| SEC-42 | API cache: HIPAA-sensitive endpoints not cached | Endpoints in UNCACHEABLE_PREFIXES (/auth/, /users/, /security/, etc.) bypass cache |
| SEC-43 | PWA service worker: API responses not cached | NetworkOnly strategy for all /api/ routes |
| SEC-44 | Source maps disabled in production build | No .map files served, no sourceMappingURL in bundles |
| SEC-45 | Encrypted fields readable only with correct ENCRYPTION_KEY | Changing key makes stored encrypted data unreadable |
| SEC-46 | External training provider credentials encrypted at rest | Provider API keys/passwords stored encrypted in database |
| SEC-47 | Legacy token cleanup from localStorage | legacySensitiveData utility removes any old tokens on startup |
| SEC-48 | XSS in event request comments | HTML escaped before display |
| SEC-49 | XSS in training record notes | HTML escaped before display |
| SEC-50 | Admin hours QR code data integrity | QR payload validated server-side, cannot be spoofed for wrong user/org |

## 28. Accessibility Testing

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
| A11Y-33 | Color contrast: high-contrast theme | All elements meet enhanced contrast ratios (7:1 normal, 4.5:1 large) |
| A11Y-34 | Keyboard navigation: command palette open/navigate/select | Cmd/Ctrl+K opens, arrow keys navigate, Enter selects, Escape closes |
| A11Y-35 | Keyboard navigation: date range picker | Dates selectable via keyboard without mouse |
| A11Y-36 | Keyboard navigation: file dropzone | Files selectable via Enter/Space on dropzone, keyboard-accessible file dialog |
| A11Y-37 | Keyboard navigation: inline edit fields | Enter activates edit mode, Escape cancels, Enter/Tab confirms |
| A11Y-38 | Keyboard navigation: collapsible sections | Enter/Space toggles, state announced to screen reader |
| A11Y-39 | Keyboard navigation: sortable table headers | Enter/Space toggles sort, current sort direction announced |
| A11Y-40 | Keyboard navigation: pagination controls | Page numbers, next/prev reachable via Tab, activatable via Enter |
| A11Y-41 | Screen reader: breadcrumb navigation | Current page position announced in breadcrumb trail |
| A11Y-42 | Screen reader: confirm dialog | Dialog role, title, and action buttons properly announced |
| A11Y-43 | Screen reader: progress steps (onboarding, wizards) | Current step number and label announced |
| A11Y-44 | Screen reader: skeleton loading states | Loading placeholder announced as content loading |
| A11Y-45 | Screen reader: empty state messages | Empty state description read correctly |
| A11Y-46 | Screen reader: tooltip content | Tooltip content associated via aria-describedby |

## 29. Edge Cases & Stress Testing

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
| EDGE-21 | API cache invalidation after mutation | POST/PUT/PATCH/DELETE to a resource invalidates cached GETs for that URL prefix |
| EDGE-22 | API cache stale-while-revalidate behavior | Stale cache entries (30-90s old) served immediately, background revalidation fires |
| EDGE-23 | API cache LRU eviction at 200 entries | Oldest entries evicted when cache exceeds 200 entries |
| EDGE-24 | lazyWithRetry: chunk load failure after deployment | Module re-fetched with new build ID, user sees fresh chunk |
| EDGE-25 | lazyWithRetry: permanent chunk failure | Error boundary catches after retries exhausted |
| EDGE-26 | PWA update detected while user is active | Update notification shown, user can defer or apply |
| EDGE-27 | Pull-to-refresh on mobile PWA | Page data refreshed on pull gesture |
| EDGE-28 | WebSocket reconnection (inventory real-time updates) | Exponential backoff reconnect, max delay 30s |
| EDGE-29 | WebSocket disconnect during inventory batch operation | Operation completes via HTTP, UI updates on reconnect |
| EDGE-30 | Idle timer: session timeout warning before logout | Warning shown before HIPAA timeout, option to extend |
| EDGE-31 | Unsaved changes warning on navigation away | Browser confirmation dialog shown when leaving page with unsaved form data |
| EDGE-32 | Leave of absence spanning requirement calculation period | Leave months correctly excluded from training compliance calculations |
| EDGE-33 | Member with active leave assigned to shift | Warning shown or assignment prevented |
| EDGE-34 | Delete training requirement with existing progress records | Graceful handling: progress records orphaned or cleaned up |
| EDGE-35 | Delete election while voting is in progress | Prevented or votes preserved with clear error |
| EDGE-36 | Concurrent clock-in: member already clocked in tries again | Second clock-in rejected, active session shown |
| EDGE-37 | Admin hours stale session: clock-in exceeds max allowed duration | Session auto-closed by scheduled task, logged for review |
| EDGE-38 | Create training program with circular phase dependencies | Validation rejects circular dependency |
| EDGE-39 | Inventory batch operation: camera permission denied | Graceful fallback to manual code entry |
| EDGE-40 | Public form submission with browser back button | Re-submission prevented or gracefully handled |
| EDGE-41 | Election with ranked-choice tie | Tiebreaker rules applied or tie reported |
| EDGE-42 | Very large CSV import (5000+ rows member import) | Pagination of results, progress indicator, no server timeout |
| EDGE-43 | Organization timezone change after data exists | Historical dates display correctly in old timezone, new dates use new timezone |
| EDGE-44 | DST transition: event/shift spanning clock change | Start/end times correctly adjusted for DST |
| EDGE-45 | Multi-tenant data isolation: verify all queries include org_id filter | No endpoint returns data from other organizations |

## 30. Improvements & Future-Proofing Recommendations

| ID | Area | Recommendation | Priority |
|---|---|---|---|
| IMP-01 | **Security** | Implement token blacklist/revocation on logout (Redis-backed) — currently tokens remain valid until expiry | High |
| IMP-02 | **Security** | Move rate limiting from in-memory to Redis for multi-instance deployments | High |
| IMP-03 | **Security** | Remove `'unsafe-inline'` from CSP; migrate to nonce-based inline styles | High |
| IMP-04 | **Security** | Add antivirus/malware scanning on file uploads (ClamAV integration) | High |
| IMP-05 | **Security** | Enforce TOTP 2FA for all admin-role accounts | High |
| IMP-06 | **Security** | Implement automated audit log integrity verification as a scheduled task | Medium |
| IMP-07 | **Security** | Add request size limiting middleware to prevent oversized payloads | Medium |
| IMP-08 | **Security** | Add request ID headers (`X-Request-ID`) for distributed tracing | Medium |
| IMP-09 | **Accessibility** | Run automated axe-core or Lighthouse CI in CI/CD pipeline on every build | High |
| IMP-10 | **Accessibility** | Add `autocomplete` attributes to all form fields (login, profile, address) | High |
| IMP-11 | **Accessibility** | Ensure all data tables have proper `<caption>` and `scope` attributes | Medium |
| IMP-12 | **Accessibility** | Add visible focus indicators to custom components (not just native elements) | High |
| IMP-13 | **Accessibility** | Implement error summary component: on form error, focus moves to summary at top | Medium |
| IMP-14 | **Accessibility** | Add `aria-current="page"` to active navigation item | Low |
| IMP-15 | **Accessibility** | Ensure all dynamic content updates announce via `aria-live` regions | Medium |
| IMP-16 | **Frontend** | Add client-side form state persistence (localStorage) to survive accidental refresh/timeout | Medium |
| IMP-17 | **Frontend** | Implement optimistic UI updates for common actions (RSVP, check-in) | Low |
| IMP-18 | **Frontend** | Add skeleton loading screens instead of spinners for better perceived performance | Low |
| IMP-19 | **Frontend** | Implement service worker caching strategy for static assets (PWA offline) | Medium |
| IMP-20 | **Backend** | Add database connection encryption (`DB_SSL=true`) as required in production config validation | High |
| IMP-21 | **Backend** | Add container memory/CPU limits in docker-compose production profile | Medium |
| IMP-22 | **Backend** | Enable Elasticsearch security (`xpack.security.enabled=true`) in production | Medium |
| IMP-23 | **Backend** | Add automated GeoIP database update mechanism | Low |
| IMP-24 | **Backend** | Implement database-level row security or connection-per-tenant for stronger isolation | Low |
| IMP-25 | **Backend** | Add request timeout middleware (e.g. 30s max per request) | Medium |
| IMP-26 | **Email** | Add email bounce handling and delivery tracking | Medium |
| IMP-27 | **Email** | Add unsubscribe mechanism for non-critical notifications (CAN-SPAM compliance) | Medium |
| IMP-28 | **Testing** | Add end-to-end tests (Playwright/Cypress) covering critical flows: login, member create, event RSVP, training submit | High |
| IMP-29 | **Testing** | Add load testing (k6/Locust) to verify performance under expected concurrent user count | Medium |
| IMP-30 | **Monitoring** | Set up uptime monitoring and alerting (health endpoint checks) | High |
| IMP-31 | **Monitoring** | Configure Sentry for frontend + backend error tracking | High |
| IMP-32 | **Infrastructure** | Document disaster recovery plan: database backup restoration, failover procedures | High |
| IMP-33 | **Infrastructure** | Set up automated database backups with off-site storage | High |
| IMP-34 | **Frontend** | Lazy-load heavy module pages (elections, facilities, apparatus) to reduce initial bundle size | Medium |
| IMP-35 | **Frontend** | Add `rel="noopener noreferrer"` to all external links for security | Low |
