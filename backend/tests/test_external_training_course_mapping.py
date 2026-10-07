"""
A provider's course ids map to courses in the department library.

Target Solutions reissues a course under a new Course ID for each new version.
A requirement links to the library course, so every mapped version satisfies
it; mapping a new version credits the members who already took it; and
training officers are emailed when a new course looks like a library course,
so the gap between release and mapping stays short. Suggestions are offered,
never applied.
"""

import io
import uuid
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import select

from app.api.v1.endpoints.external_training import (
    list_course_mappings,
    update_course_mapping,
    upload_report,
)
from app.models.training import (
    DueDateType,
    ExternalCourseMapping,
    ExternalProviderType,
    ExternalTrainingProvider,
    RequirementFrequency,
    RequirementType,
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingType,
)
from app.models.user import Organization, Position, User, UserStatus
from app.schemas.training import ExternalCourseMappingUpdate
from app.services.email_service import EmailService
from app.services.external_course_mapping import (
    SuggestionCandidates,
    _course_lines,
    normalize_course_title,
)
from app.services.training_compliance import evaluate_member_requirement

PREAMBLE = "Completions (via API),,,,,,,,,,,,,,,,,,\n"
HEADER = (
    "Employee ID,Email,Assignment Name,Assignment Type,Assigned By,Date Assigned,"
    "Date Due,Completion Date,Completion Time,Time Spent In Course,Test Score,"
    "Test Attempts,Tags,Course ID,Transcript ID,RMS Code,Duration (hours),"
    "Instructor,Location"
)


def _row(email, title, course_id, transcript, completed="9/30/2026"):
    return (
        f'1001,{email},"{title}",TS Course,,{completed},,{completed},7:31 PM,95,'
        f"100%,1,,{course_id},{transcript},,1,,"
    )


def _report(*rows):
    return PREAMBLE + "\n".join([HEADER, *rows]) + "\n"


def _upload(text):
    return UploadFile(file=io.BytesIO(text.encode("utf-8")), filename="report.csv")


HIPAA_2026 = ("CAPCE HIPAA Awareness (3088740)", "3088740")
HIPAA_2027 = ("CAPCE HIPAA Awareness (4123987)", "4123987")
SEPSIS = ("CAPCE Sepsis (2861511)", "2861511")


@pytest.mark.unit
class TestNormalizeCourseTitle:
    @pytest.mark.parametrize(
        ("title", "expected"),
        [
            ("CAPCE HIPAA Awareness (3088740)", "hipaa awareness"),
            ("HIPAA Awareness", "hipaa awareness"),
            (
                "  capce  Dementia: Overview, Assessment, and Care (2841231) ",
                "dementia overview assessment and care",
            ),
            ("General First Aid, Part I", "general first aid part i"),
            ("", ""),
            (None, ""),
        ],
    )
    def test_reduces_a_title_to_what_names_the_course(self, title, expected):
        assert normalize_course_title(title) == expected


def _course(name, course_id=None):
    return SimpleNamespace(id=course_id or str(uuid.uuid4()), name=name)


