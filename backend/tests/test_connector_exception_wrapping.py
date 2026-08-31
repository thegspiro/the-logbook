"""
INT-6 follow-up: three connector test_connection() implementations catch a
broad exception and re-raise it as a bare Exception, but interpolated the
caught exception's raw text into the new message (e.g.
``raise Exception(f"Google Calendar connection failed: {e}")``). Because
that re-raised message is of exact type ``Exception``, it is exactly the
shape ``sanitize_connector_error()`` treats as "hand-authored and safe" at
the caller boundary (POST /integrations/{id}/test-connection) — so the raw
interpolated text (which can be an httpx DNS/TLS/timeout message) reached
the client anyway. Fixed by dropping the interpolation and logging the real
exception server-side instead.
"""

from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.integration_services.google_calendar_service import (
    GoogleCalendarService,
)
from app.services.integration_services.outlook_calendar_service import (
    OutlookCalendarService,
)
from app.services.integration_services.weather_service import (
    test_zone as run_test_zone,  # Aliased: a bare "test_zone" import is collected by pytest as a test function (name starts with test_) and errors.
)

pytestmark = pytest.mark.asyncio


class TestGoogleCalendarTestConnectionDoesNotLeakRawException:
    async def test_dns_failure_text_is_not_interpolated_into_message(self):
        dns_failure = "[Errno -2] Name or service not known"
        service = GoogleCalendarService({})
        service._get_service = lambda: (_ for _ in ()).throw(
            httpx.ConnectError(dns_failure)
        )

        with pytest.raises(
            Exception, match="Google Calendar connection failed"
        ) as exc_info:
            await service.test_connection()

        assert dns_failure not in str(exc_info.value)
        assert (
            str(exc_info.value)
            == "Google Calendar connection failed — check the stored credentials"
        )


class TestOutlookCalendarTestConnectionDoesNotLeakRawException:
    async def test_dns_failure_text_is_not_interpolated_into_message(self):
        dns_failure = "[Errno -2] Name or service not known"
        service = OutlookCalendarService(
            {
                "client_id": "c",
                "client_secret": "s",
                "tenant_id": "t",
                "refresh_token": "r",
            }
        )
        with patch.object(
            service, "_get_token", side_effect=httpx.ConnectError(dns_failure)
        ):
            with pytest.raises(
                Exception, match="Outlook Calendar connection failed"
            ) as exc_info:
                await service.test_connection()

        assert dns_failure not in str(exc_info.value)
        assert (
            str(exc_info.value)
            == "Outlook Calendar connection failed — check the stored credentials"
        )


class TestWeatherZoneTestDoesNotLeakRawException:
    async def test_dns_failure_text_is_not_interpolated_into_message(self):
        dns_failure = "[Errno -2] Name or service not known"
        with patch(
            "app.services.integration_services.weather_service.fetch_active_alerts",
            AsyncMock(side_effect=httpx.ConnectError(dns_failure)),
        ):
            with pytest.raises(
                Exception, match="Could not fetch alerts for zone"
            ) as exc_info:
                await run_test_zone("NYZ072")

        assert dns_failure not in str(exc_info.value)
        assert str(exc_info.value) == "Could not fetch alerts for zone NYZ072"
