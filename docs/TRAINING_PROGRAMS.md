# Training Programs Module

## Overview

The Training Programs module provides a comprehensive system for managing member training requirements, programs, and progress tracking. It supports multiple requirement types, phase-based progression, and integration with national/state training registries.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [User Roles](#user-roles)
3. [Features](#features)
4. [Training Categories](#training-categories)
5. [Training Requirements](#training-requirements)
6. [Due Date Types](#due-date-types)
7. [Training Programs](#training-programs)
8. [Enrollment & Progress](#enrollment--progress)
9. [Member Experience](#member-experience)
10. [Training Officer Workflow](#training-officer-workflow)
11. [API Reference](#api-reference)
12. [Database Schema](#database-schema)

---

## Core Concepts

### Training Requirements

Training requirements are individual training items that members must complete. They can be:
- **Hours-based**: Require a certain number of training hours
- **Course-based**: Require completion of specific courses
- **Certification-based**: Require obtaining certifications
- **Shift-based**: Require completing a number of shifts
- **Call-based**: Require responding to a number of calls
- **Skills evaluation**: Require demonstrating specific skills
- **Checklist**: Require completing a checklist of tasks

### Training Programs

Training programs are structured pathways that group requirements together. Programs can be:
- **Flexible**: Requirements can be completed in any order
- **Sequential**: Requirements must be completed in a specific order
- **Phase-based**: Requirements are organized into phases with prerequisites

### Enrollment

Members are enrolled in training programs to track their progress toward completion. Enrollments track:
- Current phase (for phase-based programs)
- Overall progress percentage
- Completion status
- Target completion date
- Deadline warnings

---

## User Roles

### Training Officer
- Create and manage training programs
- Set up requirements from registries or custom
- Enroll members in programs
- Monitor member progress
- Approve manual phase advancements
- Verify completed requirements

### Member
- View assigned training programs
- Track progress on requirements
- See next steps and upcoming deadlines
- View completed vs. pending requirements
- Receive notifications for milestones and deadlines

---

## Features

### ✅ Implemented Features

#### Registry Integration
- **NFPA Standards**: Firefighter I/II, Driver/Operator, Fire Officer, Instructor, Live Fire, Safety, Medical Fitness
- **NREMT Certifications**: EMR, EMT, AEMT, Paramedic, CPR/BLS, ACLS, PALS, PHTLS
- **Pro Board**: Firefighter I/II, Driver/Operator, Fire Officer I/II, HazMat Ops, Instructor
- One-click import of registry requirements
- Department can customize imported requirements

#### Template System
- Save programs as reusable templates
- Duplicate templates with version tracking
- Independent copies for customization
- Version numbering (e.g., "Probationary Program v2")

#### Program Prerequisites
- Set prerequisite programs (e.g., must complete "Recruit School" before "Driver Candidate")
- Automatic validation during enrollment
- Prevents enrollment if prerequisites not met

#### Enrollment Controls
- Concurrent enrollment restrictions (one program at a time, or multiple allowed)
- Bulk member enrollment with validation
- Custom target completion dates
- Enrollment notes

#### Phase Management
- Multi-phase program structures
- Phase prerequisites
- Manual vs. automatic advancement
- Phase-specific time limits

#### Progress Tracking
- Real-time progress calculation
- Completion percentage tracking
- Requirement-level progress
- Verification by training officers
- Progress notes and history

#### Milestone System
- Define completion milestones (e.g., 25%, 50%, 75%)
- Milestone notifications
- Officer verification requirements

#### Conditional Reminders
- Send reminders based on progress thresholds
- Configure days before deadline
- Only send if member is behind schedule (e.g., only remind if < 40% complete 90 days before deadline)

#### Member Dashboard Widget
- Shows top 3 active programs on dashboard
- Visual progress bars
- Next steps displayed
- Upcoming deadline warnings
- Click-through to detailed progress page

---

## Training Categories

Training categories provide a hierarchical way to organize training courses and requirements. Categories help training officers group related training topics and allow requirements to be satisfied by any training within specified categories.

### Category Features

- **Hierarchical Structure**: Categories can have parent-child relationships for nested organization
- **Visual Customization**: Each category can have a color and icon for easy identification in the UI
- **Flexible Assignment**: Courses and requirements can belong to multiple categories
- **Category-Based Requirements**: Requirements can accept training from any course in specified categories

### Example Category Structure

```
🔥 Firefighting
   ├── Structural Firefighting
   ├── Wildland Firefighting
   └── Fire Prevention/Investigation

🏥 Emergency Medical Services
   ├── Basic Life Support (BLS)
   ├── Advanced Life Support (ALS)
   └── Pediatric/Specialty Care

☢️ Hazardous Materials
   ├── Awareness Level
   ├── Operations Level
   └── Technician Level

🚒 Apparatus Operations
   ├── Pumper Operations
   ├── Aerial Operations
   └── Specialized Vehicles
```

### Creating Categories

1. Navigate to **Training** → **Requirements** tab
2. Click the **Categories** section
3. Click **Add Category**
4. Fill in category details:
   - **Name**: Display name for the category
   - **Code**: Short code (e.g., "FF", "EMS", "HAZ")
   - **Description**: Detailed description
   - **Color**: Hex color for UI display
   - **Icon**: Icon identifier
   - **Parent Category**: For nested categories (optional)
   - **Sort Order**: Display order within parent

### Using Categories with Requirements

When creating a requirement, you can specify which categories satisfy the requirement:

```
Requirement: Annual Fire Training (24 hours)
Categories: Firefighting, Apparatus Operations

→ Any training hours logged in courses belonging to "Firefighting"
  or "Apparatus Operations" categories count toward this requirement
```

This allows flexible tracking where members can complete various courses that all contribute to meeting a single requirement.

---

## Due Date Types

Training requirements support flexible due date calculations to match different organizational needs. The system supports four due date types:

### 1. Calendar Period (Default)

Training is due by the end of a specified calendar period. This is ideal for annual requirements that align with calendar or fiscal years.

**Configuration:**
- `period_start_month`: Month when the period starts (1-12)
- `period_start_day`: Day when the period starts (1-31)

**Examples:**

| Use Case | Start Month | Start Day | Due Date |
|----------|-------------|-----------|----------|
| Calendar Year | January (1) | 1 | December 31 |
| Fiscal Year (July-June) | July (7) | 1 | June 30 |
| Academic Year (Sept-Aug) | September (9) | 1 | August 31 |
| Q1 Deadline | January (1) | 1 | March 31 |

**How it works:**
- If current date is before the period start, due date is end of current period
- If current date is after period start, due date is end of next period
- Completion resets the cycle for the next period

### 2. Rolling

Training is due X months from the date of last completion. This is ideal for certifications that must be renewed at regular intervals regardless of when they were obtained.

**Configuration:**
- `rolling_period_months`: Number of months between required completions

**Examples:**

| Certification | Rolling Period | If Completed Jan 15, 2026 |
|--------------|----------------|---------------------------|
| CPR/BLS | 24 months | Due: Jan 15, 2028 |
| ACLS | 24 months | Due: Jan 15, 2028 |
| Annual Physical | 12 months | Due: Jan 15, 2027 |
| Quarterly Drill | 3 months | Due: Apr 15, 2026 |

**How it works:**
- Due date = Last completion date + Rolling period months
- If never completed, due date is immediate (or based on enrollment date)
- Each completion resets the countdown from the new completion date

### 3. Certification Period

Training is due when the associated certification expires. This ties the requirement directly to an external certification's validity period.

**Use Cases:**
- EMT certification renewal
- Paramedic license renewal
- State firefighter certification
- CDL medical card renewal

**How it works:**
- Due date matches the expiration date of the linked certification
- When certification is renewed, due date automatically updates
- Useful for requirements that must match external regulatory timelines

### 4. Fixed Date

Training is due by a specific, unchanging date. This is ideal for one-time requirements or requirements with hard external deadlines.

**Use Cases:**
- Grant-mandated training deadlines
- New regulation compliance dates
- Probationary period milestones
- Specific event preparation

**How it works:**
- Due date is set once and does not change
- Typically used for non-recurring requirements

### Choosing the Right Due Date Type

| Scenario | Recommended Type | Why |
|----------|------------------|-----|
| "Complete 24 hours by year end" | Calendar Period | Aligns with reporting cycles |
| "Recertify CPR every 2 years" | Rolling | Based on individual completion dates |
| "Keep EMT cert current" | Certification Period | Matches external cert expiration |
| "Complete by grant deadline" | Fixed Date | Hard external deadline |
| "Quarterly training drills" | Calendar Period | Recurring calendar-based |
| "Physical fitness test annually" | Rolling | Individual anniversary dates |

---

## Training Requirements

### Requirement Types

#### 1. Hours-Based Requirements
Track cumulative training hours.

```json
{
  "requirement_type": "hours",
  "required_hours": 100,
  "due_date_type": "calendar_period",
  "period_start_month": 1,
  "period_start_day": 1,
  "category_ids": ["firefighting-uuid", "ems-uuid"]
}
```

**With Rolling Due Date:**
```json
{
  "requirement_type": "hours",
  "required_hours": 24,
  "due_date_type": "rolling",
  "rolling_period_months": 12
}
```

#### 2. Course-Based Requirements
Require completion of specific courses.

```json
{
  "requirement_type": "courses",
  "required_courses": [
    {"course_id": "uuid", "name": "Firefighter I"}
  ]
}
```

#### 3. Certification Requirements
Require obtaining certifications.

```json
{
  "requirement_type": "certification",
  "required_certifications": ["CPR", "EMT"],
  "due_date_type": "certification_period"
}
```

**With Rolling Recertification:**
```json
{
  "requirement_type": "certification",
  "required_certifications": ["CPR"],
  "due_date_type": "rolling",
  "rolling_period_months": 24,
  "category_ids": ["bls-uuid"]
}
```

#### 4. Shift Requirements
Require completing a number of shifts.

```json
{
  "requirement_type": "shifts",
  "required_shifts": 24,
  "time_limit_days": 180
}
```

#### 5. Call Requirements
Require responding to calls/incidents.

```json
{
  "requirement_type": "calls",
  "required_calls": 50,
  "required_call_types": ["structure_fire", "ems", "mva"]
}
```

#### 6. Skills Evaluation
Require demonstrating skills with officer evaluation.

```json
{
  "requirement_type": "skills_evaluation",
  "required_skills": [
    {"skill_id": "uuid", "name": "SCBA Donning"}
  ]
}
```

#### 7. Checklist Requirements
Require completing a checklist of tasks.

```json
{
  "requirement_type": "checklist",
  "checklist_items": [
    "Complete station tour",
    "Review SOPs",
    "Equipment familiarization"
  ]
}
```

### Requirement Sources

- **Department**: Custom requirements created by the training officer
- **State**: State-mandated requirements
- **National**: National registry requirements (NFPA, NREMT, Pro Board)

### Customizing Registry Requirements

Registry requirements are editable by default. Training officers can:
- Modify time limits
- Add program-specific descriptions
- Set custom deadlines
- Add prerequisite flags
- Change sort order

---

## Training Programs

### Program Structure Types

#### Flexible Programs
Members can complete requirements in any order.

**Use case**: Annual continuing education requirements

#### Sequential Programs
Requirements must be completed in order.

**Use case**: Progressive skill development programs

#### Phase-Based Programs
Requirements organized into phases with prerequisites.

**Use case**: Probationary firefighter program (Orientation → Skills → Certification)

### Creating a Program

```typescript
const program = {
  name: "Probationary Firefighter Program",
  description: "Complete training path for probationary members",
  target_position: "probationary",
  structure_type: "phases",
  time_limit_days: 365,
  warning_days_before: 30,
  prerequisite_program_ids: [], // No prerequisites for entry-level
  allows_concurrent_enrollment: false, // Only one at a time
  reminder_conditions: {
    milestone_threshold: 50,
    days_before_deadline: 90,
    send_if_below_percentage: 40
  }
};
```

### Adding Phases

```typescript
const phase1 = {
  program_id: programId,
  phase_number: 1,
  name: "Orientation",
  description: "Initial orientation and safety training",
  prerequisite_phase_ids: [],
  requires_manual_advancement: false, // Auto-advance when complete
  time_limit_days: 30
};

const phase2 = {
  program_id: programId,
  phase_number: 2,
  name: "Skills Development",
  description: "Hands-on skills training and evaluation",
  prerequisite_phase_ids: [phase1.id],
  requires_manual_advancement: true, // Officer must approve
  time_limit_days: 180
};
```

### Adding Requirements to Program

```typescript
const programRequirement = {
  program_id: programId,
  phase_id: phase1Id, // Or null for program-level
  requirement_id: requirementId,
  is_required: true,
  is_prerequisite: false,
  sort_order: 1,
  program_specific_description: "Complete within first 30 days",
  custom_deadline_days: 30,
  notification_message: "Welcome! Please complete orientation materials."
};
```

### Adding Milestones

```typescript
const milestone = {
  program_id: programId,
  phase_id: null, // Program-level milestone
  name: "Halfway Point",
  description: "Completed 50% of requirements",
  completion_percentage_threshold: 50,
  notification_message: "Great progress! You're halfway through the program.",
  requires_verification: false
};
```

---

## Enrollment & Progress

### Enrolling Members

#### Single Enrollment

```typescript
const enrollment = {
  user_id: memberId,
  program_id: programId,
  target_completion_date: "2026-12-31",
  notes: "Started as probationary member on Jan 22, 2026"
};
```

#### Bulk Enrollment

```typescript
const bulkEnrollment = {
  user_ids: [memberId1, memberId2, memberId3],
  target_completion_date: "2026-12-31"
};

const response = await api.post(
  `/training/programs/programs/${programId}/bulk-enroll`,
  bulkEnrollment
);

// Response includes success count and any errors
console.log(`Enrolled ${response.success_count} members`);
console.log(`Errors: ${response.errors}`);
```

### Tracking Progress

Progress is automatically calculated based on:
- Completed requirements vs. total required
- Progress percentage for each requirement
- Phase completion status

```typescript
const progress = {
  enrollment_id: enrollmentId,
  requirement_id: requirementId,
  status: "in_progress", // not_started, in_progress, completed, waived
  progress_value: 45, // e.g., 45 hours, 45 shifts, etc.
  progress_percentage: 45, // Calculated automatically
  progress_notes: {
    "2026-01-22": "Completed 8 hours of training",
    "2026-01-29": "Completed additional 12 hours"
  }
};
```

### Manual Phase Advancement

For phases with `requires_manual_advancement: true`, training officers must manually advance members:

1. Officer reviews member's completed requirements
2. Officer verifies skill competency
3. Officer approves advancement to next phase
4. System automatically moves member to next phase

---

## Member Experience

### Dashboard Widget

Members see a training progress widget on their dashboard showing:
- Top 3 active programs
- Progress percentage with color-coded bars
- Next 1-2 steps/requirements
- Upcoming deadline warnings
- Click-through to detailed view

### Detailed Progress View

The full progress page shows:
- All enrolled programs
- Overall progress percentage
- Time remaining to deadline
- Current phase (for phase-based programs)
- All requirements grouped by phase
- Individual requirement progress bars
- Completed vs. pending status
- Next milestones
- Behind schedule warnings

### Next Steps Logic

**Flexible Programs**: Shows any incomplete required requirements

**Sequential Programs**: Shows the next requirement in sequence

**Phase-Based Programs**: Shows incomplete requirements in current phase

### Deadline Warnings

- **Green** (90+ days): On track
- **Yellow** (30-89 days): Attention needed
- **Red** (< 30 days): Urgent

---

## Training Officer Workflow

### 1. Set Up Categories (Optional but Recommended)

Categories help organize your training and allow flexible requirement satisfaction.

1. Navigate to **Training** → **Requirements** tab
2. Click **Manage Categories**
3. Create your category hierarchy:
   - Start with top-level categories (Firefighting, EMS, HazMat)
   - Add sub-categories as needed
   - Assign colors and icons for visual identification
4. Categories can be assigned to courses and requirements

### 2. Set Up Requirements

#### Option A: Import from Registry
1. Navigate to Training Programs → Requirements tab
2. Click "Import NFPA", "Import NREMT", or "Import Pro Board"
3. System imports standard requirements
4. Customize as needed (including due date types)

#### Option B: Create Custom Requirement
1. Click "Create Requirement"
2. Fill in details:
   - Name and description
   - Requirement type (hours, shifts, etc.)
   - Source (department)
   - **Due Date Type** (Calendar Period, Rolling, Certification Period, or Fixed Date)
   - **Due Date Configuration**:
     - For Calendar Period: Set period start month and day
     - For Rolling: Set rolling period in months
   - **Categories** (optional): Select categories that satisfy this requirement
   - Applicability (positions/roles)

#### Option C: Use Requirement Templates
1. Click "Use Template" when creating a requirement
2. Choose from common requirement templates:
   - **Annual Fire Training** (24 hrs, calendar period)
   - **CPR/BLS Certification** (rolling, 24 months)
   - **Hazmat Awareness** (one-time certification)
   - **Monthly Drills** (calendar period, monthly)
3. Customize the template values as needed

### 2. Create Training Program

#### Option A: Create from Scratch
1. Navigate to Training Programs → Programs tab
2. Click "New Program"
3. Fill in program details:
   - Name and description
   - Target position
   - Structure type
   - Time limits
   - Prerequisite programs
   - Concurrent enrollment settings

#### Option B: Duplicate from Template
1. Find existing template/program
2. Click "Duplicate"
3. Enter new name
4. System creates independent copy with version increment

### 3. Configure Program Structure

#### For Phase-Based Programs:
1. Add phases in order
2. Set prerequisites for each phase
3. Configure manual advancement if needed
4. Add requirements to each phase
5. Set phase-specific time limits

#### For All Programs:
1. Add requirements to program
2. Set requirement order/priority
3. Add custom descriptions
4. Configure deadlines
5. Set up milestones

### 4. Enroll Members

#### Single Enrollment:
1. Navigate to program
2. Click "Enroll Member"
3. Select member
4. Set target completion date
5. Add notes

#### Bulk Enrollment:
1. Navigate to program
2. Click "Bulk Enroll"
3. Select multiple members
4. Set target completion date
5. System validates prerequisites
6. System checks concurrent enrollment restrictions
7. View success/error report

### 5. Monitor Progress

#### Program-Level View:
- Number of enrolled members
- Average completion percentage
- Members behind schedule
- Upcoming deadlines

#### Member-Level View:
- Individual progress percentage
- Completed requirements
- Pending requirements
- Time remaining
- Next steps

### 6. Verify & Approve

#### Verify Completions:
1. Review submitted requirement completions
2. Check supporting documentation
3. Verify or request corrections
4. Add verification notes

#### Approve Phase Advancements:
1. Review phase completion
2. Evaluate readiness for next phase
3. Approve or request additional training
4. Member automatically advances

---

## API Reference

### Programs

#### Create Program
```http
POST /api/v1/training/programs/programs
Content-Type: application/json

{
  "name": "Program Name",
  "description": "Description",
  "structure_type": "phases",
  "time_limit_days": 365,
  "prerequisite_program_ids": ["uuid"],
  "allows_concurrent_enrollment": false
}
```

#### Get Program Details
```http
GET /api/v1/training/programs/programs/{programId}
```

#### Duplicate Program
```http
POST /api/v1/training/programs/programs/{programId}/duplicate?new_name=Program%20v2&increment_version=true
```

### Requirements

#### Create Requirement
```http
POST /api/v1/training/programs/requirements
Content-Type: application/json

{
  "name": "Requirement Name",
  "requirement_type": "hours",
  "required_hours": 100,
  "source": "department"
}
```

#### Import Registry
```http
POST /api/v1/training/programs/requirements/import/nfpa?skip_existing=true
```

### Enrollment

#### Enroll Member
```http
POST /api/v1/training/programs/enrollments
Content-Type: application/json

{
  "user_id": "uuid",
  "program_id": "uuid",
  "target_completion_date": "2026-12-31"
}
```

#### Bulk Enroll
```http
POST /api/v1/training/programs/programs/{programId}/bulk-enroll
Content-Type: application/json

{
  "user_ids": ["uuid1", "uuid2"],
  "target_completion_date": "2026-12-31"
}
```

#### Get Member Progress
```http
GET /api/v1/training/programs/enrollments/{enrollmentId}
```

### Progress

#### Update Requirement Progress
```http
PATCH /api/v1/training/programs/progress/{progressId}
Content-Type: application/json

{
  "status": "in_progress",
  "progress_value": 45,
  "progress_notes": {"2026-01-22": "Completed training"}
}
```

---

## Database Schema

### Key Tables

#### `training_categories`
- id, organization_id, name, code
- description, color, icon
- parent_category_id (self-referential for hierarchy)
- sort_order, active
- created_at, updated_at, created_by

#### `training_programs`
- id, organization_id, name, description
- version, code
- target_position, target_roles
- structure_type (flexible, sequential, phases)
- prerequisite_program_ids
- allows_concurrent_enrollment
- time_limit_days, warning_days_before
- reminder_conditions (JSONB)
- is_template, active

#### `program_phases`
- id, program_id, phase_number, name
- prerequisite_phase_ids
- requires_manual_advancement
- time_limit_days

#### `training_requirements`
- id, organization_id, name, description
- requirement_type (hours, courses, shifts, calls, etc.)
- source (department, state, national)
- registry_name, registry_code
- required_hours, required_shifts, required_calls, etc.
- frequency, time_limit_days
- applies_to_all, required_positions, required_roles
- **due_date_type** (calendar_period, rolling, certification_period, fixed_date)
- **rolling_period_months** (for rolling due dates)
- **period_start_month** (1-12, for calendar period)
- **period_start_day** (1-31, for calendar period)
- **category_ids** (JSONB array of category UUIDs)

#### `training_courses`
- id, organization_id, name, code
- training_type, duration_hours, credit_hours
- prerequisites, expiration_months
- **category_ids** (JSONB array of category UUIDs)

#### `program_requirements`
- id, program_id, phase_id, requirement_id
- is_required, is_prerequisite
- sort_order
- program_specific_description
- custom_deadline_days
- notification_message

#### `program_milestones`
- id, program_id, phase_id
- name, description
- completion_percentage_threshold
- notification_message
- requires_verification

#### `program_enrollments`
- id, user_id, program_id
- enrolled_at, target_completion_date
- current_phase_id
- progress_percentage
- status (active, completed, on_hold, withdrawn, failed)
- completed_at, deadline_warning_sent

#### `requirement_progress`
- id, enrollment_id, requirement_id
- status (not_started, in_progress, completed, waived)
- progress_value, progress_percentage
- progress_notes (JSONB)
- started_at, completed_at
- verified_by, verified_at

---

## Best Practices

### For Training Officers

1. **Start with Templates**: Use existing templates and customize rather than starting from scratch
2. **Set Realistic Deadlines**: Give members adequate time to complete requirements
3. **Use Milestones**: Break long programs into milestones for motivation
4. **Monitor Regularly**: Check member progress weekly
5. **Provide Feedback**: Use progress notes to give constructive feedback
6. **Verify Thoroughly**: Don't just check boxes - ensure competency

### For Department Administrators

1. **Import Registries First**: Get standard requirements from national registries
2. **Customize Thoughtfully**: Only modify registry requirements when necessary
3. **Set Prerequisites**: Ensure proper progression through training levels
4. **Bulk Enroll**: Use bulk enrollment for cohorts starting together
5. **Review Reports**: Regularly review program effectiveness
6. **Update Templates**: Keep templates current with changing requirements

### For Members

1. **Check Dashboard Daily**: Stay aware of upcoming deadlines
2. **Complete Prerequisites First**: Focus on prerequisite requirements
3. **Track Progress**: Update your progress regularly
4. **Ask Questions**: Reach out to training officer if unclear
5. **Plan Ahead**: Don't wait until the last minute
6. **Document Everything**: Keep records of completed training

---

## Troubleshooting

### Common Issues

**Q: Member can't enroll in program**
- Check prerequisite program completion
- Verify concurrent enrollment settings
- Ensure program is active

**Q: Progress not updating**
- Verify requirement is linked to program
- Check that progress value matches requirement type
- Ensure officer has verified completion

**Q: Reminder not sent**
- Check reminder_conditions configuration
- Verify member is below threshold percentage
- Check days_before_deadline setting

**Q: Can't advance to next phase**
- Check if phase requires manual advancement
- Verify all prerequisites completed
- Ensure previous phase is 100% complete

### Category Issues

**Q: Category not appearing in dropdown**
- Verify category is marked as active
- Check that category belongs to your organization
- Refresh the page to load latest categories

**Q: Training not counting toward category-based requirement**
- Verify the course is assigned to one of the requirement's categories
- Check that the training record status is "completed"
- Ensure the training date is within the current requirement period

**Q: Can't delete a category**
- Categories with assigned courses or requirements cannot be deleted
- Remove category assignments first, or deactivate the category instead
- Child categories must be removed or reassigned before deleting parent

### Due Date Issues

**Q: Due date showing wrong date for calendar period**
- Verify `period_start_month` and `period_start_day` are set correctly
- Remember: period start defines when the NEW period begins, not when it ends
- Example: January 1 start means due December 31

**Q: Rolling due date not updating after completion**
- Ensure the training record has a `completion_date` set
- Verify the record status is "completed"
- Check that `rolling_period_months` is configured on the requirement

**Q: Member shows compliant but due date is past**
- For rolling requirements, the due date is calculated from last completion
- If never completed, member is immediately non-compliant
- Check if there's a grace period configured

**Q: Calendar period requirement due date is in the past**
- If current date is past the period end, member is non-compliant for the current period
- They need to complete training to become compliant for the next period
- Due date will update to next period after completion

**Q: Certification period requirement has no due date**
- Ensure the member has an associated certification record
- The certification must have an expiration date
- Link the training record to the certification if not auto-linked

---

## Future Enhancements

### Planned Features
- **Shift Module Integration**: Auto-populate shift requirements from shift attendance
- **Training Session Integration**: Auto-populate hours from training sessions
- **Automated Reporting**: Schedule automatic progress reports
- **Email Notifications**: Automated emails for milestones and deadlines
- **Mobile App**: View progress and complete checklist items on mobile
- **Skill Videos**: Embed training videos for skill requirements
- **Digital Signatures**: Sign off on checklist items digitally
- **Analytics Dashboard**: Department-wide training analytics

---

## Support

For questions or issues with the Training Programs module:
- Submit an issue on GitHub: https://github.com/anthropics/the-logbook/issues
- Check the FAQ in the main README
- Contact your department administrator

---

*Last Updated: February 5, 2026*
