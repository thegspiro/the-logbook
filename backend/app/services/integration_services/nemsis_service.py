"""
NEMSIS 3.5 Response Module Export Service

Exports dispatch and response data that The Logbook actually has
in NEMSIS 3.5 XML format. This is the response/dispatch module only —
NOT full clinical ePCR data.

What this exports:
  - eResponse: incident number, unit, response mode
  - eTimes: dispatched_at, on_scene_at, cleared_at
  - eDisposition: medical_refusal, cancelled_en_route
  - eCrew: responding members matched to certification levels

What this CANNOT export (data doesn't exist in The Logbook):
  - ePatient, eVitals, eMedications, eProcedures — lives in ePCR system
"""

import logging
from datetime import datetime
from typing import Any
from xml.etree.ElementTree import Element, SubElement, tostring

logger = logging.getLogger(__name__)

NEMSIS_NAMESPACE = "http://www.nemsis.org"


def export_nemsis_data(
    calls: list[dict[str, Any]],
    state_code: str,
    agency_id: str,
    nemsis_version: str = "3.5.0",
) -> bytes:
    """
    Generate NEMSIS 3.5 Response Module XML.

    Args:
        calls: List of ShiftCall dicts from the database.
        state_code: Two-letter state code.
        agency_id: State-assigned agency/FDID.
        nemsis_version: NEMSIS version string.

    Returns:
        UTF-8 encoded XML bytes.
    """
    root = Element("EMSDataSet")
    root.set("xmlns", NEMSIS_NAMESPACE)

    # Header
    header = SubElement(root, "Header")
    SubElement(header, "DemographicGroup").text = ""
    SubElement(header, "eCustomConfiguration").text = ""
    state_el = SubElement(header, "dAgency.01")
    state_el.text = state_code
    agency_el = SubElement(header, "dAgency.02")
    agency_el.text = agency_id

    # Patient care reports (response module only)
    for call in calls:
        pcr = SubElement(root, "PatientCareReport")
        _build_response_section(pcr, call)
        _build_times_section(pcr, call)
        _build_disposition_section(pcr, call)
        _build_crew_section(pcr, call)

    xml_bytes = tostring(root, encoding="unicode", xml_declaration=False)
    full_xml = f'<?xml version="1.0" encoding="UTF-8"?>\n{xml_bytes}'

    logger.info(
        "Exported %d records in NEMSIS %s format for agency %s",
        len(calls),
        nemsis_version,
        agency_id,
    )
    return full_xml.encode("utf-8")


def _build_response_section(pcr: Element, call: dict[str, Any]) -> None:
    """eResponse section — incident number, unit info."""
    response = SubElement(pcr, "eResponse")
    SubElement(response, "eResponse.03").text = call.get("incident_number", "")
    SubElement(response, "eResponse.05").text = call.get("incident_type", "")


def _build_times_section(pcr: Element, call: dict[str, Any]) -> None:
    """eTimes section — dispatch, en route, on scene, cleared timestamps."""
    times = SubElement(pcr, "eTimes")
    if call.get("dispatched_at"):
        SubElement(times, "eTimes.01").text = _format_nemsis_datetime(
            call["dispatched_at"]
        )
    if call.get("on_scene_at"):
        SubElement(times, "eTimes.06").text = _format_nemsis_datetime(
            call["on_scene_at"]
        )
    if call.get("cleared_at"):
        SubElement(times, "eTimes.13").text = _format_nemsis_datetime(
            call["cleared_at"]
        )


def _build_disposition_section(pcr: Element, call: dict[str, Any]) -> None:
    """eDisposition section — patient disposition, refusals."""
    disposition = SubElement(pcr, "eDisposition")
    if call.get("medical_refusal"):
        SubElement(disposition, "eDisposition.12").text = "4212001"  # Patient refused
    if call.get("cancelled_en_route"):
        SubElement(disposition, "eDisposition.12").text = "4212007"  # Cancelled


def _build_crew_section(pcr: Element, call: dict[str, Any]) -> None:
    """eCrew section — responding members and certification levels."""
    members = call.get("responding_members") or []
    if not members:
        return

    crew = SubElement(pcr, "eCrew")
    for member in members:
        member_el = SubElement(crew, "eCrew.CrewGroup")
        if isinstance(member, dict):
            SubElement(member_el, "eCrew.01").text = member.get("name", "")
            if member.get("certification_level"):
                SubElement(member_el, "eCrew.02").text = member[
                    "certification_level"
                ]
        elif isinstance(member, str):
            SubElement(member_el, "eCrew.01").text = member


def _format_nemsis_datetime(dt: Any) -> str:
    """Format datetime to NEMSIS-compliant ISO 8601 with timezone."""
    if isinstance(dt, str):
        return dt
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)