@pytest.mark.unit
class TestPickSuggestion:
    def _candidates(self, library=(), mapped=()):
        courses = {c.id: c for c in library}
        return SuggestionCandidates(
            [(ext, normalize_course_title(n), cid) for ext, n, cid in mapped],
            [(normalize_course_title(c.name), c.id) for c in library],
            courses,
        )

    def test_matches_a_library_course_by_name(self):
        hipaa = _course("HIPAA Awareness")
        candidates = self._candidates(library=[hipaa, _course("Sepsis")])

        assert candidates.pick(*reversed(HIPAA_2026)) is hipaa

    def test_matches_an_earlier_mapped_version(self):
        # The library course is named nothing like the provider's title; the
        # earlier version's mapping is what recognises the new one.
        privacy = _course("Annual Privacy Training")
        candidates = self._candidates(
            library=[privacy], mapped=[("3088740", HIPAA_2026[0], privacy.id)]
        )

        assert candidates.pick("4123987", HIPAA_2027[0]) is privacy

    def test_a_reworded_version_still_matches(self):
        hipaa = _course("HIPAA Awareness")
        candidates = self._candidates(library=[hipaa])

        assert candidates.pick("9", "CAPCE HIPAA Awareness 2027 (9)") is hipaa

    def test_an_unrelated_course_suggests_nothing(self):
        candidates = self._candidates(library=[_course("HIPAA Awareness")])

        assert candidates.pick(*reversed(SEPSIS)) is None

    def test_a_similar_but_different_course_suggests_nothing(self):
        candidates = self._candidates(library=[_course("HIPAA Awareness")])

        assert candidates.pick("7", "HIPAA Privacy Rules for Officers (7)") is None

    def test_a_course_is_not_its_own_evidence(self):
        privacy = _course("Annual Privacy Training")
        candidates = self._candidates(
            library=[privacy], mapped=[("3088740", HIPAA_2026[0], privacy.id)]
        )

        assert candidates.pick("3088740", HIPAA_2026[0]) is None


@pytest.mark.unit
def test_course_lines_escape_provider_text():
    mapping = SimpleNamespace(
        external_course_name="<b>HIPAA</b> & You", external_course_id="1<2"
    )
    html_part, text_part = _course_lines([(mapping, _course("HIPAA & Privacy"), 1)])

    assert "<b>HIPAA</b>" not in html_part
    assert "&lt;b&gt;HIPAA&lt;/b&gt; &amp; You" in html_part
    assert "1&lt;2" in html_part
    assert "1 member completed it" in text_part


async def _setup(db_session):
    org = Organization(
        id=str(uuid.uuid4()), name="Mapping Dept", slug=f"cm-{uuid.uuid4().hex[:8]}"
    )
    db_session.add(org)
    await db_session.flush()
    officer_position = Position(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Training Officer",
        slug=f"to-{uuid.uuid4().hex[:6]}",
        permissions=["training.manage"],
    )
    db_session.add(officer_position)
    await db_session.flush()
    officer = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"to{uuid.uuid4().hex[:8]}",
        email=f"to-{uuid.uuid4().hex[:6]}@dept.test",
        first_name="Terry",
        last_name="Officer",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    officer.positions = [officer_position]
    member = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m{uuid.uuid4().hex[:8]}",
        email="pat@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db_session.add_all([officer, member])
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Target Solutions",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
        api_base_url="https://app.targetsolutions.com/tsapp/api/",
    )
    hipaa = TrainingCourse(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="HIPAA Awareness",
        training_type=TrainingType.CONTINUING_EDUCATION,
        active=True,
    )
    db_session.add_all([provider, hipaa])
    await db_session.flush()
    return SimpleNamespace(
        org=org, officer=officer, member=member, provider=provider, hipaa=hipaa
    )


async def _mapping(db_session, ctx, external_course_id):
    return (
        await db_session.execute(
            select(ExternalCourseMapping).where(
                ExternalCourseMapping.provider_id == ctx.provider.id,
                ExternalCourseMapping.external_course_id == external_course_id,
            )
        )
    ).scalar_one()


async def _record(db_session, ctx, transcript):
    return (
        await db_session.execute(
            select(TrainingRecord).where(
                TrainingRecord.external_provider_id == ctx.provider.id,
                TrainingRecord.external_record_id == transcript,
            )
        )
    ).scalar_one()


async def _upload_report(db_session, ctx, *rows):
    with patch.object(
        EmailService, "send_external_course_match_email", AsyncMock(return_value=True)
    ) as sent:
        await upload_report(
            uuid.UUID(ctx.provider.id),
            _upload(_report(*rows)),
            db_session,
            ctx.officer,
        )
    return sent


async def _map(db_session, ctx, mapping, course_id):
    return await update_course_mapping(
        uuid.UUID(ctx.provider.id),
        uuid.UUID(mapping.id),
        ExternalCourseMappingUpdate(
            internal_course_id=uuid.UUID(course_id) if course_id else None
        ),
        db_session,
        ctx.officer,
    )


