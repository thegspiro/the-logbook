"""
Mapping a training provider's course ids to courses in the department library.

Target Solutions reissues a course under a new Course ID when it publishes a
new version — a new HIPAA video, a re-accredited CAPCE course. Requirements
link to a library course, so every version a department maps to that course
satisfies the same requirement, and a new version never needs the requirement
edited (a COURSES requirement needs *all* its linked courses, so linking both
versions to it would demand both).

Between a new version arriving and an officer mapping it, members who took it
are not credited. That gap is closed from both ends: training officers are
emailed when a new course looks like a library course, and mapping a course
fills in ``course_id`` on the training records already imported from it.

Suggestions are offered, never applied: a wrong guess would quietly credit a
requirement, so the officer confirms every mapping.
"""

import html
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Sequence, Tuple

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.training import (
    ExternalCourseMapping,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    TrainingCategory,
    TrainingCourse,
    TrainingRecord,
)
from app.models.user import Organization, User

# Where an officer maps courses: Training Admin → Setup → Integrations.
MAPPINGS_PATH = "/training/admin?page=setup&tab=integrations"

# How alike two normalized titles must be to suggest one for the other. High
# enough that "HIPAA Awareness" does not suggest "HIPAA Privacy for Officers",
# low enough to survive a reworded version ("... 2027", "Part I" → "Part 1").
SUGGESTION_THRESHOLD = 0.85

TRAINING_OFFICER_PERMISSIONS = ("training.manage",)

# "CAPCE HIPAA Awareness (3088740)": the trailing number is Target Solutions'
# Course ID, and "CAPCE" names the accreditation, not the subject. Neither
# says which course it is, and both change between versions.
_TRAILING_ID = re.compile(r"\(\s*\d+\s*\)\s*$")
_ACCREDITATION_PREFIX = re.compile(r"^\s*capce\b", re.IGNORECASE)
_NON_WORD = re.compile(r"[^0-9a-z]+")


def normalize_course_title(title: Optional[str]) -> str:
    """A title reduced to the words that say which course it is."""
    text = _TRAILING_ID.sub("", title or "")
    text = _ACCREDITATION_PREFIX.sub("", text).lower()
    return " ".join(_NON_WORD.sub(" ", text).split())


def _similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


class SuggestionCandidates:
    """Everything a suggestion is chosen from, loaded once per request.

    Two kinds of evidence: another course id from the same provider that an
    officer already mapped (an earlier version of the course), and an active
    library course whose own name matches.
    """

    def __init__(
        self,
        mapped: List[Tuple[str, str, str]],
        library: List[Tuple[str, str]],
        courses: Dict[str, TrainingCourse],
    ):
        self.mapped = mapped
        self.library = library
        self.courses = courses

    def pick(
        self, external_course_id: str, external_course_name: str
    ) -> Optional[TrainingCourse]:
        target = normalize_course_title(external_course_name)
        if not target:
            return None
        best_score, best_course_id = 0.0, None
        for other_id, name, course_id in self.mapped:
            if other_id == external_course_id:
                continue
            score = _similarity(target, name)
            if score > best_score:
                best_score, best_course_id = score, course_id
        for name, course_id in self.library:
            score = _similarity(target, name)
            if score > best_score:
                best_score, best_course_id = score, course_id
        if best_course_id is None or best_score < SUGGESTION_THRESHOLD:
            return None
        return self.courses.get(best_course_id)


