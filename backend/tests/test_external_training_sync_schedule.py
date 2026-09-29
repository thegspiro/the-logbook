"""
External training auto-sync at fixed times of day, and the Target Solutions
lookback window.

Auto-sync used to run every ``sync_interval_hours`` after the previous sync,
so "twice a day" drifted with whenever the first sync happened. A provider can
now store ``config.sync_times`` — wall-clock times in the department's
timezone — and ``next_sync_at`` is set to the next of those.

Target Solutions also lets a completion be recorded for a past date, which an
incremental sync starting at the last sync date would never ask for, so its
scheduled syncs re-check the last 30 days.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import UUID
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.api.v1.endpoints.external_training import update_provider
from app.models.training import ExternalProviderType, ExternalTrainingProvider
from app.models.user import Organization, User, UserStatus
from app.schemas.training import ExternalProviderConfig, ExternalTrainingProviderUpdate
from app.services.external_training_service import (
    TS_INCREMENTAL_LOOKBACK_DAYS,
    ExternalTrainingSyncService,
    compute_next_sync_at,
    next_scheduled_sync,
)

NEW_YORK = ZoneInfo("America/New_York")
TWICE_DAILY = [time(6, 0), time(18, 0)]


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


@pytest.mark.unit
class TestNextScheduledSync:
    def test_later_the_same_day(self):
        # 06:00 EDT exactly: the 06:00 slot has arrived, so the next is 18:00.
        assert next_scheduled_sync(
            TWICE_DAILY, NEW_YORK, _utc(2026, 9, 29, 10, 0)
        ) == _utc(2026, 9, 29, 22, 0)

    def test_before_the_first_slot(self):
        assert next_scheduled_sync(
            TWICE_DAILY, NEW_YORK, _utc(2026, 9, 29, 9, 0)
        ) == _utc(2026, 9, 29, 10, 0)

    def test_wraps_to_tomorrow(self):
        assert next_scheduled_sync(
            TWICE_DAILY, NEW_YORK, _utc(2026, 9, 29, 23, 0)
        ) == _utc(2026, 9, 30, 10, 0)

    def test_keeps_local_time_across_spring_forward(self):
        # US DST begins 2026-03-08: 06:00 local is 11:00Z before, 10:00Z after.
        assert next_scheduled_sync(
            [time(6, 0)], NEW_YORK, _utc(2026, 3, 7, 23, 30)
        ) == _utc(2026, 3, 8, 10, 0)

    def test_keeps_local_time_across_fall_back(self):
        # US DST ends 2026-11-01: 06:00 local becomes 11:00Z.
        assert next_scheduled_sync(
            [time(6, 0)], NEW_YORK, _utc(2026, 10, 31, 23, 0)
        ) == _utc(2026, 11, 1, 11, 0)


def _provider(config=None, interval=12, provider_type=None):
    return ExternalTrainingProvider(
        id="prov-1",
        organization_id="org-1",
        name="Provider",
        provider_type=provider_type or ExternalProviderType.TARGET_SOLUTIONS,
        api_base_url="https://app.targetsolutions.com/tsapp/api/",
        api_key="k",
        api_secret="s",
        config=config,
        sync_interval_hours=interval,
    )


@pytest.mark.unit
class TestComputeNextSyncAt:
    NOW = _utc(2026, 9, 29, 12, 0)  # 08:00 EDT

    def test_uses_the_set_times(self):
        provider = _provider({"sync_times": ["06:00", "18:00"]})
        assert compute_next_sync_at(provider, NEW_YORK, self.NOW) == _utc(
            2026, 9, 29, 22, 0
        )

    @pytest.mark.parametrize(
        "config",
        [
            None,
            {},
            {"sync_times": None},
            {"sync_times": []},
            {"sync_times": "06:00"},
            {"sync_times": ["25:99"]},
            {"sync_times": ["six"]},
        ],
    )
    def test_anything_unusable_falls_back_to_the_interval(self, config):
        provider = _provider(config, interval=12)
        assert compute_next_sync_at(provider, NEW_YORK, self.NOW) == (
            self.NOW + timedelta(hours=12)
        )


@pytest.mark.unit
class TestSyncTimesValidation:
    def test_normalizes_and_sorts(self):
        config = ExternalProviderConfig(sync_times=["18:00", "6:00", "06:00"])
        assert config.sync_times == ["06:00", "18:00"]

    @pytest.mark.parametrize(
        "sync_times",
        [["24:00"], ["06:60"], ["6"], ["noon"]],
    )
    def test_rejects_a_malformed_time(self, sync_times):
        with pytest.raises(ValueError, match="24-hour HH:MM"):
            ExternalProviderConfig(sync_times=sync_times)

    @pytest.mark.parametrize(
        "sync_times",
        [[], ["01:00", "02:00", "03:00", "04:00", "05:00"]],
    )
    def test_rejects_too_few_or_too_many(self, sync_times):
        with pytest.raises(ValueError, match="between 1 and 4"):
            ExternalProviderConfig(sync_times=sync_times)


class _Db:
    def add(self, obj):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass


def _recording_service(body: str):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=body.encode())

    service = ExternalTrainingSyncService(_Db())
    service.http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return service, requests


TS_EMPTY_REPORT = "Employee ID,Email,Assignment Name,Transcript ID\n"


@pytest.mark.unit
class TestIncrementalLookback:
    async def test_target_solutions_rechecks_the_last_30_days(self):
        provider = _provider()
        provider.last_sync_at = datetime.now(timezone.utc) - timedelta(days=1)
        service, requests = _recording_service(TS_EMPTY_REPORT)
        try:
            await service.sync_training_records(provider, "incremental")
        finally:
            await service.close()

        start = datetime.strptime(
            requests[0].url.params["startDate"], "%m-%d-%Y"
        ).date()
        assert start <= date.today() - timedelta(days=TS_INCREMENTAL_LOOKBACK_DAYS)

    async def test_other_providers_still_start_at_the_last_sync(self):
        provider = _provider(
            config={"site_id": "42"},
            provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
        )
        last_sync = datetime.now(timezone.utc) - timedelta(days=1)
        provider.last_sync_at = last_sync
        service, requests = _recording_service("[]")
        try:
            await service.sync_training_records(provider, "incremental")
        finally:
            await service.close()

        assert requests[0].url.params["startDate"] == last_sync.date().isoformat()

    async def test_explicit_range_is_left_alone(self):
        provider = _provider()
        provider.last_sync_at = datetime.now(timezone.utc) - timedelta(days=1)
        service, requests = _recording_service(TS_EMPTY_REPORT)
        yesterday = date.today() - timedelta(days=1)
        try:
            await service.sync_training_records(
                provider, "incremental", from_date=yesterday
            )
        finally:
            await service.close()

        assert requests[0].url.params["startDate"] == yesterday.strftime("%m-%d-%Y")


@pytest.mark.unit
class TestSyncSchedulesTheNextSlot:
    async def test_successful_sync_points_next_sync_at_at_a_set_time(self):
        provider = _provider({"sync_times": ["06:00", "18:00"]})
        provider.auto_sync_enabled = True
        service, _ = _recording_service(TS_EMPTY_REPORT)
        try:
            with patch(
                "app.services.external_training_service.resolve_scheduling_timezone",
                AsyncMock(return_value=NEW_YORK),
            ):
                await service.sync_training_records(provider, "incremental")
        finally:
            await service.close()

        local = provider.next_sync_at.astimezone(NEW_YORK)
        assert (local.hour, local.minute) in {(6, 0), (18, 0)}
        assert provider.next_sync_at > provider.last_sync_at
        assert provider.next_sync_at - provider.last_sync_at <= timedelta(hours=12)


@pytest.mark.integration
class TestSavingAScheduleSetsTheNextSlot:
    async def test_update_points_next_sync_at_at_the_next_set_time(self, db_session):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Schedule Test Department",
            slug=f"schedule-{uuid.uuid4().hex[:8]}",
            timezone="America/Chicago",
        )
        db_session.add(org)
        await db_session.flush()
        officer = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            email="officer@schedule.test",
            first_name="Training",
            last_name="Officer",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        provider = ExternalTrainingProvider(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Target Solutions",
            provider_type=ExternalProviderType.TARGET_SOLUTIONS,
            api_base_url="https://app.targetsolutions.com/tsapp/api/",
        )
        db_session.add_all([officer, provider])
        await db_session.flush()

        before = datetime.now(timezone.utc)
        await update_provider(
            UUID(provider.id),
            ExternalTrainingProviderUpdate(
                auto_sync_enabled=True,
                config=ExternalProviderConfig(sync_times=["06:00", "18:00"]),
            ),
            db_session,
            officer,
        )

        next_sync = provider.next_sync_at
        if next_sync.tzinfo is None:
            next_sync = next_sync.replace(tzinfo=timezone.utc)
        local = next_sync.astimezone(ZoneInfo("America/Chicago"))
        assert (local.hour, local.minute) in {(6, 0), (18, 0)}
        assert before < next_sync <= before + timedelta(hours=12)

    async def test_interval_schedule_leaves_next_sync_at_alone(self, db_session):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Interval Test Department",
            slug=f"interval-{uuid.uuid4().hex[:8]}",
        )
        db_session.add(org)
        await db_session.flush()
        officer = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"u{uuid.uuid4().hex[:10]}",
            email="officer@interval.test",
            first_name="Training",
            last_name="Officer",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        provider = ExternalTrainingProvider(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Target Solutions",
            provider_type=ExternalProviderType.TARGET_SOLUTIONS,
            api_base_url="https://app.targetsolutions.com/tsapp/api/",
        )
        db_session.add_all([officer, provider])
        await db_session.flush()

        await update_provider(
            UUID(provider.id),
            ExternalTrainingProviderUpdate(
                auto_sync_enabled=True, sync_interval_hours=12
            ),
            db_session,
            officer,
        )

        assert provider.next_sync_at is None