@pytest.mark.integration
class TestMappingRows:
    async def test_each_course_id_gets_one_unmapped_row(self, db_session):
        ctx = await _setup(db_session)
        row = _row("pat@dept.test", *HIPAA_2026, "T-1")

        await _upload_report(db_session, ctx, row)
        await _upload_report(
            db_session, ctx, row, _row("pat@dept.test", *SEPSIS, "T-2")
        )

        mapping = await _mapping(db_session, ctx, "3088740")
        assert mapping.is_mapped is False
        assert mapping.external_course_name == HIPAA_2026[0]
        assert (await _mapping(db_session, ctx, "2861511")).internal_course_id is None

    async def test_list_offers_the_suggestion_without_applying_it(self, db_session):
        ctx = await _setup(db_session)
        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2026, "T-1"))

        listed = await list_course_mappings(
            uuid.UUID(ctx.provider.id), db_session, ctx.officer
        )

        (entry,) = listed
        assert entry.is_mapped is False
        assert entry.internal_course_id is None
        assert str(entry.suggested_course_id) == ctx.hipaa.id
        assert entry.suggested_course_name == "HIPAA Awareness"
        assert entry.members_completed == 1
        assert (await _record(db_session, ctx, "T-1")).course_id is None


@pytest.mark.integration
class TestMappingCreditsMembers:
    async def test_import_after_mapping_links_the_library_course(self, db_session):
        ctx = await _setup(db_session)
        await _upload_report(db_session, ctx, _row("nobody@x.test", *HIPAA_2026, "T-0"))
        await _map(
            db_session, ctx, await _mapping(db_session, ctx, "3088740"), ctx.hipaa.id
        )

        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2026, "T-1"))

        assert (await _record(db_session, ctx, "T-1")).course_id == ctx.hipaa.id

    async def test_mapping_a_new_version_credits_members_who_already_took_it(
        self, db_session
    ):
        ctx = await _setup(db_session)
        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2027, "T-9"))
        assert (await _record(db_session, ctx, "T-9")).course_id is None

        response = await _map(
            db_session, ctx, await _mapping(db_session, ctx, "4123987"), ctx.hipaa.id
        )

        assert response.records_updated == 1
        assert response.is_mapped is True
        assert response.internal_course_name == "HIPAA Awareness"
        record = await _record(db_session, ctx, "T-9")
        await db_session.refresh(record)
        assert record.course_id == ctx.hipaa.id

    async def test_unmapping_takes_the_course_back_off(self, db_session):
        ctx = await _setup(db_session)
        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2026, "T-1"))
        mapping = await _mapping(db_session, ctx, "3088740")
        await _map(db_session, ctx, mapping, ctx.hipaa.id)

        response = await _map(db_session, ctx, mapping, None)

        assert response.records_updated == 1
        record = await _record(db_session, ctx, "T-1")
        await db_session.refresh(record)
        assert record.course_id is None

    async def test_a_record_linked_to_another_course_by_hand_is_left_alone(
        self, db_session
    ):
        ctx = await _setup(db_session)
        other = TrainingCourse(
            id=str(uuid.uuid4()),
            organization_id=ctx.org.id,
            name="Privacy Refresher",
            training_type=TrainingType.REFRESHER,
            active=True,
        )
        db_session.add(other)
        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2026, "T-1"))
        record = await _record(db_session, ctx, "T-1")
        record.course_id = other.id
        await db_session.flush()

        response = await _map(
            db_session, ctx, await _mapping(db_session, ctx, "3088740"), ctx.hipaa.id
        )

        assert response.records_updated == 0
        await db_session.refresh(record)
        assert record.course_id == other.id


