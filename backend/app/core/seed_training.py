"""
Training Seed Data

Seeds the database with default training categories, courses, and requirements.
Follows the same async SQLAlchemy session pattern as seed.py.
"""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Dict, List, Optional

from app.models.training import (
    TrainingCategory,
    TrainingCourse,
    TrainingRequirement,
    TrainingType,
    RequirementType,
    RequirementFrequency,
    RequirementSource,
    DueDateType,
)
from app.core.utils import generate_uuid
from loguru import logger


# ============================================
# Default Training Categories
# ============================================

DEFAULT_CATEGORIES = [
    {
        "name": "Fire Training",
        "code": "FIRE",
        "description": "Core firefighting skills and suppression training",
        "color": "#DC2626",
        "icon": "flame",
        "sort_order": 1,
        "subcategories": [
            {"name": "Suppression", "code": "FIRE-SUP", "description": "Fire suppression techniques and tactics", "sort_order": 1},
            {"name": "Ventilation", "code": "FIRE-VENT", "description": "Ventilation operations and techniques", "sort_order": 2},
            {"name": "Search & Rescue", "code": "FIRE-SAR", "description": "Primary and secondary search operations", "sort_order": 3},
            {"name": "Ladder Operations", "code": "FIRE-LAD", "description": "Ground and aerial ladder operations", "sort_order": 4},
        ],
    },
    {
        "name": "EMS Training",
        "code": "EMS",
        "description": "Emergency medical services training and continuing education",
        "color": "#3B82F6",
        "icon": "heart-pulse",
        "sort_order": 2,
        "subcategories": [
            {"name": "BLS", "code": "EMS-BLS", "description": "Basic Life Support training", "sort_order": 1},
            {"name": "ALS", "code": "EMS-ALS", "description": "Advanced Life Support training", "sort_order": 2},
            {"name": "Trauma", "code": "EMS-TRAUMA", "description": "Trauma assessment and treatment", "sort_order": 3},
            {"name": "Pediatric", "code": "EMS-PEDI", "description": "Pediatric emergency care", "sort_order": 4},
        ],
    },
    {
        "name": "Hazmat",
        "code": "HAZMAT",
        "description": "Hazardous materials awareness and operations training",
        "color": "#F59E0B",
        "icon": "alert-triangle",
        "sort_order": 3,
        "subcategories": [],
    },
    {
        "name": "Rescue",
        "code": "RESCUE",
        "description": "Technical rescue operations and training",
        "color": "#8B5CF6",
        "icon": "shield",
        "sort_order": 4,
        "subcategories": [
            {"name": "Water Rescue", "code": "RESCUE-WATER", "description": "Water and swift water rescue operations", "sort_order": 1},
            {"name": "Rope Rescue", "code": "RESCUE-ROPE", "description": "High and low angle rope rescue", "sort_order": 2},
            {"name": "Confined Space", "code": "RESCUE-CS", "description": "Confined space rescue operations", "sort_order": 3},
            {"name": "Vehicle Extrication", "code": "RESCUE-VEX", "description": "Vehicle extrication techniques", "sort_order": 4},
        ],
    },
    {
        "name": "Driver/Operator",
        "code": "DRIVER",
        "description": "Apparatus driver/operator training and evaluation",
        "color": "#22C55E",
        "icon": "truck",
        "sort_order": 5,
        "subcategories": [],
    },
    {
        "name": "Officer Development",
        "code": "OFFICER",
        "description": "Leadership and officer development training",
        "color": "#0EA5E9",
        "icon": "award",
        "sort_order": 6,
        "subcategories": [],
    },
    {
        "name": "General / Administrative",
        "code": "GENERAL",
        "description": "General training and administrative topics",
        "color": "#6B7280",
        "icon": "book-open",
        "sort_order": 7,
        "subcategories": [],
    },
    {
        "name": "Safety & Wellness",
        "code": "SAFETY",
        "description": "Safety, health, and wellness training",
        "color": "#EF4444",
        "icon": "shield-check",
        "sort_order": 8,
        "subcategories": [],
    },
]


# ============================================
# Default Training Courses
# ============================================

