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

| Concept | Description |
|---------|-------------|
| **Outreach Types** | Categories of programs your department offers (configurable per department) |
| **Pipeline Tasks** | Custom checklist steps for each request (reorderable, department-defined) |
| **Email Triggers** | Automatic notifications on status changes (toggleable per trigger) |
| **Email Templates** | Reusable email messages with template variables (e.g., directions, what-to-expect) |
| **Status Page** | Public, token-based page where requesters check their request status |

---

## Initial Setup

### Step 1: Configure Outreach Types

Navigate to **Events Admin > Settings > Outreach Types**.

Add the program types your department offers. Each type needs:
- **Key**: A lowercase identifier (e.g., `fire_safety_demo`, `station_tour`)
- **Label**: The display name shown to the public (e.g., "Fire Safety Demonstration")

**Recommended starter types for fire departments:**

| Key | Label |
|-----|-------|
| `fire_safety_demo` | Fire Safety Demonstration |
| `station_tour` | Station Tour |
| `school_visit` | School Visit / Classroom Presentation |
| `cpr_first_aid` | CPR / First Aid Class |
| `smoke_detector_install` | Smoke Detector Installation |
| `open_house` | Community Open House |
| `safety_talk` | Safety Talk / Lecture |
| `career_day` | Career Day Presentation |
| `community_event` | Community Event Support |

### Step 2: Set Up Pipeline Tasks

Navigate to **Events Admin > Settings > Request Pipeline > Tasks**.

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

### Step 3: Assign a Default Coordinator

Navigate to **Events Admin > Settings > Request Pipeline > Default Coordinator**.

Select the member who should be auto-assigned all incoming requests. This is typically:
- The **Public Education Officer** or **Community Outreach Coordinator**
- A **Lieutenant** or **Captain** responsible for public programs
- The **Chief** (for smaller departments)

The coordinator receives an email notification whenever a new request arrives.

### Step 4: Configure Email Triggers

Navigate to **Events Admin > Settings > Email Triggers**.

Each status change can automatically send an email. Configure:

| Trigger | Notify Requester | Notify Coordinator | Recommended |
|---------|:---:|:---:|:---:|
| On Submitted | Yes | Yes | On — confirms receipt and alerts coordinator |
| On In Progress | Yes | — | On — tells requester someone is working on it |
| On Scheduled | Yes | — | On — includes confirmed date |
| On Postponed | Yes | — | On — explains the delay |
| On Completed | Yes | — | On — thank you / follow-up |
| On Declined | Yes | — | On — with a reason |
| On Cancelled | Yes | — | On — confirms cancellation |
| Days Before Event | Yes | Yes | On — 7 days and 1 day before |

### Step 5: Create the Public Form

Navigate to **Forms** and create a new form:

1. Set a **public slug** (e.g., `request-event`)
2. Enable **Public Access**
3. Add an **EVENT_REQUEST** integration
4. Share the URL: `https://your-domain.com/f/request-event`

> **Tip**: Add the form link to your department website's "Community Programs" or "Request an Event" page. You can also generate a QR code for print materials.

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

Below are ready-to-use email templates. Copy these into **Events > Settings > Email Templates** and customize for your department.

### Template: Request Received Confirmation

**Trigger**: `on_submitted`

**Subject**: We Received Your Event Request — {{outreach_type}}

**Body**:
```
Dear {{contact_name}},

Thank you for reaching out to {{organization_name}}! We've received your request
for a {{outreach_type}} and a coordinator has been assigned.

Here's what happens next:
1. Our coordinator will review your request within [X] business days
2. We'll reach out to confirm date, time, and logistics
3. You can check your request status anytime at: {{status_link}}

If you need to make changes or cancel, use the status link above.

Thank you for thinking of us!

{{organization_name}}
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

You can always check your request status at: {{status_link}}

We're looking forward to it!

{{organization_name}}
```

### Template: How to Find Our Building (Directions)

**Trigger**: Manual send (or `days_before_event`, 7 days)

**Subject**: Directions to {{organization_name}} — Your Visit on {{event_date}}

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

{{organization_name}}
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

{{organization_name}}
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
cancel, visit your status page: {{status_link}}

{{organization_name}}
```

### Template: Thank You / Post-Event Follow-Up

**Trigger**: `on_completed`

**Subject**: Thank You! — {{outreach_type}} Follow-Up

**Body**:
```
Dear {{contact_name}},

Thank you for hosting {{organization_name}} for your {{outreach_type}}!
We hope the program was valuable for your group.

Here are some follow-up resources:
  - [Fire safety tips PDF link]
  - [Smoke alarm information]
  - [Link to your department website]

If you'd like to schedule another program in the future, you can submit
a new request at: [your public form URL]

We'd also appreciate any feedback! Reply to this email with your thoughts
— it helps us improve our community programs.

Thank you for your commitment to safety!

{{organization_name}}
```

---

## Tips & Best Practices

### For Coordinators

- **Respond within 48 hours** — A prompt response builds community trust. Even if you can't confirm a date yet, acknowledge the request.
- **Use comments for coordination** — Keep internal notes in the comment thread so anyone who takes over can see the full context.
- **Front-load approvals** — Put "Chief Approval" early in the pipeline so you don't do prep work that gets blocked later.
- **Batch similar requests** — If you get multiple school visit requests, try to schedule them in the same week to reduce setup time.
- **Copy the status link** — Share the status link in any external emails so the requester can self-service.

### For Department Administrators

- **Start simple** — You don't need all program types on day one. Start with your 2-3 most common requests and add more as needed.
- **Review templates quarterly** — Update email templates with current addresses, phone numbers, and seasonal information.
- **Track metrics** — Monitor how many requests come in per month, average time to schedule, and completion rates. This data helps justify volunteer coordinator positions.
- **Delegate** — If one coordinator is overwhelmed, reassign requests to other qualified members.

### For Public Forms

- **Prominent placement** — Add the request form link to your website header/footer, "Community" page, and social media bios.
- **QR code on print** — Generate a QR code for the form URL and include it on department brochures, station flyers, and vehicle decals.
- **Set expectations** — On your website, mention the typical lead time (e.g., "Please submit requests at least 3 weeks in advance").

---

**See also:** [Events Module](Module-Events) | [Forms Module](../docs/FORMS_MODULE.md) | [Troubleshooting](Troubleshooting)
