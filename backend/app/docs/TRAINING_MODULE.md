# Training Module - Backend Documentation

## Overview

The Training Module backend provides a comprehensive RESTful API for managing training programs, requirements, enrollments, and progress tracking. It follows a layered architecture with clear separation of concerns.

## Architecture

```
├── models/          # SQLAlchemy ORM models
│   └── training.py  # All training-related models
├── schemas/         # Pydantic request/response schemas
│   ├── training.py
│   └── training_program.py
├── services/        # Business logic layer
│   ├── training_session_service.py
│   └── training_program_service.py
├── api/v1/endpoints/  # API route handlers
│   ├── training.py
│   ├── training_sessions.py
│   └── training_programs.py
└── data/registries/   # Registry seed data
    ├── nfpa_requirements.json
    ├── nremt_requirements.json
    └── proboard_requirements.json
```

## Models

### TrainingCourse
Basic training course catalog.

**Fields:**
- `name`: Course name
- `code`: Course code (optional)
- `training_type`: Type of training
- `duration_hours`: Expected duration
- `credit_hours`: Credit hours awarded
- `prerequisites`: Array of prerequisite course IDs
- `expiration_months`: Certification expiration period

### TrainingRecord
Individual member training history.

**Fields:**
- `user_id`: Member who completed training
- `course_id`: Reference to course (optional)
- `course_name`: Course name
- `completion_date`: When completed
- `expiration_date`: When certification expires
- `hours_completed`: Hours completed
- `status`: scheduled | in_progress | completed | cancelled | failed
- `score`: Test score (optional)
- `passed`: Pass/fail status

### TrainingRequirement
Requirements that members must complete.

**Fields:**
- `name`: Requirement name
- `requirement_type`: hours | courses | certification | shifts | calls | skills_evaluation | checklist
- `source`: department | state | national
- `registry_name`: e.g., "NFPA", "NREMT"
- `registry_code`: e.g., "NFPA 1001"
- `is_editable`: Can training officer modify?
- `required_hours`: For hours-based requirements
- `required_shifts`: For shift-based requirements
- `required_calls`: For call-based requirements
- `required_skills`: For skills evaluations (JSONB)
- `checklist_items`: For checklist requirements (JSONB)
- `frequency`: annual | biannual | quarterly | monthly | one_time
- `time_limit_days`: Days to complete from enrollment
- `required_positions`: Array of positions this applies to

### TrainingProgram
Structured training pathways.

**Fields:**
- `name`: Program name
- `version`: Version number for tracking duplicates
- `target_position`: probationary | firefighter | driver_candidate | officer | aic
- `structure_type`: flexible | sequential | phases
- `prerequisite_program_ids`: Programs that must be completed first (JSONB)
- `allows_concurrent_enrollment`: Can member be in multiple programs?
- `time_limit_days`: Overall deadline
- `warning_days_before`: Send warning X days before deadline
- `reminder_conditions`: Conditional reminder rules (JSONB)
- `is_template`: Can be used as template

### ProgramPhase
Phases within a program.

**Fields:**
- `program_id`: Parent program
- `phase_number`: Order in program
- `name`: Phase name
- `prerequisite_phase_ids`: Phases that must be completed first (JSONB)
- `requires_manual_advancement`: Officer must approve advancement
- `time_limit_days`: Phase-specific deadline

### ProgramRequirement
Links requirements to programs/phases.

**Fields:**
- `program_id`: Parent program
- `phase_id`: Parent phase (null if program-level)
- `requirement_id`: The requirement
- `is_required`: Required vs. optional
- `is_prerequisite`: Must complete before other requirements
- `sort_order`: Display order
- `program_specific_description`: Override requirement description
- `custom_deadline_days`: Override requirement time_limit_days
- `notification_message`: Custom message when assigned

### ProgramMilestone
Checkpoints within programs.

**Fields:**
- `program_id`: Parent program
- `phase_id`: Parent phase (null if program-level)
- `name`: Milestone name
- `completion_percentage_threshold`: Trigger at X% (e.g., 50.0)
- `notification_message`: Message to display when reached
- `requires_verification`: Officer must verify

