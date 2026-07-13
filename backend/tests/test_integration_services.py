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

from unittest.mock import AsyncMock, patch

import pytest

from app.services.integration_services.calcom_service import (
    CalcomService,
    format_booking_as_event,
)
from app.services.integration_services.discord_service import (
    format_event_embed,
    format_shift_embed,
    format_training_embed,
)
from app.services.integration_services.documenso_service import (
    DocumensoService,
    build_create_document_payload,
)
from app.services.integration_services.epcr_import_service import (
    parse_csv_file,
    parse_nemsis_xml,
)
from app.services.integration_services.ical_service import (
    generate_feed_token,
    generate_ical_feed,
)
from app.services.integration_services.nemsis_service import export_nemsis_data
from app.services.integration_services.nfirs_service import (
    _map_incident_type,
    export_nfirs_data,
)
from app.services.integration_services.slack_service import (
    format_event_notification,
    format_shift_notification,
    format_training_notification,
)
from app.services.integration_services.teams_service import (
    format_event_card,
    format_shift_card,
    format_training_card,
)
from app.services.integration_services.webhook_service import _sign_payload

# ============================================
# Shared httpx mocking helper
# ============================================


class _FakeResponse:
    """Minimal stand-in for an httpx.Response."""

    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json


def _mock_client(response):
    """Build a create_integration_client() replacement yielding a fake client."""
    client = AsyncMock()
    client.get = AsyncMock(return_value=response)
    client.post = AsyncMock(return_value=response)

    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


# ============================================
# Slack Formatting Tests
# ============================================


class TestSlackFormatting:
    def test_format_event_notification(self):
        event = {
            "title": "Training Night",
            "event_type": "training",
            "start_time": "2026-03-10T19:00",
        }
        result = format_event_notification(event)
        assert result["text"] == "New event: Training Night"
        assert len(result["blocks"]) >= 2

    def test_format_event_with_location(self):
        event = {"title": "Meeting", "location": "Station 1"}
        result = format_event_notification(event)
        assert any("Station 1" in str(b) for b in result["blocks"])

    def test_format_shift_notification(self):
        shift = {
            "type": "A Shift",
            "start_time": "08:00",
            "end_time": "20:00",
            "crew": ["Alice", "Bob"],
        }
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
        event = {
            "title": "Fire Drill",
            "event_type": "training",
            "start_time": "2026-03-10",
        }
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
        event = {
            "title": "Board Meeting",
            "event_type": "business_meeting",
            "start_time": "2026-03-10",
        }
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


# ============================================
# Documenso Tests
# ============================================


class TestDocumensoPayload:
    def test_defaults_role_to_signer(self):
        payload = build_create_document_payload(
            "Waiver", [{"name": "Alice", "email": "alice@example.com"}]
        )
        assert payload["title"] == "Waiver"
        assert payload["recipients"][0]["role"] == "SIGNER"
        assert payload["recipients"][0]["signingOrder"] == 1

    def test_unknown_role_falls_back_to_signer(self):
        payload = build_create_document_payload(
            "Doc", [{"name": "Bob", "email": "b@x.com", "role": "bogus"}]
        )
        assert payload["recipients"][0]["role"] == "SIGNER"

    def test_role_is_uppercased_and_preserved(self):
        payload = build_create_document_payload(
            "Doc", [{"name": "Cara", "email": "c@x.com", "role": "approver"}]
        )
        assert payload["recipients"][0]["role"] == "APPROVER"

    def test_sequential_signing_order(self):
        recipients = [
            {"name": "A", "email": "a@x.com"},
            {"name": "B", "email": "b@x.com"},
        ]
        payload = build_create_document_payload("Doc", recipients)
        assert [r["signingOrder"] for r in payload["recipients"]] == [1, 2]

    def test_external_id_included_when_provided(self):
        payload = build_create_document_payload(
            "Doc", [{"name": "A", "email": "a@x.com"}], external_id="evt-42"
        )
        assert payload["externalId"] == "evt-42"

    def test_external_id_omitted_when_absent(self):
        payload = build_create_document_payload(
            "Doc", [{"name": "A", "email": "a@x.com"}]
        )
        assert "externalId" not in payload

    def test_base_url_trailing_slash_normalized(self):
        service = DocumensoService(
            {"api_base_url": "https://sign.example.com/api/v1/", "api_token": "t"}
        )
        assert service.api_base_url == "https://sign.example.com/api/v1"

    async def test_connection_success(self):
        service = DocumensoService(
            {"api_base_url": "https://app.documenso.com/api/v1", "api_token": "tok"}
        )
        with patch(
            "app.services.integration_services.documenso_service.create_integration_client",
            return_value=_mock_client(_FakeResponse(200, {"documents": []})),
        ):
            result = await service.test_connection()
        assert "Connected to Documenso" in result

    async def test_connection_missing_token_raises(self):
        service = DocumensoService({"api_base_url": "https://app.documenso.com/api/v1"})
        with pytest.raises(Exception, match="No Documenso API token"):
            await service.test_connection()

    async def test_connection_unauthorized_raises(self):
        service = DocumensoService(
            {"api_base_url": "https://app.documenso.com/api/v1", "api_token": "bad"}
        )
        with patch(
            "app.services.integration_services.documenso_service.create_integration_client",
            return_value=_mock_client(_FakeResponse(401, text="Unauthorized")),
        ):
            with pytest.raises(Exception, match="rejected the API token"):
                await service.test_connection()


