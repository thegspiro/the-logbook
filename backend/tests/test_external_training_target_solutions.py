"""
Target Solutions sync: authentication and email-based member matching.

A provider created as TARGET_SOLUTIONS runs through the Vector Solutions code
path, but was sent generic API-key headers the TargetSolutions API rejects.
Member matching by email ran only once, when a mapping row was first created,
so a member whose Logbook email was added after the first sync never matched.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.models.training import (
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    ExternalTrainingSyncLog,
    ExternalUserMapping,
    SyncStatus,
)
from app.models.user import Organization, User, UserStatus
from app.services.external_training_service import ExternalTrainingSyncService


def _provider(provider_type, auth_type="api_key"):
    return ExternalTrainingProvider(
        id="prov-1",
        organization_id="org-1",
        name="Target Solutions",
        provider_type=provider_type,
        api_base_url="https://app.targetsolutions.com/v1",
        api_key="tok-123",
        auth_type=auth_type,
        config={"site_id": "42"},
    )


@pytest.mark.unit
class TestTargetSolutionsHeaders:
    @pytest.mark.parametrize(
        "provider_type",
        [ExternalProviderType.TARGET_SOLUTIONS, ExternalProviderType.VECTOR_SOLUTIONS],
    )
    async def test_sends_access_token_header(self, provider_type):
        service = ExternalTrainingSyncService(db=None)
        try:
            headers = service._get_auth_headers(_provider(provider_type))
        finally:
            await service.close()
        assert headers["AccessToken"] == "tok-123"
        assert "Authorization" not in headers
        assert "X-API-Key" not in headers

    async def test_other_providers_keep_api_key_headers(self):
        service = ExternalTrainingSyncService(db=None)
        try:
            headers = service._get_auth_headers(_provider(ExternalProviderType.LEXIPOL))
        finally:
            await service.close()
        assert headers["X-API-Key"] == "tok-123"
        assert "AccessToken" not in headers


@pytest.mark.unit
class TestNormalizeUserId:
    async def test_null_user_id_is_empty_not_the_string_none(self):
        service = ExternalTrainingSyncService(db=None)
        try:
            normalized = service._normalize_vector_solutions_record(
                {"id": 7, "userId": None, "email": "a@b.test"}
            )
        finally:
            await service.close()
        assert normalized["external_user_id"] == ""

    async def test_falls_through_to_employee_id(self):
        service = ExternalTrainingSyncService(db=None)
        try:
            normalized = service._normalize_vector_solutions_record(
                {"id": 7, "userId": "", "employeeId": 991}
            )
        finally:
            await service.close()
        assert normalized["external_user_id"] == "991"


async def _make_org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="TS Sync Test Department",
        slug=f"ts-sync-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _make_user(db_session, org, email, deleted=False) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u{uuid.uuid4().hex[:10]}",
        email=email,
        first_name="Test",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _make_provider(db_session, org) -> ExternalTrainingProvider:
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Target Solutions",
        provider_type=ExternalProviderType.TARGET_SOLUTIONS,
        api_base_url="https://app.targetsolutions.com/v1",
        config={"site_id": "42"},
    )
    db_session.add(provider)
    await db_session.flush()
    return provider


async def _make_sync_log(db_session, provider) -> ExternalTrainingSyncLog:
    log = ExternalTrainingSyncLog(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=provider.organization_id,
        sync_type="manual",
        status=SyncStatus.IN_PROGRESS,
    )
    db_session.add(log)
    await db_session.flush()
    return log


def _ts_record(record_id="c-1", user_id="ts-501", email="Jane.Doe@Dept.test "):
    return {
        "id": record_id,
        "userId": user_id,
        "email": email,
        "firstName": "Jane",
        "lastName": "Doe",
        "courseName": "Hazmat Awareness",
        "completionDate": "2026-09-01T14:30:00Z",
    }


@pytest.mark.integration
class TestEmailMatching:
    async def _process(self, db_session, provider, log, raw):
        service = ExternalTrainingSyncService(db_session)
        try:
            record = service._normalize_vector_solutions_record(raw)
            result = await service._process_external_record(provider, log.id, record)
            await db_session.flush()
            return result
        finally:
            await service.close()

    async def _import_row(self, db_session, provider, record_id="c-1"):
        return (
            await db_session.execute(
                ExternalTrainingImport.__table__.select().where(
                    ExternalTrainingImport.provider_id == provider.id,
                    ExternalTrainingImport.external_record_id == record_id,
                )
            )
        ).one()

    async def test_matches_ignoring_case_and_whitespace(self, db_session):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org, "jane.doe@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        assert (
            await self._process(db_session, provider, log, _ts_record()) == "imported"
        )

        row = await self._import_row(db_session, provider)
        assert row.user_id == member.id

    async def test_never_matches_a_deleted_member(self, db_session):
        org = await _make_org(db_session)
        await _make_user(db_session, org, "jane.doe@dept.test", deleted=True)
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _ts_record())

        row = await self._import_row(db_session, provider)
        assert row.user_id is None

    async def test_does_not_match_a_member_of_another_org(self, db_session):
        org = await _make_org(db_session)
        other = await _make_org(db_session)
        await _make_user(db_session, other, "jane.doe@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _ts_record())

        row = await self._import_row(db_session, provider)
        assert row.user_id is None

    async def test_later_sync_matches_a_member_whose_email_was_added(self, db_session):
        org = await _make_org(db_session)
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _ts_record())
        assert (await self._import_row(db_session, provider)).user_id is None

        member = await _make_user(db_session, org, "jane.doe@dept.test")
        assert await self._process(db_session, provider, log, _ts_record()) == "updated"

        row = await self._import_row(db_session, provider)
        assert row.user_id == member.id
        mapping = (
            await db_session.execute(
                ExternalUserMapping.__table__.select().where(
                    ExternalUserMapping.provider_id == provider.id
                )
            )
        ).one()
        assert mapping.internal_user_id == member.id
        assert mapping.auto_mapped is True

    async def test_later_sync_never_overrides_an_officer_decision(self, db_session):
        org = await _make_org(db_session)
        officer = await _make_user(db_session, org, "chief@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _ts_record())
        mapping = (
            await db_session.execute(
                ExternalUserMapping.__table__.select().where(
                    ExternalUserMapping.provider_id == provider.id
                )
            )
        ).one()
        # An officer deliberately leaves this external user unmapped.
        await db_session.execute(
            ExternalUserMapping.__table__.update()
            .where(ExternalUserMapping.id == mapping.id)
            .values(mapped_by=officer.id)
        )

        await _make_user(db_session, org, "jane.doe@dept.test")
        await self._process(db_session, provider, log, _ts_record())

        assert (await self._import_row(db_session, provider)).user_id is None

    async def test_record_with_email_but_no_user_id_still_maps(self, db_session):
        org = await _make_org(db_session)
        member = await _make_user(db_session, org, "jane.doe@dept.test")
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _ts_record(user_id=None))

        row = await self._import_row(db_session, provider)
        assert row.user_id == member.id
        assert row.external_user_id == "jane.doe@dept.test"

    async def test_resync_parses_the_completion_date(self, db_session):
        org = await _make_org(db_session)
        provider = await _make_provider(db_session, org)
        log = await _make_sync_log(db_session, provider)

        await self._process(db_session, provider, log, _ts_record())
        raw = _ts_record()
        raw["completionDate"] = "2026-09-15T08:00:00Z"
        assert await self._process(db_session, provider, log, raw) == "updated"

        row = await self._import_row(db_session, provider)
        assert row.completion_date.date().isoformat() == "2026-09-15"
