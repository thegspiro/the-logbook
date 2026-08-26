"""The course-to-qualification link, and the writer it gives member_qualifications.

``member_qualifications`` is read by shift eligibility and had no writer: a
training officer recorded the class that happened, then had to grant the
qualification again on another screen. ``TrainingCourse.grants_qualification``
closes that, so completing a course grants the qualification with the record's
own completion and expiry dates.

These cover the API surface and the sync rule. The seats a qualification
clears are asserted in tests/test_qualification_service.py.
"""

import re
from datetime import date
from pathlib import Path

import pydantic
import pytest

from app.schemas.training import TrainingCourseCreate, TrainingCourseUpdate
from app.services.qualification_service import QUALIFICATIONS


def _course(**kwargs):
    return TrainingCourseCreate(
        name="Paramedic", training_type="certification", **kwargs
    )


class TestGrantsQualificationValidation:
    def test_omitted_is_none(self):
        # A course that confers no seat is the norm, not an error: most
        # continuing education teaches something without qualifying anyone.
        assert _course().grants_qualification is None

    def test_accepted_and_normalized(self):
        assert (
            _course(grants_qualification="Paramedic").grants_qualification
            == "paramedic"
        )
        assert _course(grants_qualification="  EMT  ").grants_qualification == "emt"

    def test_a_shift_seat_is_not_a_qualification(self):
        # The two vocabularies are different on purpose: "ems" is a seat, and
        # which seats a qualification clears is the backend's mapping, not
        # something a course states.
        with pytest.raises(pydantic.ValidationError):
            _course(grants_qualification="ems")

    def test_blank_clears_rather_than_storing_empty(self):
        # An emptied form field means "no seat", not a target_position of "".
        assert _course(grants_qualification="   ").grants_qualification is None

    def test_unknown_value_is_rejected(self):
        # The failure this guards is silent: an unresolvable value is stored,
        # shown back as configured, and confers nothing -- so the training
        # officer believes the seat is wired when it is not.
        with pytest.raises(
            pydantic.ValidationError, match="grants_qualification must be one of"
        ):
            _course(grants_qualification="medic")

    @pytest.mark.parametrize("value", sorted(QUALIFICATIONS))
    def test_every_resolvable_value_is_accepted(self, value):
        # The validator and the resolver must agree in both directions: a
        # value the service can resolve must not be refused at the door.
        assert _course(grants_qualification=value).grants_qualification == value

    def test_update_accepts_an_explicit_null_to_clear_the_grant(self):
        # model_dump(exclude_unset=True) keeps an explicitly-passed None, so
        # this reaches the column and revokes the seat.
        payload = TrainingCourseUpdate(grants_qualification=None)
        assert "grants_qualification" in payload.model_dump(exclude_unset=True)

    def test_update_omitting_the_field_leaves_it_alone(self):
        assert "grants_qualification" not in TrainingCourseUpdate().model_dump(
            exclude_unset=True
        )


class TestTheCourseFormOffersOnlyKnownQualifications:
    """A qualification the form offers and the API refuses is a dead option.

    Parsed from source in the manner of ``test_position_slots.py``: the two
    lists live in different languages and nothing else makes them agree, so a
    value added to the dropdown alone would 422 on save, and one the backend
    vocabulary has no entry for would save and certify nothing.
    """

    def _offered(self):
        source = (
            Path(__file__).resolve().parents[2]
            / "frontend"
            / "src"
            / "constants"
            / "enums.ts"
        ).read_text()
        block = re.search(
            r"export const COURSE_QUALIFICATIONS[^=]*=\s*\[(.*?)\n\];",
            source,
            re.S,
        )
        assert block, "COURSE_QUALIFICATIONS not found in enums.ts"
        values = re.findall(r"value:\s*'([^']+)'", block.group(1))
        assert values, "no target values parsed"
        return values

    def test_every_offered_value_is_a_known_qualification(self):
        offered = set(self._offered())
        assert offered <= set(QUALIFICATIONS), (
            "the course form offers qualification codes the API rejects: "
            f"{sorted(offered - set(QUALIFICATIONS))}"
        )

    def test_every_known_qualification_is_offered(self):
        # The reverse: a qualification the backend knows and the form never
        # offers cannot be attached to a course through the UI at all, so it
        # can only ever be granted by hand.
        missing = set(QUALIFICATIONS) - set(self._offered())
        assert missing == set(), (
            "these qualifications exist but no course can certify them "
            f"through the form: {sorted(missing)}"
        )