### ProgramEnrollment
Tracks member participation in programs.

**Fields:**
- `user_id`: Enrolled member
- `program_id`: The program
- `enrolled_at`: Enrollment timestamp
- `target_completion_date`: Expected completion
- `current_phase_id`: Current phase (for phase-based programs)
- `progress_percentage`: Overall completion percentage
- `status`: active | completed | on_hold | withdrawn | failed
- `completed_at`: Completion timestamp
- `deadline_warning_sent`: Has warning been sent?

### RequirementProgress
Tracks progress on individual requirements.

**Fields:**
- `enrollment_id`: Parent enrollment
- `requirement_id`: The requirement
- `status`: not_started | in_progress | completed | waived
- `progress_value`: Hours, shifts, calls, etc. completed
- `progress_percentage`: Calculated percentage
- `progress_notes`: Historical notes (JSONB)
- `started_at`: When work began
- `completed_at`: When finished
- `verified_by`: Officer who verified
- `verified_at`: Verification timestamp

### SkillEvaluation & SkillCheckoff
Skills assessment framework.

**SkillEvaluation:**
- `name`: Skill name
- `category`: Firefighting, EMS, Driver, Officer
- `evaluation_criteria`: Criteria definition (JSONB)
- `passing_requirements`: Pass/fail criteria
- `required_for_programs`: Programs requiring this skill (JSONB)

**SkillCheckoff:**
- `user_id`: Member being evaluated
- `skill_evaluation_id`: The skill
- `evaluator_id`: Officer doing evaluation
- `status`: pending | passed | failed | needs_retest
- `evaluation_results`: Results data (JSONB)
- `evaluated_at`: Evaluation timestamp

### Shift Models (Framework Only)
Placeholder for future shift module.

**Shift:**
- `shift_date`, `start_time`, `end_time`
- `apparatus_id`, `station_id`
- `shift_officer_id`
- `activities`: What happened during shift (JSONB)

**ShiftAttendance:**
- `shift_id`, `user_id`
- `checked_in_at`, `checked_out_at`
- `duration_minutes`

**ShiftCall:**
- `shift_id`, `incident_number`, `incident_type`
- `cancelled_en_route`, `medical_refusal`
- `responding_members`: Who responded (JSONB)

## Services

### TrainingProgramService

Main business logic for training programs.

#### Requirement Methods

```python
async def create_training_requirement(
    requirement_data: TrainingRequirementEnhancedCreate,
    organization_id: UUID,
    created_by: UUID
) -> Tuple[Optional[TrainingRequirement], Optional[str]]
```

```python
async def get_requirements(
    organization_id: UUID,
    source: Optional[str] = None,
    registry_name: Optional[str] = None,
    requirement_type: Optional[str] = None,
    position: Optional[str] = None
) -> List[TrainingRequirement]
```

```python
async def update_training_requirement(
    requirement_id: UUID,
    organization_id: UUID,
    updates: Dict[str, Any]
) -> Tuple[Optional[TrainingRequirement], Optional[str]]
```

#### Program Methods

```python
async def create_training_program(
    program_data: TrainingProgramCreate,
    organization_id: UUID,
    created_by: UUID
) -> Tuple[Optional[TrainingProgram], Optional[str]]
```

```python
async def get_program_by_id(
    program_id: UUID,
    organization_id: UUID,
    include_phases: bool = False,
    include_requirements: bool = False
) -> Optional[TrainingProgram]
```

```python
async def duplicate_program(
    source_program_id: UUID,
    new_name: str,
    organization_id: UUID,
    created_by: UUID,
    increment_version: bool = True
) -> Tuple[Optional[TrainingProgram], Optional[str]]
```

**Duplication Logic:**
1. Copies program with all fields
2. Increments version number
3. Creates new phases with mapped IDs
4. Copies all phase requirements
5. Copies all milestones
6. Updates prerequisite_phase_ids to new IDs
7. Returns independent copy

#### Enrollment Methods

```python
async def enroll_member(
    enrollment_data: ProgramEnrollmentCreate,
    organization_id: UUID,
    enrolled_by: Optional[UUID] = None
) -> Tuple[Optional[ProgramEnrollment], Optional[str]]
```

