"""
Generic ePCR Import Service

Imports run/incident data from any ePCR vendor via CSV or NEMSIS XML
file export. This is the universal starting point for EMS data integration
since almost every vendor supports file export.

HIPAA note: This service deliberately discards clinical fields (vitals,
medications, patient demographics) during parsing. Only dispatch/response
fields that map to ShiftCall are extracted. Uploaded files should be
deleted after processing.
"""

import csv
import io
import logging
from typing import Any
from xml.etree import ElementTree

from app.schemas.integration import EPCRImportRow

logger = logging.getLogger(__name__)

# NEMSIS namespace
NEMSIS_NS = "http://www.nemsis.org"


def parse_csv_file(
    file_content: bytes,
    field_mappings: dict[str, str],
) -> list[dict[str, Any]]:
    """
    Parse a CSV file and extract dispatch/response fields only.

    Args:
        file_content: Raw CSV bytes.
        field_mappings: Map of CSV column names to ShiftCall field names.
            e.g. {"Run Number": "incident_number", "Unit": "unit"}

    Returns:
        List of validated record dicts (clinical fields discarded).
    """
    text = file_content.decode("utf-8-sig")  # Handle BOM from Excel exports
    reader = csv.DictReader(io.StringIO(text))

    records: list[dict[str, Any]] = []
    skipped = 0

    for row in reader:
        mapped: dict[str, Any] = {}
        for csv_col, logbook_field in field_mappings.items():
            if csv_col in row:
                mapped[logbook_field] = row[csv_col]

        # Validate through the schema (discards unknown fields)
        try:
            validated = EPCRImportRow(**mapped)
            record = {k: v for k, v in validated.model_dump().items() if v is not None}
            if record.get("incident_number"):
                records.append(record)
            else:
                skipped += 1
        except Exception:
            skipped += 1
            continue

    # Never log file contents or parsed row data (HIPAA)
    logger.info("Parsed %d records from CSV (%d skipped)", len(records), skipped)
    return records


def parse_nemsis_xml(file_content: bytes) -> list[dict[str, Any]]:
    """
    Parse a NEMSIS 3.5 XML file and extract dispatch/response fields only.

    Clinical fields (ePatient, eVitals, eMedications, eProcedures) are
    deliberately skipped — only eTimes, eResponse, eDisposition, eCrew
    are extracted.

    Args:
        file_content: Raw XML bytes.

    Returns:
        List of validated record dicts.
    """
    root = ElementTree.fromstring(file_content)
    records: list[dict[str, Any]] = []

    # Handle both namespaced and non-namespaced XML
    ns = {"n": NEMSIS_NS}
    pcr_tags = root.findall(".//n:PatientCareReport", ns) or root.findall(
        ".//PatientCareReport"
    )

    for pcr in pcr_tags:
        record = _extract_pcr_dispatch_fields(pcr, ns)
        try:
            validated = EPCRImportRow(**record)
            result = {k: v for k, v in validated.model_dump().items() if v is not None}
            if result.get("incident_number"):
                records.append(result)
        except Exception:
            continue

    logger.info("Parsed %d records from NEMSIS XML", len(records))
    return records


def _extract_pcr_dispatch_fields(
    pcr: ElementTree.Element, ns: dict[str, str]
) -> dict[str, Any]:
    """Extract only dispatch/response fields from a PCR element."""
    record: dict[str, Any] = {}

    # eResponse — incident number
    incident_num = _find_text(pcr, "eResponse/eResponse.03", ns)
    if incident_num:
        record["incident_number"] = incident_num

    incident_type = _find_text(pcr, "eResponse/eResponse.05", ns)
    if incident_type:
        record["incident_type"] = incident_type

    # eTimes — timestamps
    dispatched = _find_text(pcr, "eTimes/eTimes.01", ns)
    if dispatched:
        record["dispatched_at"] = dispatched

    on_scene = _find_text(pcr, "eTimes/eTimes.06", ns)
    if on_scene:
        record["on_scene_at"] = on_scene

    cleared = _find_text(pcr, "eTimes/eTimes.13", ns)
    if cleared:
        record["cleared_at"] = cleared

    # eDisposition
    disposition = _find_text(pcr, "eDisposition/eDisposition.12", ns)
    if disposition == "4212001":
        record["medical_refusal"] = True
    elif disposition == "4212007":
        record["cancelled_en_route"] = True

    # eCrew — member names only (no personal identifiers)
    members: list[str] = []
    crew_groups = pcr.findall(".//n:eCrew/n:eCrew.CrewGroup", ns) or pcr.findall(
        ".//eCrew/eCrew.CrewGroup"
    )
    for group in crew_groups:
        name = _find_text_direct(group, "eCrew.01", ns)
        if name:
            members.append(name)
    if members:
        record["responding_members"] = members

    return record


def _find_text(
    element: ElementTree.Element, path: str, ns: dict[str, str]
) -> str | None:
    """Find text in element, trying namespaced then non-namespaced."""
    ns_path = "/".join(f"n:{p}" for p in path.split("/"))
    el = element.find(f".//{ns_path}", ns)
    if el is not None and el.text:
        return el.text.strip()
    el = element.find(f".//{path}")
    if el is not None and el.text:
        return el.text.strip()
    return None


def _find_text_direct(
    element: ElementTree.Element, tag: str, ns: dict[str, str]
) -> str | None:
    """Find direct child element text."""
    el = element.find(f"n:{tag}", ns)
    if el is not None and el.text:
        return el.text.strip()
    el = element.find(tag)
    if el is not None and el.text:
        return el.text.strip()
    return None
