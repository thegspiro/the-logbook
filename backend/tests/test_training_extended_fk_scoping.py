"""
Security-review findings (training extended, 2026-08-26): six client-supplied
FK ids across the training-extended surface (program bulk-enroll, waivers,
submissions, recertification pathways, multi-agency exercises, xAPI
ingestion) were stored or dereferenced with no in-org check (XC-1), the same
defect class TR-11/TR-13 already fixed in training core. DB mocked; no MySQL.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.training_enhancements import (
    create_multi_agency_exercise,
    create_recertification_pathway,
    ingest_xapi_statement,
)
from app.api.v1.endpoints.training_submissions import create_submission
from app.api.v1.endpoints.training_waivers import create_training_waiver
from app.schemas.training_enhancements import (
    MultiAgencyTrainingCreate,
    ParticipatingOrganization,
    RecertificationPathwayCreate,
    XAPIStatementCreate,
)
from app.schemas.training_submission import TrainingSubmissionCreate
from app.services.training_program_service import TrainingProgramService


def _user():
    return SimpleNamespace(
        id="u1", organization_id="org-1", username="officer", email="o@x.com"
    )


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _rows(rows):
    r = MagicMock()
    r.all.return_value = rows
    return r


class TestBulkEnrollNameLookupScoping:
    """training_program_service.bulk_enroll_members's prerequisite-gate error
    strings must not resolve a foreign org's member's real name (HIGH,
    confirmed live: the unscoped lookup's result reached the response before
    any org check ran)."""

    async def test_foreign_user_id_falls_back_to_raw_id_not_name(self):
        db = MagicMock()
        foreign_user_id = uuid4()
        program = SimpleNamespace(
            id="prog-1",
            prerequisite_program_ids=[str(uuid4())],
        )
        # 1) org-scoped user batch fetch -> nothing (the foreign id isn't
        #    in this org, so it must not resolve). 2) completed-prereqs
        #    fetch -> nobody has completed it.
        db.execute = AsyncMock(side_effect=[_scalars([]), _rows([])])

        service = TrainingProgramService(db)
        with patch.object(
            service, "get_program_by_id", AsyncMock(return_value=program)
        ):
            enrollments, errors = await service.bulk_enroll_members(
                program_id="prog-1",
                user_ids=[foreign_user_id],
                organization_id="org-1",
            )

        assert enrollments == []
        assert len(errors) == 1
        # The raw id is an acceptable fallback; a real name is not.
        assert str(foreign_user_id) in errors[0]
        assert "@" not in errors[0]


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value = MagicMock(all=MagicMock(return_value=items))
    return r


class TestWaiverRequirementIdsScoping:
    async def test_create_waiver_rejects_foreign_requirement_id(self):
        db = MagicMock()
        member = SimpleNamespace(id="m1")
        # 1) member lookup (in-org, found), 2) assert_all_in_org requirement
        #    lookup -> empty (foreign/absent).
        db.execute = AsyncMock(side_effect=[_one(member), _rows([])])
        db.add = MagicMock()

        from app.api.v1.endpoints.training_waivers import TrainingWaiverCreate

        data = TrainingWaiverCreate(
            user_id="m1",
            start_date="2026-01-01",
            requirement_ids=[str(uuid4())],
        )
        with pytest.raises(HTTPException) as exc:
            await create_training_waiver(data, db, _user())
        assert exc.value.status_code == 400
        db.add.assert_not_called()

    async def test_create_waiver_accepts_in_org_requirement_id(self):
        req_id = str(uuid4())
        member = SimpleNamespace(id="m1")
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_one(member), _rows([(req_id,)])])
        db.add = MagicMock()
        db.commit = AsyncMock()
        db.refresh = AsyncMock()

        from app.api.v1.endpoints.training_waivers import TrainingWaiverCreate

        data = TrainingWaiverCreate(
            user_id="m1", start_date="2026-01-01", requirement_ids=[req_id]
        )
        result = await create_training_waiver(data, db, _user())
        assert result.requirement_ids == [req_id]
        db.add.assert_called_once()


class TestSubmissionCategoryScoping:
    async def test_create_submission_rejects_foreign_category(self):
        db = MagicMock()
        config = SimpleNamespace(
            require_approval=True,
            auto_approve_under_hours=None,
            required_evidence_types=[],
            max_hours_per_submission=None,
            allowed_training_types=None,
        )
        from app.services.training_submission_service import (
            TrainingSubmissionService,
        )

        with patch.object(
            TrainingSubmissionService, "get_config", AsyncMock(return_value=config)
        ):
            # is_in_org(TrainingCategory) -> not found.
            db.execute = AsyncMock(side_effect=[_one(None)])
            data = TrainingSubmissionCreate(
                course_name="Pump Ops",
                training_type="skills_practice",
                completion_date="2026-01-01",
                hours_completed=2,
                category_id=uuid4(),
            )
            with pytest.raises(HTTPException) as exc:
                await create_submission(data, db, _user())
            assert exc.value.status_code == 400


class TestRecertificationPathwayScoping:
    async def test_create_pathway_rejects_foreign_source_requirement(self):
        db = MagicMock()
        # assert_in_org(source_requirement_id) -> not found.
        db.execute = AsyncMock(side_effect=[_one(None)])
        data = RecertificationPathwayCreate(
            name="EMT Recert",
            source_requirement_id=uuid4(),
        )
        with pytest.raises(HTTPException) as exc:
            await create_recertification_pathway(data, db, _user())
        assert exc.value.status_code == 400
        db.add.assert_not_called()

    async def test_create_pathway_rejects_foreign_prerequisite_pathway(self):
        db = MagicMock()
        # assert_in_org(source_requirement_id, None) short-circuits (allow_none),
        # assert_in_org(assessment_course_id, None) short-circuits,
        # assert_all_in_org(required_courses, None) short-circuits,
        # assert_all_in_org(prerequisite_pathway_ids) -> empty (foreign).
        db.execute = AsyncMock(side_effect=[_rows([])])
        data = RecertificationPathwayCreate(
            name="EMT Recert",
            prerequisite_pathway_ids=[str(uuid4())],
        )
        with pytest.raises(HTTPException) as exc:
            await create_recertification_pathway(data, db, _user())
        assert exc.value.status_code == 400
        db.add.assert_not_called()


class TestMultiAgencyExerciseScoping:
    async def test_create_exercise_rejects_foreign_training_session(self):
        db = MagicMock()
        # assert_in_org(training_session_id) -> not found.
        db.execute = AsyncMock(side_effect=[_one(None)])
        data = MultiAgencyTrainingCreate(
            exercise_name="Joint MCI Drill",
            exercise_type="tabletop",
            exercise_date="2026-01-01",
            training_session_id=uuid4(),
            participating_organizations=[
                ParticipatingOrganization(name="Mutual Aid Co")
            ],
        )
        with pytest.raises(HTTPException) as exc:
            await create_multi_agency_exercise(data, db, _user())
        assert exc.value.status_code == 400
        db.add.assert_not_called()


class TestXAPISourceProviderScoping:
    async def test_ingest_rejects_foreign_source_provider(self):
        db = MagicMock()
        db.rollback = AsyncMock()
        # assert_in_org(ExternalTrainingProvider, source_provider_id) -> not found.
        db.execute = AsyncMock(side_effect=[_one(None)])
        data = XAPIStatementCreate(
            raw_statement={"actor": {}, "verb": {}, "object": {}},
            source_provider_id=uuid4(),
        )
        with pytest.raises(HTTPException) as exc:
            await ingest_xapi_statement(data, db, _user())
        assert exc.value.status_code == 400
        db.add.assert_not_called()

    async def test_batch_validates_shared_provider_once_not_per_statement(self):
        """A Codex review on this PR caught that the naive per-statement fix
        re-ran the same indexed provider query up to 1,000 times per batch
        request. ingest_batch must validate once before the loop and pass
        that result down instead of re-querying inside ingest_statement."""
        from app.services.training_enhancement_service import XAPIService

        provider_id = str(uuid4())
        db = MagicMock()
        # Exactly one provider-lookup query for the whole batch, however
        # many statements it contains.
        db.execute = AsyncMock(side_effect=[_one(provider_id)])
        db.add = MagicMock()
        db.flush = AsyncMock()
        db.refresh = AsyncMock()

        service = XAPIService(db)
        statements = [{"actor": {}, "verb": {}, "object": {}} for _ in range(5)]
        result = await service.ingest_batch(
            "org-1", statements, source_provider_id=provider_id
        )

        assert result["accepted"] == 5
        assert result["rejected"] == 0
        assert db.execute.await_count == 1