# ============================================
# Cal.com Tests
# ============================================


class TestCalcomBookingMapping:
    def test_maps_core_fields(self):
        booking = {
            "uid": "abc123",
            "title": "Interview: J. Doe",
            "description": "Prospective member interview",
            "location": "Station 1",
            "startTime": "2026-04-01T14:00:00Z",
            "endTime": "2026-04-01T14:30:00Z",
            "status": "accepted",
            "attendees": [{"name": "Jane", "email": "jane@example.com"}],
        }
        event = format_booking_as_event(booking)
        assert event["external_id"] == "abc123"
        assert event["title"] == "Interview: J. Doe"
        assert event["start_time"] == "2026-04-01T14:00:00Z"
        assert event["attendee_emails"] == ["jane@example.com"]

    def test_falls_back_to_id_when_no_uid(self):
        event = format_booking_as_event({"id": 77})
        assert event["external_id"] == "77"

    def test_missing_fields_get_safe_defaults(self):
        event = format_booking_as_event({})
        assert event["title"] == "Cal.com Booking"
        assert event["attendee_emails"] == []

    def test_attendees_without_email_are_skipped(self):
        event = format_booking_as_event(
            {"attendees": [{"name": "NoEmail"}, {"email": "y@x.com"}]}
        )
        assert event["attendee_emails"] == ["y@x.com"]

    def test_base_url_trailing_slash_normalized(self):
        service = CalcomService(
            {"api_base_url": "https://cal.example.com/api/v1/", "api_key": "k"}
        )
        assert service.api_base_url == "https://cal.example.com/api/v1"

    async def test_connection_success(self):
        service = CalcomService(
            {"api_base_url": "https://api.cal.com/v1", "api_key": "cal_x"}
        )
        with patch(
            "app.services.integration_services.calcom_service.create_integration_client",
            return_value=_mock_client(
                _FakeResponse(200, {"user": {"username": "station1"}})
            ),
        ):
            result = await service.test_connection()
        assert "station1" in result

    async def test_connection_missing_key_raises(self):
        service = CalcomService({"api_base_url": "https://api.cal.com/v1"})
        with pytest.raises(Exception, match="No Cal.com API key"):
            await service.test_connection()

    async def test_list_bookings_maps_results(self):
        service = CalcomService(
            {"api_base_url": "https://api.cal.com/v1", "api_key": "cal_x"}
        )
        with patch(
            "app.services.integration_services.calcom_service.create_integration_client",
            return_value=_mock_client(
                _FakeResponse(200, {"bookings": [{"uid": "b1", "title": "Booking 1"}]})
            ),
        ):
            events = await service.list_bookings()
        assert len(events) == 1
        assert events[0]["external_id"] == "b1"
