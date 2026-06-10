"""
Tests for the struggling-member detection service
(app/services/struggling_member_service.py).

Covers the three flagging rules (deadline proximity, behind pace, stalled
requirements — including the naive-datetime regression), severity ranking,
and the deadline-warning dedup window. DB mocked; no MySQL.
"""

from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.services.struggling_member_service import StrugglingMemberService


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


def _one(item):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=item))


def _enrollment(**kw):
    return SimpleNamespace(
        id=kw.get("id", "enr-1"),
        user_id="u1",
        program_id="prog-1",
        status="active",
        progress_percentage=kw.get("progress", 10.0),
        target_completion_date=kw.get("target"),
        enrolled_at=kw.get("enrolled_at"),
        deadline_warning_sent=kw.get("warn_sent", False),
        deadline_warning_sent_at=kw.get("warn_sent_at"),
    )


@pytest.fixture(autouse=True)
def _quiet_notifications(monkeypatch):
    import app.services.notifications_service as notifications_service

    monkeypatch.setattr(
        notifications_service,
        "NotificationsService",
        MagicMock(return_value=MagicMock(log_notification=AsyncMock())),
    )


class TestDetectAndNotify:
    def _db_for(self, enrollment, in_progress=None):
        user = SimpleNamespace(full_name="Jane Smith")
        program = SimpleNamespace(name="FF1 Program")
        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[
                _scalars([enrollment]),
                _scalars(in_progress or []),
                _one(user),
                _one(program),
            ]
        )
        return db

    async def test_flags_approaching_deadline(self):
        enrollment = _enrollment(target=date.today() + timedelta(days=10), progress=40)
        svc = StrugglingMemberService(self._db_for(enrollment))
        out = await svc.detect_and_notify("org")
        assert out["members_flagged"] == 1
        member = out["flagged_members"][0]
        assert any(i["type"] == "deadline_approaching" for i in member["issues"])
        assert member["max_severity"] == "warning"
        assert out["notifications_sent"] == 1

    async def test_critical_when_deadline_within_a_week(self):
        enrollment = _enrollment(target=date.today() + timedelta(days=3), progress=40)
        svc = StrugglingMemberService(self._db_for(enrollment))
        out = await svc.detect_and_notify("org")
        assert out["flagged_members"][0]["max_severity"] == "critical"

    async def test_flags_behind_pace(self):
        enrollment = _enrollment(
            target=date.today() + timedelta(days=40),
            enrolled_at=datetime.now(timezone.utc) - timedelta(days=60),
            progress=10,
        )
        svc = StrugglingMemberService(self._db_for(enrollment))
        out = await svc.detect_and_notify("org")
        types = [i["type"] for i in out["flagged_members"][0]["issues"]]
        assert "behind_pace" in types

    async def test_stalled_requirement_with_naive_timestamp(self):
        # Regression: a naive updated_at previously raised TypeError when
        # subtracted from the aware `now`.
        stalled = SimpleNamespace(
            requirement_id="req-1",
            updated_at=datetime.now() - timedelta(days=45),  # naive on purpose
            created_at=None,
        )
        enrollment = _enrollment(target=None)
        svc = StrugglingMemberService(self._db_for(enrollment, [stalled]))
        out = await svc.detect_and_notify("org")
        member = out["flagged_members"][0]
        assert any(i["type"] == "stalled_requirement" for i in member["issues"])
        # Info-only issues don't trigger notifications.
        assert out["notifications_sent"] == 0

    async def test_healthy_enrollment_not_flagged(self):
        enrollment = _enrollment(target=date.today() + timedelta(days=120), progress=80)
        db = MagicMock()
        db.execute = AsyncMock(side_effect=[_scalars([enrollment]), _scalars([])])
        out = await StrugglingMemberService(db).detect_and_notify("org")
        assert out["members_flagged"] == 0


class TestDeadlineWarnings:
    def _db(self, enrollments):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_scalars(enrollments))
        db.commit = AsyncMock()
        return db

    async def test_sends_at_warning_thresholds(self):
        enrollment = _enrollment(target=date.today() + timedelta(days=14))
        db = self._db([enrollment])
        out = await StrugglingMemberService(db).send_deadline_warnings("org")
        assert out["warnings_sent"] == 1
        assert enrollment.deadline_warning_sent is True
        db.commit.assert_awaited()

    async def test_skips_non_threshold_days(self):
        enrollment = _enrollment(target=date.today() + timedelta(days=12))
        out = await StrugglingMemberService(
            self._db([enrollment])
        ).send_deadline_warnings("org")
        assert out["warnings_sent"] == 0

    async def test_dedupes_recent_warning(self):
        enrollment = _enrollment(
            target=date.today() + timedelta(days=7),
            warn_sent=True,
            warn_sent_at=datetime.now(timezone.utc) - timedelta(days=2),
        )
        out = await StrugglingMemberService(
            self._db([enrollment])
        ).send_deadline_warnings("org")
        assert out["warnings_sent"] == 0

    async def test_resends_after_dedup_window(self):
        enrollment = _enrollment(
            target=date.today() + timedelta(days=7),
            warn_sent=True,
            warn_sent_at=datetime.now() - timedelta(days=10),  # naive — guarded
        )
        out = await StrugglingMemberService(
            self._db([enrollment])
        ).send_deadline_warnings("org")
        assert out["warnings_sent"] == 1
