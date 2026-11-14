"""Deleting a training requirement: deactivate when in use, or purge on request.

Follows ``LocationService.remove_location``: a requirement anything still
points at is deactivated (``active=False``), so the records that name it keep
a valid reference; one nothing points at is hard-deleted.

A hard delete is not harmless here even where the database allows it.
``program_requirements``, ``requirement_progress`` (and the credits under it),
``recertification_pathways``, ``training_session_requirements`` and
``training_requirement_overrides`` cascade, so the delete would erase members'
progress, pipeline structure and Chief overrides; the skills-testing,
knowledge-test, session and course-class links are SET NULL, so those records
would silently lose which requirement they satisfied; and compliance profiles
and waivers name the requirement inside JSON, where nothing cleans the id up
at all.

A department still setting itself up needs a way out of that rule, though: a
requirement created while trying things out picks up references (a test
enrollment, a profile) and could then never be removed. So an officer may ask
for a permanent delete, which ``purge_requirement`` carries out explicitly —
every effect above is done here, by name, rather than left to the foreign-key
actions, so the JSON lists are cleaned too and the outcome does not depend on
the database enforcing its constraints. ``requirement_references`` is what the
officer is shown before choosing.
"""

from dataclasses import dataclass
from typing import Any, List, Sequence

from sqlalchemy import delete, func, select, update
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
    TrainingRequirementOverride,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingWaiver,
)
from app.utils.json_ids import json_array_contains

# What a permanent delete does to a referencing row.
REMOVED = "removed"
UNLINKED = "unlinked"


@dataclass(frozen=True)
class _ForeignKeyReference:
    kind: str
    label: str
    column: Any
    on_delete: str  # REMOVED for a CASCADE column, UNLINKED for SET NULL


# Every column holding a foreign key to training_requirements.id. A column
# missing here is counted by nothing, so a requirement only it references is
# hard-deleted by an ordinary delete and its rows go with it —
# ``tests/test_training_requirement_removal.py`` checks this list against the
# mapped schema for that reason.
_FOREIGN_KEY_REFERENCES: Sequence[_ForeignKeyReference] = (
    _ForeignKeyReference(
        "program_requirements",
        "Pipeline requirement links",
        ProgramRequirement.requirement_id,
        REMOVED,
    ),
    _ForeignKeyReference(
        "requirement_progress",
        "Member pipeline progress records",
        RequirementProgress.requirement_id,
        REMOVED,
    ),
    _ForeignKeyReference(
        "recertification_pathways",
        "Recertification pathways",
        RecertificationPathway.source_requirement_id,
        REMOVED,
    ),
    _ForeignKeyReference(
        "training_session_requirements",
        "Session attendance links",
        TrainingSessionRequirement.requirement_id,
        REMOVED,
    ),
    _ForeignKeyReference(
        "training_requirement_overrides",
        "Chief overrides",
        TrainingRequirementOverride.requirement_id,
        REMOVED,
    ),
    _ForeignKeyReference(
        "skill_templates",
        "Skill evaluation templates",
        SkillTemplate.requirement_id,
        UNLINKED,
    ),
    _ForeignKeyReference(
        "skill_tests", "Skill tests", SkillTest.requirement_id, UNLINKED
    ),
    _ForeignKeyReference(
        "knowledge_tests",
        "Knowledge tests",
        KnowledgeTest.requirement_id,
        UNLINKED,
    ),
    _ForeignKeyReference(
        "knowledge_test_attempts",
        "Knowledge test attempts",
        KnowledgeTestAttempt.requirement_id,
        UNLINKED,
    ),
    _ForeignKeyReference(
        "training_sessions",
        "Training sessions",
        TrainingSession.requirement_id,
        UNLINKED,
    ),
    _ForeignKeyReference(
        "course_classes", "Course classes", CourseClass.requirement_id, UNLINKED
    ),
    _ForeignKeyReference(
        "course_cohort_classes",
        "Cohort classes",
        CourseCohortClass.requirement_id,
        UNLINKED,
    ),
)


@dataclass(frozen=True)
class RequirementReference:
    """One kind of record that names the requirement, and how many do."""

    kind: str
    label: str
    count: int
    on_delete: str


def _profiles_naming(org_id: str, requirement_id: str):
    return (
        select(ComplianceProfile)
        .join(ComplianceConfig, ComplianceProfile.config_id == ComplianceConfig.id)
        .where(
            ComplianceConfig.organization_id == org_id,
            json_array_contains(
                ComplianceProfile.required_requirement_ids, requirement_id
            )
            | json_array_contains(
                ComplianceProfile.optional_requirement_ids, requirement_id
            ),
        )
    )


