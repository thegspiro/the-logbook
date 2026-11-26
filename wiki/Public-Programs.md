# Public Programs — How-To Guide

This guide walks through setting up and managing public outreach programs using The Logbook's Event Request Pipeline. It includes step-by-step instructions, sample program configurations, and ready-to-use email templates.

---

## Table of Contents

1. [Overview](#overview)
2. [Initial Setup](#initial-setup)
3. [Sample Programs](#sample-programs)
4. [Email Template Library](#email-template-library)
5. [Tips & Best Practices](#tips--best-practices)

---

## Overview

The Public Outreach Request Pipeline lets community members request events from your department — fire safety demos, station tours, school visits, CPR classes, and more. The pipeline handles the full lifecycle from public submission to event completion.

**How the flow works:**

```
Community Member              Your Department
─────────────────            ─────────────────
Fills out public form   →   Request arrives, coordinator auto-assigned
                             Coordinator reviews & starts working
                             Completes pipeline tasks (approval, volunteers, etc.)
                             Schedules event (date + room booking)
Checks status page      ←   Status updates visible to requester
Attends event           →   Coordinator marks complete
```

**Key concepts:**

| Concept             | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| **Outreach Types**  | Categories of programs your department offers (configurable per department)        |
| **Pipeline Tasks**  | Custom checklist steps for each request (reorderable, department-defined)          |
| **Email Triggers**  | Automatic notifications on status changes (toggleable per trigger)                 |
| **Email Templates** | Reusable email messages with template variables (e.g., directions, what-to-expect) |
| **Status Page**     | Public, token-based page where requesters check their request status               |

---

## Initial Setup

### Step 1: Configure Outreach Types

Navigate to **Events Admin > Settings > Public Requests > Types & roles** (the **Request Types** card).

Add the program types your department offers: type a **Type Name** — the display name shown to the public (e.g., "Fire Safety Demonstration") — and press **Add**. The lowercase key (e.g., `fire_safety_demo`) is made from the name for you.

**Recommended starter types for fire departments:**

| Key                      | Label                                 |
| ------------------------ | ------------------------------------- |
| `fire_safety_demo`       | Fire Safety Demonstration             |
| `station_tour`           | Station Tour                          |
| `school_visit`           | School Visit / Classroom Presentation |
| `cpr_first_aid`          | CPR / First Aid Class                 |
| `smoke_detector_install` | Smoke Detector Installation           |
| `open_house`             | Community Open House                  |
| `safety_talk`            | Safety Talk / Lecture                 |
| `career_day`             | Career Day Presentation               |
| `community_event`        | Community Event Support               |

### Step 2: Set Up Pipeline Tasks

Navigate to **Events Admin > Settings > Public Requests > Handling**, under **Request Checklist**.

Pipeline tasks are the checklist steps your coordinator follows for each request. Use the up/down arrows to set the order.

**Recommended base tasks:**

1. Review request and confirm date availability
2. Chief/President approval
3. Email volunteer signup to department
4. Confirm minimum volunteer count
5. Prepare equipment and materials
6. Send confirmation/directions email to requester
7. Day-before reminder to volunteers and requester

> **Tip**: Tasks are shared across all outreach types. Keep them general enough to apply to most programs. Type-specific notes can go in comments.

**Some steps tick themselves** _(2026-11-22)_. Four of the built-in steps follow the request instead of waiting for a coordinator: **Review Request** ticks once work on the request starts, **Assign Coordinator** while someone is assigned, **Confirm Date** once the event is scheduled, and **Arrange Volunteers** when every seat on the request's volunteer signup sheet is filled. Each unticks if that is undone — a postponed request loses **Confirm Date**, a volunteer dropping out unticks **Arrange Volunteers** — and none can be ticked by hand. Keep them in your list if you want the requester's progress to move on its own; a step you add yourself, like the ones above, is always ticked by hand. Without a signup sheet, **Arrange Volunteers** is a manual step too.

### Step 3: Assign a Default Coordinator

Navigate to **Events Admin > Settings > Public Requests > Handling > Default Coordinator**.

Select the member who should be auto-assigned all incoming requests. Members are listed as name and rank (for example "Jordan Avery — Firefighter"). This is typically:

- The member holding the **Community Outreach Manager** position (or your department's public education officer)
- A **Lieutenant** or **Captain** responsible for public programs
- The **Chief** (for smaller departments)

The coordinator receives an email notification whenever a new request arrives.

Only current members (active or probationary) are offered. If the default coordinator later leaves the department, they stay selected, marked "(former member)", but new requests are left **unassigned** rather than given to them, so they still show in the queue for anyone to pick up. Choose a current member to have requests assigned again.

### Step 4: Configure Email Triggers

Navigate to **Events Admin > Settings > Public Requests > Emails**, under **Automatic Emails**.

Each status change can automatically send an email. Configure:

| Trigger           | Notify Requester | Notify Coordinator |                  Recommended                  |
| ----------------- | :--------------: | :----------------: | :-------------------------------------------: |
| On Submitted      |       Yes        |        Yes         | On — confirms receipt and alerts coordinator  |
| On In Progress    |       Yes        |         —          | On — tells requester someone is working on it |
| On Scheduled      |       Yes        |         —          |         On — includes confirmed date          |
| On Postponed      |       Yes        |         —          |            On — explains the delay            |
| On Completed      |       Yes        |         —          |          On — thank you / follow-up           |
| On Declined       |       Yes        |         —          |              On — with a reason               |
| On Cancelled      |       Yes        |         —          |          On — confirms cancellation           |
| Days Before Event |       Yes        |        Yes         |         On — 7 days and 1 day before          |

### Step 5: Create the Public Form

The easiest route is **Events Admin > Settings > Public Requests > Request form >
Generate Event Request Form**. It creates a ready-made form that already accepts submissions
without an account, in Draft status — open it in **Forms**, adjust the fields
if you like, and press **Publish Form**.

To build one yourself in **Forms** instead:

1. Create the form and add its fields
2. Press **Share**, switch on **Public Access**, and tick **Allow submissions
   without signing in** — without it, a member of the public can open the form
   but is refused when they press Submit ("Authentication is required to submit
   this form.")
3. Add the **Event Request** integration (**Integrations**)
4. Press **Publish Form**

The public address is `https://your-domain.com/f/<code>`, where the code is a
12-character code the form is given when it is created; **Share** shows the
full link.

> **Tip**: Add the form link to your department website's "Community Programs" or "Request an Event" page. You can also generate a QR code for print materials.

### Step 6 (optional): Ask Requesters for Feedback

_(2026-11-23)_ Once a request is marked **Completed**, its status page can ask
the requester how the visit went, and the built-in Completed email links to
it. Under **Events Admin > Settings > Public Requests > Handling**, find
**Feedback From Requesters**: choose a published form as the **Feedback form**,
or press **Create the starter feedback form** (a 1 to 5 rating, **What went
well?**, and **What could we do better?** shown at a rating of 3 or less), and
choose the **Rating question**. Each requester answers once. Answers appear on
the request under **Requester feedback**, and **Outreach Impact** shows the
average rating and how many responded. A template you attached to the
Completed trigger yourself carries the link only if you put
`{{feedback_link}}` or `{{feedback_url}}` in it _(2026-11-26; before, it could
not carry the link at all)_ — see
[Email Template Library](#email-template-library).
_(2026-11-24)_ Each answer emails the request's coordinator (or the
**Default Coordinator**, or failing both every member who manages events) and
puts a notice in their bell; a rating of 3 or less out of 5 starts the subject
with **Low rating:**. Reword it, or turn it off for the department, under
**Requester Feedback Received** in **Email Templates**. See
[Events & Meetings → Feedback from requesters](https://github.com/thegspiro/the-logbook/blob/main/docs/training/04-events-meetings.md#feedback-from-requesters).

---

## Sample Programs

### Fire Safety Demonstration

**What it is**: Live fire extinguisher training and kitchen fire safety demonstration for community groups. Typically 45-60 minutes with hands-on participation.

**Typical audience**: Corporate offices, senior living communities, school staff, community centers, church groups.

**What the department provides**:

- 2-3 firefighters/volunteers
- Burn pan and propane (for live extinguisher training)
- Practice fire extinguishers (one per 5-8 participants)
- PPE for demonstrators
- Handouts: kitchen fire safety, escape planning, smoke alarm placement

**What the requester provides**:

- Outdoor space approximately 20×20 feet (parking lot, field)
- Access to a power outlet (for presentation, if indoors portion)
- Closed-toe shoes for all participants

**Pipeline tasks** (customize as needed):

1. Review request and confirm date availability
2. Chief/President approval
3. Email volunteer signup to department — need 2-3 volunteers
4. Confirm burn pan availability and propane level
5. Prep equipment checklist (extinguishers, pan, PPE, handouts)
6. Send confirmation email with what-to-expect details
7. Send directions email (if at station) or confirm venue address
8. Day-before reminder to volunteers and requester

---

### Station Tour

**What it is**: Guided tour of the fire station including apparatus bay, equipment overview, and meet-the-crew. 30-45 minutes.

**Typical audience**: Scout troops (earning fire safety badge), daycare/preschool groups, birthday party groups, school field trips, senior community outings.

**What the department provides**:

- 1-2 tour guides (on-duty crew or assigned volunteers)
- Kid-friendly equipment to try on (helmet, child-size turnout coat)
- Station areas: apparatus bay, kitchen/living area, dispatch, equipment room
- Junior firefighter stickers/badges (for kids)

**What the requester provides**:

- Adult chaperones (1 per 5-8 children)
- Group stays together during tour
- Understanding that tour may be interrupted by emergency calls

**Pipeline tasks**:

1. Review request — confirm group size and age range
2. Check station availability (not during training or maintenance days)
3. Assign tour guide — preferably someone great with the audience age group
4. Confirm with on-duty crew
5. Prep station (clean bay, stage kid-friendly equipment)
6. Send directions and parking information email
7. Day-before reminder

> **Important note for the confirmation email**: Always mention that active emergency calls take priority and the tour may be briefly paused or rescheduled mid-visit.

---

### School Visit / Classroom Presentation

**What it is**: Age-appropriate fire safety education at the school, including stop-drop-roll, escape planning, 911 education, and optional apparatus display outside.

**Typical audience**: Elementary schools (K-5), after-school programs, Head Start programs.

**What the department provides**:

- 1-2 presenters
- Age-appropriate materials:
  - **K-2**: Coloring books, "Sparky" take-home sheets, stickers
  - **3-5**: Activity worksheets, escape plan templates, fire safety quiz
- Optional: Fire engine/truck for outdoor display
- Presenter in uniform (kids respond well to seeing the gear)

**What the school provides**:

- Gym, cafeteria, or outdoor area for presentation
- Power outlet for projector (if indoors)
- Student count per session
- School staff member present during presentation
- Any accessibility notes (sensory sensitivities to sirens, mobility needs)

**Pipeline tasks**:

1. Review request — confirm school, grade levels, number of students
2. Chief/President approval
3. Coordinate with school administration (point of contact, schedule, building access)
4. Assign presenter(s) and optional apparatus driver
5. Email volunteer signup to department
6. Prepare age-appropriate materials (based on grade level)
7. Confirm apparatus availability if bringing engine/truck
8. Send confirmation to school contact with arrival time and setup needs
9. Day-before reminder

---

### CPR / First Aid Class

**What it is**: Hands-on CPR and basic first aid class for community members, usually 2-3 hours. May include AED training and optional certification.

**Typical audience**: Community groups, youth organizations (Explorer posts, Scouts), corporate teams, parent groups, coaches and lifeguards.

**What the department provides**:

- Certified CPR instructor(s)
- CPR manikins (1 per 3 participants recommended)
- AED trainers
- Certification cards (if offering official certification — verify with your certifying body)
- Participant handouts and reference cards

**What the requester provides**:

- Room with tables and chairs (or the department can host at the station)
- Confirmed participant list (max 12 per instructor)
- Participants wearing comfortable clothing (kneeling required)

**Pipeline tasks**:

1. Review request — confirm group size (max 12 per instructor)
2. Verify instructor certifications are current
3. Chief/President approval
4. Assign certified instructor(s) and assistants
5. Calculate equipment needs (manikins, AED trainers, supplies)
6. Email volunteer signup for assistant instructors
7. Order certification cards if offering official certification
8. Send pre-class information email (what to wear, what to bring, location)
9. Day-before confirmation to requester and instructors

---

### Smoke Detector Installation Program

**What it is**: Free smoke detector installation and battery replacement for residents, especially seniors and low-income households.

**Typical audience**: Individual homeowners, neighborhood associations, senior communities, housing authorities, social service referrals.

**What the department provides**:

- Installation team (minimum 2 members per home visit)
- Smoke detectors (10-year sealed lithium battery recommended)
- Replacement batteries for existing detectors
- Mounting hardware and tools
- Fire safety information handouts

**What the requester provides**:

- Access to the home and permission to install
- An adult present during installation

**Pipeline tasks**:

1. Review request — confirm address and number of homes
2. Verify smoke detector inventory (request from supply if needed)
3. Assign installation team (minimum 2 members)
4. Schedule route if multiple homes in same area
5. Confirm with homeowner(s) — day, time, and access needs
6. Complete installation and record detector serial numbers
7. Send follow-up email with maintenance reminders (test monthly, replace after 10 years)

**Recording what was installed** _(2026-11-23)_: log each home visit under
**Events → CRR Activities → Log a CRR activity**, choosing **Smoke alarm
install** and filling in its counts (alarms installed, homes), the ZIP code,
and who took part — each member's minutes go to Admin Hours. Resident details
are optional, encrypted, seen only by the Community Outreach Manager, the
chiefs and the president, and cleared after your retention period (24 months
by default). The installs then appear by activity, risk, priority population
and ZIP code on **Outreach Impact**. See
[Events & Meetings → CRR Activities](https://github.com/thegspiro/the-logbook/blob/main/docs/training/04-events-meetings.md#crr-activities).

---

### Community Open House / Recruitment Event

**What it is**: Department open house with apparatus display, equipment demonstrations, recruitment information, and family-friendly activities.

**Typical audience**: General public, potential recruits, families, neighborhood.

**What the department provides**:

- Full department participation
- Apparatus display (static, with walk-around access)
- Equipment demonstrations (jaws of life, hose operation, etc.)
- Recruitment materials and applications
- Family activities (helmet try-on, hose spraying, coloring station)
- Food and refreshments (optional — may need budget approval)

**Pipeline tasks**:

1. Select date and obtain Chief/President approval
2. Form planning committee (assign committee lead)
3. Email department — request volunteers and activity ideas
4. Book apparatus for static display (coordinate with neighboring departments if mutual aid needed)
5. Coordinate food/refreshments (donations, budget approval, or potluck)
6. Prepare recruitment materials and applications
7. Create promotional flyer and social media posts
8. Send press release to local media (newspaper, community calendar, radio)
9. Set up and assign volunteer stations day-of
10. Post-event follow-up: collect and organize contact info from interested recruits

---

## Email Template Library

Below are ready-to-use email templates. Copy these into **Events Admin > Settings > Public Requests > Emails**, under **Email Templates**, and customize for your department.

> **Available variables:** `{{contact_name}}`, `{{outreach_type}}`,
> `{{organization_name}}` and `{{event_date}}` (in the department's timezone,
> or "TBD"). `{{organization_name}}` is the **requester's** organization — the
> school or group typed on the request, blank if none — not your department, so
> the templates below sign off with a literal `[Your Department]` for you to
> replace. `{{organization_logo_img}}` is also accepted but renders nothing,
> because the email header already carries the logo. For a **Completed**
> request, `{{feedback_link}}` adds a sentence inviting feedback with the link,
> and `{{feedback_url}}` the bare link _(2026-11-26)_; both stay empty unless a
> feedback form is set under **Handling** and the requester has not answered
> yet, so a template can carry them always. Variables are filled in the
> subject, the HTML body and, since 2026-11-26, the plain-text body too (before,
> the plain-text part reached the requester with its placeholders unreplaced,
> and an officer's per-send additions skipped it). Nothing else is filled in —
> an unknown variable reaches the requester literally. In particular there is **no status-link variable**, and
> no email sends the requester their status page. To give them one, press
> **Copy status link** on the request (Events Admin > Community Outreach > Outreach Requests) and paste the address
> into your message yourself.

### Template: Request Received Confirmation

**Trigger**: `on_submitted`

**Subject**: We Received Your Event Request — {{outreach_type}}

**Body**:

```
Dear {{contact_name}},

Thank you for reaching out to [Your Department]! We've received your request
for a {{outreach_type}} and a coordinator has been assigned.

Here's what happens next:
1. Our coordinator will review your request within [X] business days
2. We'll reach out to confirm date, time, and logistics

If you need to make changes or cancel, reply to this email.

Thank you for thinking of us!

[Your Department]
```

### Template: Event Scheduled Confirmation

**Trigger**: `on_scheduled`

**Subject**: Your {{outreach_type}} is Confirmed — {{event_date}}

**Body**:

```
Dear {{contact_name}},

Great news! Your {{outreach_type}} has been confirmed:

  Date: {{event_date}}
  Location: [To be filled by coordinator]

We'll send a reminder [X] days before the event with final details.

We're looking forward to it!

[Your Department]
```

### Template: How to Find Our Building (Directions)

**Trigger**: Manual send (or `days_before_event`, 7 days)

**Subject**: Directions to [Your Department] — Your Visit on {{event_date}}

**Body**:

```
Dear {{contact_name}},

We're looking forward to your visit! Here's everything you need to know:

ADDRESS:
  [Your station address]

PARKING:
  [Free parking in the rear lot / street parking on Main St / etc.]
  Please do not block the apparatus bay doors (the large red doors).

ENTRANCE:
  Enter through the [front / side] door. A crew member will meet your group.

WHAT TO EXPECT:
  - Duration: approximately [X] minutes
  - Restrooms are available inside
  - [Add any program-specific details]

IMPORTANT:
  If we receive an emergency call during your visit, our crew will need to
  respond immediately. A backup member will continue your program, or we'll
  reschedule the remaining portion.

Questions? Reply to this email or call [phone number].

See you on {{event_date}}!

[Your Department]
```

### Template: Day-Before Reminder

**Trigger**: `days_before_event`, 1 day

**Subject**: Reminder: Your {{outreach_type}} is Tomorrow!

**Body**:

```
Dear {{contact_name}},

Just a friendly reminder that your {{outreach_type}} is tomorrow,
{{event_date}}.

Please remember:
  - [Program-specific reminders, e.g., "wear closed-toe shoes"]
  - Arrive [X] minutes early for setup
  - Contact us at [phone] if you need to make last-minute changes

We look forward to seeing you!

[Your Department]
```

### Template: Event Postponed Notification

**Trigger**: `on_postponed`

**Subject**: Your {{outreach_type}} Has Been Postponed

**Body**:

```
Dear {{contact_name}},

We regret to inform you that your {{outreach_type}} has been postponed.

[If new date set]:
A tentative new date has been set: {{event_date}}. We will confirm
the details with you as we get closer.

[If no new date]:
We are working on scheduling a new date and will be in touch as soon
as one is available.

We apologize for any inconvenience. If you have questions or need to
cancel, reply to this email.

[Your Department]
```

### Template: Thank You / Post-Event Follow-Up

**Trigger**: `on_completed`

**Subject**: Thank You! — {{outreach_type}} Follow-Up

**Body**:

```
Dear {{contact_name}},

Thank you for hosting [Your Department] for your {{outreach_type}}!
We hope the program was valuable for your group.

Here are some follow-up resources:
  - [Fire safety tips PDF link]
  - [Smoke alarm information]
  - [Link to your department website]

If you'd like to schedule another program in the future, you can submit
a new request at: [your public form URL]

We'd also appreciate any feedback — it helps us improve our community
programs. {{feedback_link}}

Thank you for your commitment to safety!

[Your Department]
```

---

## Tips & Best Practices

### For Coordinators

- **Respond within 48 hours** — A prompt response builds community trust. Even if you can't confirm a date yet, acknowledge the request.
- **Use comments for coordination** — Keep internal notes in the comment thread so anyone who takes over can see the full context.
- **Front-load approvals** — Put "Chief Approval" early in the pipeline so you don't do prep work that gets blocked later.
- **Batch similar requests** — If you get multiple school visit requests, try to schedule them in the same week to reduce setup time.
- **Copy the status link** — No email sends the requester their status page. Press **Copy status link** on the request and paste it into a message to them so they can self-serve.

### For Department Administrators

- **Start simple** — You don't need all program types on day one. Start with your 2-3 most common requests and add more as needed.
- **Review templates quarterly** — Update email templates with current addresses, phone numbers, and seasonal information.
- **Track metrics** — **Community Outreach > Outreach Impact** reports requests received and completed, people reached and member hours for any period; the **Overview** page shows what is waiting on you now. _(2026-11-24)_ **Events Admin > Settings > Outreach Goals** sets yearly targets for events held, people reached, member hours or any CRR count, and both pages show whether each is on pace.
- **Mark the roles you can do without** — _(2026-11-23)_ untick **Essential** on a role in a type's preset or on the request's sheet (a second greeter, say). The request's staffing badge then turns green once the essential roles are filled, while **Arrange Volunteers** still waits for every seat.
- **Volunteer time counts as outreach** — _(2026-11-24)_ members who check in on a request's signup sheet are credited through the event to the Admin Hours category its type maps to, not as shift hours. Also watch average time to schedule. This data helps justify volunteer coordinator positions.
- **Delegate** — If one coordinator is overwhelmed, reassign requests to other qualified members.

### For Public Forms

- **Prominent placement** — Add the request form link to your website header/footer, "Community" page, and social media bios.
- **QR code on print** — Generate a QR code for the form URL and include it on department brochures, station flyers, and vehicle decals.
- **Set expectations** — On your website, mention the typical lead time (e.g., "Please submit requests at least 3 weeks in advance").

---

**See also:** [Events Module](Module-Events) | [Forms Module](https://github.com/thegspiro/the-logbook/blob/main/docs/FORMS_MODULE.md) | [Troubleshooting](Troubleshooting)
