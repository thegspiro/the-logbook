"""
Tests for integration service implementations.

Tests cover:
- Slack message formatting
- Discord embed formatting
- Teams card formatting
- Webhook HMAC signing
- iCal feed generation
- NFIRS export
- NEMSIS export
- ePCR CSV/XML import
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from app.services.integration_services.slack_service import (
    format_event_notification,
    format_shift_notification,
    format_training_notification,
)
from app.services.integration_services.discord_service import (
    format_event_embed,
    format_shift_embed,
    format_training_embed,
)
from app.services.integration_services.teams_service import (
    format_event_card,
    format_shift_card,
    format_training_card,
)
from app.services.integration_services.webhook_service import _sign_payload
from app.services.integration_services.ical_service import (
    generate_ical_feed,
    generate_feed_token,
)
from app.services.integration_services.nfirs_service import (
    export_nfirs_data,
    _map_incident_type,
)
from app.services.integration_services.nemsis_service import export_nemsis_data
from app.services.integration_services.epcr_import_service import (
    parse_csv_file,
    parse_nemsis_xml,
)


# ============================================
# Slack Formatting Tests
# ============================================


class TestSlackFormatting:
    def test_format_event_notification(self):
        event = {"title": "Training Night", "event_type": "training", "start_time": "2026-03-10T19:00"}
        result = format_event_notification(event)
        assert result["text"] == "New event: Training Night"
        assert len(result["blocks"]) >= 2

    def test_format_event_with_location(self):
        event = {"title": "Meeting", "location": "Station 1"}
        result = format_event_notification(event)
        assert any("Station 1" in str(b) for b in result["blocks"])

    def test_format_shift_notification(self):
        shift = {"type": "A Shift", "start_time": "08:00", "end_time": "20:00", "crew": ["Alice", "Bob"]}
        result = format_shift_notification(shift)
        assert "A Shift" in result["text"]

    def test_format_training_notification(self):
        record = {"member_name": "John", "course_name": "CPR", "hours": 4}
        result = format_training_notification(record)
        assert "John" in result["text"]
        assert "CPR" in result["text"]


# ============================================
# Discord Formatting Tests
# ============================================


class TestDiscordFormatting:
    def test_format_event_embed(self):
        event = {"title": "Fire Drill", "event_type": "training", "start_time": "2026-03-10"}
        embed = format_event_embed(event)
        assert "Fire Drill" in embed["title"]
        assert "color" in embed

    def test_format_shift_embed(self):
        shift = {"type": "B Shift", "start_time": "08:00", "end_time": "20:00"}
        embed = format_shift_embed(shift)
        assert "B Shift" in embed["title"]

    def test_format_training_embed(self):
        record = {"member_name": "Jane", "course_name": "HAZMAT", "hours": 8}
        embed = format_training_embed(record)
        assert "Jane" in embed["description"]
        assert "HAZMAT" in embed["description"]


# ============================================
# Teams Formatting Tests
# ============================================


class TestTeamsFormatting:
    def test_format_event_card(self):
        event = {"title": "Board Meeting", "event_type": "business_meeting", "start_time": "2026-03-10"}
        card = format_event_card(event)
        assert "Board Meeting" in card["title"]

    def test_format_shift_card(self):
        shift = {"type": "Day Shift", "start_time": "08:00", "end_time": "20:00"}
        card = format_shift_card(shift)
        assert "Day Shift" in card["title"]

    def test_format_training_card(self):
        record = {"member_name": "Bob", "course_name": "EMT-B", "hours": 16}
        card = format_training_card(record)
        assert "Bob" in card["message"]


# ============================================
# Webhook HMAC Tests
# ============================================


class TestWebhookSigning:
    def test_hmac_signature(self):
        payload = b'{"event_type": "test"}'
        secret = "my-secret-key"
        sig1 = _sign_payload(payload, secret)
        sig2 = _sign_payload(payload, secret)
        assert sig1 == sig2  # Deterministic
        assert len(sig1) == 64  # SHA-256 hex digest

    def test_different_secret_different_signature(self):
        payload = b'{"event_type": "test"}'
        sig1 = _sign_payload(payload, "secret1")
        sig2 = _sign_payload(payload, "secret2")
        assert sig1 != sig2


# ============================================
# iCal Feed Tests
# ============================================


class TestICalFeed:
    def test_generates_valid_ics(self):
        events = [
            {
                "id": "evt-1",
                "title": "Training Night",
                "start_time": "2026-03-10T19:00:00Z",
                "end_time": "2026-03-10T21:00:00Z",
                "description": "Weekly training",
                "location": "Station 1",
            }
        ]
        result = generate_ical_feed(events, org_name="Test FD")
        assert "BEGIN:VCALENDAR" in result
        assert "END:VCALENDAR" in result
        assert "BEGIN:VEVENT" in result
        assert "Training Night" in result
        assert "Station 1" in result
        assert "evt-1@thelogbook.app" in result

    def test_empty_events(self):
        result = generate_ical_feed([], org_name="Empty FD")
        assert "BEGIN:VCALENDAR" in result
        assert "VEVENT" not in result

    def test_feed_token_uniqueness(self):
        token1 = generate_feed_token()
        token2 = generate_feed_token()
        assert token1 != token2
        assert len(token1) >= 48  # 48 bytes base64url


# ============================================
# NFIRS Export Tests
# ============================================


class TestNFIRSExport:
    def test_exports_csv(self):
        incidents = [
            {
                "incident_number": "2026-001",
                "incident_type": "structure_fire",
                "dispatched_at": "2026-03-01T14:30:00Z",
                "on_scene_at": "2026-03-01T14:38:00Z",
                "cleared_at": "2026-03-01T16:00:00Z",
                "station": "1",
            }
        ]
        result = export_nfirs_data(incidents, state_fdid="12345", state_code="NY")
        csv_text = result.decode("utf-8")
        assert "State" in csv_text  # Header
        assert "NY" in csv_text
        assert "12345" in csv_text
        assert "2026-001" in csv_text

    def test_incident_type_mapping(self):
        assert _map_incident_type("structure_fire") == "111"
        assert _map_incident_type("ems") == "300"
        assert _map_incident_type("vehicle_fire") == "131"
        assert _map_incident_type("unknown_type") == ""

    def test_empty_incidents(self):
        result = export_nfirs_data([], state_fdid="00000", state_code="CA")
        csv_text = result.decode("utf-8")
        # Should have header only
        lines = csv_text.strip().split("\n")
        assert len(lines) == 1


# ============================================
# NEMSIS Export Tests
# ============================================


class TestNEMSISExport:
    def test_exports_xml(self):
        calls = [
            {
                "incident_number": "2026-EMS-001",
                "incident_type": "medical",
                "dispatched_at": "2026-03-01T14:30:00Z",
                "on_scene_at": "2026-03-01T14:38:00Z",
                "cleared_at": "2026-03-01T16:00:00Z",
                "medical_refusal": False,
                "responding_members": ["Smith, J", "Doe, A"],
            }
        ]
        result = export_nemsis_data(calls, state_code="NY", agency_id="A12345")
        xml_text = result.decode("utf-8")
        assert "<?xml" in xml_text
        assert "EMSDataSet" in xml_text
        assert "2026-EMS-001" in xml_text
        assert "Smith, J" in xml_text

    def test_medical_refusal_disposition(self):
        calls = [{"incident_number": "2026-002", "medical_refusal": True}]
        result = export_nemsis_data(calls, state_code="CA", agency_id="B99")
        xml_text = result.decode("utf-8")
        assert "4212001" in xml_text  # Patient refused code


# ============================================
# ePCR Import Tests
# ============================================


class TestEPCRImport:
    def test_parse_csv(self):
        csv_content = b"Run Number,Type,Dispatch Time\n2026-001,medical,2026-03-01T14:30:00Z\n2026-002,trauma,2026-03-01T15:00:00Z\n"
        field_mappings = {
            "Run Number": "incident_number",
            "Type": "incident_type",
            "Dispatch Time": "dispatched_at",
        }
        records = parse_csv_file(csv_content, field_mappings)
        assert len(records) == 2
        assert records[0]["incident_number"] == "2026-001"
        assert records[0]["incident_type"] == "medical"

    def test_csv_skips_rows_without_incident_number(self):
        csv_content = b"Run Number,Type\n,medical\n2026-001,trauma\n"
        field_mappings = {"Run Number": "incident_number", "Type": "incident_type"}
        records = parse_csv_file(csv_content, field_mappings)
        assert len(records) == 1

    def test_csv_handles_bom(self):
        csv_content = b"\xef\xbb\xbfRun Number,Type\n2026-001,medical\n"
        field_mappings = {"Run Number": "incident_number", "Type": "incident_type"}
        records = parse_csv_file(csv_content, field_mappings)
        assert len(records) == 1

    def test_parse_nemsis_xml(self):
        xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<EMSDataSet xmlns="http://www.nemsis.org">
  <PatientCareReport>
    <eResponse>
      <eResponse.03>2026-EMS-001</eResponse.03>
      <eResponse.05>medical</eResponse.05>
    </eResponse>
    <eTimes>
      <eTimes.01>2026-03-01T14:30:00Z</eTimes.01>
      <eTimes.06>2026-03-01T14:38:00Z</eTimes.06>
    </eTimes>
    <eCrew>
      <eCrew.CrewGroup>
        <eCrew.01>Smith, J</eCrew.01>
      </eCrew.CrewGroup>
    </eCrew>
  </PatientCareReport>
</EMSDataSet>"""
        records = parse_nemsis_xml(xml_content)
        assert len(records) == 1
        assert records[0]["incident_number"] == "2026-EMS-001"
        assert records[0]["dispatched_at"] == "2026-03-01T14:30:00Z"

    def test_nemsis_xml_discards_clinical_data(self):
        """Verify clinical fields are NOT extracted (HIPAA compliance)."""
        xml_content = b"""<?xml version="1.0" encoding="UTF-8"?>
<EMSDataSet xmlns="http://www.nemsis.org">
  <PatientCareReport>
    <eResponse>
      <eResponse.03>2026-EMS-002</eResponse.03>
    </eResponse>
    <ePatient>
      <ePatient.15>Smith</ePatient.15>
      <ePatient.16>John</ePatient.16>
    </ePatient>
    <eVitals>
      <eVitals.BloodPressureGroup>
        <eVitals.06>120</eVitals.06>
      </eVitals.BloodPressureGroup>
    </eVitals>
  </PatientCareReport>
</EMSDataSet>"""
        records = parse_nemsis_xml(xml_content)
        assert len(records) == 1
        # Only incident_number should be extracted — no patient data
        assert records[0]["incident_number"] == "2026-EMS-002"
        assert "patient_name" not in records[0]
        assert "blood_pressure" not in records[0]