async def load_suggestion_candidates(
    db: AsyncSession, provider: ExternalTrainingProvider
) -> SuggestionCandidates:
    library_courses = (
        (
            await db.execute(
                select(TrainingCourse)
                .where(TrainingCourse.organization_id == provider.organization_id)
                .where(TrainingCourse.active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    courses = {str(c.id): c for c in library_courses}
    mapped_rows = await db.execute(
        select(
            ExternalCourseMapping.external_course_id,
            ExternalCourseMapping.external_course_name,
            ExternalCourseMapping.internal_course_id,
        )
        .where(ExternalCourseMapping.provider_id == provider.id)
        .where(ExternalCourseMapping.organization_id == provider.organization_id)
        .where(ExternalCourseMapping.internal_course_id.isnot(None))
    )
    # A mapping to a course since retired is no evidence for a new mapping.
    mapped = [
        (str(ext_id), normalize_course_title(name), str(course_id))
        for ext_id, name, course_id in mapped_rows.all()
        if str(course_id) in courses
    ]
    library = [(normalize_course_title(c.name), cid) for cid, c in courses.items()]
    return SuggestionCandidates(mapped, library, courses)


async def find_or_create_course_mapping(
    db: AsyncSession,
    provider: ExternalTrainingProvider,
    external_course_id: str,
    external_course_name: str,
) -> Tuple[ExternalCourseMapping, bool]:
    """The mapping row for a provider course id, created unmapped if new.

    Returns the row and whether it was created. Callers hold the provider
    lock, so two runs never create the same row; the unique index backs that.
    """
    existing = (
        await db.execute(
            select(ExternalCourseMapping)
            .where(ExternalCourseMapping.provider_id == provider.id)
            .where(ExternalCourseMapping.external_course_id == external_course_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False
    mapping = ExternalCourseMapping(
        provider_id=provider.id,
        organization_id=provider.organization_id,
        external_course_id=external_course_id,
        external_course_name=(external_course_name or external_course_id)[:500],
        is_mapped=False,
    )
    db.add(mapping)
    await db.flush()
    return mapping, True


async def mapped_course_id(
    db: AsyncSession,
    provider_id: str,
    organization_id: str,
    external_course_id: Optional[str],
) -> Optional[str]:
    """The library course a provider course id is mapped to, or None."""
    if not external_course_id:
        return None
    course_id = (
        await db.execute(
            select(ExternalCourseMapping.internal_course_id)
            .where(ExternalCourseMapping.provider_id == provider_id)
            .where(ExternalCourseMapping.organization_id == organization_id)
            .where(ExternalCourseMapping.external_course_id == external_course_id)
        )
    ).scalar_one_or_none()
    return str(course_id) if course_id else None


async def course_category_id(
    db: AsyncSession, course_id: str, organization_id: str
) -> Optional[str]:
    """The category an import of this library course is filed under.

    A course can count toward several categories; a training record holds
    one, so it takes the first of the course's categories that is still an
    active category in the organization.
    """
    category_ids = (
        await db.execute(
            select(TrainingCourse.category_ids)
            .where(TrainingCourse.id == course_id)
            .where(TrainingCourse.organization_id == organization_id)
        )
    ).scalar_one_or_none()
    wanted = [str(c) for c in (category_ids or []) if c]
    if not wanted:
        return None
    present = set(
        (
            await db.execute(
                select(TrainingCategory.id)
                .where(TrainingCategory.id.in_(wanted))
                .where(TrainingCategory.organization_id == organization_id)
                .where(TrainingCategory.active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    return next((c for c in wanted if c in present), None)


async def apply_course_mapping(
    db: AsyncSession,
    mapping: ExternalCourseMapping,
    internal_course_id: Optional[str],
    mapped_by: str,
) -> int:
    """Map (or unmap) a provider course and update records already imported.

    Records imported from this course id take the new library course, which
    is what credits members who completed a new version before it was mapped.
    Only records still on the previous mapping (or on none) move: a record an
    officer linked to some other course by hand keeps it. Returns how many
    training records changed.
    """
    previous = mapping.internal_course_id
    mapping.internal_course_id = internal_course_id
    mapping.is_mapped = internal_course_id is not None
    mapping.mapped_by = mapped_by

    imported_from_course = (
        select(ExternalTrainingImport.training_record_id)
        .where(ExternalTrainingImport.provider_id == mapping.provider_id)
        .where(ExternalTrainingImport.organization_id == mapping.organization_id)
        .where(ExternalTrainingImport.external_course_id == mapping.external_course_id)
        .where(ExternalTrainingImport.training_record_id.isnot(None))
    )
    unchanged_link = (
        TrainingRecord.course_id.is_(None)
        if previous is None
        else (TrainingRecord.course_id.is_(None))
        | (TrainingRecord.course_id == previous)
    )
    result = await db.execute(
        update(TrainingRecord)
        .where(TrainingRecord.organization_id == mapping.organization_id)
        .where(TrainingRecord.id.in_(imported_from_course))
        .where(unchanged_link)
        .values(course_id=internal_course_id)
        .execution_options(synchronize_session=False)
    )

    # The course's category follows it onto records that had none, or only
    # the provider's catch-all default. A category an officer or a category
    # mapping chose is kept. Unmapping leaves categories as they are.
    if internal_course_id:
        category_id = await course_category_id(
            db, internal_course_id, mapping.organization_id
        )
        if category_id:
            default_category_id = (
                await db.execute(
                    select(ExternalTrainingProvider.default_category_id).where(
                        ExternalTrainingProvider.id == mapping.provider_id
                    )
                )
            ).scalar_one_or_none()
            replaceable = TrainingRecord.category_id.is_(None)
            if default_category_id:
                replaceable = replaceable | (
                    TrainingRecord.category_id == default_category_id
                )
            await db.execute(
                update(TrainingRecord)
                .where(TrainingRecord.organization_id == mapping.organization_id)
                .where(TrainingRecord.id.in_(imported_from_course))
                .where(TrainingRecord.course_id == internal_course_id)
                .where(replaceable)
                .values(category_id=category_id)
                .execution_options(synchronize_session=False)
            )
    return int(result.rowcount or 0)


async def completion_counts(
    db: AsyncSession, provider_id: str, organization_id: str
) -> Dict[str, int]:
    """Distinct members who completed each provider course id."""
    rows = await db.execute(
        select(
            ExternalTrainingImport.external_course_id,
            func.count(func.distinct(ExternalTrainingImport.external_user_id)),
        )
        .where(ExternalTrainingImport.provider_id == provider_id)
        .where(ExternalTrainingImport.organization_id == organization_id)
        .where(ExternalTrainingImport.external_course_id.isnot(None))
        .where(ExternalTrainingImport.import_status != "duplicate")
        .group_by(ExternalTrainingImport.external_course_id)
    )
    return {str(course_id): int(count) for course_id, count in rows.all()}


async def _training_officers(db: AsyncSession, organization_id: str) -> List[User]:
    """Live members of the org who hold ``training.manage``."""
    from app.core.permissions import permission_matches_any

    result = await db.execute(
        select(User)
        .where(User.organization_id == organization_id)
        .where(User.deleted_at.is_(None))
        .where(User.is_active == True)  # noqa: E712
        .where(User.email.isnot(None))
        .options(selectinload(User.roles))
    )
    officers: List[User] = []
    for user in result.scalars().all():
        granted: set[str] = set()
        for role in user.roles or []:
            granted.update(role.permissions or [])
        if permission_matches_any(TRAINING_OFFICER_PERMISSIONS, granted):
            officers.append(user)
    return officers


def _course_lines(
    entries: Sequence[Tuple[ExternalCourseMapping, TrainingCourse, int]],
) -> Tuple[str, str]:
    cells = []
    lines = []
    for mapping, course, members in entries:
        took = f"{members} member{'' if members == 1 else 's'} completed it"
        cells.append(
            '<tr><td class="fact" colspan="2">'
            f'<p class="fact-label">{html.escape(mapping.external_course_name)} '
            f"&middot; Course ID {html.escape(mapping.external_course_id)}</p>"
            f'<p class="fact-value">Looks like {html.escape(course.name)} '
            f"&middot; {took}</p></td></tr>"
        )
        lines.append(
            f"- {mapping.external_course_name} (Course ID "
            f"{mapping.external_course_id}): looks like {course.name}; {took}"
        )
    table = (
        '<table class="facts" role="presentation" cellpadding="0" '
        f'cellspacing="0">{"".join(cells)}</table>'
    )
    return table, "\n".join(lines)


async def notify_new_course_matches(
    db: AsyncSession,
    provider: ExternalTrainingProvider,
    mapping_ids: Sequence[str],
) -> int:
    """Email training officers about new, unmapped courses that match the library.

    Only courses that look like a library course are emailed: those are the
    new versions a requirement may depend on. Courses with no likeness — a
    one-off continuing-education course — are listed under Mappings without
    an email. Each course is emailed about once. Returns emails sent.
    """
    from app.services.email_policy import (
        EmailKind,
        department_required_kinds,
        recipients_for,
    )
    from app.services.email_service import EmailService

    if not mapping_ids:
        return 0
    mappings = (
        (
            await db.execute(
                select(ExternalCourseMapping)
                .where(ExternalCourseMapping.id.in_(list(mapping_ids)))
                .where(
                    ExternalCourseMapping.organization_id == provider.organization_id
                )
                .where(ExternalCourseMapping.internal_course_id.is_(None))
                .where(ExternalCourseMapping.notified_at.is_(None))
            )
        )
        .scalars()
        .all()
    )
    counts = await completion_counts(db, provider.id, provider.organization_id)
    candidates = await load_suggestion_candidates(db, provider)
    entries: List[Tuple[ExternalCourseMapping, TrainingCourse, int]] = []
    for mapping in mappings:
        course = candidates.pick(
            mapping.external_course_id, mapping.external_course_name
        )
        if course is not None:
            entries.append((mapping, course, counts.get(mapping.external_course_id, 0)))
    if not entries:
        return 0

    org = (
        await db.execute(
            select(Organization).where(Organization.id == provider.organization_id)
        )
    ).scalar_one_or_none()
    officers = recipients_for(
        await _training_officers(db, provider.organization_id),
        EmailKind.TRAINING_DUTIES,
        department_required_kinds(org),
    )
    courses_html, courses_text = _course_lines(entries)
    context = {
        "provider_name": provider.name,
        "course_count": str(len(entries)),
        "courses_html": courses_html,
        "courses_text": courses_text,
        "mappings_url": f"{settings.FRONTEND_URL.rstrip('/')}{MAPPINGS_PATH}",
    }
    email_service = EmailService(organization=org)
    sent = 0
    for officer in officers:
        try:
            if await email_service.send_external_course_match_email(
                to_email=officer.email,
                context={
                    **context,
                    "recipient_name": officer.display_name or officer.username,
                },
                db=db,
                organization_id=provider.organization_id,
            ):
                sent += 1
        except Exception as e:
            logger.error(f"Course-match email to officer {officer.id} failed: {e}")

    # Marked even when nobody could be emailed (no officer, or all opted
    # out): the course is still listed under Mappings, and emailing it on
    # every later sync would only repeat a message nobody receives.
    now = datetime.now(timezone.utc)
    for mapping, _, _ in entries:
        mapping.notified_at = now
    return sent
