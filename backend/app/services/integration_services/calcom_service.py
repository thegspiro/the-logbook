"""
Cal.com Integration Service

Connects to a Cal.com instance (cloud at cal.com or a self-hosted
deployment) via the Cal.com REST API v1 to pull scheduled bookings —
an open-source Calendly alternative. Useful for surfacing member
interviews, apparatus inspections, or public appointments as Logbook
events.

The v1 API authenticates with an API key passed as an ``apiKey`` query
parameter (created under Settings → Developer → API keys in Cal.com).
"""

from typing import Any

from loguru import logger

from app.services.integration_services.base import create_integration_client

# Default Cal.com Cloud API base. Self-hosted orgs override this with their
# own https://<host>/api/v1 in the integration config.
DEFAULT_API_BASE_URL = "https://api.cal.com/v1"


def _normalize_base_url(api_base_url: str) -> str:
    """Strip a trailing slash so path joins never double up."""
    return (api_base_url or DEFAULT_API_BASE_URL).rstrip("/")


def format_booking_as_event(booking: dict[str, Any]) -> dict[str, Any]:
    """
    Map a Cal.com booking to The Logbook's internal event shape.

    Only non-clinical scheduling fields are carried over. Attendee emails are
    included so the event can be linked to members, but no other personal data
    is pulled through.
    """
    attendees = booking.get("attendees") or []
    attendee_emails = [
        a.get("email", "") for a in attendees if isinstance(a, dict) and a.get("email")
    ]

    return {
        "external_id": str(booking.get("uid") or booking.get("id") or ""),
        "title": booking.get("title", "Cal.com Booking"),
        "description": booking.get("description", ""),
        "location": booking.get("location", ""),
        "start_time": booking.get("startTime", ""),
        "end_time": booking.get("endTime", ""),
        "status": booking.get("status", ""),
        "attendee_emails": attendee_emails,
    }


class CalcomService:
    """Client for the Cal.com REST API v1."""

    def __init__(self, credentials: dict[str, Any]):
        self.api_base_url: str = _normalize_base_url(
            credentials.get("api_base_url", "")
        )
        self.api_key: str = credentials.get("api_key", "")

    async def test_connection(self) -> str:
        """Verify the API key by fetching the authenticated user."""
        if not self.api_key:
            raise Exception("No Cal.com API key configured")

        async with create_integration_client() as client:
            response = await client.get(
                f"{self.api_base_url}/me",
                params={"apiKey": self.api_key},
            )
            if response.status_code == 200:
                data = response.json()
                user = data.get("user", {}) if isinstance(data, dict) else {}
                username = user.get("username") or user.get("email") or "your account"
                return f"Connected to Cal.com as {username}"
            if response.status_code in (401, 403):
                raise Exception(
                    "Cal.com rejected the API key — verify it is correct and "
                    "has not been revoked"
                )
            logger.warning(
                "Cal.com test returned {}: {}",
                response.status_code,
                response.text[:200],
            )
            raise Exception(
                f"Cal.com returned an unexpected status ({response.status_code})"
            )

    async def list_bookings(self) -> list[dict[str, Any]]:
        """Fetch bookings and return them mapped to Logbook event dicts."""
        async with create_integration_client() as client:
            response = await client.get(
                f"{self.api_base_url}/bookings",
                params={"apiKey": self.api_key},
            )
            if response.status_code != 200:
                logger.warning(
                    "Cal.com list bookings returned {}: {}",
                    response.status_code,
                    response.text[:200],
                )
                raise Exception(
                    f"Cal.com returned an unexpected status ({response.status_code})"
                )
            data = response.json()
            bookings = data.get("bookings", []) if isinstance(data, dict) else []
            return [format_booking_as_event(b) for b in bookings]