def _waivers_naming(org_id: str, requirement_id: str):
    return select(TrainingWaiver).where(
        TrainingWaiver.organization_id == org_id,
        json_array_contains(TrainingWaiver.requirement_ids, requirement_id),
    )


async def requirement_references(
    db: AsyncSession, requirement: TrainingRequirement
) -> List[RequirementReference]:
    """Every kind of record referencing this requirement, with a count.

    Only kinds with at least one row are returned, in the order of
    ``_FOREIGN_KEY_REFERENCES`` followed by the JSON lists.

    The foreign-key counts are not org-filtered, on the same reasoning as
    ``LocationService.location_reference_count``: the requirement has already
    been resolved in the caller's organization, and a count that missed a
    referencing row would send it down the hard-delete path and destroy that
    row's history. The JSON lists carry no constraint, so they are read only
    within the requirement's own organization.
    """
    requirement_id = str(requirement.id)
    org_id = str(requirement.organization_id)

    found: List[RequirementReference] = []
    for ref in _FOREIGN_KEY_REFERENCES:
        count = (
            await db.scalar(
                select(func.count())
                .select_from(ref.column.class_)
                .where(ref.column == requirement_id)
            )
            or 0
        )
        if count:
            found.append(
                RequirementReference(ref.kind, ref.label, count, ref.on_delete)
            )

    profiles = (
        await db.scalar(
            select(func.count()).select_from(
                _profiles_naming(org_id, requirement_id).subquery()
            )
        )
        or 0
    )
    if profiles:
        found.append(
            RequirementReference(
                "compliance_profiles", "Compliance profiles", profiles, UNLINKED
            )
        )

    waivers = (
        await db.scalar(
            select(func.count()).select_from(
                _waivers_naming(org_id, requirement_id).subquery()
            )
        )
        or 0
    )
    if waivers:
        found.append(
            RequirementReference(
                "training_waivers", "Training waivers", waivers, UNLINKED
            )
        )
    return found


async def requirement_reference_count(
    db: AsyncSession, requirement: TrainingRequirement
) -> int:
    """Rows that reference this requirement, by foreign key or by JSON id list."""
    return sum(ref.count for ref in await requirement_references(db, requirement))


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


async def purge_requirement(
    db: AsyncSession, requirement: TrainingRequirement
) -> List[RequirementReference]:
    """Delete the requirement and deal with everything that names it. No commit.

    Returns what referenced it beforehand, for the audit record. Rows whose
    whole purpose was this requirement (``REMOVED``) are deleted; rows that
    merely pointed at it (``UNLINKED``) keep existing without the link.
    """
    references = await requirement_references(db, requirement)
    requirement_id = str(requirement.id)
    org_id = str(requirement.organization_id)

    for ref in _FOREIGN_KEY_REFERENCES:
        model = ref.column.class_
        if ref.on_delete == REMOVED:
            await db.execute(
                delete(model)
                .where(ref.column == requirement_id)
                .execution_options(synchronize_session=False)
            )
        else:
            await db.execute(
                update(model)
                .where(ref.column == requirement_id)
                .values({ref.column.key: None})
                .execution_options(synchronize_session=False)
            )

    # Assign new lists rather than mutating in place: these are plain JSON
    # columns, which do not track in-place changes (Pitfall #12). A profile
    # left with an empty required list means "nothing required", which is
    # what it now amounts to — the grader already skipped ids it could not
    # resolve.
    for profile in (
        await db.execute(_profiles_naming(org_id, requirement_id))
    ).scalars():
        if profile.required_requirement_ids is not None:
            profile.required_requirement_ids = [
                rid
                for rid in profile.required_requirement_ids
                if str(rid) != requirement_id
            ]
        if profile.optional_requirement_ids is not None:
            profile.optional_requirement_ids = [
                rid
                for rid in profile.optional_requirement_ids
                if str(rid) != requirement_id
            ]

    for waiver in (await db.execute(_waivers_naming(org_id, requirement_id))).scalars():
        remaining = [
            rid for rid in (waiver.requirement_ids or []) if str(rid) != requirement_id
        ]
        if remaining:
            waiver.requirement_ids = remaining
        else:
            # An empty list reads as "waives every requirement" to the
            # waiver checks (``not w.requirement_ids``), so stripping the
            # last id would turn a waiver for this one requirement into a
            # blanket excuse from all of them. Deactivate it instead and
            # leave its list alone: the record of the leave survives, and
            # the id it names now matches nothing.
            waiver.active = False

    await db.delete(requirement)
    await db.flush()
    return references
