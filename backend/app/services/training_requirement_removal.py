"""Deleting a training requirement that is in use deactivates it instead.

Follows ``LocationService.remove_location``: a requirement anything still
points at is deactivated (``active=False``), so the records that name it keep
a valid reference; one nothing points at is hard-deleted.

A hard delete is not harmless here even where the database allows it.
``program_requirements``, ``requirement_progress`` (and the credits under it)
and ``recertification_pathways`` cascade, so the delete would erase members'
progress and pipeline structure; the skills-testing, knowledge-test and
course-class links are SET NULL, so those records would silently lose which
requirement they satisfied; and compliance profiles and waivers name the
requirement inside JSON, where nothing cleans the id up at all.
"""

from typing import Any, Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.knowledge_test import KnowledgeTest, KnowledgeTestAttempt
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.training import (
    CourseClass,
    CourseCohortClass,
    ProgramRequirement,
    RecertificationPathway,
    RequirementProgress,
    TrainingRequirement,
    TrainingSession,
    TrainingWaiver,
)
from app.utils.json_ids import json_array_contains

# Every column holding a foreign key to training_requirements.id.
_FOREIGN_KEY_REFERENCES: Sequence[Any] = (
    ProgramRequirement.requirement_id,
    RequirementProgress.requirement_id,
    RecertificationPathway.source_requirement_id,
    SkillTemplate.requirement_id,
    SkillTest.requirement_id,
    KnowledgeTest.requirement_id,
    KnowledgeTestAttempt.requirement_id,
    TrainingSession.requirement_id,
    CourseClass.requirement_id,
    CourseCohortClass.requirement_id,
)


async def requirement_reference_count(
    db: AsyncSession, requirement: TrainingRequirement
) -> int:
    """Rows that reference this requirement, by foreign key or by JSON id list.

    The foreign-key counts are not org-filtered, on the same reasoning as
    ``LocationService.location_reference_count``: the requirement has already
    been resolved in the caller's organization, and a count that missed a
    referencing row would send it down the hard-delete path and destroy that
    row's history. The JSON lists carry no constraint, so they are read only
    within the requirement's own organization.
    """
    requirement_id = str(requirement.id)
    org_id = str(requirement.organization_id)

    total = 0
    for column in _FOREIGN_KEY_REFERENCES:
        total += (
            await db.scalar(
                select(func.count())
                .select_from(column.class_)
                .where(column == requirement_id)
            )
            or 0
        )

    total += (
        await db.scalar(
            select(func.count())
            .select_from(ComplianceProfile)
            .join(ComplianceConfig, ComplianceProfile.config_id == ComplianceConfig.id)
            .where(
                ComplianceConfig.organization_id == org_id,
                or_(
                    json_array_contains(
                        ComplianceProfile.required_requirement_ids, requirement_id
                    ),
                    json_array_contains(
                        ComplianceProfile.optional_requirement_ids, requirement_id
                    ),
                ),
            )
        )
        or 0
    )
    total += (
        await db.scalar(
            select(func.count())
            .select_from(TrainingWaiver)
            .where(
                TrainingWaiver.organization_id == org_id,
                json_array_contains(TrainingWaiver.requirement_ids, requirement_id),
            )
        )
        or 0
    )
    return total


async def remove_requirement(
    db: AsyncSession, requirement: TrainingRequirement
) -> bool:
    """Deactivate a referenced requirement, otherwise delete it. No commit.

    Returns True when the row was deleted, False when it was deactivated.
    """
    if await requirement_reference_count(db, requirement) > 0:
        requirement.active = False
        return False

    await db.delete(requirement)
    return True
