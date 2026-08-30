"""Unit tests for the member-status lifecycle state machine.

The admin status-change endpoint previously allowed any-to-any transitions
(module audit, roles #5). These tests pin the transition graph's invariants
and the validator's error behavior.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.member_status import (
    ALLOWED_STATUS_TRANSITIONS,
    _send_property_return_email,
    assert_transition_allowed,
)
from app.core.permissions import DEFAULT_POSITIONS
from app.models.user import UserStatus


class TestTransitionGraph:

    def test_every_status_has_an_entry(self):
        assert set(ALLOWED_STATUS_TRANSITIONS) == set(UserStatus)

    def test_archived_is_fully_isolated(self):
        """Archive/reactivate have dedicated endpoints — the status-change
        endpoint must not move members in or out of ARCHIVED."""
        assert ALLOWED_STATUS_TRANSITIONS[UserStatus.ARCHIVED] == frozenset()
        for targets in ALLOWED_STATUS_TRANSITIONS.values():
            assert UserStatus.ARCHIVED not in targets

    def test_no_self_transitions(self):
        for source, targets in ALLOWED_STATUS_TRANSITIONS.items():
            assert source not in targets

    def test_suspension_resolves_before_leave_or_retirement(self):
        targets = ALLOWED_STATUS_TRANSITIONS[UserStatus.SUSPENDED]
        assert UserStatus.RETIRED not in targets
        assert UserStatus.LEAVE not in targets

    def test_drops_reachable_from_every_membership_state(self):
        for source in (
            UserStatus.PROBATIONARY,
            UserStatus.ACTIVE,
            UserStatus.INACTIVE,
            UserStatus.SUSPENDED,
            UserStatus.LEAVE,
        ):
            targets = ALLOWED_STATUS_TRANSITIONS[source]
            assert UserStatus.DROPPED_VOLUNTARY in targets
            assert UserStatus.DROPPED_INVOLUNTARY in targets

    def test_reinstatement_paths_exist(self):
        for source in (
            UserStatus.RETIRED,
            UserStatus.DROPPED_VOLUNTARY,
            UserStatus.DROPPED_INVOLUNTARY,
        ):
            assert UserStatus.ACTIVE in ALLOWED_STATUS_TRANSITIONS[source]


class TestAssertTransitionAllowed:

    def test_allowed_transition_passes(self):
        assert_transition_allowed(UserStatus.ACTIVE, UserStatus.LEAVE)

    def test_blocked_transition_raises_400_with_allowed_list(self):
        with pytest.raises(HTTPException) as exc:
            assert_transition_allowed(UserStatus.SUSPENDED, UserStatus.RETIRED)
        assert exc.value.status_code == 400
        assert "suspended" in exc.value.detail
        assert "retired" in exc.value.detail
        # The error teaches the caller what IS allowed.
        assert "active" in exc.value.detail

    def test_archiving_redirects_to_archive_endpoint(self):
        with pytest.raises(HTTPException) as exc:
            assert_transition_allowed(UserStatus.ACTIVE, UserStatus.ARCHIVED)
        assert exc.value.status_code == 400
        assert "archive endpoint" in exc.value.detail

    def test_archived_source_redirects_to_reactivate_endpoint(self):
        with pytest.raises(HTTPException) as exc:
            assert_transition_allowed(UserStatus.ARCHIVED, UserStatus.ACTIVE)
        assert exc.value.status_code == 400
        assert "reactivate" in exc.value.detail


class TestMemberBaselinePermissions:

    def test_member_position_holds_equipment_check_submit(self):
        """EC-7 gated the check-flow reads with view-OR-submit; the default
        member position must carry submit or members lose the check flow
        (migration 20260801_0010 backfills existing orgs)."""
        member = DEFAULT_POSITIONS["member"]
        assert "inventory.check_submit" in member["permissions"]
        # view stays leadership-only: it also opens compliance/failure
        # reports, which are not baseline member material.
        assert "inventory.check_view" not in member["permissions"]


@pytest.mark.asyncio
async def test_property_return_email_releases_session_before_delivery(monkeypatch):
    """Slow outbound delivery must not retain a database connection."""
    session_open = False
    session_was_open_during_send = None

    class Result:
        def scalar_one_or_none(self):
            return SimpleNamespace(name="Test Department")

    class Session:
        async def execute(self, _query):
            return Result()

    async def get_session():
        nonlocal session_open
        session_open = True
        try:
            yield Session()
        finally:
            session_open = False

    class TemplateService:
        def __init__(self, _session):
            pass

        async def get_template(self, *_args):
            return None

    class EmailService:
        def __init__(self, _organization):
            pass

        async def send_email(self, **_kwargs):
            nonlocal session_was_open_during_send
            session_was_open_during_send = session_open

    monkeypatch.setattr(
        "app.api.v1.endpoints.member_status.database_manager.get_session",
        get_session,
    )
    monkeypatch.setattr("app.services.email_service.EmailService", EmailService)
    monkeypatch.setattr(
        "app.services.email_template_service.EmailTemplateService", TemplateService
    )

    await _send_property_return_email(
        organization_id="org-1",
        to_emails=["member@example.com"],
        cc_emails=[],
        report_data={
            "member_name": "Test Member",
            "drop_type_display": "Voluntary",
            "effective_date": "2026-08-12",
            "return_deadline": "2026-08-26",
            "item_count": 0,
            "items": [],
            "total_value": 0,
            "performed_by_name": "Test Admin",
            "performed_by_title": "Chief",
        },
        member_email="member@example.com",
    )
    assert session_was_open_during_send is False
