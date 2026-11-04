"""Certification and fallback requirements match records by a stored key.

Owner decisions of 2026-11-01:

- **Stored match key.** A certification requirement no longer matches a
  record by free text (its name as a substring of the course name, its
  registry code as a substring of the certification number). Each record
  stores ``match_key`` and ``certification_key``, built by
  ``app.utils.training_match_key.training_match_key``; the requirement's name
  must equal the record's key (still for legacy records only, up to
  ``name_match_until``) and the record's certification key must begin with
  the requirement's registry-code key. The department-wide load can then ask
  for those keys instead of reading every completed record.
- **Extend the cut-off.** Skills-evaluation, checklist and knowledge-test
  requirements (every type the grader's fallback branch handles) match by name
  under the same rule: only a record dated on or before the requirement's
  ``name_match_until``, and only by key.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.models.training import (
    DueDateType,
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
)
from app.models.user import Organization, User, UserStatus
from app.services.training_compliance import (
    certification_record_matches,
    evaluate_member_requirement,
    load_graded_records,
)
from app.utils.org_timezone import resolve_org_today

CUTOFF = date(2026, 10, 5)
TODAY = date(2026, 11, 4)


def _record(**fields) -> TrainingRecord:
    """A transient record, keyed by the model exactly as a saved one is."""
    values = dict(
        course_name="CPR",
        training_type=TrainingType.CONTINUING_EDUCATION,
        status=TrainingStatus.COMPLETED,
        completion_date=CUTOFF - timedelta(days=30),
        hours_completed=2.0,
    )
    values.update(fields)
    return TrainingRecord(**values)


def _cert(**fields):
    values = dict(
        name="CPR",
        required_courses=None,
        training_type=None,
        registry_code=None,
        name_match_until=CUTOFF,
    )
    values.update(fields)
    return SimpleNamespace(**values)


def _fallback(req_type: RequirementType, **fields) -> TrainingRequirement:
    values = dict(
        id=str(uuid.uuid4()),
        name="SCBA Donning",
        requirement_type=req_type,
        frequency=RequirementFrequency.ONE_TIME,
        due_date_type=DueDateType.CALENDAR_PERIOD,
        name_match_until=CUTOFF,
    )
    values.update(fields)
    return TrainingRequirement(**values)


@pytest.mark.unit
class TestTheKey:
    def test_case_spacing_and_punctuation_do_not_matter(self):
        from app.utils.training_match_key import training_match_key

        keys = {
            training_match_key(text)
            for text in ("CPR", "cpr", "  C.P.R. ", "C-P-R", "Ｃｐｒ")
        }
        assert keys == {"cpr"}

    def test_letters_and_digits_do(self):
        from app.utils.training_match_key import training_match_key

        assert training_match_key("CPR Refresher") != training_match_key("CPR")
        assert training_match_key("NFPA 1001") != training_match_key("NFPA 1002")

    def test_text_with_no_letters_or_digits_has_no_key(self):
        from app.utils.training_match_key import training_match_key

        assert training_match_key("") is None
        assert training_match_key(None) is None
        assert training_match_key(" -- ") is None

    def test_folding_is_unicode_case_folding_not_lower(self):
        # The collation and str.lower disagree on these; the key is neither.
        from app.utils.training_match_key import training_match_key

        assert training_match_key("STRASSE") == training_match_key("straße")
        assert training_match_key("ΟΔΟΣ") == training_match_key("οδος")

    def test_the_model_keys_a_record_whenever_its_text_is_set(self):
        record = _record(course_name="Hazmat Ops", certification_number="NFPA-472")
        assert (record.match_key, record.certification_key) == (
            "hazmatops",
            "nfpa472",
        )
        record.course_name = "HAZMAT  OPS (Refresher)"
        record.certification_number = None
        assert (record.match_key, record.certification_key) == (
            "hazmatopsrefresher",
            None,
        )


@pytest.mark.unit
class TestCertificationMatchesByKey:
    def test_a_recased_or_repunctuated_legacy_record_matches(self):
        for name in ("cpr", "C.P.R.", " CPR "):
            assert certification_record_matches(_cert(), _record(course_name=name))

    def test_a_different_name_does_not_match_even_when_it_contains_it(self):
        assert not certification_record_matches(
            _cert(), _record(course_name="CPR Refresher")
        )

    def test_the_cutoff_still_applies_to_the_name(self):
        assert not certification_record_matches(
            _cert(), _record(completion_date=CUTOFF + timedelta(days=1))
        )
        assert not certification_record_matches(_cert(name_match_until=None), _record())

    def test_a_certification_number_matches_when_it_begins_with_the_code(self):
        late = CUTOFF + timedelta(days=60)
        req = _cert(name="Firefighter I", registry_code="NFPA 1001")
        assert certification_record_matches(
            req,
            _record(
                course_name="Academy",
                certification_number="nfpa-1001-0042",
                completion_date=late,
            ),
        )
        assert not certification_record_matches(
            req,
            _record(
                course_name="Academy",
                certification_number="TX-NFPA-1001",
                completion_date=late,
            ),
        )

    def test_a_record_with_no_stored_key_cannot_match_by_text(self):
        # A record written around the ORM (or one the backfill could not key)
        # carries no key, and text it holds is not consulted.
        record = SimpleNamespace(
            course_id=None,
            course_name="CPR",
            training_type=TrainingType.CONTINUING_EDUCATION,
            certification_number="CPR-1",
            completion_date=CUTOFF - timedelta(days=1),
            created_at=None,
            match_key=None,
            certification_key=None,
        )
        assert not certification_record_matches(_cert(registry_code="CPR"), record)


@pytest.mark.unit
class TestFallbackTypesStopMatchingByNamePastTheCutoff:
    @pytest.mark.parametrize(
        "req_type",
        [
            RequirementType.SKILLS_EVALUATION,
            RequirementType.CHECKLIST,
            RequirementType.KNOWLEDGE_TEST,
        ],
    )
    def test_only_a_legacy_record_with_the_same_key_counts(self, req_type):
        req = _fallback(req_type)

        def status(**fields):
            return evaluate_member_requirement(req, [_record(**fields)], TODAY)[0]

        assert status(course_name="scba donning") == "completed"
        assert (
            status(
                course_name="SCBA Donning",
                completion_date=CUTOFF + timedelta(days=1),
            )
            == "not_started"
        )
        assert status(course_name="SCBA Donning Refresher") == "not_started"

    def test_no_cutoff_means_no_name_match(self):
        req = _fallback(RequirementType.CHECKLIST, name_match_until=None)
        record = _record(course_name="SCBA Donning")
        assert evaluate_member_requirement(req, [record], TODAY)[0] == "not_started"

    def test_an_in_progress_record_follows_the_same_rule(self):
        req = _fallback(RequirementType.SKILLS_EVALUATION)
        early = _record(
            course_name="SCBA donning",
            status=TrainingStatus.IN_PROGRESS,
            completion_date=None,
            created_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
        )
        late = _record(
            course_name="SCBA donning",
            status=TrainingStatus.IN_PROGRESS,
            completion_date=None,
            created_at=datetime(2026, 10, 20, tzinfo=timezone.utc),
        )
        assert evaluate_member_requirement(req, [early], TODAY)[0] == "in_progress"
        assert evaluate_member_requirement(req, [late], TODAY)[0] == "not_started"

    def test_the_training_type_still_matches_at_any_date(self):
        req = _fallback(
            RequirementType.SKILLS_EVALUATION,
            training_type=TrainingType.SKILLS_PRACTICE,
        )
        record = _record(
            course_name="Station Drill",
            training_type=TrainingType.SKILLS_PRACTICE,
            completion_date=CUTOFF + timedelta(days=20),
        )
        assert evaluate_member_requirement(req, [record], TODAY)[0] == "completed"


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.integration
class TestTheDepartmentLoadAsksForTheKey:
    """A certification requirement without a freshness window used to load
    every completed record; it now loads the records its keys, course, type or
    code can match — and the grader credits the same members either way."""

    async def test_only_matchable_records_are_loaded_and_graded(self, db_session):
        db = db_session
        org = Organization(
            id=_uid(),
            name="Match Key Department",
            slug=f"match-key-{uuid.uuid4().hex[:8]}",
            timezone="UTC",
        )
        db.add(org)
        await db.flush()
        today = await resolve_org_today(db, org.id)
        cutoff = today - timedelta(days=10)
        handle = uuid.uuid4().hex[:10]
        member = User(
            id=_uid(),
            organization_id=org.id,
            username=f"key-{handle}",
            email=f"{handle}@match-key.test",
            first_name="Key",
            last_name="Member",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        db.add(member)
        req = TrainingRequirement(
            id=_uid(),
            organization_id=org.id,
            name="CPR",
            requirement_type=RequirementType.CERTIFICATION,
            frequency=RequirementFrequency.ONE_TIME,
            due_date_type=DueDateType.CALENDAR_PERIOD,
            active=True,
            applies_to_all=True,
            registry_code="AHA BLS",
            name_match_until=cutoff,
        )
        db.add(req)
        await db.flush()

        def record(course_name, **fields):
            fields.setdefault("completion_date", cutoff - timedelta(days=30))
            return TrainingRecord(
                id=_uid(),
                organization_id=org.id,
                user_id=member.id,
                course_name=course_name,
                training_type=TrainingType.CONTINUING_EDUCATION,
                status=TrainingStatus.COMPLETED,
                hours_completed=2.0,
                **fields,
            )

        recased = record("c.p.r.")
        by_code = record(
            "Provider Course",
            certification_number="aha-bls-7781",
            completion_date=today - timedelta(days=2),
        )
        containing = record("CPR Refresher")
        unrelated = record("Pump Operations")
        db.add_all([recased, by_code, containing, unrelated])
        await db.flush()

        loaded = await load_graded_records(db, org.id, [member.id], [req], today, True)
        assert {r.id for r in loaded} == {recased.id, by_code.id}

        assert evaluate_member_requirement(req, loaded, today)[0] == "completed"
        assert (
            evaluate_member_requirement(req, [containing, unrelated], today)[0]
            == "not_started"
        )
