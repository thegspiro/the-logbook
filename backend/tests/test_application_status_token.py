"""Public application-status token stays stable across reads.

Regression: get_prospect_by_token used to rotate the token on every
successful read and return the new value. The public status page (and the
link emailed to the prospect) carry the *original* token and never capture
the rotated one, so the link 404'd on the second request — refresh, revisit,
or React StrictMode's double-invoke broke it immediately. The token must stay
stable (its security comes from being 256-bit random, TTL-bounded, rate
limited, and pipeline opt-in), with only the TTL timestamp sliding forward.

DB mocked; no MySQL.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from app.services.membership_pipeline_service import MembershipPipelineService


def _prospect(token="tok_original", created_at=None, public_enabled=True):
    now = datetime.now(timezone.utc)
    # sort_order matters: the timeline is ordered by pipeline position, so a
    # step stub without it is not a faithful stand-in for the model.
    step = SimpleNamespace(
        id="s1", public_visible=True, name="Interview", sort_order=0, step_type="note"
    )
    return SimpleNamespace(
        id="p1",
        first_name="Jane",
        last_name="Doe",
        status=SimpleNamespace(value="active"),
        created_at=now - timedelta(days=2),
        status_token=token,
        status_token_created_at=created_at if created_at is not None else now,
        pipeline=SimpleNamespace(
            name="Recruit",
            public_status_enabled=public_enabled,
            public_show_future_stages=True,
            steps=[step],
        ),
        current_step=step,
        current_step_id=step.id,
        step_progress=[
            SimpleNamespace(
                step_id="s1",
                step=step,
                status=SimpleNamespace(value="completed"),
                completed_at=None,
                created_at=now - timedelta(days=1),
            )
        ],
    )


def _svc_for(prospect):
    db = MagicMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = prospect
    db.execute = AsyncMock(return_value=result)
    db.commit = AsyncMock()
    return MembershipPipelineService(db)


async def test_token_is_not_rotated_on_read():
    prospect = _prospect(token="tok_original")
    svc = _svc_for(prospect)

    result = await svc.get_prospect_by_token("tok_original")

    assert result is not None
    # The stored token is untouched, so the emailed link keeps working.
    assert prospect.status_token == "tok_original"
    # The bearer credential is not reflected into the public response.
    assert "status_token" not in result


async def test_second_read_with_same_token_still_succeeds():
    prospect = _prospect(token="tok_original")
    svc = _svc_for(prospect)

    first = await svc.get_prospect_by_token("tok_original")
    second = await svc.get_prospect_by_token("tok_original")

    assert first is not None
    assert second is not None
    assert second["first_name"] == "Jane"


async def test_ttl_timestamp_slides_forward_on_read():
    old_ts = datetime.now(timezone.utc) - timedelta(days=20)
    prospect = _prospect(token="tok_original", created_at=old_ts)
    svc = _svc_for(prospect)

    await svc.get_prospect_by_token("tok_original")

    # Refreshed so an actively-checked link expires only after inactivity.
    assert prospect.status_token_created_at > old_ts


async def test_expired_token_returns_none():
    expired_ts = datetime.now(timezone.utc) - timedelta(
        days=MembershipPipelineService._STATUS_TOKEN_TTL_DAYS + 1
    )
    prospect = _prospect(token="tok_original", created_at=expired_ts)
    svc = _svc_for(prospect)

    assert await svc.get_prospect_by_token("tok_original") is None


async def test_pipeline_not_opted_in_returns_none():
    prospect = _prospect(token="tok_original", public_enabled=False)
    svc = _svc_for(prospect)

    assert await svc.get_prospect_by_token("tok_original") is None


def _prospect_with_step(step):
    """Build a prospect whose single public step is the given SimpleNamespace."""
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id="p1",
        first_name="Jane",
        last_name="Doe",
        status=SimpleNamespace(value="active"),
        created_at=now - timedelta(days=2),
        status_token="tok_original",
        status_token_created_at=now,
        pipeline=SimpleNamespace(
            name="Recruit",
            public_status_enabled=True,
            public_show_future_stages=True,
            steps=[step],
        ),
        current_step=step,
        current_step_id=step.id,
        step_progress=[],
    )


async def test_calcom_meeting_stage_surfaces_scheduling_action():
    step = SimpleNamespace(
        id="s1",
        sort_order=0,
        public_visible=True,
        name="Interview",
        step_type="meeting",
        config={
            "scheduling_provider": "calcom",
            "calcom_booking_url": "https://cal.com/dept/interview",
        },
    )
    svc = _svc_for(_prospect_with_step(step))

    result = await svc.get_prospect_by_token("tok_original")

    action = result["current_stage_action"]
    assert action["type"] == "calcom_scheduling"
    assert action["url"] == "https://cal.com/dept/interview"


async def test_calcom_meeting_without_url_has_no_action():
    step = SimpleNamespace(
        id="s1",
        sort_order=0,
        public_visible=True,
        name="Interview",
        step_type="meeting",
        config={"scheduling_provider": "calcom"},
    )
    svc = _svc_for(_prospect_with_step(step))

    result = await svc.get_prospect_by_token("tok_original")

    assert result["current_stage_action"] is None


async def test_non_http_booking_url_is_rejected():
    step = SimpleNamespace(
        id="s1",
        sort_order=0,
        public_visible=True,
        name="Interview",
        step_type="meeting",
        config={
            "scheduling_provider": "calcom",
            "calcom_booking_url": "javascript:alert(1)",
        },
    )
    svc = _svc_for(_prospect_with_step(step))

    result = await svc.get_prospect_by_token("tok_original")

    assert result["current_stage_action"] is None


async def test_documenso_document_stage_surfaces_signature_note():
    step = SimpleNamespace(
        id="s1",
        sort_order=0,
        public_visible=True,
        name="Sign Waiver",
        step_type="document_upload",
        config={"signing_provider": "documenso"},
    )
    svc = _svc_for(_prospect_with_step(step))

    result = await svc.get_prospect_by_token("tok_original")

    action = result["current_stage_action"]
    assert action["type"] == "documenso_signature"
    assert "url" not in action


async def test_plain_meeting_stage_has_no_action():
    step = SimpleNamespace(
        id="s1",
        sort_order=0,
        public_visible=True,
        name="Meet the Chief",
        step_type="meeting",
        config={},
    )
    svc = _svc_for(_prospect_with_step(step))

    result = await svc.get_prospect_by_token("tok_original")

    assert result["current_stage_action"] is None


def _prospect_with_future_stages(show_future):
    """Three public stages: one done, one current, one not reached yet."""
    now = datetime.now(timezone.utc)
    steps = [
        SimpleNamespace(
            id=f"s{i}", public_visible=True, name=name, sort_order=i, step_type="note"
        )
        for i, name in enumerate(["Interest Form", "Interview", "Vote"])
    ]
    statuses = ["completed", "in_progress", "pending"]
    return SimpleNamespace(
        id="p1",
        first_name="Jane",
        last_name="Doe",
        status=SimpleNamespace(value="active"),
        created_at=now - timedelta(days=2),
        status_token="tok_original",
        status_token_created_at=now,
        pipeline=SimpleNamespace(
            name="Recruit",
            public_status_enabled=True,
            public_show_future_stages=show_future,
            steps=steps,
        ),
        current_step=steps[1],
        current_step_id=steps[1].id,
        step_progress=[
            SimpleNamespace(
                step_id=step.id,
                step=step,
                status=SimpleNamespace(value=status),
                completed_at=now if status == "completed" else None,
                created_at=now,
            )
            for step, status in zip(steps, statuses)
        ],
    )


async def test_future_stages_shown_by_default():
    svc = _svc_for(_prospect_with_future_stages(show_future=True))

    result = await svc.get_prospect_by_token("tok_original")

    assert [s["stage_name"] for s in result["stage_timeline"]] == [
        "Interest Form",
        "Interview",
        "Vote",
    ]
    assert result["total_stages"] == 3
    assert result["current_stage_name"] == "Interview"


async def test_hiding_future_stages_lists_only_completed_ones():
    svc = _svc_for(_prospect_with_future_stages(show_future=False))

    result = await svc.get_prospect_by_token("tok_original")

    assert [s["stage_name"] for s in result["stage_timeline"]] == ["Interest Form"]
    # The total alone would reveal how many stages are left.
    assert result["total_stages"] is None
    # Only completed stages: the one they are on now is withheld too.
    assert result["current_stage_name"] is None
    assert result["current_stage_action"] is None
