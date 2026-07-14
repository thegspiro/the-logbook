"""
Built-in sample training-program templates.

These are curated, real-world-aligned starting points a training officer can add
to their department with one click. Each is expressed in the exact
``ProgramBuildRequest`` shape the create-pipeline wizard/``build_program`` use,
so instantiating one just replays that atomic build into the caller's org.

They are deliberately generic: requirements are *named* (e.g. "Firefighter I
practical skills evaluation") but do not hard-wire a department's own course,
category, or skill-test IDs — a fresh org has none. After adding a template the
officer links its requirements to their real sessions/categories/tests and
enrolls members. Templates land in the org's Templates tab (``is_template=True``)
as an editable copy the department owns.

Content alignment:
  * Firefighter recruit school -> NFPA 1001 Firefighter I & II, Hazmat
    Awareness/Operations (NFPA 1072), IFSAC/Pro Board certification testing.
  * EMT recruit school -> NREMT / National EMS Education Standards modules
    (Preparatory, Airway, Medical, Trauma, Operations) + clinical/field
    internship + cognitive & psychomotor exams.
  * New-member orientation -> department familiarization + mandatory annual
    compliance (HIPAA, OSHA Bloodborne Pathogens, Hazard Communication,
    harassment prevention) + department-specific onboarding.
"""

from typing import Dict, List

from app.schemas.training_program import (
    ProgramBuildMilestoneInput,
    ProgramBuildPhaseInput,
    ProgramBuildRequirementInput,
    ProgramBuildRequest,
    TrainingProgramCreate,
)

# ---------------------------------------------------------------------------
# 1. Firefighter Recruit School (NFPA 1001 Firefighter I & II)
# ---------------------------------------------------------------------------