**Enrollment Logic:**
1. Validates program exists
2. Checks prerequisite programs completed
3. Checks concurrent enrollment restrictions
4. Calculates target completion date
5. Determines initial phase (for phase-based)
6. Creates enrollment
7. Creates RequirementProgress for all requirements

```python
async def bulk_enroll_members(
    program_id: UUID,
    user_ids: List[UUID],
    organization_id: UUID,
    target_completion_date: Optional[date] = None,
    enrolled_by: Optional[UUID] = None
) -> Tuple[List[ProgramEnrollment], List[str]]
```

**Bulk Enrollment Logic:**
1. Validates program exists
2. Checks prerequisites for each member
3. Checks concurrent enrollment for each member
4. Enrolls valid members
5. Returns success list and error list

#### Progress Methods

```python
async def update_requirement_progress(
    progress_id: UUID,
    organization_id: UUID,
    updates: RequirementProgressUpdate,
    verified_by: Optional[UUID] = None
) -> Tuple[Optional[RequirementProgress], Optional[str]]
```

**Progress Calculation:**
1. Updates status and progress_value
2. Calculates progress_percentage based on requirement type:
   - Hours: `(completed_hours / required_hours) * 100`
   - Shifts: `(completed_shifts / required_shifts) * 100`
   - Calls: `(completed_calls / required_calls) * 100`
3. Auto-completes at 100%
4. Triggers `_recalculate_enrollment_progress()`

```python
async def _recalculate_enrollment_progress(
    enrollment_id: UUID
) -> None
```

**Enrollment Progress Calculation:**
1. Gets all required requirement progress
2. Calculates average percentage
3. Updates enrollment.progress_percentage
4. Auto-completes enrollment at 100%

#### Registry Methods

```python
async def import_registry_requirements(
    registry_file_path: str,
    organization_id: UUID,
    created_by: UUID,
    skip_existing: bool = True
) -> Tuple[int, List[str]]
```

**Import Logic:**
1. Loads JSON file
2. Checks for existing requirements (if skip_existing)
3. Creates new requirements
4. Returns count and errors

## API Endpoints

### Requirements

```
GET    /api/v1/training/programs/requirements
POST   /api/v1/training/programs/requirements
GET    /api/v1/training/programs/requirements/{id}
PATCH  /api/v1/training/programs/requirements/{id}
POST   /api/v1/training/programs/requirements/import/{registry_name}
```

### Programs

```
GET    /api/v1/training/programs/programs
POST   /api/v1/training/programs/programs
GET    /api/v1/training/programs/programs/{id}
POST   /api/v1/training/programs/programs/{id}/duplicate
```

### Phases

```
GET    /api/v1/training/programs/programs/{id}/phases
POST   /api/v1/training/programs/programs/{id}/phases
```

### Program Requirements

```
GET    /api/v1/training/programs/programs/{id}/requirements
POST   /api/v1/training/programs/programs/{id}/requirements
```

### Milestones

```
POST   /api/v1/training/programs/programs/{id}/milestones
```

### Enrollments

```
POST   /api/v1/training/programs/enrollments
GET    /api/v1/training/programs/enrollments/me
GET    /api/v1/training/programs/enrollments/user/{userId}
GET    /api/v1/training/programs/enrollments/{id}
POST   /api/v1/training/programs/programs/{id}/bulk-enroll
```

### Progress

```
PATCH  /api/v1/training/programs/progress/{id}
```

## Database Migrations

### Initial Training System
**File:** `20260122_0015_add_training_programs_and_requirements.py`

Creates:
- Enums for requirement types, sources, program structures
- training_requirements table (enhanced)
- training_programs table
- program_phases table
- program_requirements table
- program_milestones table
- program_enrollments table
- requirement_progress table
- skill_evaluations table
- skill_checkoffs table
- shifts table (framework)
- shift_attendance table (framework)
- shift_calls table (framework)

### Enhanced Features
**File:** `20260122_0030_add_enhanced_training_program_features.py`

