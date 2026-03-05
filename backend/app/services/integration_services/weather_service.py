"""
NWS Weather Alerts Service

Fetches active weather alerts from the NOAA/NWS API (api.weather.gov).
Free, no API key required. Designed to run as a scheduled task every 15 min.
"""

import logging
from typing import Any

from app.schemas.integration import WeatherAlertResponse
from app.services.integration_services.base import create_integration_client

logger = logging.getLogger(__name__)

# NWS API base — hardcoded, no user-provided URLs (SSRF-safe)
NWS_API_BASE = "https://api.weather.gov"


async def fetch_active_alerts(zone_id: str) -> list[dict[str, Any]]:
    """
    Fetch active weather alerts for a NWS zone.

    Args:
        zone_id: NWS zone identifier (e.g., "NYZ072", "CAZ006").

    Returns:
        List of validated alert dicts.
    """
    url = f"{NWS_API_BASE}/alerts/active"
    headers = {
        "Accept": "application/geo+json",
        "User-Agent": "(TheLogbook, admin@thelogbook.app)",
    }

    async with create_integration_client() as client:
        response = await client.get(url, params={"zone": zone_id}, headers=headers)
        response.raise_for_status()

    data = response.json()
    features = data.get("features", [])

    alerts: list[dict[str, Any]] = []
    for feature in features:
        props = feature.get("properties", {})
        try:
            validated = WeatherAlertResponse(**props)
            alerts.append(validated.model_dump())
        except Exception:
            logger.debug("Skipping invalid alert entry")
            continue

    logger.info("Fetched %d active alerts for zone %s", len(alerts), zone_id)
    return alerts


async def test_zone(zone_id: str) -> str:
    """Test that a zone ID is valid by fetching alerts for it."""
    try:
        alerts = await fetch_active_alerts(zone_id)
        return f"Zone {zone_id} is valid. {len(alerts)} active alert(s)."
    except Exception as e:
        raise Exception(
            f"Could not fetch alerts for zone {zone_id}: {e}"
        )
