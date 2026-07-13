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
    step = SimpleNamespace(id="s1", public_visible=True, name="Interview")
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
            steps=[step],
        ),
        current_step=step,
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
    # And the response echoes the same stable token, not a new one.
    assert result["status_token"] == "tok_original"


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
            name="Recruit", public_status_enabled=True, steps=[step]
        ),
        current_step=step,
        step_progress=[],
    )


async def test_calcom_meeting_stage_surfaces_scheduling_action():
    step = SimpleNamespace(
        id="s1",
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
        public_visible=True,
        name="Meet the Chief",
        step_type="meeting",
        config={},
    )
    svc = _svc_for(_prospect_with_step(step))

    result = await svc.get_prospect_by_token("tok_original")

    assert result["current_stage_action"] is None
