"""The Enable Status Page stage switches an applicant's public status page.

The stage type shipped with an editor and a stored config and no reader, so a
coordinator could build "reveal the status page at the interview stage" and
nothing happened. It now decides, per applicant, whether their page is on:

* The latest Enable Status Page stage an applicant has reached decides for
  them, overriding the pipeline-wide switch in either direction.
* An applicant who has reached none follows the pipeline switch, which is what
  every applicant did before.
* On arrival an enabling stage emails the link and then completes itself, as
  an automated-email stage does; a failed send leaves it open.

DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.membership_pipeline import PipelineStepType
from app.services.membership_pipeline_service import (
    MembershipPipelineService,
    public_status_enabled_for,
    status_page_stage_enables,
)

pytestmark = [pytest.mark.unit]

_TOGGLE = PipelineStepType.STATUS_PAGE_TOGGLE


def _step(step_id, sort_order, step_type=PipelineStepType.CHECKBOX, **overrides):
    fields = dict(
        id=step_id,
        name=step_id,
        sort_order=sort_order,
        step_type=step_type,
        action_type=None,
        config={},
        is_final_step=False,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _toggle(step_id, sort_order, enable=True, **overrides):
    return _step(
        step_id,
        sort_order,
        _TOGGLE,
        config={"enable_public_status": enable, "custom_message": ""},
        **overrides,
    )


def _prospect(steps, current, pipeline_enabled=False, **overrides):
    fields = dict(
        id="p1",
        organization_id="org1",
        first_name="Jane",
        email="jane@example.org",
        status_token="tok_1",
        status_token_created_at=datetime.now(timezone.utc) - timedelta(days=60),
        current_step_id=current,
        pipeline=SimpleNamespace(steps=steps, public_status_enabled=pipeline_enabled),
        step_progress=[],
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestPublicStatusEnabledFor:
    @pytest.mark.parametrize("pipeline_enabled", [True, False])
    def test_no_stage_reached_follows_the_pipeline(self, pipeline_enabled):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=not pipeline_enabled)]

        prospect = _prospect(steps, "s1", pipeline_enabled=pipeline_enabled)

        assert public_status_enabled_for(prospect) is pipeline_enabled

    def test_an_enabling_stage_turns_it_on_despite_the_pipeline(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True), _step("s3", 2)]

        assert public_status_enabled_for(_prospect(steps, "s3")) is True

    def test_a_disabling_stage_turns_it_off_despite_the_pipeline(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=False), _step("s3", 2)]

        prospect = _prospect(steps, "s3", pipeline_enabled=True)

        assert public_status_enabled_for(prospect) is False

    def test_the_stage_applies_while_the_applicant_is_on_it(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True)]

        assert public_status_enabled_for(_prospect(steps, "s2")) is True

    def test_the_latest_stage_reached_wins(self):
        steps = [
            _toggle("on", 0, enable=True),
            _step("s1", 1),
            _toggle("off", 2, enable=False),
            _step("s2", 3),
        ]

        assert public_status_enabled_for(_prospect(steps, "s1")) is True
        assert public_status_enabled_for(_prospect(steps, "s2")) is False

    def test_order_comes_from_sort_order_not_list_position(self):
        steps = [_step("s2", 2), _toggle("t", 1, enable=True), _step("s0", 0)]

        assert public_status_enabled_for(_prospect(steps, "s0")) is False
        assert public_status_enabled_for(_prospect(steps, "s2")) is True

    def test_no_current_stage_follows_the_pipeline(self):
        steps = [_toggle("t", 0, enable=True)]

        prospect = _prospect(steps, None, pipeline_enabled=False)

        assert public_status_enabled_for(prospect) is False

    def test_no_pipeline_is_off(self):
        assert public_status_enabled_for(SimpleNamespace(pipeline=None)) is False


class TestStatusPageStageEnables:
    @pytest.mark.parametrize(
        ("config", "expected"),
        [
            ({"enable_public_status": True}, True),
            ({"enable_public_status": False}, False),
            # The editor seeds True; a stage built before the key existed was
            # built to enable, and only an explicit false disables.
            ({}, True),
            (None, True),
            ({"enable_public_status": "false"}, True),
        ],
    )
    def test_reads_the_config_defensively(self, config, expected):
        step = _step("t", 0, _TOGGLE, config=config)

        assert status_page_stage_enables(step) is expected


def _service():
    db = SimpleNamespace(flush=AsyncMock())
    svc = MembershipPipelineService(db)
    svc._auto_link_event_for_step = AsyncMock()
    svc._send_status_page_link_email = AsyncMock(return_value=True)
    return svc


class TestArrivingAtTheStage:
    async def test_an_enabling_stage_emails_the_link_and_finishes(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True)]
        prospect = _prospect(steps, "s1")
        svc = _service()

        result = await svc._advance_current_step(prospect, "s1")

        assert result == ("s2", "status_page_applied")
        svc._send_status_page_link_email.assert_awaited_once_with(prospect, steps[1])

    async def test_the_link_is_valid_when_it_is_sent(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True)]
        prospect = _prospect(steps, "s1")
        before = datetime.now(timezone.utc)

        await _service()._advance_current_step(prospect, "s1")

        # Created 60 days ago; the link would otherwise arrive already expired.
        assert prospect.status_token_created_at >= before

    async def test_a_failed_send_leaves_the_stage_open(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True)]
        svc = _service()
        svc._send_status_page_link_email = AsyncMock(return_value=False)

        assert await svc._advance_current_step(_prospect(steps, "s1"), "s1") is None

    async def test_an_applicant_without_an_email_leaves_it_open(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True)]
        svc = _service()

        result = await svc._advance_current_step(
            _prospect(steps, "s1", email=None), "s1"
        )

        assert result is None
        svc._send_status_page_link_email.assert_not_awaited()

    async def test_a_disabling_stage_finishes_without_sending(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=False)]
        svc = _service()

        result = await svc._advance_current_step(_prospect(steps, "s1"), "s1")

        assert result == ("s2", "status_page_applied")
        svc._send_status_page_link_email.assert_not_awaited()

    async def test_a_final_stage_waits_for_a_coordinator(self):
        steps = [_step("s1", 0), _toggle("s2", 1, enable=True, is_final_step=True)]
        svc = _service()

        result = await svc._advance_current_step(_prospect(steps, "s1"), "s1")

        assert result is None
        svc._send_status_page_link_email.assert_awaited_once()

    async def test_any_other_stage_is_left_alone(self):
        steps = [_step("s1", 0), _step("s2", 1)]
        svc = _service()

        assert await svc._advance_current_step(_prospect(steps, "s1"), "s1") is None
        svc._send_status_page_link_email.assert_not_awaited()


class TestCompletingTheStage:
    async def test_completes_as_an_automated_system_action(self):
        svc = MembershipPipelineService(SimpleNamespace())
        svc.complete_step = AsyncMock(return_value="completed")

        result = await svc._complete_on_arrival_step(
            "p1", "org1", "s2", "status_page_applied"
        )

        assert result == "completed"
        kwargs = svc.complete_step.await_args.kwargs
        assert kwargs["completed_by"] is None
        assert kwargs["automated"] is True
        assert kwargs["action_result"] == {
            "auto_advanced": True,
            "trigger": "status_page_applied",
        }
        assert kwargs["notes"] == (
            "Completed automatically when the status page stage was applied"
        )


class TestStatusTokenUsable:
    def _svc(self):
        return MembershipPipelineService(SimpleNamespace())

    def test_opens_for_an_applicant_past_an_enabling_stage(self):
        steps = [_toggle("t", 0, enable=True), _step("s1", 1)]
        prospect = _prospect(
            steps,
            "s1",
            pipeline_enabled=False,
            status_token_created_at=datetime.now(timezone.utc),
        )

        assert self._svc()._status_token_usable(prospect) is True

    def test_closed_for_an_applicant_past_a_disabling_stage(self):
        steps = [_toggle("t", 0, enable=False), _step("s1", 1)]
        prospect = _prospect(
            steps,
            "s1",
            pipeline_enabled=True,
            status_token_created_at=datetime.now(timezone.utc),
        )

        assert self._svc()._status_token_usable(prospect) is False

    def test_an_expired_token_stays_closed_whatever_the_stage(self):
        steps = [_toggle("t", 0, enable=True)]
        prospect = _prospect(steps, "t")  # token last refreshed 60 days ago

        assert self._svc()._status_token_usable(prospect) is False


class TestLinkEmail:
    async def _send(self, config, send=None):
        db = MagicMock()
        org_result = MagicMock()
        org_result.scalar_one_or_none.return_value = SimpleNamespace(
            id="org1", name="Oak & Ash FD"
        )
        db.execute = AsyncMock(return_value=org_result)
        svc = MembershipPipelineService(db)
        email_cls = MagicMock()
        email_cls.return_value.send_email = send or AsyncMock(return_value=(1, 0))
        step = _toggle("s2", 1, name="Interview scheduled")
        step.config = config
        prospect = _prospect([step], "s2", first_name="<Jane>")
        with (
            patch("app.services.email_service.EmailService", email_cls),
            patch("app.core.config.settings.FRONTEND_URL", "https://fd.example"),
        ):
            sent = await svc._send_status_page_link_email(prospect, step)
        return sent, email_cls.return_value.send_email

    async def test_sends_the_link_to_the_applicant(self):
        sent, send = await self._send({"enable_public_status": True})

        assert sent is True
        kwargs = send.await_args.kwargs
        assert kwargs["to_emails"] == ["jane@example.org"]
        assert kwargs["subject"] == "Track Your Membership Application"
        link = "https://fd.example/application-status/tok_1"
        assert link in kwargs["html_body"]
        assert link in kwargs["text_body"]

    async def test_includes_the_custom_message_escaped(self):
        _, send = await self._send(
            {"enable_public_status": True, "custom_message": "Welcome <b>aboard</b>"}
        )

        kwargs = send.await_args.kwargs
        assert "Welcome &lt;b&gt;aboard&lt;/b&gt;" in kwargs["html_body"]
        assert "&lt;Jane&gt;" in kwargs["html_body"]
        assert "Welcome <b>aboard</b>" in kwargs["text_body"]

    async def test_a_mail_failure_reports_unsent_without_raising(self):
        sent, _ = await self._send(
            {"enable_public_status": True},
            send=AsyncMock(side_effect=RuntimeError("SMTP down")),
        )

        assert sent is False


class TestLegacyStageShape:
    """An old ``action`` row the stage editor shows as Enable Status Page."""

    def _legacy(self, step_id, sort_order, config, action_type=None):
        return _step(
            step_id,
            sort_order,
            PipelineStepType.ACTION,
            action_type=action_type,
            config=config,
        )

    def test_acts_as_the_stage_the_editor_shows(self):
        steps = [self._legacy("t", 0, {"enable_public_status": True}), _step("s1", 1)]

        assert public_status_enabled_for(_prospect(steps, "s1")) is True

    async def test_is_applied_on_arrival(self):
        steps = [_step("s1", 0), self._legacy("t", 1, {"enable_public_status": True})]
        svc = _service()

        result = await svc._advance_current_step(_prospect(steps, "s1"), "s1")

        assert result == ("t", "status_page_applied")

    def test_an_action_row_without_the_key_is_not_one(self):
        steps = [self._legacy("a", 0, {}), _step("s1", 1)]

        assert public_status_enabled_for(_prospect(steps, "s1")) is False

    def test_a_typed_action_row_keeps_its_own_meaning(self):
        # send_email resolves to an automated-email stage, whatever its config.
        steps = [
            self._legacy("e", 0, {"enable_public_status": True}, "send_email"),
            _step("s1", 1),
        ]

        assert public_status_enabled_for(_prospect(steps, "s1")) is False
