"""Link training records that name no library course to one, by their name.

Compliance credits a record toward a course or certification requirement only
through its ``course_id``. A record entered with a free-text name, or imported
from a file whose name matched no course, has none and counts toward nothing
that names a course. The rule that once matched records to requirements by name
alone is off for every requirement created since 2026-10 (``name_match_until``),
so a resemblance in the name is never credit by itself.

This screen closes the gap the other way round. It lists each name the
department's unlinked records carry, grouped so spellings that differ only in
case, punctuation, a trailing provider id or a "CAPCE" prefix read as one, and
suggests a library course with the matcher the provider-course mapping already
uses. Nothing is linked until a training officer says so (owner decision
2026-11-15). Linking a name sets the course on every record that carries it and
still has none, and the course's category and training type with it, so the
existing compliance rules count those records from then on.

A record keeps its own name, date and hours. Only records with no course are
touched, so a second link of the same name changes nothing, and a record an
officer linked by hand keeps its course.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Dict, List, Optional, Sequence, Set

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingCourse, TrainingRecord
from app.services.external_course_mapping import (
    SuggestionCandidates,
    course_category_id,
    normalize_course_title,
)
from app.services.qualification_service import QualificationService
from app.utils.sql_results import rows_affected
from app.utils.training_match_key import training_match_key

# Keeps each IN list a reasonable size when a name has many spellings or a
# course certifies many records.
_NAME_CHUNK = 500


def name_key(course_name: Optional[str]) -> Optional[str]:
    """The key names are grouped by.

    The provider-course normalizer first drops what does not say which course
    it is (a trailing provider id, a "CAPCE" prefix); the training match key
    then drops case and punctuation, so "C.P.R. refresher" and "CPR Refresher"
    are one name, as they are to the certification grader.
    """
    return training_match_key(normalize_course_title(course_name))


@dataclass
class Spelling:
    name: str
    records: int


@dataclass
class UnlinkedName:
    """One name, however it was spelled, and the records that carry it."""

    key: str
    spellings: List[Spelling] = field(default_factory=list)
    records: int = 0
    members: Set[str] = field(default_factory=set)
    first_date: Optional[date] = None
    last_date: Optional[date] = None
    suggested_course: Optional[TrainingCourse] = None

    @property
    def label(self) -> str:
        """The spelling most records use, as the name to show."""
        return max(self.spellings, key=lambda s: (s.records, s.name)).name


@dataclass
class LinkResult:
    names: int
    records: int


class TrainingCourseLinkService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def library(self, organization_id: str) -> List[TrainingCourse]:
        rows = await self.db.execute(
            select(TrainingCourse)
            .where(TrainingCourse.organization_id == str(organization_id))
            .where(TrainingCourse.active.is_(True))
            .order_by(TrainingCourse.name)
        )
        return list(rows.scalars().all())

    async def unlinked_names(self, organization_id: str) -> List[UnlinkedName]:
        """Every name unlinked records carry, most records first."""
        org_id = str(organization_id)
        # One row per spelling and member: a member's records under two
        # spellings of one name are one member, which a count per spelling
        # cannot tell.
        rows = await self.db.execute(
            select(
                TrainingRecord.course_name,
                TrainingRecord.user_id,
                func.count(TrainingRecord.id),
                func.min(TrainingRecord.completion_date),
                func.max(TrainingRecord.completion_date),
            )
            .where(TrainingRecord.organization_id == org_id)
            .where(TrainingRecord.course_id.is_(None))
            .group_by(TrainingRecord.course_name, TrainingRecord.user_id)
        )
        names: Dict[str, UnlinkedName] = {}
        spellings: Dict[str, Dict[str, int]] = {}
        for course_name, user_id, count, first, last in rows.all():
            key = name_key(course_name)
            if not key:
                continue
            entry = names.setdefault(key, UnlinkedName(key=key))
            entry.records += count
            entry.members.add(str(user_id))
            if first is not None and (
                entry.first_date is None or first < entry.first_date
            ):
                entry.first_date = first
            if last is not None and (entry.last_date is None or last > entry.last_date):
                entry.last_date = last
            by_spelling = spellings.setdefault(key, {})
            by_spelling[course_name] = by_spelling.get(course_name, 0) + count

        courses = await self.library(org_id)
        candidates = SuggestionCandidates(
            mapped=[],
            library=[(normalize_course_title(c.name), str(c.id)) for c in courses],
            courses={str(c.id): c for c in courses},
        )
        for key, entry in names.items():
            entry.spellings = sorted(
                (Spelling(name, n) for name, n in spellings[key].items()),
                key=lambda s: (-s.records, s.name),
            )
            # The provider-mapping matcher with no provider evidence: it then
            # compares the name against the library alone.
            entry.suggested_course = candidates.pick("", entry.label)
        return sorted(names.values(), key=lambda n: (-n.records, n.key))

    async def link(self, organization_id: str, key: str, course_id: str) -> LinkResult:
        """Link every unlinked record carrying this name to the course.

        Raises ``ValueError`` for a course outside the department or retired,
        and for a name no unlinked record carries.
        """
        org_id = str(organization_id)
        course = (
            await self.db.execute(
                select(TrainingCourse)
                .where(TrainingCourse.id == str(course_id))
                .where(TrainingCourse.organization_id == org_id)
                .where(TrainingCourse.active.is_(True))
            )
        ).scalar_one_or_none()
        if course is None:
            raise ValueError("That course is not in the department's library.")
        spellings = await self._spellings(org_id, [key])
        if not spellings.get(key):
            raise ValueError("No unlinked training records carry that name.")
        records = await self._apply(org_id, spellings[key], course)
        return LinkResult(names=1, records=records)

    async def link_suggested(self, organization_id: str) -> LinkResult:
        """Link every name that has a suggestion to its suggested course."""
        org_id = str(organization_id)
        names = records = 0
        for entry in await self.unlinked_names(org_id):
            if entry.suggested_course is None:
                continue
            records += await self._apply(
                org_id, [s.name for s in entry.spellings], entry.suggested_course
            )
            names += 1
        return LinkResult(names=names, records=records)

    async def _spellings(
        self, org_id: str, keys: Sequence[str]
    ) -> Dict[str, List[str]]:
        """The stored spellings of each name, read now rather than trusted
        from the client, which only ever sends the grouped key."""
        wanted = set(keys)
        rows = await self.db.execute(
            select(TrainingRecord.course_name)
            .where(TrainingRecord.organization_id == org_id)
            .where(TrainingRecord.course_id.is_(None))
            .distinct()
        )
        found: Dict[str, List[str]] = {}
        for (course_name,) in rows.all():
            key = name_key(course_name)
            if key in wanted:
                found.setdefault(key, []).append(course_name)
        return found

    async def _apply(
        self, org_id: str, spellings: Sequence[str], course: TrainingCourse
    ) -> int:
        values: Dict[str, object] = {"course_id": str(course.id)}
        category_id = await course_category_id(self.db, str(course.id), org_id)
        if category_id:
            values["category_id"] = category_id
        if course.training_type:
            values["training_type"] = course.training_type
        linked_ids: List[str] = []
        changed = 0
        for start in range(0, len(spellings), _NAME_CHUNK):
            chunk = list(spellings[start : start + _NAME_CHUNK])
            # Only records still without a course: the guard is what makes a
            # second link a no-op, and what keeps a hand-picked course.
            match = (
                (TrainingRecord.organization_id == org_id)
                & TrainingRecord.course_id.is_(None)
                & TrainingRecord.course_name.in_(chunk)
            )
            if course.grants_qualification:
                linked_ids.extend(
                    str(rid)
                    for rid in (
                        await self.db.execute(select(TrainingRecord.id).where(match))
                    )
                    .scalars()
                    .all()
                )
            result = await self.db.execute(
                update(TrainingRecord)
                .where(match)
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            changed += int(rows_affected(result) or 0)
        if linked_ids:
            await self._sync_qualifications(org_id, linked_ids)
        return changed

    async def _sync_qualifications(self, org_id: str, record_ids: List[str]) -> None:
        """A course that grants a qualification certifies the members whose
        records now point at it, as recording the class would have."""
        service = QualificationService(self.db)
        for start in range(0, len(record_ids), _NAME_CHUNK):
            records = (
                await self.db.execute(
                    select(TrainingRecord)
                    .where(TrainingRecord.organization_id == org_id)
                    .where(
                        TrainingRecord.id.in_(record_ids[start : start + _NAME_CHUNK])
                    )
                    .execution_options(populate_existing=True)
                )
            ).scalars()
            for record in records:
                try:
                    await service.sync_from_training_record(record)
                except Exception:
                    # The link is the officer's decision and is kept; a grant
                    # that did not follow is logged for the record, as the
                    # record endpoints do.
                    logger.exception(
                        "Qualification sync failed for linked record {}", record.id
                    )
