# Events & Meetings

The Events module handles department events, attendance tracking with QR code check-in, and event templates. The Meetings and Minutes modules manage formal meeting records, action item tracking, and attendance waivers. The Elections module supports secure, anonymous voting.

---

## Table of Contents

1. [Events Overview](#events-overview)
2. [Viewing and RSVPing to Events](#viewing-and-rsvping-to-events)
3. [QR Code Check-In](#qr-code-check-in)
4. [Creating Events (Officers)](#creating-events-officers)
5. [Event Templates and Recurring Events](#event-templates-and-recurring-events)
6. [Calendar View, Analytics & Templates](#calendar-view-analytics--templates-2026-03-13)
7. [RSVP Enhancements](#rsvp-enhancements-2026-03-13)
8. [Event Notifications](#event-notifications-2026-03-13)
9. [Bulk Operations & Import](#bulk-operations--import-2026-03-13)
10. [Meeting Minutes](#meeting-minutes)
11. [Action Items](#action-items)
12. [Elections and Voting](#elections-and-voting)
13. [Public Outreach Request Pipeline](#public-outreach-request-pipeline)
14. [Realistic Example: Outreach Request from Submission to Completion](#realistic-example-outreach-request-from-submission-to-completion)
15. [Troubleshooting](#troubleshooting)

---

## Events Overview

Navigate to **Events** in the sidebar to see all upcoming department events. Past events are hidden by default to keep the view focused on what's coming up.

Events are categorized by type:
- **Business Meeting** - Regular department meetings
- **Training** - Training sessions and drills
- **Social** - Department social events
- **Fundraiser** - Fundraising events
- **Community** - Community outreach
- **Work Detail** - Work parties and maintenance
- **Other** - Miscellaneous events
- **Custom Categories** - Your department can define additional custom event categories with color-coded badges in **Events Settings > Custom Event Categories**

You can filter events by type and date range using the controls at the top of the page. A **search bar** lets you filter by event title and location. If custom categories have been configured and enabled, they appear as additional filter tabs alongside the built-in types. Event cards show your **RSVP status badge** (Going/Maybe/Not Going) so you can see at a glance which events you've responded to.

**Past Events:** All users can toggle between **Upcoming** and **Past** events using the toggle at the top of the page. Results are paginated for easy browsing.

> **Screenshot placeholder:**
> _[Screenshot of the Events listing page showing upcoming events as cards or rows, with type badges (color-coded), dates, times, and RSVP status indicators. Show the filter controls and Past Events tab at the top]_

---

## Viewing and RSVPing to Events

Click on any event to view its detail page. The detail page shows:

- Event title, type, date, time, and location
- Description and any attached files
- RSVP counts (Going, Maybe, Not Going)
- Attendee list — officers can add/remove attendees directly from the detail page
- Attendance list (for past events)
- Your current RSVP status

**To RSVP:**
1. Click one of the RSVP buttons: **Going**, **Maybe**, or **Not Going**.
2. Your response is recorded immediately.
3. You can change your RSVP at any time before the event.

> **Screenshot placeholder:**
> _[Screenshot of an event detail page showing the event header (title, date, location), description, RSVP buttons (Going/Maybe/Not Going with counts), and a list of attendees who have RSVP'd]_

---

## QR Code Check-In

Events support QR code-based check-in for tracking attendance:

### For Officers (Setting Up Check-In)

1. Open the event detail page.
2. Click **QR Code** to display or print the check-in QR code.
3. Display the QR code on a screen or print it for the venue entrance.

> **Screenshot placeholder:**
> _[Screenshot of the QR code display page showing a large QR code in the center, the event name above it, and instructions below ("Scan to check in")]_

### For Members (Checking In)

1. Scan the QR code with your phone's camera.
2. You will be taken to the self check-in page.
3. Confirm your check-in.
4. When leaving, scan again to check out.

### Monitoring Check-Ins

Officers can view real-time check-in activity from the event's **Monitoring** view, which shows:
- Who has checked in
- Check-in and check-out times
- Total attendee count
- Members who RSVP'd but have not checked in

> **Screenshot placeholder:**
> _[Screenshot of the check-in monitoring page showing a real-time list of checked-in members with timestamps, and a sidebar showing RSVP'd members who haven't arrived yet]_

> **Hint:** Officers can also manually check in members or override check-in/check-out times from the monitoring view, useful for members who forgot to scan.

---

## Creating Events (Officers)

**Required Permission:** `events.manage`

Navigate to **Events Admin > Create Event** or click **Create Event** on the events page.

1. Set the **event type**, **title**, **date**, **start time**, and **end time**.
2. Add a **location** and **description**.
3. Configure **check-in settings** (QR code, manual, or both).
4. Set **reminder schedule** — choose one or more reminder times (e.g., 24 hours before, 1 hour before). Members who RSVP'd will receive notifications at these times.
5. Optionally attach files (agendas, maps, etc.).
6. Click **Create Event**.

> **Screenshot placeholder:**
> _[Screenshot of the Create Event form showing fields for type, title, date/time, location, description, reminder schedule, check-in configuration options, and file attachment area]_

### Event Reminders

Events support configurable reminders that are sent via the notification system:

- **Multiple reminders**: Set multiple reminder times per event (e.g., "1 day before" and "1 hour before").
- **Automatic delivery**: Reminders are sent to all members who RSVP'd "Going" or "Maybe".
- **Notification preferences**: Members can configure their preferred notification delivery window in their account settings.

### Post-Event Notifications

After an event ends, the event organizer receives an automatic notification prompting them to review and finalize the attendance records. This ensures attendance data is complete and accurate for compliance tracking.

### Training Sessions from Events

Training-type events can be linked to a **Training Session** for automatic record-keeping:

1. Create an event with type **Training**.
2. After the event, navigate to **Training Admin > Create Session** and link it to the event.
3. Finalize the session to trigger the approval workflow.
4. Attendees automatically receive training records once approved.

---

## Event Templates and Recurring Events

**Required Permission:** `events.manage`

### Templates

Save frequently used event configurations as templates:

1. Create an event with all desired settings.
2. From the Events Admin, click **Create Template** and base it on the event.
3. Use the template to quickly create future events with the same settings.

### Recurring Events

Create a series of repeating events:

1. Navigate to **Events Admin**.
2. Click **Create Recurring Event**.
3. Set the recurrence pattern:
   - **Daily** — Every day or every N days
   - **Weekly** — Every week on selected days (e.g., every Monday and Wednesday)
   - **Monthly** — On the same date each month (e.g., the 15th)
   - **Monthly by Weekday** — On a specific weekday occurrence (e.g., "2nd Tuesday of every month" or "last Friday of every month"). The weekday auto-populates from your event date
   - **Annual** — On the same date each year
4. Set the start and end dates for the series.
5. Each occurrence is created as an individual event that can be modified independently.

> **Screenshot placeholder:**
> _[Screenshot of the recurring event creation form showing the base event settings plus the recurrence pattern selector (daily/weekly/monthly/monthly-by-weekday/annual), weekday selectors, and the series date range]_

### Managing Recurring Event Series

Once a recurring series is created, each occurrence appears as an individual event with a **recurring event badge** on the events list. From any event in the series:

- **View All in Series** — See all events in the series on a single page
- **Edit All Future** — Modify all future occurrences at once (past events are unchanged)
- **Delete Series** — Remove all events in the series
- **Edit Single** — Modify just this one occurrence without affecting others

> **Hint:** Deleting a single occurrence from a series does not affect other occurrences. The system warns you when an edit will affect multiple events.

### Recurring Event Edge Cases

| Scenario | What Happens |
|----------|-------------|
| Monthly-by-weekday "5th Tuesday" | Falls back to the last Tuesday when the month has fewer than 5 weeks |
| Annual event on Feb 29 | Shifts to Feb 28 in non-leap years |
| Conflicting times/locations | The system checks for scheduling conflicts before creating each occurrence and warns you |
| Past events in "Edit All Future" | Only events after today are modified — historical records remain intact |
| Series spanning timezone changes (DST) | Event times are stored in UTC and displayed in local time; times may shift by 1 hour across DST boundaries |

---

## Calendar View, Analytics & Templates (2026-03-13)

### Calendar View

A monthly calendar view is available alongside the list view:

- Click the **Calendar** toggle on the Events page to switch views
- Events appear as colored dots on their respective days
- Click a day to expand and see that day's events with details
- Navigate between months using the arrow buttons
- All times display in the organization's configured timezone

> **Screenshot needed:**
> _[Screenshot of the CalendarView component showing a monthly grid with colored event dots on several days, one day expanded to show a list of events for that day with titles and times]_

### Event Analytics Dashboard

**Required Permission:** `analytics.view`

Navigate to **Events > Analytics** to view department-wide event metrics:

- **Summary Cards**: Total events, total RSVPs, total check-ins, attendance rate, check-in rate, average check-in time (minutes before event start)
- **Event Type Distribution**: Bar chart showing event counts by type
- **Monthly Trends**: Line chart showing event frequency over time
- **Top Events**: Table of highest-attendance events
- **Date Range Filter**: Filter all analytics by custom date range

> **Screenshot needed:**
> _[Screenshot of the EventAnalyticsPage showing the summary cards at the top, the event type bar chart on the left, monthly trends line chart on the right, and the top events table below]_

### Event Templates Management

**Required Permission:** `events.manage`

Navigate to **Events > Templates** to manage reusable event configurations:

1. Click **Create Template** to save a new template
2. Fill in the template form with default event settings (title, type, location, time, description, reminders)
3. Toggle templates **active/inactive** — inactive templates won't appear in the template picker
4. Edit or delete existing templates

When creating a new event, the **Template Picker** lets you quick-select from active templates to pre-fill the event form.

> **Screenshot needed:**
> _[Screenshot of the EventTemplatesPage showing a list of templates with name, type, active toggle, and edit/delete buttons. Show the create template modal open with the form fields]_

### Quick-Create Events

For simple events, use the quick-create flow:

1. Click **Quick Create** on the Events page
2. Enter only the required fields: **title**, **date**, and **time**
3. All other settings use sensible defaults
4. Click **Create** to save immediately

### Rich Text Descriptions

Event descriptions now support rich text formatting:

- Bold, italic, underline
- Bullet and numbered lists
- Links
- Headings

> **Screenshot needed:**
> _[Screenshot of the event creation form showing the rich text editor for the description field with the formatting toolbar visible]_

---

## RSVP Enhancements (2026-03-13)

### Dietary & Accessibility Information

When RSVPing to an event, members can now provide:

- **Dietary restrictions** — allergies, preferences, or special requirements
- **Accessibility needs** — wheelchair access, hearing assistance, or other accommodations

This information is visible to event coordinators in the attendee list.

> **Screenshot needed:**
> _[Screenshot of the RSVP form showing the dietary restrictions text field and accessibility requirements text field below the Going/Maybe/Not Going buttons]_

### RSVP History

The event detail page now includes a collapsible **RSVP Activity History** feed showing all RSVP changes with timestamps (e.g., "John Smith changed from Maybe to Going at 2:15 PM").

### Inline RSVP

RSVP directly from the events list without opening the event detail page — click the RSVP button on any event card.

### Series RSVP

For recurring events, you can RSVP to **all events in the series** at once instead of responding to each individually.

### Waitlist System

When an event reaches its capacity limit:

1. New RSVPs are automatically added to the **waitlist**
2. If a spot opens (someone changes to "Not Going"), the first waitlisted person is promoted
3. Waitlisted members are notified when promoted to "Going"
4. The waitlist position is visible on the event detail page

> **Edge case:** Waitlisted attendees are promoted in the order they RSVP'd. If multiple spots open simultaneously, multiple waitlisted members are promoted in order.

### Additional RSVP Features

- **RSVP Countdown** — Shows time remaining until RSVP deadline on event cards
- **CSV Export** — Download the attendee list as a CSV file from the event detail page
- **Print Roster** — Print a formatted attendee roster for on-site check-in use
- **Capacity Bar** — Visual progress bar on event cards showing RSVP count vs. capacity
- **Non-Respondent Reminders** — Send targeted reminder notifications to members who haven't RSVP'd. Excludes members who already responded (going, not going, or maybe)

> **Screenshot needed:**
> _[Screenshot of the EventRSVPSection on an event detail page showing the attendee list with check-in times, RSVP statuses, the CSV Export and Print Roster buttons, and the RSVP activity history collapsed section]_

---

## Event Notifications (2026-03-13)

**Required Permission:** `events.manage`

From any event's detail page, coordinators can send targeted notifications:

### Notification Types

| Type | Purpose |
|------|---------|
| **Announcement** | General announcement about the event |
| **Reminder** | Reminder notification before the event |
| **Follow-Up** | Post-event follow-up message |
| **Missed Event** | Alert for members who RSVP'd but didn't attend |
| **Check-In Confirmation** | Confirmation for members who checked in |

### Target Audiences

| Audience | Who Receives |
|----------|-------------|
| **All** | Everyone invited or associated with the event |
| **Going** | Members who RSVP'd "Going" |
| **Not Responded** | Members who haven't RSVP'd |
| **Checked In** | Members who checked in to the event |
| **Not Checked In** | Members who RSVP'd "Going" but didn't check in |

> **Screenshot needed:**
> _[Screenshot of the EventNotificationPanel showing the notification type dropdown, target audience radio buttons, message text area, and the Send button with confirmation dialog]_

---

## Bulk Operations & Import (2026-03-13)

### Duplicate Events

Click **Duplicate** from an event's "More" menu to create a copy with the same settings but a new date.

### Bulk Actions

Select multiple events from the events list to perform bulk operations (delete, change type, etc.).

### CSV Import

Import events from a CSV file:

1. Navigate to **Events Admin**
2. Click **Import from CSV**
3. Upload a CSV with columns: title, date, start_time, end_time, type, location, description
4. Preview the import — invalid rows are highlighted with error details
5. Confirm to import all valid rows

> **Edge case:** Invalid rows (missing title or date) are skipped with error reporting. Valid rows in the same file are still imported.

### Saved Filter Presets

Save frequently used filter combinations (event type, date range, category) as named presets for quick recall.

### Draft/Publish Workflow

Events can be saved as **drafts** before publishing:

1. Create an event and click **Save as Draft** instead of **Create**
2. Draft events are only visible to users with `events.manage` permission
3. Edit the draft until ready, then click **Publish** to make it visible to all members

### Additional Features

- **Save as Template** — Save any event's configuration as a reusable template
- **Enhanced Search** — Full-text search across event titles, descriptions, and locations
- **My Events Filter** — Filter the events list to show only events you've RSVP'd to
- **Sort Options** — Sort by date, title, attendance count, or creation date
- **Conflict Detection** — Warning when creating events that overlap at the same location (warns but does not block)
- **Timezone Labels** — All event times display with timezone abbreviation
- **Directions Link** — Map/directions link for events with a location
- **Dashboard Widget** — Upcoming events widget on the main dashboard
- **Calendar Export** — Export events to iCal/Google Calendar format
- **Attendance Display** — Visual attendance count on event cards in list view

---

## Meeting Minutes

Navigate to **Minutes** in the sidebar to access meeting minutes management.

### Creating Minutes

1. Click **Create Minutes**.
2. Select the **meeting type**: Business, Special, Committee, Board, Trustee, Executive, or Annual.
3. Add **attendees** from the member roster.
4. Record the **minutes content** including:
   - Call to order
   - Roll call
   - Agenda items
   - Motions (with mover, seconder, vote results)
   - Discussions
   - Adjournment

> **Screenshot placeholder:**
> _[Screenshot of the minutes creation/editing page showing the meeting type selector, date, attendee list with checkboxes, and the minutes content area with sections for motions, discussions, and action items]_

### Motions

Record formal motions with:
- Motion text
- Mover (who made the motion)
- Seconder
- Vote result (Passed, Failed, Tabled)

### Creating Minutes from Events

Business meeting events can be converted to minutes:
1. After the event, navigate to the event detail page.
2. Click **Create Minutes from Event**.
3. The attendee list is automatically imported from the event check-in records.

---

## Action Items

Navigate to **Action Items** in the sidebar for a unified view of all tasks assigned from meetings and minutes.

Action items have:
- **Title** and **description**
- **Assigned to** - The responsible member
- **Due date**
- **Priority** - Low, Medium, High
- **Status** - Open, In Progress, Completed, Cancelled

> **Screenshot placeholder:**
> _[Screenshot of the Action Items page showing a filterable list of tasks with columns for title, assigned member, due date, priority (color-coded badges), and status. Show filter controls for status and assignee at the top]_

> **Hint:** Members see their own action items prominently. Officers can view and manage all action items across the department.

### Attendance Dashboard (Secretary)

The **Meetings > Attendance Dashboard** provides:
- Attendance percentage by member
- Attendance by membership tier
- Meeting attendance waivers granted
- Meetings excluded due to Leave of Absence
- Voting eligibility based on attendance requirements

The attendance percentage is calculated as:

```
attendance_pct = meetings_attended / eligible_meetings × 100
```

Where `eligible_meetings = total_meetings − per_meeting_waivers − meetings_during_leave`.

> **Screenshot placeholder:**
> _[Screenshot of the Attendance Dashboard showing a table of members with their attendance percentage, number of meetings attended, meetings on leave, and voting eligibility status]_

### Leave of Absence & Meeting Attendance

When a member has an active **Leave of Absence** (created via **Administration > Member Lifecycle**), any meetings whose date falls within the leave period are automatically excluded from the attendance denominator. This means:

- The member's attendance percentage is not penalized for meetings they could not attend
- Officers do **not** need to grant individual per-meeting waivers for members on formal leave
- Voting eligibility calculations also respect the adjusted attendance percentage

Per-meeting waivers (granted for one-off absences) and Leave of Absence exclusions are tracked separately in the dashboard. Both reduce the denominator independently.

---

## Elections and Voting

Navigate to **Elections** in the sidebar to view active and past elections.

### Viewing Elections

Each election shows:
- Election title and description
- Voting period (start and end dates)
- Candidates or ballot items
- Your voting status (Voted / Not Yet Voted)

### Casting Your Vote

1. Click on an active election.
2. Review the candidates or ballot items.
3. Make your selections.
4. Submit your ballot.

> **Screenshot placeholder:**
> _[Screenshot of the voting page showing the election title, ballot items with candidate names and descriptions, radio buttons or checkboxes for selection, and a Submit Ballot button at the bottom]_

> **Hint:** Votes are anonymous by default. The system records that you voted but not how you voted. Write-in candidates are supported when enabled by the election creator.

### Creating Elections (Officers)

**Required Permission:** `elections.manage`

1. Navigate to **Elections** and click **Create Election**.
2. Set the election title, description, and voting period.
3. Add **ballot items** using the card-based Ballot Builder with drag-and-drop reordering:
   - Use templates for common items (officer election, bylaw vote, membership approval) or create custom items
   - Each position can only have one ballot item (the dropdown shows only unused positions)
   - Positions load from your organization's operational ranks (Chief, Captain, etc.) with type-ahead filtering
4. For each item, add **candidates** and configure options:
   - Allow write-ins (auto-fills name with "Write-in Candidate")
   - Victory condition (plurality, majority, ranked choice)
   - Number of winners
   - Move candidates between positions using the position dropdown in the edit form
5. Configure **proxy voting** in Election Settings if needed (enable/disable, set max proxies per person).
6. Optionally enable **email ballots** for members who cannot access the system.
7. Open the election for voting.

> **Screenshot placeholder:**
> _[Screenshot of the election creation form showing the title, date range, ballot items section with candidates, and the configuration options (write-ins, victory type)]_

### Public Ballot Access

Elections can provide a public ballot URL that uses unique tokens, allowing members to vote from any device without logging in. The token is single-use and tied to the member.

---

## Public Outreach Request Pipeline

The Events module includes a **Public Outreach Request Pipeline** that lets community members submit event requests to your department — fire safety demos, station tours, school visits, CPR classes, and more. Your department controls the workflow, assignment, scheduling, and communication.

### How It Works

1. **Community member submits a request** via a public form on your website (no login needed).
2. **A coordinator is auto-assigned** (configurable in Settings) and notified by email.
3. **The coordinator manages the request** — moving it through configurable pipeline tasks, adding comments, and communicating with the requester.
4. **When ready, the coordinator schedules the event** — setting a confirmed date, booking a room, and creating a calendar event.
5. **The requester tracks status** via a unique status link — and can cancel if plans change.
6. **After the event, the coordinator marks it complete**.

### Setting Up the Pipeline

**Required Permission:** `events.manage`

1. Navigate to **Events Admin > Settings**.
2. Under **Outreach Types**, add the program types your department offers:
   - Click **Add Type**, enter a key (e.g., `fire_safety_demo`) and label (e.g., "Fire Safety Demonstration")
   - These appear as options on the public request form
3. Under **Request Pipeline**, configure:
   - **Default Coordinator** — Select a member who will be auto-assigned all new requests
   - **Pipeline Tasks** — Add custom checklist steps (e.g., "Chief Approval", "Email Volunteer Signup", "Prep Equipment"). Use the up/down arrows to reorder.
   - **Public Progress Visibility** — Toggle whether the requester can see task progress on their status page (off by default)
4. Under **Email Triggers**, configure which status changes send notifications:
   - Toggle each trigger on/off (e.g., "On Submitted", "On Scheduled", "On Postponed")
   - Each trigger can notify the requester, the assigned coordinator, or both
5. Under **Email Templates**, create reusable email messages:
   - Example: "How to Find Our Building" email with directions and parking info
   - Templates support variables: `{{contact_name}}`, `{{event_date}}`, `{{organization_name}}`, etc.
   - Optionally set a trigger (e.g., "7 days before event") for automatic sending

### Managing Requests

Once requests start coming in, manage them from the **Event Requests** tab:

1. **View the request** — Click to expand details including contact info, date preferences, and description.
2. **Assign/reassign** — Change the assigned coordinator using the dropdown.
3. **Add comments** — Use the comment thread for internal notes and coordination (not visible to the requester).
4. **Complete pipeline tasks** — Check off tasks as they're done. The first task completion auto-moves the status from "Submitted" to "In Progress".
5. **Schedule the event** — Click **Schedule Event** to:
   - Set the confirmed date and time
   - Select a room/location (the system prevents double-booking)
   - Optionally create a calendar event with QR check-in
6. **Postpone** — If the event needs to be pushed back, click **Postpone**. You can set a new date or leave it open.
7. **Send emails** — Use the template dropdown to send a pre-written email to the requester (e.g., directions, parking, what to expect).
8. **Copy status link** — Click the link icon to copy the requester's status page URL to share.

### Public Request Form

The public form is created through the **Forms module** with an `EVENT_REQUEST` integration:

1. Go to **Forms** and create a new form or edit an existing one.
2. Enable **Public Access** and set a **public slug** (e.g., `request-event`).
3. Under **Integrations**, add an `EVENT_REQUEST` integration to connect the form to the pipeline.
4. Share the form URL (`/f/request-event`) on your website, social media, or print materials.

The form collects:
- Contact information (name, email, phone, organization)
- Outreach type (from your configured types)
- Event description
- Date preferences (specific dates, general timeframe, or flexible)
- Preferred time of day (morning, afternoon, evening, or flexible)
- Audience size and age group
- Venue preference (their location, your station, or either)
- Special requests

### Public Status Page

Each request has a unique, token-based status page accessible without login:

- **URL format**: `/request-status/:token`
- Shows: current status (as a progress stepper), submitted date, date preferences, scheduled date
- Optionally shows: pipeline task progress (if department enables it)
- Allows: self-service cancellation with an optional reason
- Shows postponed state with new date (if set) or "awaiting reschedule" message

### Common Public Programs

Here are examples of outreach programs departments commonly configure:

| Program | Key | Typical Duration | Audience |
|---------|-----|-----------------|----------|
| Fire Safety Demonstration | `fire_safety_demo` | 45-60 min | Offices, senior living, school staff |
| Station Tour | `station_tour` | 30-45 min | Scouts, daycares, school trips |
| School Visit / Classroom | `school_visit` | 30 min per session | Elementary schools (K-5) |
| CPR / First Aid Class | `cpr_first_aid` | 2-3 hours | Community groups, corporate teams |
| Smoke Detector Installation | `smoke_detector_install` | 15-30 min per home | Seniors, low-income residents |
| Community Open House | `open_house` | 2-4 hours | General public, potential recruits |

For detailed program descriptions, pipeline task suggestions, and sample email templates for each, see [Public Programs How-To](../../wiki/Public-Programs.md).

> **Screenshot placeholder:**
> _[Screenshot of the Event Requests tab showing a list of requests with status badges, assigned coordinator, and expand arrow. Below: expanded request detail showing contact info, comment thread, pipeline task checklist, and action buttons (Schedule, Postpone, Cancel)]_

---

## Realistic Example: Outreach Request from Submission to Completion

This walkthrough follows a community event request through the entire pipeline — from the moment a community member submits the form through the event itself and completion — showing both what the **requester** sees and what the **department coordinator** sees.

### Background

**Riverside Fire-Rescue** has set up the Public Outreach Request Pipeline. Their configuration:

- **Outreach Types:** Fire Safety Demonstration, Station Tour, School Visit, CPR/First Aid Class
- **Default Coordinator:** Lt. Sarah Chen (Community Outreach Officer)
- **Pipeline Tasks:** Chief Approval → Confirm Volunteers → Prep Equipment → Pre-Event Email
- **Email Triggers:** On Submitted (notify coordinator), On Scheduled (notify requester), On Completed (notify requester)
- **Email Templates:** "Directions & Parking" template, "What to Expect" template

---

### Step 1: Community Member Submits a Request

**Maria Rodriguez**, PTA president at Lincoln Elementary School, visits the department's website and clicks "Request a Visit." She is taken to the public form at `/f/request-event`.

She fills out the form:

| Field | Value |
|-------|-------|
| **Contact Name** | Maria Rodriguez |
| **Email** | maria.rodriguez@email.com |
| **Phone** | (555) 234-5678 |
| **Organization** | Lincoln Elementary School PTA |
| **Outreach Type** | Fire Safety Demonstration |
| **Description** | We'd like a fire safety presentation for our K-2 students during Fire Prevention Week. Topics: stop-drop-roll, smoke alarms, escape plans. Kids love seeing the fire truck! |
| **Date Preference** | Specific dates: October 7 or October 8 |
| **Preferred Time** | Morning (school starts at 8:15, assembly at 9:00) |
| **Audience Size** | 120 students + 8 teachers |
| **Age Group** | 5-8 years old |
| **Venue** | Their location (school gymnasium) |
| **Special Requests** | We have a student in a wheelchair — please ensure any activities are accessible. Parking available in the staff lot. |

She clicks **Submit**. The form confirms: *"Thank you! Your request has been submitted. You will receive an email with a link to track your request's status."*

**What Maria sees:** An email arrives with a link to her status page (`/request-status/abc123token`). The status page shows:

```
Request Status: ● Submitted

Progress:  [●]─────[○]─────[○]─────[○]
         Submitted  In Progress  Scheduled  Completed

Submitted: October 1
Request Type: Fire Safety Demonstration
Date Preference: October 7 or October 8

[Cancel Request]
```

---

### Step 2: Coordinator Receives and Reviews the Request

Lt. Chen receives an email notification: *"New outreach request from Lincoln Elementary School PTA — Fire Safety Demonstration."*

She navigates to **Events Admin > Event Requests** and clicks on the new request. The detail view shows Maria's full submission, the pipeline task checklist, and action buttons.

Lt. Chen adds an internal comment (not visible to Maria): *"Perfect timing for Fire Prevention Week. We should bring Engine 3 and the smoke house trailer. Need 3 volunteers minimum."*

---

### Step 3: Working Through Pipeline Tasks

**Task 1 — Chief Approval:**
Lt. Chen walks the request by Chief Williams, who approves. She checks off "Chief Approval" in the pipeline.

The first task completion automatically moves the status from **Submitted** to **In Progress**.

**Task 2 — Confirm Volunteers:**
Lt. Chen posts a sign-up in the station and confirms three volunteers: FF Martinez, FF Okafor, and FF Lee. She checks off "Confirm Volunteers" and adds a comment: *"Martinez, Okafor, Lee confirmed. Martinez will drive Engine 3."*

**Task 3 — Prep Equipment:**
She reserves the smoke house trailer and gathers fire safety handouts for K-2 age group. Checks off "Prep Equipment."

---

### Step 4: Scheduling the Event

Lt. Chen clicks **Schedule Event** and fills in:

| Field | Value |
|-------|-------|
| **Confirmed Date** | October 7 |
| **Start Time** | 9:00 AM |
| **End Time** | 10:30 AM |
| **Location** | Lincoln Elementary School — Gymnasium |
| **Create Calendar Event** | Yes |
| **Enable QR Check-In** | Yes |

She clicks **Confirm**. The system:
1. Changes the request status to **Scheduled**
2. Creates a department calendar event (type: Community) for October 7
3. Sends Maria the "On Scheduled" email: *"Your fire safety demonstration has been confirmed for October 7 at 9:00 AM."*

**What Maria now sees on her status page:**

```
Request Status: ● Scheduled

Progress:  [●]─────[●]─────[●]─────[○]
         Submitted  In Progress  Scheduled  Completed

Submitted: October 1
Scheduled: October 7, 9:00 AM – 10:30 AM
Location: Lincoln Elementary School — Gymnasium
```

---

### Step 5: Pre-Event Communication

**Task 4 — Pre-Event Email:**
One week before the event, Lt. Chen uses the email template dropdown to send the "What to Expect" template to Maria. The template auto-fills the variables:

> Dear Maria,
>
> We're looking forward to the fire safety demonstration at Lincoln Elementary School on October 7 at 9:00 AM.
>
> **What to expect:**
> - 3 firefighters will arrive with Engine 3 at approximately 8:45 AM
> - The presentation lasts about 60-90 minutes
> - We'll cover stop-drop-roll, home escape plans, and smoke alarm awareness
> - Students will have the opportunity to see the fire truck up close
>
> Please let us know if anything changes.
>
> — Lt. Sarah Chen, Riverside Fire-Rescue

She checks off the final pipeline task. All 4 tasks are now complete.

---

### Step 6: Day of the Event

The event appears on the department calendar. FF Martinez, FF Okafor, and FF Lee see it on their schedules. The QR check-in code is available for attendance tracking.

After the presentation, Lt. Chen navigates to the event request and clicks **Complete**. The status changes to **Completed** and the system sends Maria a completion email.

**What Maria now sees on her status page:**

```
Request Status: ● Completed

Progress:  [●]─────[●]─────[●]─────[●]
         Submitted  In Progress  Scheduled  Completed

Submitted: October 1
Scheduled: October 7, 9:00 AM – 10:30 AM
Completed: October 7

Thank you for working with Riverside Fire-Rescue!
```

---

### What This Looked Like for Each Person

| Step | Maria (Requester) | Lt. Chen (Coordinator) |
|------|-------------------|----------------------|
| Submit | Fills out public form, receives status link | Receives email notification, sees request in queue |
| Review | Sees "Submitted" on status page | Reviews details, adds internal comments |
| Pipeline | No visibility (public progress off) | Checks off Chief Approval, Volunteers, Equipment, Email |
| Schedule | Receives "Scheduled" email, status page updates | Sets confirmed date, creates calendar event |
| Pre-Event | Receives "What to Expect" email | Sends template email from request detail |
| Complete | Receives completion email, status page shows done | Clicks Complete, request moves to terminal state |

> **Hint:** If the department enables **Public Progress Visibility** in Settings, Maria would also see the pipeline tasks on her status page — helpful for transparency, but some departments prefer to keep internal workflow steps private.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| QR code not scanning | Ensure good lighting and that the code is displayed at a readable size. Try the manual check-in option. |
| "Already checked in" error | The member has already checked in. Use the monitoring view to verify or override times. |
| Cannot RSVP to an event | Check that the event is still open for RSVPs and that you are logged in. Past events cannot be RSVP'd to. |
| Training records not created from event | The event must have a linked Training Session that has been finalized and approved. |
| Minutes not showing attendees | If creating minutes from an event, attendees are imported from check-in records, not RSVPs. Ensure members checked in. |
| "Already voted" error | Each member can only vote once per election. This is by design. |
| Election results not visible | The election creator controls when results are visible. Results may be hidden until the voting period ends. |
| Candidates not showing in ballot preview | Fixed in March 2026 — ballot items from templates were missing the `position` field for candidate matching. Pull latest and rebuild. |
| Ballot builder only shows one candidate per position | As of 2026-03-06, one ballot item per position is enforced. Use separate positions for multiple candidate races. |
| Election settings not saving or loading | Fixed in March 2026 — GET/PATCH endpoints returned wrong structure. Pull latest and restart. |
| Event request form not showing outreach types | Add outreach types in **Events > Settings > Outreach Types**. At least one type must be configured. |
| Submitted request not appearing for coordinator | Coordinator needs `events.manage` permission. Check role permissions in Administration. |
| Room double-booking error when scheduling | Another event is already booked at that location and time. Choose a different room or time slot. |
| Email template variables showing as `{{variable}}` | Use double curly braces with no spaces: `{{contact_name}}`. Check supported variable names in email template docs. |
| Cannot cancel from public status page | Only requests in active states (submitted, in_progress, scheduled) can be cancelled. Terminal states cannot be changed. |
| Pipeline tasks not visible to requester | Public progress visibility is off by default. Enable it in **Events > Settings > Request Pipeline > Public Progress Visibility**. |
| Custom event categories not appearing in form | Configure categories in **Events Settings > Custom Event Categories**. Then toggle visibility in **Event Type & Category Visibility** section. |
| Custom categories not showing as filter tabs | Category visibility must be enabled separately — go to Events Settings and enable each custom category under the visibility section. |
| Events Settings page layout changed | As of 2026-03-04, the Events Settings page uses a sidebar + content panel layout (matching Organization Settings) instead of collapsible sections. Desktop shows a sidebar with section descriptions; mobile uses horizontal scrollable tabs. As of 2026-03-12, the settings tab is further refactored into 6 focused section components. |
| EventRequestStatusPage colors look wrong in light mode | Fixed in March 2026 — hardcoded colors replaced with theme-aware CSS variables. Pull latest and rebuild. |
| Email templates missing CC/BCC fields | As of 2026-03-04, each email template now supports configurable CC/BCC addresses. Run the latest migration and restart. |
| Members show 0 hours despite checking in | As of 2026-03-06, use **Finalize Attendance** from the event detail "More" menu to calculate duration for members who checked in but didn't check out. Auto-triggers when recording actual end time. |
| Past events not visible to regular members | As of 2026-03-06, all users can toggle between Upcoming and Past events. Previously past events were only accessible via the admin hub. |
| Facility rooms not in event location picker | As of 2026-03-06, facility rooms auto-create linked Location records. Existing rooms get locations on next update. |
| QR check-in window shows "N/A" | Fixed 2026-03-12 — backend was returning bare date/time strings instead of ISO 8601 format. Pull latest and restart. |
| QR check-in times showing in wrong timezone | Fixed 2026-03-12 — QR data now includes `organizationTimezone` for local time display. Self check-in falls back to browser timezone if missing. |
| Recurring event dates seem wrong | Monthly-by-weekday events with "5th week" fall back to last occurrence. Annual Feb 29 events shift to Feb 28 in non-leap years. These are expected behaviors. |
| Custom categories sent as strings cause 422 | Fixed 2026-03-12 — schema now accepts objects (`{id, label, color}`). Existing string-format categories auto-migrate on next save. |
| Settings changes not persisting | Fixed 2026-03-12 — SQLAlchemy JSON column shallow copy issue. Pull latest to get `deepcopy()` fix. |
| Event form sending empty strings causes 422 | Fixed 2026-03-12 — `??` replaced with `||` for all optional form fields to coerce empty strings to `undefined`. |
| Calendar view not showing events | Ensure events exist for the displayed month. Use the navigation arrows to check other months. Events are filtered by the currently selected event type filter. |
| Analytics page shows no data | Verify `analytics.view` permission is assigned to your role. Analytics require at least one event to have been created. Use the date range filter to widen the search window. |
| Template picker shows no templates | No active templates exist. Create a template from **Events > Templates** or save an existing event as a template. Deactivated templates are hidden. |
| Waitlist not promoting attendees | Promotion occurs automatically when a "Going" member changes to "Not Going". Check that the event has a capacity limit set. |
| CSV import skipping rows | Rows missing required fields (title, date) are skipped. Check the error details in the import preview for specific validation failures. |
| Draft event visible to regular members | Verify the event was saved as a draft, not published. Only users with `events.manage` permission can see drafts. |
| Non-respondent reminder sent to someone who already RSVP'd | This should not happen — reminders exclude all members who have responded (going, not going, or maybe). If it occurs, refresh the RSVP data and retry. *(fixed 2026-03-13)* |
| Conflict detection false positive | Conflict detection checks time + location overlap. Events at different locations at the same time are not flagged. The warning is advisory — you can proceed with creation. |
| Recurrence exception not restoring | Deleting a recurrence exception should restore the occurrence. If the occurrence doesn't reappear, check the series management view for the full series timeline. *(added 2026-03-13)* |
| Check-in modal shows error or blank | The eligible-members endpoint was missing prior to 2026-03-15. Pull latest and restart. The modal now also has correct z-index stacking. |
| Recurring event creation crashes | Fixed 2026-03-15 — certain recurrence patterns generating dates beyond the series end date caused a crash. Pull latest. |
| Series end reminder not received | Reminders are sent 7 days before the last occurrence. If the series has already ended, no reminder is sent. Verify the series has a defined end date. |
| Event times show wrong in edit form | Fixed 2026-03-15 — the time extraction function was returning UTC instead of local time. Shift/event edit forms now use `Intl.DateTimeFormat` with the user's timezone. |
| Conflict detection false negative near midnight | Fixed 2026-03-15 — conflict detection now uses timezone-aware date arithmetic. Events spanning midnight in the org's timezone are correctly identified. |
| In-app event notifications not appearing | Fixed 2026-03-17 — event notifications now deliver via in-app notifications in addition to email. Check the notification bell icon. |
| Time picker allows non-quarter-hour values | Fixed 2026-03-17 — all time pickers now enforce 15-minute increments (`:00`, `:15`, `:30`, `:45`). |
| Valid check-in rejected as "outside window" | Fixed 2026-03-17 — QR display and self-check-in pages were using different datetime sources for the check-in window. Now consistent. |
| Event times display incorrectly across timezones | Fixed 2026-03-16 — all event response schemas now stamp naive datetimes with UTC timezone markers via `UTCResponseBase`. |
| Election ballot emails sent but 0 recipients | Fixed 2026-03-19 — `User.is_active` converted to `hybrid_property` for SQLAlchemy query compatibility. Added per-recipient exception handling. |
| Election error messages unhelpful | Fixed 2026-03-19 — error messages now include actionable details (e.g., "Election has no candidates"). |
| Election results not arriving by email | Use the new **Send Report Email** button on the election detail page to email formatted results. Added 2026-03-19. |
| Ballot sending skips voters without explanation | The secretary now receives an eligibility summary email after ballot dispatch listing all skipped voters with reasons. Added 2026-03-19. |

---

## Event Notifications — In-App Delivery (2026-03-17)

Event notifications now deliver via **in-app notifications** in addition to email. When a coordinator sends a notification from the event detail page (announcement, reminder, follow-up, missed_event, or check_in_confirmation), targeted members receive the notification in their notification bell.

> **Screenshot needed:**
> _[Screenshot of the notification bell dropdown showing an event notification entry (e.g., "Reminder: Monthly Business Meeting tomorrow at 7 PM") alongside other notification types]_

## Time Picker Standardization (2026-03-17)

All time pickers across the application now enforce **15-minute increments** (`:00`, `:15`, `:30`, `:45`). This applies to event creation/editing, shift creation, and scheduling forms, consistent with the `DateTimeQuarterHour` component introduced in the training module.

> **Edge case:** Pre-existing events with non-quarter-hour times (e.g., `:07`, `:42`) retain their stored values. The constraint applies only on the next edit — the time picker will round to the nearest quarter-hour.

## Elections — Hardening & Email Improvements (2026-03-19)

### Ballot Sending Reliability

The ballot email dispatch system has been significantly hardened:

1. **Root cause fix**: `User.is_active` was a Python property, invisible to SQLAlchemy queries. Converted to `hybrid_property` so active user filtering works in database queries
2. **Per-recipient exception handling**: If one email fails, the loop continues sending to remaining recipients instead of aborting
3. **Diagnostic logging**: When no recipients are found, detailed logs explain why (no email address, ineligible, already voted)
4. **Eligibility summary email**: The secretary who dispatched ballots receives a summary listing all skipped voters with actionable reasons

> **Screenshot needed:**
> _[Screenshot of the election detail page showing the "Send Ballots" button and, after sending, the eligibility summary showing "Sent: 45, Skipped: 3" with expandable reasons for skipped voters]_

### Election Report Email

Officers can email election results as a formatted report directly from the election detail page using the **Send Report Email** button.

> **Screenshot needed:**
> _[Screenshot of the election detail page with the "Send Report Email" button visible in the actions area, and the report email preview showing round-by-round results]_

### Upcoming Business Meetings

The election detail page now shows a section listing **upcoming business meetings** that the election can be linked to for procedural compliance.

> **Screenshot needed:**
> _[Screenshot of the election detail page showing the "Upcoming Business Meetings" section with a list of upcoming meetings and "Link" buttons]_

### Edge Cases — Elections (2026-03-19)

| Scenario | Behavior |
|----------|----------|
| Voter with no email address | Skipped in ballot dispatch; listed in eligibility summary |
| One email fails in batch | Per-recipient handling; other recipients still receive |
| Cross-tenant proxy authorization | Blocked by organization_id filter — returns 404 |
| Rollback history not saving | Fixed — uses `copy.deepcopy()` before appending |
| Election with only ballot items | Can be opened without candidates |
| Concurrent vote attempts | Database-level locking prevents race conditions |

---

## Recurring Event Enhancements (2026-03-22)

### Rolling 12-Month Recurrence

Recurring events can now use a **rolling 12-month window** that automatically extends the series forward. Instead of defining a fixed end date, the system continuously generates occurrences up to 12 months ahead, ensuring future events are always available for RSVP and scheduling.

To enable rolling recurrence:
1. Create or edit a recurring event
2. Select "Rolling (12 months)" as the recurrence end option
3. The system generates occurrences up to 12 months from today and auto-refreshes the window

> **Screenshot needed:**
> _[Screenshot of the recurring event form showing the "Rolling (12 months)" option selected in the recurrence end date area, with a note explaining that the system will auto-generate future occurrences]_

> **Edge case:** Rolling recurrence with a monthly-by-weekday pattern (e.g., "2nd Tuesday") generates all occurrences correctly, including months where the weekday pattern falls on the last week.

### Delete Series

Officers can now delete an entire recurring event series at once:
1. Navigate to any event in the series
2. Click **More > Delete Series**
3. A confirmation dialog shows the total number of events that will be removed
4. Confirm to delete all events in the series (past and future)

> **Screenshot needed:**
> _[Screenshot of the delete series confirmation dialog showing "This will permanently delete 24 events in this series. This action cannot be undone." with Cancel and Delete buttons]_

> **Edge case:** Deleting a series removes all events including past ones. If you need to keep historical records, use "Delete Future Events" instead to preserve past occurrences.

### "End Event" — Bulk Checkout

The new **End Event** button on the event detail page checks out all currently checked-in attendees at once. This is useful for events where individual checkout tracking isn't needed (e.g., meetings, training sessions).

1. Navigate to the event detail page during or after an event
2. Click **End Event** in the actions area
3. Confirm the bulk checkout
4. All checked-in attendees are marked as checked out with the current timestamp

> **Screenshot needed:**
> _[Screenshot of the event detail page showing the "End Event" button in the action area, with a tooltip explaining "Check out all attendees at once"]_

> **Edge case:** If no attendees are currently checked in, the button shows an informational message ("No attendees to check out") and performs no action.

### Compact Event Create Form

The event creation form has been redesigned with a **2-column grid layout**:
- Left column: Title, type, category, description
- Right column: Date, time, location, settings
- Settings and recurrence sections pair side-by-side

This reduces scrolling significantly on desktop while remaining single-column on mobile.

> **Screenshot needed:**
> _[Screenshot of the redesigned event creation form showing the 2-column layout with the title and type fields on the left, date/time fields on the right, and the recurrence section below spanning both columns]_

### Event-to-Admin-Hours Integration

Events can now be linked to administrative hour tracking categories, automatically crediting attendance hours toward compliance requirements.

**Setting up the integration:**
1. Navigate to **Events Settings > Hour Tracking**
2. Map event types to admin hour categories (e.g., "Business Meeting" → "Administrative Hours")
3. Set compliance requirements (e.g., "4 hours per quarter")

When members attend events with configured mappings, their attendance hours are automatically credited.

> **Screenshot needed:**
> _[Screenshot of the Events Settings > Hour Tracking section showing a mapping table with event types on the left, admin hour categories on the right, and a "Requirements" section below with compliance thresholds]_

> **Edge case:** If no mapping is configured for an event type, attendance is not credited to admin hours. The mapping must be explicitly set up in Events Settings.

---

## Notification Enhancements (2026-03-22)

### Dashboard Notification Management

Dashboard notification cards now include **clear** and **dismiss** buttons, allowing you to manage notifications without navigating to the full Notifications page.

- **Dismiss**: Hides the notification from your dashboard (personal action, doesn't affect others)
- **Clear**: Marks the notification as read

> **Screenshot needed:**
> _[Screenshot of the Dashboard notifications section showing notification cards with dismiss (X) and clear (checkmark) buttons on each card]_

### Persistent Department Messages

Administrators can create department-wide messages that persist for all members until explicitly cleared by an admin:

1. Navigate to **Notifications** (admin)
2. Click **Create Department Message**
3. Enter the message content and mark it as **Persistent**
4. The message appears for all department members until an admin clears it

> **Screenshot needed:**
> _[Screenshot of a persistent department message on the Dashboard showing the message content with an admin-only "Clear for All" button, and no dismiss button for regular members]_

> **Edge case:** Non-admin users cannot dismiss persistent messages — the dismiss button is not shown. Only users with admin permissions see the "Clear for All" action.

### Notification Channel Filter

The Notifications page now includes a **channel filter** to view notifications by delivery method:
- **All** — Shows all notifications
- **Email** — Only email-delivered notifications
- **In-App** — Only in-app notifications
- **SMS** — Only SMS notifications (when Twilio is enabled)

> **Screenshot needed:**
> _[Screenshot of the Notifications page showing the channel filter tabs (All, Email, In-App, SMS) at the top, with the In-App filter active showing only in-app notification entries]_

---

## Email Deliverability Improvements (2026-03-22)

Email delivery has been significantly improved for compatibility with Gmail, Microsoft Outlook, and other major providers:

- **Message-ID header**: All outgoing emails include proper Message-ID headers, satisfying DKIM/SPF authentication
- **Batch rate limiting**: Large recipient lists are rate-limited to avoid bulk-send throttles
- **Inline CSS**: All styles are inlined directly on HTML elements (Gmail strips `<style>` tags)
- **SMTP connection reuse**: Connections reused within batches for better performance
- **Logo hosting**: Organization logos use hosted URLs instead of base64 data URIs, preventing Gmail from clipping emails

> **Edge case:** If the logo image URL is not accessible (e.g., server behind VPN), emails fall back to a text-only header with the organization name.

---

## Elections — Eligibility & Email (2026-03-22)

### Voter Eligibility Correction

Voter eligibility now correctly uses `User.membership_type` instead of role slugs. This means:

- A member with role "EMT" but membership_type "administrative" is **not** eligible for "operational" ballot items
- A member with membership_type "active" **is** eligible for operational items regardless of their assigned roles
- See the [Elections Voter Eligibility](#elections-and-voting) section above for the full eligibility matrix

> **Screenshot needed:**
> _[Screenshot of the election detail page showing voter eligibility breakdown — listing eligible membership types and the count of members in each type]_

### Ballot Email Improvements

- **Per-recipient error handling**: If one ballot email fails, remaining recipients still receive their ballots
- **Eligibility summary email**: The secretary who dispatched ballots receives a summary listing all sent and skipped voters with reasons (no email address, ineligible, already voted)
- **Election report email**: New "Send Report Email" button emails formatted round-by-round results

> **Screenshot needed:**
> _[Screenshot of the eligibility summary showing "Sent: 45 ballots, Skipped: 3 voters" with expandable reasons — "John Smith: no email address", "Jane Doe: membership type not eligible"]_

### Election Meeting Integration

The election detail page now shows **upcoming business meetings** in a dedicated section, making it easy to link elections to meeting records for procedural compliance.

> **Screenshot needed:**
> _[Screenshot of the election detail page "Upcoming Business Meetings" section showing a list of upcoming meetings with dates and "Link to Election" buttons]_

| Troubleshooting | Solution |
|-----------------|----------|
| Ballot emails sent but 0 recipients | Fixed 2026-03-22 — eligibility now uses `membership_type`. Check that members have the correct membership type and email addresses. |
| Election error messages are generic | Fixed 2026-03-22 — errors now include specific guidance. |
| Can't find report email button | Look for "Send Report Email" in the election detail page actions area. |

---

**Previous:** [Shifts & Scheduling](./03-scheduling.md) | **Next:** [Inventory Management](./05-inventory.md)
