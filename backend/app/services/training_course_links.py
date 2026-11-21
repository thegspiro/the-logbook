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
from datetime import date, datetime, timezone
from types import SimpleNamespace
from typing import Dict, List, Optional, Sequence, Set, Tuple

from loguru import logger
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import TrainingCourse, TrainingRecord
from app.models.training_course_link import (
    TrainingCourseLink,
    TrainingCourseLinkRecord,
)
from app.services.external_course_mapping import (
    SuggestionCandidates,
    course_category_id,
    normalize_course_title,
)
from app.services.qualification_service import QualificationService
from app.utils.edit_window import EDIT_TOLERANCE, as_utc, changed_since
from app.utils.sql_results import rows_affected
from app.utils.training_match_key import training_match_key

# Keeps each IN list a reasonable size when a name has many spellings or a
# course certifies many records.
_NAME_CHUNK = 500


# MySQL deadlock and lock-wait timeout. Either rolls the transaction back
# whole, so the officer can simply try again.
_LOCK_CONFLICTS = {1213, 1205}


class CourseLinkBusy(Exception):
    """A link collided with another one running on the same records.

    The locking reads in ``_apply`` take record locks by name and then by id,
    so two overlapping links (two officers, or "Link all suggested" beside a
    single link) can deadlock; InnoDB rolls one back. That is a retry, not a
    server error.
    """

    def __init__(self) -> None:
        super().__init__(
            "Another course link was changing these records at the same time. "
            "Nothing was linked; try again."
        )


def _is_lock_conflict(exc: OperationalError) -> bool:
    orig = exc.orig
    code = orig.args[0] if orig is not None and orig.args else None
    return code in _LOCK_CONFLICTS


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
class UnlinkResult:
    reverted: int
    kept: int


