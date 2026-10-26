"""The QR check-in dashboard's events are written by the server (RPT2-3).

``GET /analytics/metrics`` counts ``qr_scan``, ``check_in_success`` and
``check_in_failure`` rows and nothing wrote them, so every department read zero.
Owner decision: the server records them. A scan is the self-check-in page's
first load, kept once per member per event (the data endpoint is polled, and
the officer's QR display page polls it too). Success and failure come from the
self-check-in endpoint's outcome, a failure carrying one reason from a fixed
list. An officer's manual check-in is not counted.
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import events as ep
from app.core.constants import (
    ANALYTICS_CHECK_IN_FAILURE,
    ANALYTICS_CHECK_IN_SUCCESS,
    ANALYTICS_QR_SCAN,
)
from app.models.analytics import AnalyticsEvent
from app.services.event_service import (
    ATTENDANCE_LOCKED_PREFIX,
    PHASE_GATE_PREFIX,
)
from app.services.qr_check_in_analytics import (
    device_type_from_user_agent,
    failure_reason,
    record_qr_scan,
)

IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"


def _uid() -> str:
    return str(uuid.uuid4())


async def _rows(db, org_id):
    result = await db.execute(
        select(AnalyticsEvent).where(AnalyticsEvent.organization_id == org_id)
    )
    return list(result.scalars().all())


def _request(user_agent=IPHONE):
    return SimpleNamespace(headers={"user-agent": user_agent})


@pytest.mark.unit
class TestClassification:
    @pytest.mark.parametrize(
        ("error", "reason"),
        [
            ("Check-in is not available yet. Opens at 07:00 PM EDT.", "not_open_yet"),
            ("Check-in has closed for this event. Ask an organizer.", "closed"),
            ("Event has been cancelled", "event_cancelled"),
            (ATTENDANCE_LOCKED_PREFIX + "Attendance is locked.", "attendance_locked"),
            ("Event not found", None),
            ("User not found in organization", None),
            ("Some message nobody mapped", None),
        ],
    )
    def test_a_refusal_maps_to_a_bounded_reason_or_none(self, error, reason):
        assert failure_reason(error) == reason

    @pytest.mark.parametrize(
        ("user_agent", "device"),
        [
            (IPHONE, "mobile"),
            ("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", "tablet"),
            ("Mozilla/5.0 (Linux; Android 15; Pixel Tablet)", "tablet"),
            ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141", "desktop"),
            (None, "unknown"),
        ],
    )
    def test_device_type_matches_the_client_rule(self, user_agent, device):
        assert device_type_from_user_agent(user_agent) == device


@pytest.mark.integration
class TestScans:
    async def test_one_scan_per_member_per_event(self, db_session):
        org, event, member, other = _uid(), _uid(), _uid(), _uid()

        assert await record_qr_scan(db_session, org, event, member, "mobile")
        await db_session.flush()
        assert not await record_qr_scan(db_session, org, event, member, "mobile")
        assert await record_qr_scan(db_session, org, event, other, "desktop")
        await db_session.flush()

        rows = await _rows(db_session, org)
        assert sorted(r.user_id for r in rows) == sorted([member, other])
        assert {r.event_type for r in rows} == {ANALYTICS_QR_SCAN}

    async def _qr_data(self, db_session, scan):
        org, event = _uid(), _uid()
        user = SimpleNamespace(id=_uid(), organization_id=org)
        data = {
            "event_id": event,
            "event_name": "Drill",
            "start_datetime": "2026-10-25T23:00:00Z",
            "end_datetime": "2026-10-26T01:00:00Z",
            "check_in_start": "2026-10-25T22:00:00Z",
            "check_in_end": "2026-10-26T01:00:00Z",
            "is_valid": True,
            "can_check_in": True,
        }
        with patch.object(
            ep.EventService,
            "get_qr_check_in_data",
            AsyncMock(return_value=(data, None)),
        ):
            for _ in range(3):  # the page's first load, then polling
                await ep.get_qr_check_in_data(
                    event_id=uuid.UUID(event),
                    request=_request(),
                    scan=scan,
                    db=db_session,
                    current_user=user,
                )
        return await _rows(db_session, org)

    async def test_the_first_load_records_the_scan_once(self, db_session):
        rows = await self._qr_data(db_session, scan=True)

        assert [(r.event_type, r.device_type) for r in rows] == [
            (ANALYTICS_QR_SCAN, "mobile")
        ]

    async def test_polling_and_the_qr_display_page_record_nothing(self, db_session):
        assert await self._qr_data(db_session, scan=False) == []


@pytest.mark.integration
class TestSelfCheckInOutcomes:
    async def _check_in(self, db_session, outcome, is_checkout=False):
        org, event = _uid(), _uid()
        user = SimpleNamespace(id=_uid(), organization_id=org, username="m")
        body = SimpleNamespace(is_checkout=is_checkout)
        with patch.object(
            ep.EventService, "self_check_in", AsyncMock(return_value=outcome)
        ), patch.object(
            ep, "_build_rsvp_response", return_value=MagicMock(model_dump=dict)
        ), patch.object(
            ep, "log_audit_event", AsyncMock()
        ):
            try:
                await ep.self_check_in(
                    event_id=uuid.UUID(event),
                    request=_request(),
                    check_in_data=body,
                    override=False,
                    db=db_session,
                    current_user=user,
                )
            except HTTPException:
                pass
        return await _rows(db_session, org)

    async def test_a_check_in_records_a_success(self, db_session):
        rows = await self._check_in(db_session, (MagicMock(), None, None))

        assert [r.event_type for r in rows] == [ANALYTICS_CHECK_IN_SUCCESS]

    async def test_a_refusal_records_a_failure_with_its_reason(self, db_session):
        rows = await self._check_in(
            db_session, (None, "Check-in has closed for this event.", None)
        )

        assert [(r.event_type, r.event_metadata["error_reason"]) for r in rows] == [
            (ANALYTICS_CHECK_IN_FAILURE, "closed")
        ]

    @pytest.mark.parametrize(
        ("outcome", "is_checkout"),
        [
            ((MagicMock(), "ALREADY_CHECKED_IN", None), False),
            ((None, PHASE_GATE_PREFIX + "Finish phase 1 first.", None), False),
            ((MagicMock(), None, None), True),
            ((None, "Event not found", None), False),
        ],
        ids=["repeat-scan", "phase-gate-warning", "check-out", "not-this-org"],
    )
    async def test_what_is_not_a_check_in_outcome_records_nothing(
        self, db_session, outcome, is_checkout
    ):
        assert await self._check_in(db_session, outcome, is_checkout) == []
