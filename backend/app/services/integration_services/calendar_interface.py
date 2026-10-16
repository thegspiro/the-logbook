"""
Calendar Sync Interface

The contract the Google Calendar and Outlook connectors share. Each pushes
department events one way into a single calendar the app created; payloads
come from ``calendar_common.build_calendar_payload``.

Every method raises a ``calendar_common.CalendarError`` subclass on failure
instead of returning a sentinel. A service may refresh its access token
along the way; the caller reads ``tokens`` afterwards and persists them.
"""

from abc import ABC, abstractmethod
from typing import Any

from app.services.integration_services.calendar_common import CalendarTokens


class CalendarSyncInterface(ABC):
    """Abstract base class for calendar sync services."""

    tokens: CalendarTokens | None = None

    @abstractmethod
    async def refresh_tokens(self) -> CalendarTokens:
        """Exchange the refresh token for a new access token."""

    @abstractmethod
    async def create_calendar(self, name: str) -> str:
        """Create a calendar owned by the app and return its id."""

    @abstractmethod
    async def upsert_event(
        self, calendar_id: str, external_id: str | None, payload: dict[str, Any]
    ) -> str:
        """Create or replace an event idempotently; return its external id."""

    @abstractmethod
    async def update_event(
        self, calendar_id: str, external_id: str, payload: dict[str, Any]
    ) -> None:
        """Replace an existing event. Raises CalendarNotFound if it is gone."""

    @abstractmethod
    async def delete_event(self, calendar_id: str, external_id: str) -> None:
        """Delete an event. An event that is already gone counts as deleted."""

    @abstractmethod
    async def test_connection(self) -> str:
        """Test that the calendar connection is working. Returns a status message."""