DEFAULT_COURSES = [
    {
        "name": "Firefighter I",
        "code": "FF1",
        "description": "NFPA 1001 Firefighter I certification course covering basic firefighting skills, fire behavior, PPE, hose operations, ladders, ventilation, and search and rescue.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 160.0,
        "credit_hours": 160.0,
        "category_codes": ["FIRE"],
        "prerequisites": [],
        "expiration_months": None,
    },
    {
        "name": "Firefighter II",
        "code": "FF2",
        "description": "NFPA 1001 Firefighter II certification course building on FF1 with advanced fire suppression, fire investigation, and community education.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 80.0,
        "credit_hours": 80.0,
        "category_codes": ["FIRE"],
        "prerequisites": ["FF1"],
        "expiration_months": None,
    },
    {
        "name": "EMT-Basic",
        "code": "EMT-B",
        "description": "Emergency Medical Technician - Basic certification covering patient assessment, airway management, splinting, bleeding control, and medical emergencies.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 170.0,
        "credit_hours": 170.0,
        "category_codes": ["EMS"],
        "prerequisites": [],
        "expiration_months": None,
    },
    {
        "name": "Paramedic",
        "code": "MEDIC",
        "description": "Paramedic certification program covering advanced life support, pharmacology, cardiology, trauma management, and advanced airway management.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 1200.0,
        "credit_hours": 1200.0,
        "category_codes": ["EMS"],
        "prerequisites": ["EMT-B"],
        "expiration_months": None,
    },
    {
        "name": "Driver/Operator Pumper",
        "code": "DOP",
        "description": "NFPA 1002 Driver/Operator certification for pumper apparatus including pump operations, hydraulics, and water supply.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 40.0,
        "credit_hours": 40.0,
        "category_codes": ["DRIVER"],
        "prerequisites": ["FF1"],
        "expiration_months": None,
    },
    {
        "name": "Driver/Operator Aerial",
        "code": "DOA",
        "description": "NFPA 1002 Driver/Operator certification for aerial apparatus including aerial ladder and platform operations.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 40.0,
        "credit_hours": 40.0,
        "category_codes": ["DRIVER"],
        "prerequisites": ["FF1"],
        "expiration_months": None,
    },
    {
        "name": "Hazmat Awareness",
        "code": "HAZMAT-A",
        "description": "NFPA 472 Hazardous Materials Awareness level training covering identification, notification, and isolation procedures.",
        "training_type": TrainingType.CONTINUING_EDUCATION,
        "duration_hours": 8.0,
        "credit_hours": 8.0,
        "category_codes": ["HAZMAT"],
        "prerequisites": [],
        "expiration_months": None,
    },
    {
        "name": "Hazmat Operations",
        "code": "HAZMAT-O",
        "description": "NFPA 472 Hazardous Materials Operations level training covering defensive operations, decontamination, and PPE selection.",
        "training_type": TrainingType.CONTINUING_EDUCATION,
        "duration_hours": 24.0,
        "credit_hours": 24.0,
        "category_codes": ["HAZMAT"],
        "prerequisites": ["HAZMAT-A"],
        "expiration_months": None,
    },
    {
        "name": "Fire Officer I",
        "code": "FO1",
        "description": "NFPA 1021 Fire Officer I certification covering supervision, community relations, administration, inspection, investigation, and emergency service delivery.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 80.0,
        "credit_hours": 80.0,
        "category_codes": ["OFFICER"],
        "prerequisites": ["FF2"],
        "expiration_months": None,
    },
    {
        "name": "CPR/BLS Provider",
        "code": "CPR-BLS",
        "description": "American Heart Association CPR/BLS Provider course for healthcare professionals covering adult, child, and infant CPR, AED use, and choking relief.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 4.0,
        "credit_hours": 4.0,
        "category_codes": ["EMS"],
        "prerequisites": [],
        "expiration_months": 24,
    },
    {
        "name": "ACLS Provider",
        "code": "ACLS",
        "description": "American Heart Association Advanced Cardiovascular Life Support course covering cardiac arrest algorithms, stroke, and acute coronary syndromes.",
        "training_type": TrainingType.CERTIFICATION,
        "duration_hours": 16.0,
        "credit_hours": 16.0,
        "category_codes": ["EMS"],
        "prerequisites": ["CPR-BLS"],
        "expiration_months": 24,
    },
    {
        "name": "Incident Safety Officer",
        "code": "ISO",
        "description": "NFPA 1521 Incident Safety Officer course covering safety officer roles, risk assessment, accident investigation, and health and safety programs.",
        "training_type": TrainingType.SPECIALTY,
        "duration_hours": 24.0,
        "credit_hours": 24.0,
        "category_codes": ["SAFETY"],
        "prerequisites": ["FF2"],
        "expiration_months": None,
    },
    {
        "name": "SCBA Confidence Course",
        "code": "SCBA-CC",
        "description": "Hands-on SCBA confidence course including low visibility navigation, air management, emergency procedures, and RIT activation.",
        "training_type": TrainingType.SKILLS_PRACTICE,
        "duration_hours": 4.0,
        "credit_hours": 4.0,
        "category_codes": ["FIRE"],
        "prerequisites": [],
        "expiration_months": None,
    },
    {
        "name": "Annual Live Fire Training",
        "code": "LIVE-FIRE",
        "description": "NFPA 1403 compliant live fire training evolution including interior attack, search and rescue, and ventilation under live fire conditions.",
        "training_type": TrainingType.SKILLS_PRACTICE,
        "duration_hours": 8.0,
        "credit_hours": 8.0,
        "category_codes": ["FIRE"],
        "prerequisites": ["FF1"],
        "expiration_months": None,
    },
]