def _label_of(spellings: Sequence[str]) -> str:
    return sorted(spellings)[0] if spellings else ""


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

    async def link(
        self,
        organization_id: str,
        key: str,
        course_id: str,
        linked_by: Optional[str] = None,
    ) -> LinkResult:
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
        try:
            records = await self._apply(
                org_id,
                spellings[key],
                course,
                key,
                _label_of(spellings[key]),
                linked_by,
            )
        except OperationalError as exc:
            if _is_lock_conflict(exc):
                raise CourseLinkBusy() from exc
            raise
        return LinkResult(names=1, records=records)

    async def link_suggested(
        self, organization_id: str, linked_by: Optional[str] = None
    ) -> LinkResult:
        """Link every name that has a suggestion to its suggested course."""
        org_id = str(organization_id)
        names = records = 0
        for entry in await self.unlinked_names(org_id):
            if entry.suggested_course is None:
                continue
            try:
                records += await self._apply(
                    org_id,
                    [s.name for s in entry.spellings],
                    entry.suggested_course,
                    entry.key,
                    entry.label,
                    linked_by,
                )
            except OperationalError as exc:
                if _is_lock_conflict(exc):
                    raise CourseLinkBusy() from exc
                raise
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
        self,
        org_id: str,
        spellings: Sequence[str],
        course: TrainingCourse,
        key: str,
        label: str,
        linked_by: Optional[str],
    ) -> int:
        """Link the records and keep what each held before, so the link can be
        undone (``unlink``)."""
        values: Dict[str, object] = {"course_id": str(course.id)}
        category_id = await course_category_id(self.db, str(course.id), org_id)
        if category_id:
            values["category_id"] = category_id
        if course.training_type:
            values["training_type"] = course.training_type
        before: Dict[str, Tuple[Optional[str], Optional[str]]] = {}
        for start in range(0, len(spellings), _NAME_CHUNK):
            chunk = list(spellings[start : start + _NAME_CHUNK])
            # Only records still without a course: the guard is what makes a
            # second link a no-op, and what keeps a hand-picked course. A
            # locking read (pitfall #27): a plain one answers from this
            # transaction's snapshot, so a link racing another of the same
            # name read the records as unlinked after the first had linked
            # them. Locked, it waits for the first and reads them as linked.
            rows = await self.db.execute(
                select(
                    TrainingRecord.id,
                    TrainingRecord.category_id,
                    TrainingRecord.training_type,
                )
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.course_id.is_(None),
                    TrainingRecord.course_name.in_(chunk),
                )
                .with_for_update()
            )
            for rid, category, training_type in rows.all():
                before[str(rid)] = (
                    str(category) if category else None,
                    getattr(training_type, "value", training_type),
                )
        if not before:
            return 0
        link = TrainingCourseLink(
            organization_id=org_id,
            course_id=str(course.id),
            course_name=course.name[:255],
            name_key=key[:255],
            label=label[:255],
            record_count=len(before),
            linked_by=str(linked_by) if linked_by else None,
        )
        self.db.add(link)
        await self.db.flush()
        ids = sorted(before)
        linked: List[str] = []
        for start in range(0, len(ids), _NAME_CHUNK):
            chunk = ids[start : start + _NAME_CHUNK]
            # Exactly the rows this write will change, read and locked as
            # committed: only those are this link's to record and undo. Behind
            # the locking read above it is every row read; it is what keeps a
            # link that changed nothing from claiming records another link
            # changed, whose undo would then revert that link's work.
            still_unlinked = await self.db.execute(
                select(TrainingRecord.id)
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.course_id.is_(None),
                    TrainingRecord.id.in_(chunk),
                )
                .with_for_update()
            )
            changing = sorted(str(rid) for (rid,) in still_unlinked.all())
            if not changing:
                continue
            await self.db.execute(
                update(TrainingRecord)
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.course_id.is_(None),
                    TrainingRecord.id.in_(changing),
                )
                .values(**values)
                .execution_options(synchronize_session=False)
            )
            linked.extend(changing)
        if not linked:
            # Nothing changed, so there is nothing to record or undo.
            await self.db.delete(link)
            await self.db.flush()
            return 0
        link.record_count = len(linked)
        self.db.add_all(
            TrainingCourseLinkRecord(
                link_id=link.id,
                record_id=rid,
                previous_category_id=before[rid][0],
                previous_training_type=before[rid][1],
            )
            for rid in linked
        )
        await self.db.flush()
        if course.grants_qualification:
            await self._sync_qualifications(org_id, linked)
        return len(linked)

    async def history(
        self, organization_id: str, offset: int, limit: int
    ) -> Tuple[List[TrainingCourseLink], int]:
        """The department's links, newest first."""
        org_id = str(organization_id)
        total = await self.db.scalar(
            select(func.count())
            .select_from(TrainingCourseLink)
            .where(TrainingCourseLink.organization_id == org_id)
        )
        rows = await self.db.execute(
            select(TrainingCourseLink)
            .where(TrainingCourseLink.organization_id == org_id)
            .order_by(TrainingCourseLink.linked_at.desc(), TrainingCourseLink.id)
            .offset(offset)
            .limit(limit)
        )
        return list(rows.scalars().all()), int(total or 0)

    async def unlink(
        self, organization_id: str, link_id: str, undone_by: str
    ) -> UnlinkResult:
        """Put a link's records back as they were: no course, and the category
        and training type each had before.

        A record changed since the link, or since linked to another course by
        hand, is the officer's and keeps its course; it is counted as kept.
        Raises ``ValueError`` for a link not in the department or already undone.
        """
        org_id = str(organization_id)
        link = (
            await self.db.execute(
                select(TrainingCourseLink)
                .where(
                    TrainingCourseLink.id == str(link_id),
                    TrainingCourseLink.organization_id == org_id,
                )
                .with_for_update()
            )
        ).scalar_one_or_none()
        if link is None:
            raise ValueError("That link was not found.")
        if link.undone_at is not None:
            raise ValueError("That link has already been undone.")
        rows = await self.db.execute(
            select(
                TrainingCourseLinkRecord.record_id,
                TrainingCourseLinkRecord.previous_category_id,
                TrainingCourseLinkRecord.previous_training_type,
                TrainingRecord.course_id,
                TrainingRecord.updated_at,
                TrainingRecord.user_id,
            )
            .join(
                TrainingRecord, TrainingRecord.id == TrainingCourseLinkRecord.record_id
            )
            .where(
                TrainingCourseLinkRecord.link_id == link.id,
                TrainingRecord.organization_id == org_id,
            )
        )
        restore: Dict[Tuple[Optional[str], Optional[str]], List[str]] = {}
        users: set[str] = set()
        candidates = 0
        for rid, category, training_type, course_id, updated_at, user_id in rows.all():
            candidates += 1
            if str(course_id or "") != str(link.course_id or "") or changed_since(
                updated_at, link.linked_at
            ):
                continue
            restore.setdefault((category, training_type), []).append(str(rid))
            users.add(str(user_id))
        # The read above is a snapshot, so the UPDATE re-checks the same test
        # against the row as committed (pitfall #27): a record an officer
        # re-linked or edited after the read keeps their change. Anything the
        # UPDATE skips is counted as kept.
        still_linked = (
            TrainingRecord.course_id.is_(None)
            if link.course_id is None
            else TrainingRecord.course_id == str(link.course_id)
        )
        # linked_at is never null (server default); were it, changed_since
        # above reads every record as untouched, and so does this.
        linked_at = as_utc(link.linked_at) or datetime.now(timezone.utc)
        untouched_until = linked_at + EDIT_TOLERANCE
        reverted = 0
        for (category, training_type), ids in restore.items():
            values: Dict[str, object] = {"course_id": None, "category_id": category}
            if training_type:
                values["training_type"] = training_type
            for start in range(0, len(ids), _NAME_CHUNK):
                result = await self.db.execute(
                    update(TrainingRecord)
                    .where(
                        TrainingRecord.organization_id == org_id,
                        TrainingRecord.id.in_(ids[start : start + _NAME_CHUNK]),
                        still_linked,
                        or_(
                            TrainingRecord.updated_at.is_(None),
                            TrainingRecord.updated_at <= untouched_until,
                        ),
                    )
                    .values(**values)
                    .execution_options(synchronize_session=False)
                )
                reverted += int(rows_affected(result) or 0)
        kept = candidates - reverted
        if link.course_id and users:
            # A recompute from the records still on the course: one that no
            # longer supports a granted qualification removes it.
            service = QualificationService(self.db)
            for user_id in sorted(users):
                await service.sync_from_training_record(
                    SimpleNamespace(
                        organization_id=org_id,
                        user_id=user_id,
                        course_id=link.course_id,
                    )
                )
        link.undone_at = datetime.now(timezone.utc)
        link.undone_by = str(undone_by)
        await self.db.flush()
        return UnlinkResult(reverted=reverted, kept=kept)

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