Adds:
- `version` to training_programs
- `prerequisite_program_ids` to training_programs
- `allows_concurrent_enrollment` to training_programs
- `reminder_conditions` to training_programs
- `requires_manual_advancement` to program_phases
- `program_specific_description` to program_requirements
- `custom_deadline_days` to program_requirements
- `notification_message` to program_requirements
- `notification_message` to program_milestones
- Renames `is_mandatory` to `is_required`
- Renames `order` to `sort_order`
- Adds `is_prerequisite` to program_requirements

## Registry Data Files

### NFPA Requirements
**File:** `backend/app/data/registries/nfpa_requirements.json`

Contains 7 NFPA standards:
- NFPA 1001: Firefighter I & II
- NFPA 1002: Driver/Operator
- NFPA 1021: Fire Officer I-IV
- NFPA 1041: Fire Service Instructor
- NFPA 1403: Live Fire Training
- NFPA 1500: Fire Department Safety
- NFPA 1582: Medical Fitness

### NREMT Requirements
**File:** `backend/app/data/registries/nremt_requirements.json`

Contains 8 NREMT certifications:
- EMR, EMT, AEMT, Paramedic
- CPR/BLS, ACLS, PALS, PHTLS

### Pro Board Requirements
**File:** `backend/app/data/registries/proboard_requirements.json`

Contains 8 Pro Board certifications:
- Firefighter I & II
- Driver/Operator Pumper & Aerial
- Fire Officer I & II
- HazMat Operations
- Instructor I

## Testing

### Unit Tests
Test individual service methods:

```python
async def test_create_program():
    service = TrainingProgramService(db)
    program, error = await service.create_training_program(
        program_data=mock_program_data,
        organization_id=org_id,
        created_by=user_id
    )
    assert error is None
    assert program is not None
    assert program.version == 1
```

### Integration Tests
Test full workflows:

```python
async def test_enroll_with_prerequisites():
    # Create prereq program
    prereq_program = await create_program()

    # Create main program with prerequisite
    main_program = await create_program_with_prereq(prereq_program.id)

    # Try to enroll without completing prereq - should fail
    enrollment, error = await service.enroll_member(...)
    assert error is not None

    # Complete prereq
    await complete_program(prereq_program.id, user_id)

    # Try again - should succeed
    enrollment, error = await service.enroll_member(...)
    assert error is None
```

## Error Handling

### Common Error Cases

**Prerequisite Not Met:**
```json
{
  "detail": "User has not completed prerequisite program"
}
```

**Concurrent Enrollment Violation:**
```json
{
  "detail": "User is already enrolled in another program. This program does not allow concurrent enrollment."
}
```

**Non-Editable Requirement:**
```json
{
  "detail": "This requirement cannot be edited"
}
```

**Invalid Phase Progression:**
```json
{
  "detail": "Phase 2 already exists for this program"
}
```

## Performance Considerations

### Query Optimization

**Use selectinload for relationships:**
```python
query = select(TrainingProgram).options(
    selectinload(TrainingProgram.phases)
    .selectinload(ProgramPhase.requirements)
)
```

**Batch operations:**
```python
# Good: Single query for all enrollments
enrollments = await bulk_enroll_members(program_id, user_ids)

# Bad: Loop with individual queries
for user_id in user_ids:
    await enroll_member(user_id, program_id)
```

### Caching

Consider caching for:
- Registry requirements (rarely change)
- Program details (moderate change frequency)
- Enrollment lists (frequent updates)

### Background Jobs

Recommended for:
- Deadline reminder emails
- Progress recalculation for large programs
- Batch imports from registries

## Security

### Permissions Required

**Training Officer:**
- `training.manage`: Create/edit programs and requirements
- `training.view_all`: View all member progress

**Member:**
- `training.view`: View own progress
- `training.update`: Update own progress (if self-reporting enabled)

### Data Validation

All inputs validated with Pydantic schemas:
- Required fields enforced
- Type checking automatic
- Range validation (e.g., `ge=0` for hours)
- Custom validators for business rules

### SQL Injection Prevention

Using SQLAlchemy ORM:
- Parameterized queries automatic
- No raw SQL execution
- Safe from injection attacks

---

*Last Updated: January 22, 2026*