# ============================================
# Default Training Requirements
# ============================================

DEFAULT_REQUIREMENTS = [
    {
        "name": "Annual Fire Training Hours",
        "description": "Minimum annual fire training hours required for all members per department policy.",
        "requirement_type": RequirementType.HOURS,
        "source": RequirementSource.DEPARTMENT,
        "required_hours": 36.0,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "category_codes": ["FIRE"],
    },
    {
        "name": "Annual EMS Training Hours",
        "description": "Minimum annual EMS continuing education hours required for all members.",
        "requirement_type": RequirementType.HOURS,
        "source": RequirementSource.DEPARTMENT,
        "required_hours": 24.0,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "category_codes": ["EMS"],
    },
    {
        "name": "Annual HazMat Refresher",
        "description": "Annual hazardous materials refresher training required per OSHA 29 CFR 1910.120.",
        "requirement_type": RequirementType.HOURS,
        "source": RequirementSource.DEPARTMENT,
        "required_hours": 8.0,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "category_codes": ["HAZMAT"],
    },
    {
        "name": "Annual SCBA Fit Test",
        "description": "Annual SCBA fit test and air consumption evaluation required per OSHA 29 CFR 1910.134.",
        "requirement_type": RequirementType.CHECKLIST,
        "source": RequirementSource.DEPARTMENT,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "checklist_items": [
            "SCBA fit test completed",
            "Facepiece seal verified",
            "Air consumption test passed",
        ],
        "category_codes": [],
    },
    {
        "name": "Annual Driver Evaluation",
        "description": "Annual driver/operator evaluation and competency assessment for all designated drivers.",
        "requirement_type": RequirementType.HOURS,
        "source": RequirementSource.DEPARTMENT,
        "required_hours": 8.0,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": False,
        "required_positions": ["driver"],
        "category_codes": ["DRIVER"],
    },
    {
        "name": "Quarterly Safety Training",
        "description": "Quarterly safety and wellness training covering current safety topics, injury prevention, and member wellness.",
        "requirement_type": RequirementType.HOURS,
        "source": RequirementSource.DEPARTMENT,
        "required_hours": 4.0,
        "frequency": RequirementFrequency.QUARTERLY,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "category_codes": ["SAFETY"],
    },
    {
        "name": "Bloodborne Pathogens Training",
        "description": "Annual bloodborne pathogens exposure control training required per OSHA 29 CFR 1910.1030.",
        "requirement_type": RequirementType.COURSES,
        "source": RequirementSource.DEPARTMENT,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "category_codes": [],
    },
    {
        "name": "Sexual Harassment Prevention",
        "description": "Annual sexual harassment prevention and workplace conduct training required by department policy.",
        "requirement_type": RequirementType.COURSES,
        "source": RequirementSource.DEPARTMENT,
        "frequency": RequirementFrequency.ANNUAL,
        "due_date_type": DueDateType.CALENDAR_PERIOD,
        "period_start_month": 1,
        "period_start_day": 1,
        "applies_to_all": True,
        "category_codes": [],
    },
]


