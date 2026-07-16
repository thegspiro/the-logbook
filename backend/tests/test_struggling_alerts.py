"""
Struggling-member / deadline alert delivery (previously inert):
  * struggling alerts go to the member AND training officers (not recipient=None)
  * deadline warnings actually emit a notification to the member
  * training officers are resolved by role
DB / notification layer mocked.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.core.constants import DEFAULT_TRAINING_OFFICER_ROLES
from app.services import notifications_service as notif_mod
from app.services.struggling_member_service import StrugglingMemberService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars(items):
    r = MagicMock()
    r.scalars.return_value.all.return_value = items
    return r


class RecordingSession:
    def __init__(self, results=None):
        self._results = list(results or [])
        self.commit = AsyncMock()

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _member_data(user_id="u1"):
    return {
        "enrollment": SimpleNamespace(struggling_alert_sent_at=None),
        "user_id": user_id,
        "member_name": "Jane Recruit",
        "enrollment_id": "enr-1",
        "program_id": "prog-1",
        "program_name": "Recruit School",
        "progress_pct": 20.0,
        "issues": [{"detail": "Deadline in 5 days but only 20% complete"}],
    }


class TestStrugglingNotificationDelivery:
    async def test_notifies_member_and_officers_with_real_recipients(self, monkeypatch):
        mock_log = AsyncMock(return_value=(MagicMock(), None))
        monkeypatch.setattr(
            notif_mod.NotificationsService, "log_notification", mock_log
        )

        svc = StrugglingMemberService(RecordingSession())
        officers = [SimpleNamespace(id="off-1"), SimpleNamespace(id="off-2")]

        await svc._send_struggling_notification("org-1", _member_data("u1"), officers)

        recipients = [
            c.kwargs["log_data"]["recipient_id"] for c in mock_log.await_args_list
        ]
        # Member + two officers, and never a null recipient (the old bug).
        assert recipients == ["u1", "off-1", "off-2"]
        assert None not in recipients

    async def test_officer_who_is_the_member_is_not_double_notified(self, monkeypatch):
        mock_log = AsyncMock(return_value=(MagicMock(), None))
        monkeypatch.setattr(
            notif_mod.NotificationsService, "log_notification", mock_log
        )

        svc = StrugglingMemberService(RecordingSession())
        officers = [
            SimpleNamespace(id="u1")
        ]  # the struggling member is also an officer

        await svc._send_struggling_notification("org-1", _member_data("u1"), officers)

        recipients = [
            c.kwargs["log_data"]["recipient_id"] for c in mock_log.await_args_list
        ]
        assert recipients == ["u1"]  # only the member notification, no officer dupe


class TestDeadlineNotificationDelivery:
    async def test_emits_a_notification_to_the_member(self, monkeypatch):
        mock_log = AsyncMock(return_value=(MagicMock(), None))
        monkeypatch.setattr(
            notif_mod.NotificationsService, "log_notification", mock_log
        )

        program = SimpleNamespace(name="Recruit School")
        enrollment = SimpleNamespace(
            id="enr-1", user_id="u1", program_id="prog-1", progress_percentage=40.0
        )
        svc = StrugglingMemberService(RecordingSession([_one(program)]))

        await svc._send_deadline_notification("org-1", enrollment, days_left=7)

        mock_log.assert_awaited_once()
        log_data = mock_log.await_args.kwargs["log_data"]
        assert log_data["recipient_id"] == "u1"
        assert "7 days" in log_data["message"]


class TestGetTrainingOfficers:
    async def test_filters_by_role_slug(self):
        officer_role = DEFAULT_TRAINING_OFFICER_ROLES[0]
        officer = SimpleNamespace(
            id="off-1", roles=[SimpleNamespace(slug=officer_role)]
        )
        member = SimpleNamespace(id="m-1", roles=[SimpleNamespace(slug="member")])
        svc = StrugglingMemberService(RecordingSession([_scalars([officer, member])]))

        result = await svc._get_training_officers("org-1")

        assert [u.id for u in result] == ["off-1"]
