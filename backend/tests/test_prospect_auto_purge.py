"""The pipeline Auto-Purge setting is read, and purges only what it should.

Until this was wired, ``inactivity_config.auto_purge_enabled`` and
``purge_days_after_inactive`` were stored by the settings screen and read by
nothing (CLAUDE.md pitfall #19). The job deletes records permanently, so most
of what is pinned here is what it must *not* delete: applications under the
grace period, any status but inactive, any application with no recorded start
to its inactive spell, and anything in a pipeline whose setting is off or
unreadable — and one organization's problem must not stop another's purge.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog
from app.models.membership_pipeline import (
    MembershipPipeline,
    ProspectDocument,
    ProspectiveMember,
    ProspectStatus,
)
from app.services import file_storage_service
from app.services.membership_pipeline_service import MembershipPipelineService
from app.services.scheduled_tasks import (
    TASK_INTERVALS_SECONDS,
    TASK_RUNNERS,
    run_membership_auto_purge,
)

pytestmark = [pytest.mark.integration]

NOW = datetime(2026, 10, 9, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _prospect_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db.flush()
    return org_id


async def _pipeline(db: AsyncSession, org_id: str, config) -> str:
    svc = MembershipPipelineService(db)
    created = await svc.create_pipeline(organization_id=org_id, name="P")
    # Written directly so a malformed value reaches the column exactly as a
    # hand edit or an old build would have left it.
    await db.execute(
        update(MembershipPipeline)
        .where(MembershipPipeline.id == str(created.id))
        .values(inactivity_config=config)
    )
    await db.flush()
    return str(created.id)


async def _prospect(
    db: AsyncSession,
    org_id: str,
    pipeline_id: str,
    status: ProspectStatus = ProspectStatus.INACTIVE,
    inactive_days: int | None = 400,
) -> str:
    svc = MembershipPipelineService(db)
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "App",
            "last_name": f"Licant{_uid()[:4]}",
            "email": f"a-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
        },
    )
    prospect.status = status
    prospect.inactive_since = (
        None if inactive_days is None else NOW - timedelta(days=inactive_days)
    )
    await db.flush()
    return str(prospect.id)


async def _exists(db: AsyncSession, prospect_id: str) -> bool:
    found = await db.execute(
        select(ProspectiveMember.id).where(ProspectiveMember.id == prospect_id)
    )
    return found.scalar_one_or_none() is not None


async def _with_document(db: AsyncSession, tmp_path, org_id, prospect_id):
    stored = tmp_path / org_id / "applicants" / prospect_id / "licence.jpg"
    stored.parent.mkdir(parents=True, exist_ok=True)
    stored.write_bytes(b"scanned licence")
    db.add(
        ProspectDocument(
            prospect_id=prospect_id,
            document_type="id",
            file_name=stored.name,
            file_path=str(stored),
        )
    )
    await db.flush()
    return stored


ENABLED = {"auto_purge_enabled": True, "purge_days_after_inactive": 365}


class TestWhatIsPurged:
    async def test_past_the_threshold_is_purged_with_files_and_audit(
        self, db_session: AsyncSession, tmp_path
    ):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, ENABLED)
        old = await _prospect(db_session, org_id, pipeline_id, inactive_days=400)
        stored = await _with_document(db_session, tmp_path, org_id, old)
        # The job's per-pipeline rollback releases a savepoint in this
        # fixture; committing first keeps the setup out of its reach.
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_id, now=NOW)

        assert result["purged"] == 1
        assert result["errors"] == []
        assert not await _exists(db_session, old)
        assert not stored.exists()
        audit = (
            (
                await db_session.execute(
                    select(AuditLog).where(
                        AuditLog.organization_id == org_id,
                        AuditLog.event_type == "membership_pipeline.prospects_purged",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(audit) == 1
        data = audit[0].event_data
        assert data["trigger"] == "auto_purge"
        assert data["pipeline_id"] == pipeline_id
        assert data["purged_count"] == 1
        assert data["purged_ids"] == [old]
        assert data["purge_days_after_inactive"] == 365
        assert audit[0].user_id is None
        assert audit[0].username == "system"

    async def test_under_the_threshold_is_kept(self, db_session: AsyncSession):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, ENABLED)
        recent = await _prospect(db_session, org_id, pipeline_id, inactive_days=364)
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_id, now=NOW)

        assert result["purged"] == 0
        assert await _exists(db_session, recent)

    @pytest.mark.parametrize(
        "config",
        [
            {"auto_purge_enabled": False, "purge_days_after_inactive": 30},
            {"purge_days_after_inactive": 30},
            {},
            None,
        ],
    )
    async def test_a_disabled_pipeline_purges_nothing(
        self, db_session: AsyncSession, config
    ):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, config)
        old = await _prospect(db_session, org_id, pipeline_id, inactive_days=2000)
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_id, now=NOW)

        assert result["purged"] == 0
        assert await _exists(db_session, old)

    async def test_no_recorded_inactive_date_is_never_purged(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, ENABLED)
        undated = await _prospect(db_session, org_id, pipeline_id, inactive_days=None)
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_id, now=NOW)

        assert result["purged"] == 0
        assert await _exists(db_session, undated)

    @pytest.mark.parametrize(
        "status",
        [
            ProspectStatus.ACTIVE,
            ProspectStatus.ON_HOLD,
            ProspectStatus.WITHDRAWN,
            ProspectStatus.REJECTED,
            ProspectStatus.APPROVED,
        ],
    )
    async def test_a_non_inactive_status_is_never_purged(
        self, db_session: AsyncSession, status
    ):
        # A stale clock on a non-inactive row is impossible through the
        # service, but the status filter must hold on its own regardless.
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, ENABLED)
        kept = await _prospect(
            db_session, org_id, pipeline_id, status=status, inactive_days=2000
        )
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_id, now=NOW)

        assert result["purged"] == 0
        assert await _exists(db_session, kept)

    async def test_the_threshold_is_clamped_to_the_screens_bounds(
        self, db_session: AsyncSession
    ):
        # A hand-edited 1 day is read as the 30-day minimum.
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(
            db_session,
            org_id,
            {"auto_purge_enabled": True, "purge_days_after_inactive": 1},
        )
        young = await _prospect(db_session, org_id, pipeline_id, inactive_days=10)
        old = await _prospect(db_session, org_id, pipeline_id, inactive_days=31)
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_id, now=NOW)

        assert result["purged"] == 1
        assert await _exists(db_session, young)
        assert not await _exists(db_session, old)

    async def test_a_second_run_finds_nothing_left(self, db_session: AsyncSession):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, ENABLED)
        await _prospect(db_session, org_id, pipeline_id, inactive_days=400)
        await db_session.commit()
        svc = MembershipPipelineService(db_session)

        first = await svc.auto_purge_inactive_prospects(org_id, now=NOW)
        second = await svc.auto_purge_inactive_prospects(org_id, now=NOW)

        assert first["purged"] == 1
        assert second["purged"] == 0


class TestThresholdParsing:
    @pytest.mark.parametrize(
        ("config", "expected"),
        [
            ({"auto_purge_enabled": True, "purge_days_after_inactive": 365}, 365),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": 90.0}, 90),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": 5}, 30),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": 99999}, 1095),
            ({"auto_purge_enabled": True}, None),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": "365"}, None),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": None}, None),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": True}, None),
            ({"auto_purge_enabled": True, "purge_days_after_inactive": 90.5}, None),
            ({"auto_purge_enabled": "true", "purge_days_after_inactive": 365}, None),
            ({"auto_purge_enabled": False, "purge_days_after_inactive": 365}, None),
            (["not", "a", "dict"], None),
            ("garbage", None),
            (None, None),
        ],
    )
    def test_only_an_explicit_on_with_a_number_purges(self, config, expected):
        assert MembershipPipelineService.auto_purge_threshold_days(config) == expected


class TestTheScheduledRun:
    def test_it_is_registered_to_run_daily(self):
        assert TASK_RUNNERS["membership_auto_purge"] is run_membership_auto_purge
        assert TASK_INTERVALS_SECONDS["membership_auto_purge"] == 86400

    async def test_a_garbage_config_skips_only_its_own_pipeline(
        self, db_session: AsyncSession
    ):
        bad_org = await _org(db_session)
        bad_pipeline = await _pipeline(
            db_session,
            bad_org,
            {"auto_purge_enabled": True, "purge_days_after_inactive": "soon"},
        )
        bad_kept = await _prospect(
            db_session, bad_org, bad_pipeline, inactive_days=2000
        )

        good_org = await _org(db_session)
        good_pipeline = await _pipeline(db_session, good_org, ENABLED)
        good_gone = await _prospect(
            db_session, good_org, good_pipeline, inactive_days=2000
        )
        await db_session.commit()

        out = await run_membership_auto_purge(db_session)

        assert out["task"] == "membership_auto_purge"
        assert not any(e["org_id"] in (bad_org, good_org) for e in out["errors"])
        assert await _exists(db_session, bad_kept)
        assert not await _exists(db_session, good_gone)

    async def test_one_orgs_failure_does_not_stop_another_orgs_purge(
        self, db_session: AsyncSession, tmp_path
    ):
        failing_org = await _org(db_session)
        failing_pipeline = await _pipeline(db_session, failing_org, ENABLED)
        stuck = await _prospect(
            db_session, failing_org, failing_pipeline, inactive_days=2000
        )
        stuck_file = await _with_document(db_session, tmp_path, failing_org, stuck)

        other_org = await _org(db_session)
        other_pipeline = await _pipeline(db_session, other_org, ENABLED)
        gone = await _prospect(
            db_session, other_org, other_pipeline, inactive_days=2000
        )
        await db_session.commit()

        real_remove = __import__("os").remove

        def _remove(path):
            if str(path) == str(stuck_file):
                raise PermissionError("read-only")
            return real_remove(path)

        with patch("os.remove", side_effect=_remove):
            out = await run_membership_auto_purge(db_session)

        assert [
            e["org_id"]
            for e in out["errors"]
            if e["org_id"]
            in (
                failing_org,
                other_org,
            )
        ] == [failing_org]
        assert await _exists(db_session, stuck)
        assert stuck_file.exists()
        assert not await _exists(db_session, gone)

    async def test_other_organizations_prospects_are_untouched(
        self, db_session: AsyncSession
    ):
        purging_org = await _org(db_session)
        purging_pipeline = await _pipeline(db_session, purging_org, ENABLED)
        await _prospect(db_session, purging_org, purging_pipeline, inactive_days=2000)

        # Auto-purge is off here; an equally old application must survive
        # the run that purges its neighbour organization.
        quiet_org = await _org(db_session)
        quiet_pipeline = await _pipeline(db_session, quiet_org, {})
        quiet = await _prospect(
            db_session, quiet_org, quiet_pipeline, inactive_days=2000
        )
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(purging_org, now=NOW)

        assert result["purged"] == 1
        assert await _exists(db_session, quiet)

    async def test_a_foreign_pipeline_is_not_reached_through_another_org(
        self, db_session: AsyncSession
    ):
        # The pipeline enabling purge belongs to org B; running org A must not
        # read B's pipelines at all.
        org_a = await _org(db_session)
        org_b = await _org(db_session)
        b_pipeline = await _pipeline(db_session, org_b, ENABLED)
        b_prospect = await _prospect(db_session, org_b, b_pipeline, inactive_days=2000)
        await db_session.commit()

        result = await MembershipPipelineService(
            db_session
        ).auto_purge_inactive_prospects(org_a, now=NOW)

        assert result["purged"] == 0
        assert await _exists(db_session, b_prospect)


class TestTheClock:
    async def _fresh(self, db_session: AsyncSession):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(db_session, org_id, ENABLED)
        prospect_id = await _prospect(
            db_session,
            org_id,
            pipeline_id,
            status=ProspectStatus.ACTIVE,
            inactive_days=None,
        )
        return MembershipPipelineService(db_session), org_id, prospect_id

    async def _clock(self, db_session: AsyncSession, prospect_id: str):
        return (
            await db_session.execute(
                select(ProspectiveMember.inactive_since).where(
                    ProspectiveMember.id == prospect_id
                )
            )
        ).scalar_one()

    async def test_set_status_starts_and_clears_it(self, db_session: AsyncSession):
        svc, org_id, prospect_id = await self._fresh(db_session)

        await svc.set_prospect_status(prospect_id, org_id, "inactive")
        assert await self._clock(db_session, prospect_id) is not None

        await svc.set_prospect_status(prospect_id, org_id, "active")
        assert await self._clock(db_session, prospect_id) is None

    async def test_leaving_inactive_for_any_status_clears_it(
        self, db_session: AsyncSession
    ):
        svc, org_id, prospect_id = await self._fresh(db_session)
        await svc.set_prospect_status(prospect_id, org_id, "inactive")

        await svc.set_prospect_status(prospect_id, org_id, "on_hold")

        assert await self._clock(db_session, prospect_id) is None

    async def test_deactivating_again_restarts_it(self, db_session: AsyncSession):
        svc, org_id, prospect_id = await self._fresh(db_session)
        await svc.set_prospect_status(prospect_id, org_id, "inactive")
        await db_session.execute(
            update(ProspectiveMember)
            .where(ProspectiveMember.id == prospect_id)
            .values(inactive_since=NOW - timedelta(days=900))
        )
        await svc.set_prospect_status(prospect_id, org_id, "active")

        await svc.set_prospect_status(prospect_id, org_id, "inactive")

        clock = await self._clock(db_session, prospect_id)
        assert clock is not None
        assert clock.replace(tzinfo=timezone.utc) > NOW - timedelta(days=1)

    async def test_bulk_status_change_stamps_it(self, db_session: AsyncSession):
        svc, org_id, prospect_id = await self._fresh(db_session)

        await svc.bulk_set_prospect_status(
            [prospect_id], org_id, "inactive", changed_by=None
        )
        assert await self._clock(db_session, prospect_id) is not None

        await svc.bulk_set_prospect_status(
            [prospect_id], org_id, "active", changed_by=None
        )
        assert await self._clock(db_session, prospect_id) is None

    async def test_the_generic_update_stamps_it(self, db_session: AsyncSession):
        svc, org_id, prospect_id = await self._fresh(db_session)

        await svc.update_prospect(prospect_id, org_id, {"status": "inactive"})
        assert await self._clock(db_session, prospect_id) is not None
        deactivated = (
            await db_session.execute(
                select(ProspectiveMember.deactivated_at).where(
                    ProspectiveMember.id == prospect_id
                )
            )
        ).scalar_one()
        assert deactivated is not None

        await svc.update_prospect(prospect_id, org_id, {"status": "active"})
        assert await self._clock(db_session, prospect_id) is None

    async def test_the_inactivity_sweep_stamps_it(self, db_session: AsyncSession):
        org_id = await _org(db_session)
        pipeline_id = await _pipeline(
            db_session,
            org_id,
            {"timeout_preset": "custom", "custom_timeout_days": 30},
        )
        prospect_id = await _prospect(
            db_session,
            org_id,
            pipeline_id,
            status=ProspectStatus.ACTIVE,
            inactive_days=None,
        )
        await db_session.execute(
            text("UPDATE prospective_members SET updated_at = :at WHERE id = :id"),
            {
                "at": (datetime.now(timezone.utc) - timedelta(days=60)).replace(
                    tzinfo=None
                ),
                "id": prospect_id,
            },
        )
        await db_session.flush()

        result = await MembershipPipelineService(
            db_session
        ).process_inactivity_warnings(org_id)

        assert result["marked_inactive"] == 1
        row = (
            await db_session.execute(
                select(
                    ProspectiveMember.status,
                    ProspectiveMember.inactive_since,
                    ProspectiveMember.deactivated_at,
                ).where(ProspectiveMember.id == prospect_id)
            )
        ).one()
        assert row.status == ProspectStatus.INACTIVE
        assert row.inactive_since is not None
        assert row.deactivated_at is not None

    async def test_the_clock_is_not_writable_through_the_generic_update(
        self, db_session: AsyncSession
    ):
        svc, org_id, prospect_id = await self._fresh(db_session)

        await svc.update_prospect(
            prospect_id, org_id, {"inactive_since": NOW - timedelta(days=5000)}
        )

        assert await self._clock(db_session, prospect_id) is None