@pytest.mark.integration
class TestSyncFromTrainingRecord:
    """Completing a course grants the qualification it certifies.

    Verified against a real database rather than a mocked session: the whole
    point of this path is the row it writes, and a fake that accepts any
    ``add`` would pass whether or not the grant landed.

    Marked ``integration`` because of that: CI's unit job runs
    ``-m "not integration"`` with no database service, and ``db_session``
    cannot connect there. The validation and enum-sync classes above are pure
    logic and deliberately stay in the fast job, so a course form that drifts
    out of the backend vocabulary still fails without waiting for a database.
    """

    async def _org_and_member(self, db):
        import uuid

        from sqlalchemy import text

        org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
        await db.execute(
            text("INSERT INTO organizations (id, name, slug) VALUES (:i, :n, :s)"),
            {"i": org_id, "n": "Sync Org", "s": "sync-" + org_id[:8]},
        )
        await db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, email) "
                "VALUES (:i, :o, :u, :e)"
            ),
            {
                "i": user_id,
                "o": org_id,
                "u": "m-" + user_id[:8],
                "e": user_id[:8] + "@example.test",
            },
        )
        await db.flush()
        return org_id, user_id

    async def _course(self, db, org_id, grants):
        import uuid

        from app.models.training import TrainingCourse, TrainingType

        course = TrainingCourse(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            name="Paramedic Academy",
            training_type=TrainingType.CERTIFICATION,
            grants_qualification=grants,
        )
        db.add(course)
        await db.flush()
        return course

    @staticmethod
    def _record(org_id, user_id, course, *, status, completion=None, expiry=None):
        import uuid

        from app.models.training import TrainingRecord, TrainingType

        return TrainingRecord(
            id=str(uuid.uuid4()),
            organization_id=org_id,
            user_id=user_id,
            course_id=course.id,
            course_name=course.name,
            training_type=TrainingType.CERTIFICATION,
            hours_completed=40.0,
            status=status,
            completion_date=completion,
            expiration_date=expiry,
        )

    async def test_a_completed_record_grants_the_qualification(self, db_session):
        from app.models.training import TrainingStatus
        from app.services.qualification_service import QualificationService

        org_id, user_id = await self._org_and_member(db_session)
        course = await self._course(db_session, org_id, "paramedic")
        record = self._record(
            org_id,
            user_id,
            course,
            status=TrainingStatus.COMPLETED,
            completion=date(2026, 1, 5),
            expiry=date(2029, 1, 5),
        )
        db_session.add(record)
        await db_session.flush()

        service = QualificationService(db_session)
        granted = await service.sync_from_training_record(record)

        assert granted is not None
        assert granted.qualification_code == "paramedic"
        assert granted.granted_on == date(2026, 1, 5)
        assert granted.expires_on == date(2029, 1, 5)

        # ...and it is what the eligibility reader will see.
        held = await service.get_current_by_member(org_id)
        assert held[user_id] == [{"code": "paramedic", "expires_on": date(2029, 1, 5)}]

    async def test_an_unfinished_record_grants_nothing(self, db_session):
        from app.models.training import TrainingStatus
        from app.services.qualification_service import QualificationService

        org_id, user_id = await self._org_and_member(db_session)
        course = await self._course(db_session, org_id, "paramedic")
        for status in (
            TrainingStatus.SCHEDULED,
            TrainingStatus.IN_PROGRESS,
            TrainingStatus.FAILED,
            TrainingStatus.CANCELLED,
        ):
            record = self._record(org_id, user_id, course, status=status)
            db_session.add(record)
            await db_session.flush()
            assert (
                await QualificationService(db_session).sync_from_training_record(record)
            ) is None, f"{status} certified nobody"

    async def test_a_course_that_certifies_nothing_grants_nothing(self, db_session):
        from app.models.training import TrainingStatus
        from app.services.qualification_service import QualificationService

        org_id, user_id = await self._org_and_member(db_session)
        course = await self._course(db_session, org_id, None)
        record = self._record(org_id, user_id, course, status=TrainingStatus.COMPLETED)
        db_session.add(record)
        await db_session.flush()

        assert (
            await QualificationService(db_session).sync_from_training_record(record)
        ) is None

    async def test_backfilling_an_old_class_does_not_lapse_a_live_card(
        self, db_session
    ):
        """The rule that makes importing history safe.

        A department backfilling last decade's certifications must not pull a
        member's current expiry backwards -- that would lapse the credential
        they are actually working under, on an import that was meant to add
        records rather than remove clearance.
        """
        from app.models.training import TrainingStatus
        from app.services.qualification_service import QualificationService

        org_id, user_id = await self._org_and_member(db_session)
        course = await self._course(db_session, org_id, "emt")
        service = QualificationService(db_session)

        current = self._record(
            org_id,
            user_id,
            course,
            status=TrainingStatus.COMPLETED,
            completion=date(2026, 1, 1),
            expiry=date(2029, 1, 1),
        )
        db_session.add(current)
        await db_session.flush()
        await service.sync_from_training_record(current)

        old = self._record(
            org_id,
            user_id,
            course,
            status=TrainingStatus.COMPLETED,
            completion=date(2018, 1, 1),
            expiry=date(2021, 1, 1),
        )
        db_session.add(old)
        await db_session.flush()
        granted = await service.sync_from_training_record(old)

        assert granted.expires_on == date(2029, 1, 1), "the live card was lapsed"

    async def test_a_renewal_moves_the_expiry_forward(self, db_session):
        from app.models.training import TrainingStatus
        from app.services.qualification_service import QualificationService

        org_id, user_id = await self._org_and_member(db_session)
        course = await self._course(db_session, org_id, "emt")
        service = QualificationService(db_session)

        for expiry in (date(2027, 1, 1), date(2030, 1, 1)):
            record = self._record(
                org_id,
                user_id,
                course,
                status=TrainingStatus.COMPLETED,
                completion=date(2026, 1, 1),
                expiry=expiry,
            )
            db_session.add(record)
            await db_session.flush()
            granted = await service.sync_from_training_record(record)

        assert granted.expires_on == date(2030, 1, 1)
        # One row, not two -- uq_member_qualification renews in place.
        assert len(await service.list_for_member(user_id, org_id)) == 1
