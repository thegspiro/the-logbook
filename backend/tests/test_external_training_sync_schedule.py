"""
Scheduled external training sync: frequent short pulls plus a daily review.

A department wants a finished class to show up under Imports within the hour,
without re-downloading a month of completions every hour. So a scheduled run
is one of two sizes:

- a quick pull, every ``sync_interval_hours``, asking only for completions
  since the last sync (and at least since yesterday);
- once a day, at the provider's ``config.review_time`` in the department's
  timezone, a review that re-checks the last 30 days — Target Solutions lets
  a completion be recorded for a past date, which a forward-only pull never
  sees.

Whether a review is owed is read from the sync log (a successful ``review``
run since the most recent review time), so a provider that has never been
reviewed starts with the 30-day backfill.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.models.training import (
    ExternalProviderType,
    ExternalTrainingProvider,
    ExternalTrainingSyncLog,
    SyncStatus,
)
from app.models.user import Organization
from app.schemas.training import ExternalProviderConfig
from app.services.external_training_service import (
    DEFAULT_TS_REVIEW_TIME,
    REVIEW_LOOKBACK_DAYS,
    REVIEW_SYNC_TYPE,
    ExternalTrainingSyncService,
    compute_next_sync_at,
    latest_review_slot,
    next_review_slot,
    review_time_for,
)

NEW_YORK = ZoneInfo("America/New_York")
TWO_AM = time(2, 0)
TS_EMPTY_REPORT = "Employee ID,Email,Assignment Name,Transcript ID\n"


def _utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


def _provider(config=None, interval=1, provider_type=None):
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


def _vector(config=None, interval=24):
    return _provider(
        config={"site_id": "42", **(config or {})},
        interval=interval,
        provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
    )


@pytest.mark.unit
class TestReviewSlots:
    def test_next_slot_later_today(self):
        # 01:00 EDT -> 02:00 EDT the same morning.
        assert next_review_slot(TWO_AM, NEW_YORK, _utc(2026, 9, 29, 5, 0)) == _utc(
            2026, 9, 29, 6, 0
        )

    def test_next_slot_wraps_to_tomorrow(self):
        # 02:00 EDT exactly: this slot has arrived, the next is tomorrow's.
        assert next_review_slot(TWO_AM, NEW_YORK, _utc(2026, 9, 29, 6, 0)) == _utc(
            2026, 9, 30, 6, 0
        )

    def test_latest_slot_is_this_morning_after_it_passes(self):
        assert latest_review_slot(TWO_AM, NEW_YORK, _utc(2026, 9, 29, 14, 0)) == _utc(
            2026, 9, 29, 6, 0
        )

    def test_latest_slot_is_yesterday_before_it_arrives(self):
        assert latest_review_slot(TWO_AM, NEW_YORK, _utc(2026, 9, 29, 5, 0)) == _utc(
            2026, 9, 28, 6, 0
        )

    def test_keeps_local_time_across_dst(self):
        # 06:00 local, either side of US DST start (2026-03-08) and end (11-01).
        six = time(6, 0)
        assert next_review_slot(six, NEW_YORK, _utc(2026, 3, 7, 23, 30)) == _utc(
            2026, 3, 8, 10, 0
        )
        assert next_review_slot(six, NEW_YORK, _utc(2026, 10, 31, 23, 0)) == _utc(
            2026, 11, 1, 11, 0
        )


@pytest.mark.unit
class TestReviewTimeFor:
    def test_target_solutions_defaults_to_two_am(self):
        assert review_time_for(_provider()) == DEFAULT_TS_REVIEW_TIME == TWO_AM

    def test_configured_time_wins(self):
        assert review_time_for(_provider({"review_time": "03:30"})) == time(3, 30)

    @pytest.mark.parametrize("bad", ["25:00", "3pm", 330, ["02:00"], ""])
    def test_malformed_time_falls_back_rather_than_raising(self, bad):
        assert review_time_for(_provider({"review_time": bad})) == TWO_AM
        assert review_time_for(_vector({"review_time": bad})) is None

    def test_other_providers_have_no_review_unless_configured(self):
        assert review_time_for(_vector()) is None
        assert review_time_for(_vector({"review_time": "04:00"})) == time(4, 0)


@pytest.mark.unit
class TestComputeNextSyncAt:
    def test_hourly_pull_when_the_review_is_hours_away(self):
        now = _utc(2026, 9, 29, 14, 0)  # 10:00 EDT
        assert compute_next_sync_at(_provider(), NEW_YORK, now) == now + timedelta(
            hours=1
        )

    def test_review_when_it_comes_before_the_next_pull(self):
        provider = _provider(interval=6)
        now = _utc(2026, 9, 29, 5, 30)  # 01:30 EDT, review at 02:00
        assert compute_next_sync_at(provider, NEW_YORK, now) == _utc(2026, 9, 29, 6, 0)

    def test_providers_without_a_review_keep_the_interval(self):
        now = _utc(2026, 9, 29, 5, 30)
        assert compute_next_sync_at(_vector(), NEW_YORK, now) == now + timedelta(
            hours=24
        )


@pytest.mark.unit
class TestReviewTimeValidation:
    def test_normalizes(self):
        assert ExternalProviderConfig(review_time="2:00").review_time == "02:00"

    @pytest.mark.parametrize("bad", ["24:00", "02:60", "2", "two"])
    def test_rejects_malformed(self, bad):
        with pytest.raises(ValueError, match="24-hour HH:MM"):
            ExternalProviderConfig(review_time=bad)


class _Db:
    def add(self, obj):
        pass

    async def flush(self):
        pass

    async def commit(self):
        pass

    async def execute(self, statement):
        # Staging locks the provider row, and crediting looks for this run's
        # staged rows; with an empty report there are none.
        return SimpleNamespace(
            scalars=lambda: SimpleNamespace(all=lambda: []),
            scalar_one_or_none=lambda: None,
        )


def _recording_service(body: str, db=None):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, content=body.encode())

    service = ExternalTrainingSyncService(db or _Db())
    service.http_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return service, requests


def _ts_start(request: httpx.Request) -> date:
    return datetime.strptime(request.url.params["startDate"], "%m-%d-%Y").date()


@pytest.mark.unit
class TestSyncWindows:
    async def test_quick_pull_covers_since_the_last_sync(self):
        provider = _provider()
        last_sync = datetime.now(timezone.utc) - timedelta(days=3)
        provider.last_sync_at = last_sync
        service, requests = _recording_service(TS_EMPTY_REPORT)
        try:
            await service.sync_training_records(provider, "incremental")
        finally:
            await service.close()
        assert _ts_start(requests[0]) == last_sync.date()

    async def test_quick_pull_reaches_back_to_yesterday_at_least(self):
        provider = _provider()
        provider.last_sync_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        service, requests = _recording_service(TS_EMPTY_REPORT)
        try:
            await service.sync_training_records(provider, "incremental")
        finally:
            await service.close()
        assert _ts_start(requests[0]) <= date.today() - timedelta(days=1)
        assert _ts_start(requests[0]) >= date.today() - timedelta(days=2)

    async def test_review_rechecks_the_last_30_days(self):
        provider = _provider()
        provider.last_sync_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        service, requests = _recording_service(TS_EMPTY_REPORT)
        try:
            await service.sync_training_records(provider, REVIEW_SYNC_TYPE)
        finally:
            await service.close()
        assert _ts_start(requests[0]) == date.today() - timedelta(
            days=REVIEW_LOOKBACK_DAYS
        )

    async def test_vector_solutions_incremental_is_unchanged(self):
        provider = _vector()
        last_sync = datetime.now(timezone.utc) - timedelta(days=1)
        provider.last_sync_at = last_sync
        service, requests = _recording_service("[]")
        try:
            await service.sync_training_records(provider, "incremental")
        finally:
            await service.close()
        assert requests[0].url.params["startDate"] == last_sync.date().isoformat()


@pytest.mark.unit
class TestScheduledRunChoosesItsSize:
    async def _run(self, provider, last_review):
        service = ExternalTrainingSyncService(_Db())
        sync = AsyncMock()
        try:
            with patch(
                "app.services.external_training_service.resolve_scheduling_timezone",
                AsyncMock(return_value=NEW_YORK),
            ), patch.object(
                service,
                "_last_successful_review_at",
                AsyncMock(return_value=last_review),
            ) as lookup, patch.object(
                service, "sync_training_records", sync
            ):
                await service.run_scheduled_sync(provider)
        finally:
            await service.close()
        return sync.await_args.kwargs["sync_type"], lookup

    async def test_never_reviewed_starts_with_a_review(self):
        sync_type, _ = await self._run(_provider(), None)
        assert sync_type == REVIEW_SYNC_TYPE

    async def test_reviewed_since_the_last_slot_is_a_quick_pull(self):
        sync_type, _ = await self._run(
            _provider(), datetime.now(timezone.utc) - timedelta(minutes=5)
        )
        assert sync_type == "incremental"

    async def test_last_review_before_the_last_slot_is_owed_again(self):
        sync_type, _ = await self._run(
            _provider(), datetime.now(timezone.utc) - timedelta(days=2)
        )
        assert sync_type == REVIEW_SYNC_TYPE

    async def test_providers_without_a_review_only_pull(self):
        sync_type, lookup = await self._run(_vector(), None)
        assert sync_type == "incremental"
        lookup.assert_not_awaited()


@pytest.mark.unit
class TestSyncSchedulesTheNextRun:
    async def test_next_sync_at_is_the_next_pull_or_review(self):
        provider = _provider()
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
        assert provider.next_sync_at == compute_next_sync_at(
            provider, NEW_YORK, provider.last_sync_at
        )
        assert provider.next_sync_at - provider.last_sync_at <= timedelta(hours=1)


@pytest.mark.integration
class TestReviewLedger:
    async def _setup(self, db_session):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Review Test Department",
            slug=f"review-{uuid.uuid4().hex[:8]}",
            timezone="America/Chicago",
        )
        db_session.add(org)
        await db_session.flush()
        provider = ExternalTrainingProvider(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            name="Target Solutions",
            provider_type=ExternalProviderType.TARGET_SOLUTIONS,
            api_base_url="https://app.targetsolutions.com/tsapp/api/",
            api_key="k",
            api_secret="s",
            sync_interval_hours=1,
            auto_sync_enabled=True,
        )
        db_session.add(provider)
        await db_session.flush()
        return provider

    async def _log(self, db_session, provider, sync_type, status):
        db_session.add(
            ExternalTrainingSyncLog(
                id=str(uuid.uuid4()),
                provider_id=provider.id,
                organization_id=provider.organization_id,
                sync_type=sync_type,
                status=status,
                started_at=datetime.now(timezone.utc),
            )
        )
        await db_session.flush()

    async def test_only_a_successful_review_counts(self, db_session):
        provider = await self._setup(db_session)
        await self._log(db_session, provider, REVIEW_SYNC_TYPE, SyncStatus.FAILED)
        await self._log(db_session, provider, "incremental", SyncStatus.COMPLETED)

        service = ExternalTrainingSyncService(db_session)
        try:
            assert await service._last_successful_review_at(provider) is None
            await self._log(db_session, provider, REVIEW_SYNC_TYPE, SyncStatus.PARTIAL)
            assert await service._last_successful_review_at(provider) is not None
        finally:
            await service.close()

    async def test_first_run_reviews_then_the_next_pulls(self, db_session):
        provider = await self._setup(db_session)
        service, requests = _recording_service(TS_EMPTY_REPORT, db=db_session)
        try:
            first = await service.run_scheduled_sync(provider)
            second = await service.run_scheduled_sync(provider)
        finally:
            await service.close()

        assert first.sync_type == REVIEW_SYNC_TYPE
        assert _ts_start(requests[0]) == date.today() - timedelta(
            days=REVIEW_LOOKBACK_DAYS
        )
        assert second.sync_type == "incremental"
        assert _ts_start(requests[1]) >= date.today() - timedelta(days=2)
        assert provider.next_sync_at == compute_next_sync_at(
            provider, ZoneInfo("America/Chicago"), provider.last_sync_at
        )