async def seed_training_categories(
    db: AsyncSession,
    organization_id: str,
    created_by: str,
) -> Dict[str, str]:
    """
    Seed default training categories with parent-child hierarchy.

    Args:
        db: Async database session
        organization_id: Organization to create categories for
        created_by: User ID of the creator

    Returns:
        Dictionary mapping category codes to their IDs
    """
    logger.info(f"Seeding training categories for organization {organization_id}")
    category_map: Dict[str, str] = {}

    for cat_data in DEFAULT_CATEGORIES:
        # Check if parent category already exists
        result = await db.execute(
            select(TrainingCategory).where(
                TrainingCategory.organization_id == organization_id,
                TrainingCategory.code == cat_data["code"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            logger.info(f"Training category already exists: {cat_data['name']}")
            parent_id = existing.id
            category_map[cat_data["code"]] = parent_id
        else:
            parent_id = generate_uuid()
            parent_category = TrainingCategory(
                id=parent_id,
                organization_id=organization_id,
                name=cat_data["name"],
                code=cat_data["code"],
                description=cat_data["description"],
                color=cat_data["color"],
                icon=cat_data["icon"],
                sort_order=cat_data["sort_order"],
                parent_category_id=None,
                active=True,
                created_by=created_by,
            )
            db.add(parent_category)
            category_map[cat_data["code"]] = parent_id
            logger.info(f"Created training category: {cat_data['name']}")

        # Seed subcategories
        for sub_data in cat_data.get("subcategories", []):
            result = await db.execute(
                select(TrainingCategory).where(
                    TrainingCategory.organization_id == organization_id,
                    TrainingCategory.code == sub_data["code"],
                )
            )
            existing_sub = result.scalar_one_or_none()

            if existing_sub:
                logger.info(f"Subcategory already exists: {sub_data['name']}")
                category_map[sub_data["code"]] = existing_sub.id
            else:
                sub_id = generate_uuid()
                subcategory = TrainingCategory(
                    id=sub_id,
                    organization_id=organization_id,
                    name=sub_data["name"],
                    code=sub_data["code"],
                    description=sub_data["description"],
                    color=cat_data["color"],
                    icon=cat_data["icon"],
                    sort_order=sub_data["sort_order"],
                    parent_category_id=parent_id,
                    active=True,
                    created_by=created_by,
                )
                db.add(subcategory)
                category_map[sub_data["code"]] = sub_id
                logger.info(f"Created subcategory: {sub_data['name']}")

    await db.commit()
    logger.info(f"Training categories seeded successfully ({len(category_map)} total)")
    return category_map


async def seed_training_courses(
    db: AsyncSession,
    organization_id: str,
    created_by: str,
    category_map: Dict[str, str],
) -> List[str]:
    """
    Seed default training courses.

    Args:
        db: Async database session
        organization_id: Organization to create courses for
        created_by: User ID of the creator
        category_map: Dictionary mapping category codes to IDs

    Returns:
        List of created course IDs
    """
    logger.info(f"Seeding training courses for organization {organization_id}")
    course_ids: List[str] = []
    course_code_map: Dict[str, str] = {}

    # First pass: create all courses and build a code-to-ID map
    for course_data in DEFAULT_COURSES:
        # Check if course already exists
        result = await db.execute(
            select(TrainingCourse).where(
                TrainingCourse.organization_id == organization_id,
                TrainingCourse.code == course_data["code"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            logger.info(f"Training course already exists: {course_data['name']}")
            course_ids.append(existing.id)
            course_code_map[course_data["code"]] = existing.id
            continue

        # Resolve category codes to IDs
        resolved_category_ids = [
            category_map[code]
            for code in course_data["category_codes"]
            if code in category_map
        ]

        course_id = generate_uuid()
        course = TrainingCourse(
            id=course_id,
            organization_id=organization_id,
            name=course_data["name"],
            code=course_data["code"],
            description=course_data["description"],
            training_type=course_data["training_type"],
            duration_hours=course_data["duration_hours"],
            credit_hours=course_data["credit_hours"],
            category_ids=resolved_category_ids if resolved_category_ids else None,
            expiration_months=course_data.get("expiration_months"),
            prerequisites=None,  # Will be resolved in second pass
            active=True,
            created_by=created_by,
        )
        db.add(course)
        course_ids.append(course_id)
        course_code_map[course_data["code"]] = course_id
        logger.info(f"Created training course: {course_data['name']}")

    await db.commit()

    # Second pass: resolve prerequisite course codes to IDs
    for course_data in DEFAULT_COURSES:
        prereq_codes = course_data.get("prerequisites", [])
        if not prereq_codes:
            continue

        course_code = course_data["code"]
        if course_code not in course_code_map:
            continue

        resolved_prereqs = [
            course_code_map[code]
            for code in prereq_codes
            if code in course_code_map
        ]

        if resolved_prereqs:
            result = await db.execute(
                select(TrainingCourse).where(
                    TrainingCourse.id == course_code_map[course_code],
                )
            )
            course = result.scalar_one_or_none()
            if course and not course.prerequisites:
                course.prerequisites = resolved_prereqs
                logger.info(f"Set prerequisites for {course_data['name']}: {prereq_codes}")

    await db.commit()
    logger.info(f"Training courses seeded successfully ({len(course_ids)} total)")
    return course_ids


async def seed_training_requirements(
    db: AsyncSession,
    organization_id: str,
    created_by: str,
    category_map: Dict[str, str],
) -> List[str]:
    """
    Seed default training requirements.

    Args:
        db: Async database session
        organization_id: Organization to create requirements for
        created_by: User ID of the creator
        category_map: Dictionary mapping category codes to IDs

    Returns:
        List of created requirement IDs
    """
    logger.info(f"Seeding training requirements for organization {organization_id}")
    requirement_ids: List[str] = []

    for req_data in DEFAULT_REQUIREMENTS:
        # Check if requirement already exists by name
        result = await db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == organization_id,
                TrainingRequirement.name == req_data["name"],
            )
        )
        existing = result.scalar_one_or_none()

        if existing:
            logger.info(f"Training requirement already exists: {req_data['name']}")
            requirement_ids.append(existing.id)
            continue

        # Resolve category codes to IDs
        resolved_category_ids = [
            category_map[code]
            for code in req_data.get("category_codes", [])
            if code in category_map
        ]

        req_id = generate_uuid()
        requirement = TrainingRequirement(
            id=req_id,
            organization_id=organization_id,
            name=req_data["name"],
            description=req_data["description"],
            requirement_type=req_data["requirement_type"],
            source=req_data["source"],
            required_hours=req_data.get("required_hours"),
            required_courses=req_data.get("required_courses"),
            checklist_items=req_data.get("checklist_items"),
            frequency=req_data["frequency"],
            due_date_type=req_data["due_date_type"],
            period_start_month=req_data.get("period_start_month", 1),
            period_start_day=req_data.get("period_start_day", 1),
            category_ids=resolved_category_ids if resolved_category_ids else None,
            applies_to_all=req_data.get("applies_to_all", True),
            required_positions=req_data.get("required_positions"),
            is_editable=True,
            active=True,
            created_by=created_by,
        )
        db.add(requirement)
        requirement_ids.append(req_id)
        logger.info(f"Created training requirement: {req_data['name']}")

    await db.commit()
    logger.info(f"Training requirements seeded successfully ({len(requirement_ids)} total)")
    return requirement_ids


async def seed_training_data(
    db: AsyncSession,
    organization_id: str,
    created_by: str,
) -> Dict:
    """
    Orchestrate seeding of all training data.

    Seeds categories, courses, and requirements in order, passing the
    category map to courses and requirements for proper linking.

    Args:
        db: Async database session
        organization_id: Organization to seed training data for
        created_by: User ID of the creator

    Returns:
        Dictionary with category_map, course_ids, and requirement_ids
    """
    logger.info(f"Starting training data seeding for organization {organization_id}")

    # 1. Seed categories first (courses and requirements depend on them)
    category_map = await seed_training_categories(db, organization_id, created_by)

    # 2. Seed courses (references categories)
    course_ids = await seed_training_courses(db, organization_id, created_by, category_map)

    # 3. Seed requirements (references categories)
    requirement_ids = await seed_training_requirements(db, organization_id, created_by, category_map)

    logger.info("Training data seeding completed!")
    return {
        "category_map": category_map,
        "course_ids": course_ids,
        "requirement_ids": requirement_ids,
    }
