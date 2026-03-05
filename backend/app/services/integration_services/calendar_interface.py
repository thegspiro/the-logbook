"""
Calendar Sync Interface

Abstract base class for calendar integration services (Google, Outlook).
Allows the event service to sync to all connected calendars through a
single interface.
"""

from abc import ABC, abstractmethod
from typing import Any


class CalendarSyncInterface(ABC):
    """Abstract base class for calendar sync services."""

    @abstractmethod
    async def push_event(
        self, event_data: dict[str, Any], calendar_id: str = "primary"
    ) -> str | None:
        """
        Push an event to the external calendar.

        Returns:
            The external calendar event ID, or None on failure.
        """

    @abstractmethod
    async def update_event(
        self,
        external_event_id: str,
        event_data: dict[str, Any],
        calendar_id: str = "primary",
    ) -> bool:
        """Update an existing event in the external calendar."""

    @abstractmethod
    async def delete_event(
        self, external_event_id: str, calendar_id: str = "primary"
    ) -> bool:
        """Delete an event from the external calendar."""

    @abstractmethod
    async def test_connection(self) -> str:
        """Test that the calendar connection is working. Returns a status message."""
