"""
Tests for the document service (app/services/document_service.py).

Covers the published-minutes HTML rendering (_generate_minutes_html) with a
focus on HTML escaping of member-supplied text (XSS) and present/absent
attendee partitioning, plus the timezone helper. DB mocked; no MySQL.
"""

from datetime import datetime
from datetime import timezone as tz
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.document_service import DocumentService


def _svc(db=None):
    return DocumentService(db or MagicMock())


def _minutes(**kw):
    header = kw.get("header", {"org_name": "Falls Church FD", "subtitle": "Minutes"})
    return SimpleNamespace(
        get_effective_header=lambda: header,
        get_effective_footer=lambda: {},
        get_sections=lambda: kw.get("sections", []),
        meeting_type=kw.get("meeting_type", "business_meeting"),
        meeting_date=kw.get(
            "meeting_date", datetime(2026, 1, 15, 19, 0, tzinfo=tz.utc)
        ),
        title=kw.get("title", "Monthly Business Meeting"),
        location=kw.get("location"),
        called_by=kw.get("called_by"),
        called_to_order_at=None,
        adjourned_at=None,
        attendees=kw.get("attendees", []),
        quorum_met=kw.get("quorum_met"),
        quorum_count=kw.get("quorum_count"),
        motions=kw.get("motions", []),
        action_items=kw.get("action_items", []),
        approved_at=kw.get("approved_at"),
        status=kw.get("status", "published"),
        id="min-1",
        published_document_id=None,
    )


class TestGenerateMinutesHtml:
    def test_renders_org_title_and_type(self):
        html = _svc()._generate_minutes_html(_minutes())
        assert "Falls Church FD" in html
        assert "Monthly Business Meeting" in html
        assert "Business Meeting" in html  # meeting_type humanized

    def test_escapes_xss_in_title(self):
        html = _svc()._generate_minutes_html(
            _minutes(title="<script>alert(1)</script>")
        )
        assert "<script>alert(1)</script>" not in html
        assert "&lt;script&gt;" in html

    def test_partitions_present_and_absent(self):
        attendees = [
            {"name": "Jane Smith", "present": True, "role": "Chair"},
            {"name": "Bob Jones", "present": True},
            {"name": "Sam Lee", "present": False},
        ]
        html = _svc()._generate_minutes_html(_minutes(attendees=attendees))
        assert "Present (2):" in html
        assert "Absent (1):" in html
        assert "Jane Smith" in html
        assert "(Chair)" in html

    def test_escapes_attendee_names(self):
        attendees = [{"name": "<b>Hax</b>", "present": True}]
        html = _svc()._generate_minutes_html(_minutes(attendees=attendees))
        assert "<b>Hax</b>" not in html
        assert "&lt;b&gt;Hax&lt;/b&gt;" in html

    def test_quorum_line_when_set(self):
        attendees = [{"name": "A", "present": True}]
        html = _svc()._generate_minutes_html(
            _minutes(attendees=attendees, quorum_met=True, quorum_count=12)
        )
        assert "Quorum met" in html
        assert "12 members" in html


class TestToLocal:
    def test_naive_treated_as_utc(self):
        out = _svc()._to_local(datetime(2026, 6, 1, 12, 0), "America/New_York")
        assert out.hour == 8  # noon UTC -> 8am EDT

    def test_none_timezone_returns_utc(self):
        dt = datetime(2026, 6, 1, 12, 0, tzinfo=tz.utc)
        out = _svc()._to_local(dt, None)
        # No tz name -> stays UTC.
        assert out.hour == 12


if __name__ == "__main__":  # pragma: no cover
    import pytest

    raise SystemExit(pytest.main([__file__, "-v"]))