FIREFIGHTER_RECRUIT = ProgramBuildRequest(
    program=TrainingProgramCreate(
        name="Firefighter Recruit School (NFPA 1001 FF I & II)",
        description=(
            "Entry-level structural firefighter academy aligned to NFPA 1001 "
            "Firefighter I & II with Hazmat Awareness/Operations. Progresses "
            "recruits from orientation and safety through fireground skills, "
            "live-fire evolutions, and IFSAC/Pro Board certification testing. "
            "Adjust hours and add your department's specific courses, skills "
            "tests, and session categories after adding it."
        ),
        code="FF-RECRUIT",
        target_position="probationary",
        structure_type="phases",
        time_limit_days=180,
        warning_days_before=30,
        is_template=True,
    ),
    phases=[
        ProgramBuildPhaseInput(
            phase_number=1,
            name="Orientation & Firefighter Safety",
            description=(
                "Introduction to the fire service, PPE, SCBA, and firefighter "
                "survival. Recruits must be cleared here before any hands-on "
                "fireground work, so an officer signs off on advancement."
            ),
            requires_manual_advancement=True,
            requirements=[
                ProgramBuildRequirementInput(
                    name="Orientation & safety classroom hours",
                    description="Fire service history, organization, safety, and health.",
                    requirement_type="hours",
                    required_hours=24,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="PPE issued & inspected",
                    description="Turnout coat, pants, helmet, hood, gloves, and boots issued and fit-checked.",
                    requirement_type="checklist",
                    checklist_items=[
                        "Turnout coat & pants issued and fitted",
                        "Helmet, hood, and gloves issued",
                        "Boots issued and fitted",
                        "PPE inspection & care briefing completed",
                    ],
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="SCBA donning, doffing & emergency procedures",
                    description="Self-contained breathing apparatus skills checkoff including emergency air management.",
                    requirement_type="skills_evaluation",
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Fire behavior & firefighter safety exam",
                    description="Written exam covering fire dynamics, safety, and PPE/SCBA.",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=3,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=2,
            name="Fireground Skills",
            description="Core manipulative skills: ropes, forcible entry, ladders, hose, search, and ventilation.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Manipulative skills lab hours",
                    requirement_type="hours",
                    required_hours=80,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="Ropes & knots skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Forcible entry skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Ground ladders skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=3,
                ),
                ProgramBuildRequirementInput(
                    name="Hose handling & fire streams skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=4,
                ),
                ProgramBuildRequirementInput(
                    name="Search & rescue skills evaluation",
                    description="Primary and secondary search, victim removal.",
                    requirement_type="skills_evaluation",
                    sort_order=5,
                ),
                ProgramBuildRequirementInput(
                    name="Ventilation skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=6,
                ),
                ProgramBuildRequirementInput(
                    name="Fireground operations exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=7,
                ),
            ],
            milestones=[
                ProgramBuildMilestoneInput(
                    name="Fireground skills complete",
                    description="Core manipulative skills signed off; recruit is ready for live-fire evolutions.",
                    completion_percentage_threshold=60,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=3,
            name="Fire Attack & Live-Fire Evolutions",
            description="Interior fire attack, salvage & overhaul, building construction, and hazmat.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Live-fire training hours",
                    description="NFPA 1403-compliant live-fire evolutions.",
                    requirement_type="hours",
                    required_hours=40,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="Fire attack & hose advancement skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Salvage & overhaul skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Hazmat Awareness & Operations certification",
                    description="NFPA 1072 Hazardous Materials Awareness and Operations level.",
                    requirement_type="certification",
                    sort_order=3,
                ),
                ProgramBuildRequirementInput(
                    name="Building construction & fire dynamics exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=4,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=4,
            name="Certification (Firefighter I & II)",
            description=(
                "Final written and practical certification testing. An officer "
                "verifies results before the recruit is cleared, so advancement "
                "is manual."
            ),
            requires_manual_advancement=True,
            requirements=[
                ProgramBuildRequirementInput(
                    name="Firefighter I written certification exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="Firefighter II written certification exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Firefighter I & II practical skills evaluation",
                    description="IFSAC/Pro Board practical skills stations.",
                    requirement_type="skills_evaluation",
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Firefighter I & II certification",
                    description="IFSAC/Pro Board Firefighter I & II certification awarded.",
                    requirement_type="certification",
                    sort_order=3,
                ),
            ],
            milestones=[
                ProgramBuildMilestoneInput(
                    name="Certified Firefighter I & II",
                    description="Recruit has passed all certification testing and is cleared for duty.",
                    completion_percentage_threshold=100,
                ),
            ],
        ),
    ],
)

# ---------------------------------------------------------------------------
# 2. EMT Recruit School (NREMT)
# ---------------------------------------------------------------------------

EMT_RECRUIT = ProgramBuildRequest(
    program=TrainingProgramCreate(
        name="EMT Recruit School (NREMT)",
        description=(
            "Emergency Medical Technician course aligned to the National EMS "
            "Education Standards and NREMT certification. Moves candidates "
            "through the preparatory, airway, medical, and trauma modules, a "
            "clinical/field internship, and the NREMT cognitive and psychomotor "
            "exams. Add your department's session categories and skills tests "
            "after adding it."
        ),
        code="EMT-RECRUIT",
        target_position="probationary",
        structure_type="phases",
        time_limit_days=180,
        warning_days_before=30,
        is_template=True,
    ),
    phases=[
        ProgramBuildPhaseInput(
            phase_number=1,
            name="Preparatory & Patient Assessment",
            description="EMS systems, medical/legal, anatomy, vital signs, and patient assessment.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Didactic lecture hours",
                    requirement_type="hours",
                    required_hours=40,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="BLS / CPR certification",
                    description="Current Healthcare Provider BLS/CPR card on file.",
                    requirement_type="certification",
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Patient assessment — medical skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Patient assessment — trauma skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=3,
                ),
                ProgramBuildRequirementInput(
                    name="Vital signs & baseline assessment skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=4,
                ),
                ProgramBuildRequirementInput(
                    name="Preparatory module exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=5,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=2,
            name="Airway, Respiratory & Cardiac",
            description="Airway management, oxygen therapy, ventilation, and AED / cardiac arrest care.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Airway management & oxygen administration skills evaluation",
                    description="Airway adjuncts, suction, BVM, and oxygen delivery.",
                    requirement_type="skills_evaluation",
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="AED & cardiac arrest management skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Airway & cardiology exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=2,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=3,
            name="Medical & Trauma Emergencies",
            description="Medical emergencies, trauma care, immobilization, and pediatrics.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Bleeding control & shock management skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="Spinal immobilization skills evaluation",
                    description="Long backboard and manual spinal motion restriction.",
                    requirement_type="skills_evaluation",
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Joint & long-bone immobilization skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Pediatric assessment skills evaluation",
                    requirement_type="skills_evaluation",
                    sort_order=3,
                ),
                ProgramBuildRequirementInput(
                    name="Medical emergencies exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=4,
                ),
                ProgramBuildRequirementInput(
                    name="Trauma emergencies exam",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=5,
                ),
            ],
            milestones=[
                ProgramBuildMilestoneInput(
                    name="Classroom & skills complete",
                    description="Candidate has completed didactic modules and is ready for clinical rotations.",
                    completion_percentage_threshold=70,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=4,
            name="Operations & Clinical Internship",
            description="Ambulance operations, MCI, and supervised clinical / field internship.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Clinical / ambulance ride-along hours",
                    requirement_type="hours",
                    required_hours=24,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="Field internship shifts",
                    description="Supervised field internship shifts with a preceptor.",
                    requirement_type="shifts",
                    required_shifts=3,
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Operations exam",
                    description="Ambulance operations, gaining access/extrication, hazmat, and MCI.",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=3,
                    sort_order=2,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=5,
            name="NREMT Certification",
            description=(
                "National Registry cognitive and psychomotor exams. An officer "
                "verifies certification before the candidate is cleared, so "
                "advancement is manual."
            ),
            requires_manual_advancement=True,
            requirements=[
                ProgramBuildRequirementInput(
                    name="NREMT cognitive exam",
                    description="National Registry computer-adaptive written exam.",
                    requirement_type="knowledge_test",
                    passing_score=70,
                    max_attempts=6,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="NREMT psychomotor exam",
                    requirement_type="skills_evaluation",
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="State / National EMT certification",
                    requirement_type="certification",
                    sort_order=2,
                ),
            ],
            milestones=[
                ProgramBuildMilestoneInput(
                    name="Nationally Registered EMT",
                    description="Candidate has passed the NREMT exams and is certified.",
                    completion_percentage_threshold=100,
                ),
            ],
        ),
    ],
)

# ---------------------------------------------------------------------------
# 3. New-Member Orientation
# ---------------------------------------------------------------------------

NEW_MEMBER_ORIENTATION = ProgramBuildRequest(
    program=TrainingProgramCreate(
        name="New Member Orientation",
        description=(
            "Onboarding program for new members: learn about the department, "
            "complete mandatory annual compliance training (HIPAA, OSHA "
            "Bloodborne Pathogens, and more), and finish department-specific "
            "onboarding before being cleared for duty. Edit the compliance and "
            "department-specific items to match your policies."
        ),
        code="NEW-MEMBER",
        target_position="new_member",
        structure_type="phases",
        time_limit_days=90,
        warning_days_before=14,
        is_template=True,
    ),
    phases=[
        ProgramBuildPhaseInput(
            phase_number=1,
            name="Welcome & Department Familiarization",
            description="Paperwork, department overview, facility tour, and mentor assignment.",
            requirements=[
                ProgramBuildRequirementInput(
                    name="Membership paperwork completed",
                    requirement_type="checklist",
                    checklist_items=[
                        "Application & signed code of conduct",
                        "I-9 / employment eligibility on file",
                        "Emergency contact information provided",
                        "Payroll / direct deposit set up (if applicable)",
                    ],
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="Department overview",
                    description="History, mission, organizational chart, and chain of command.",
                    requirement_type="checklist",
                    checklist_items=[
                        "Department history & mission reviewed",
                        "Organizational chart & chain of command reviewed",
                        "Member handbook & key policies reviewed",
                    ],
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Facility & apparatus familiarization",
                    requirement_type="checklist",
                    checklist_items=[
                        "Station tour completed",
                        "Apparatus & equipment locations reviewed",
                        "ID badge, building, and gate access issued",
                    ],
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Mentor / field training officer assigned",
                    requirement_type="checklist",
                    checklist_items=["Mentor assigned and introduced"],
                    sort_order=3,
                ),
                ProgramBuildRequirementInput(
                    name="Department SOPs & code of conduct quiz",
                    requirement_type="knowledge_test",
                    passing_score=80,
                    max_attempts=3,
                    sort_order=4,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=2,
            name="Mandatory Annual Compliance Training",
            description=(
                "Required compliance training, repeated annually. These are "
                "marked annual so they resurface each year for renewal."
            ),
            requirements=[
                ProgramBuildRequirementInput(
                    name="HIPAA Privacy & Security",
                    description="Protected health information handling and patient privacy.",
                    requirement_type="knowledge_test",
                    frequency="annual",
                    passing_score=80,
                    max_attempts=3,
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="OSHA Bloodborne Pathogens",
                    description="OSHA 29 CFR 1910.1030 — exposure control and universal precautions.",
                    requirement_type="knowledge_test",
                    frequency="annual",
                    passing_score=80,
                    max_attempts=3,
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Hazard Communication / Right-to-Know",
                    description="OSHA 29 CFR 1910.1200 — chemical hazards and safety data sheets.",
                    requirement_type="knowledge_test",
                    frequency="annual",
                    passing_score=80,
                    max_attempts=3,
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Harassment Prevention / Respectful Workplace",
                    requirement_type="knowledge_test",
                    frequency="annual",
                    passing_score=80,
                    max_attempts=3,
                    sort_order=3,
                ),
                ProgramBuildRequirementInput(
                    name="Emergency Action Plan & incident reporting reviewed",
                    requirement_type="checklist",
                    checklist_items=[
                        "Emergency action plan reviewed",
                        "Injury / incident reporting procedure reviewed",
                        "Member rights & safety concerns process reviewed",
                    ],
                    sort_order=4,
                ),
            ],
        ),
        ProgramBuildPhaseInput(
            phase_number=3,
            name="Department-Specific Onboarding",
            description=(
                "Items unique to your department. Replace or add to these to "
                "match how your organization operates."
            ),
            requirements=[
                ProgramBuildRequirementInput(
                    name="Radio communications & dispatch procedures",
                    requirement_type="skills_evaluation",
                    sort_order=0,
                ),
                ProgramBuildRequirementInput(
                    name="PPE / respirator fit test completed",
                    description="SCBA / respirator fit test on file (OSHA 29 CFR 1910.134).",
                    requirement_type="checklist",
                    checklist_items=["Fit test completed and documented"],
                    sort_order=1,
                ),
                ProgramBuildRequirementInput(
                    name="Orientation ride-along hours",
                    requirement_type="hours",
                    required_hours=12,
                    sort_order=2,
                ),
                ProgramBuildRequirementInput(
                    name="Department-specific policy acknowledgment",
                    description="Placeholder — swap in your department's specific policies or training.",
                    requirement_type="checklist",
                    checklist_items=["Department-specific policy reviewed and acknowledged"],
                    sort_order=3,
                ),
            ],
            milestones=[
                ProgramBuildMilestoneInput(
                    name="Orientation complete — cleared for duty",
                    completion_percentage_threshold=100,
                ),
            ],
        ),
    ],
)


# Registry keyed by URL-safe slug. Order defines gallery display order.
SAMPLE_TEMPLATES: Dict[str, ProgramBuildRequest] = {
    "firefighter-recruit-school": FIREFIGHTER_RECRUIT,
    "emt-recruit-school": EMT_RECRUIT,
    "new-member-orientation": NEW_MEMBER_ORIENTATION,
}


def _requirement_count(build: ProgramBuildRequest) -> int:
    return sum(len(phase.requirements) for phase in build.phases)


def list_sample_template_summaries() -> List[dict]:
    """Lightweight metadata for the gallery — no need to send full structure."""
    summaries: List[dict] = []
    for key, build in SAMPLE_TEMPLATES.items():
        prog = build.program
        summaries.append(
            {
                "key": key,
                "name": prog.name,
                "description": prog.description,
                "code": prog.code,
                "target_position": prog.target_position,
                "structure_type": prog.structure_type,
                "phase_count": len(build.phases),
                "requirement_count": _requirement_count(build),
                "time_limit_days": prog.time_limit_days,
            }
        )
    return summaries