@pytest.mark.integration
class TestMappingIsOrgScoped:
    async def test_another_orgs_course_is_refused(self, db_session):
        ctx = await _setup(db_session)
        outsider = await _setup(db_session)
        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2026, "T-1"))

        with pytest.raises(HTTPException) as exc:
            await _map(
                db_session,
                ctx,
                await _mapping(db_session, ctx, "3088740"),
                outsider.hipaa.id,
            )
        assert exc.value.status_code == 400

    async def test_another_orgs_mapping_is_not_found(self, db_session):
        ctx = await _setup(db_session)
        outsider = await _setup(db_session)
        await _upload_report(db_session, ctx, _row("pat@dept.test", *HIPAA_2026, "T-1"))
        mapping = await _mapping(db_session, ctx, "3088740")

        with pytest.raises(HTTPException) as exc:
            await update_course_mapping(
                uuid.UUID(ctx.provider.id),
                uuid.UUID(mapping.id),
                ExternalCourseMappingUpdate(internal_course_id=None),
                db_session,
                outsider.officer,
            )
        assert exc.value.status_code == 404


@pytest.mark.integration
class TestOfficersAreEmailed:
    async def test_a_new_course_that_matches_the_library_is_emailed_once(
        self, db_session
    ):
        ctx = await _setup(db_session)

        first = await _upload_report(
            db_session, ctx, _row("pat@dept.test", *HIPAA_2027, "T-9")
        )
        again = await _upload_report(
            db_session, ctx, _row("pat@dept.test", *HIPAA_2027, "T-10")
        )

        assert first.await_count == 1
        call = first.await_args.kwargs
        assert call["to_email"] == ctx.officer.email
        assert call["context"]["recipient_name"] == ctx.officer.display_name
        assert call["context"]["course_count"] == "1"
        assert "Looks like HIPAA Awareness" in call["context"]["courses_html"]
        assert "4123987" in call["context"]["courses_text"]
        assert call["context"]["mappings_url"].endswith(
            "/training/admin?page=setup&tab=integrations"
        )
        assert again.await_count == 0
        assert (await _mapping(db_session, ctx, "4123987")).notified_at is not None

    async def test_a_course_like_nothing_in_the_library_is_not_emailed(
        self, db_session
    ):
        ctx = await _setup(db_session)

        sent = await _upload_report(
            db_session, ctx, _row("pat@dept.test", *SEPSIS, "T-1")
        )

        assert sent.await_count == 0

    async def test_members_without_the_permission_are_not_emailed(self, db_session):
        ctx = await _setup(db_session)

        sent = await _upload_report(
            db_session, ctx, _row("pat@dept.test", *HIPAA_2027, "T-9")
        )

        recipients = {c.kwargs["to_email"] for c in sent.await_args_list}
        assert ctx.member.email not in recipients


@pytest.mark.integration
class TestAnnualRequirementSurvivesANewVersion:
    async def test_either_mapped_version_meets_the_requirement(self, db_session):
        ctx = await _setup(db_session)
        requirement = TrainingRequirement(
            id=str(uuid.uuid4()),
            organization_id=ctx.org.id,
            name="Annual HIPAA",
            requirement_type=RequirementType.COURSES,
            frequency=RequirementFrequency.ANNUAL,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            required_courses=[ctx.hipaa.id],
            applies_to_all=True,
            active=True,
        )
        old = await _mapping_after_upload(db_session, ctx, HIPAA_2026, "T-1")
        await _map(db_session, ctx, old, ctx.hipaa.id)
        # The new version arrives; the member who took it is not yet credited.
        new = await _mapping_after_upload(db_session, ctx, HIPAA_2027, "T-2")
        assert await _status(db_session, ctx, requirement, "T-2") != "completed"

        await _map(db_session, ctx, new, ctx.hipaa.id)

        assert await _status(db_session, ctx, requirement, "T-1") == "completed"
        assert await _status(db_session, ctx, requirement, "T-2") == "completed"


async def _mapping_after_upload(db_session, ctx, course, transcript):
    await _upload_report(db_session, ctx, _row("pat@dept.test", *course, transcript))
    return await _mapping(db_session, ctx, course[1])


async def _status(db_session, ctx, requirement, transcript):
    record = await _record(db_session, ctx, transcript)
    await db_session.refresh(record)
    status, _, _ = evaluate_member_requirement(requirement, [record], date(2026, 10, 7))
    return status
