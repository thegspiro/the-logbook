# Events & Meetings

The Events module handles department events, attendance tracking with QR code check-in, and event templates. The Meetings and Minutes modules manage formal meeting records, action item tracking, and attendance waivers. The Elections module supports secure, anonymous voting.

---

## Table of Contents

1. [Events Overview](#events-overview)
2. [Viewing and RSVPing to Events](#viewing-and-rsvping-to-events)
3. [QR Code Check-In](#qr-code-check-in)
4. [Creating Events (Officers)](#creating-events-officers)
5. [Event Templates and Recurring Events](#event-templates-and-recurring-events)
6. [Meeting Minutes](#meeting-minutes)
7. [Action Items](#action-items)
8. [Elections and Voting](#elections-and-voting)
9. [Public Outreach Request Pipeline](#public-outreach-request-pipeline)
10. [Troubleshooting](#troubleshooting)

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

You can filter events by type and date range using the controls at the top of the page.

**Past Events:** Officers and managers see a **Past Events** tab to browse historical events with the same filtering and search capabilities.

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
3. Set the recurrence pattern (weekly, bi-weekly, monthly).
4. Set the start and end dates for the series.
5. Each occurrence is created as an individual event that can be modified independently.

> **Screenshot placeholder:**
> _[Screenshot of the recurring event creation form showing the base event settings plus the recurrence pattern selector (weekly/bi-weekly/monthly), weekday selectors, and the series date range]_

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
3. Add **ballot items** (positions, questions, or measures).
4. For each item, add **candidates** and configure options:
   - Allow write-ins
   - Victory condition (plurality, majority, ranked choice)
   - Number of winners
5. Optionally enable **email ballots** for members who cannot access the system.
6. Open the election for voting.

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
| Event request form not showing outreach types | Add outreach types in **Events > Settings > Outreach Types**. At least one type must be configured. |
| Submitted request not appearing for coordinator | Coordinator needs `events.manage` permission. Check role permissions in Administration. |
| Room double-booking error when scheduling | Another event is already booked at that location and time. Choose a different room or time slot. |
| Email template variables showing as `{{variable}}` | Use double curly braces with no spaces: `{{contact_name}}`. Check supported variable names in email template docs. |
| Cannot cancel from public status page | Only requests in active states (submitted, in_progress, scheduled) can be cancelled. Terminal states cannot be changed. |
| Pipeline tasks not visible to requester | Public progress visibility is off by default. Enable it in **Events > Settings > Request Pipeline > Public Progress Visibility**. |

---

**Previous:** [Shifts & Scheduling](./03-scheduling.md) | **Next:** [Inventory Management](./05-inventory.md)
