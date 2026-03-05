"""
NFIRS (National Fire Incident Reporting System) Export Service

Exports incident data in NFIRS 5.0 compatible CSV format
for submission to state fire marshal offices.
"""

import csv
import io
import logging
from typing import Any

logger = logging.getLogger(__name__)

# NFIRS 5.0 Basic Module fields (subset — most commonly required)
NFIRS_BASIC_FIELDS = [
    "State",
    "FDID",
    "Incident_Date",
    "Incident_Number",
    "Exposure",
    "Station",
    "Incident_Type",
    "Aid_Given_Received",
    "Alarm_Date",
    "Alarm_Time",
    "Arrival_Date",
    "Arrival_Time",
    "Controlled_Date",
    "Controlled_Time",
    "Last_Unit_Cleared_Date",
    "Last_Unit_Cleared_Time",
    "Shift",
    "District",
    "Actions_Taken_1",
    "Actions_Taken_2",
    "Actions_Taken_3",
    "Casualties_Fire_Deaths",
    "Casualties_Fire_Injuries",
    "Property_Loss",
    "Contents_Loss",
]


def export_nfirs_data(
    incidents: list[dict[str, Any]],
    state_fdid: str,
    state_code: str,
) -> bytes:
    """
    Generate NFIRS 5.0 Basic Module export as CSV.

    Args:
        incidents: List of incident/event dicts from the database.
        state_fdid: Fire Department ID assigned by the state.
        state_code: Two-letter state abbreviation.

    Returns:
        UTF-8 encoded CSV bytes.
    """
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=NFIRS_BASIC_FIELDS)
    writer.writeheader()

    for incident in incidents:
        row = _incident_to_nfirs_row(incident, state_fdid, state_code)
        writer.writerow(row)

    logger.info("Exported %d incidents in NFIRS format", len(incidents))
    return output.getvalue().encode("utf-8")


def _incident_to_nfirs_row(
    incident: dict[str, Any],
    state_fdid: str,
    state_code: str,
) -> dict[str, str]:
    """Map a Logbook incident to an NFIRS Basic Module row."""
    dispatched_at = incident.get("dispatched_at") or incident.get("start_time")
    on_scene_at = incident.get("on_scene_at")
    cleared_at = incident.get("cleared_at") or incident.get("end_time")

    return {
        "State": state_code.upper(),
        "FDID": state_fdid,
        "Incident_Date": _format_date(dispatched_at),
        "Incident_Number": incident.get("incident_number", ""),
        "Exposure": "000",
        "Station": incident.get("station", ""),
        "Incident_Type": _map_incident_type(incident.get("incident_type", "")),
        "Aid_Given_Received": "",
        "Alarm_Date": _format_date(dispatched_at),
        "Alarm_Time": _format_time(dispatched_at),
        "Arrival_Date": _format_date(on_scene_at),
        "Arrival_Time": _format_time(on_scene_at),
        "Controlled_Date": "",
        "Controlled_Time": "",
        "Last_Unit_Cleared_Date": _format_date(cleared_at),
        "Last_Unit_Cleared_Time": _format_time(cleared_at),
        "Shift": incident.get("shift", ""),
        "District": "",
        "Actions_Taken_1": "",
        "Actions_Taken_2": "",
        "Actions_Taken_3": "",
        "Casualties_Fire_Deaths": "0",
        "Casualties_Fire_Injuries": "0",
        "Property_Loss": "0",
        "Contents_Loss": "0",
    }


def _format_date(dt: Any) -> str:
    """Format a datetime to MM/DD/YYYY string."""
    if not dt:
        return ""
    if isinstance(dt, str):
        from datetime import datetime

        try:
            parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            return parsed.strftime("%m/%d/%Y")
        except (ValueError, AttributeError):
            return ""
    if hasattr(dt, "strftime"):
        return dt.strftime("%m/%d/%Y")
    return ""


def _format_time(dt: Any) -> str:
    """Format a datetime to HHMM string."""
    if not dt:
        return ""
    if isinstance(dt, str):
        from datetime import datetime

        try:
            parsed = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            return parsed.strftime("%H%M")
        except (ValueError, AttributeError):
            return ""
    if hasattr(dt, "strftime"):
        return dt.strftime("%H%M")
    return ""


def _map_incident_type(logbook_type: str) -> str:
    """
    Map Logbook incident types to NFIRS incident type codes.

    NFIRS uses numeric codes (100-999). This provides common mappings;
    departments can customize via config.
    """
    type_map = {
        "structure_fire": "111",
        "vehicle_fire": "131",
        "brush_fire": "140",
        "wildland_fire": "141",
        "ems": "300",
        "medical": "311",
        "motor_vehicle_accident": "322",
        "mva": "322",
        "hazmat": "400",
        "rescue": "300",
        "service_call": "500",
        "good_intent": "600",
        "false_alarm": "700",
        "severe_weather": "800",
    }
    return type_map.get(logbook_type.lower(), "")
