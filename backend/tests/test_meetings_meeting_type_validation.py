"""
MM2-2 (app-review B6 pass 3): meeting_type on the meetings/minutes request
schemas maps to a strict MySQL ENUM, but was typed as a free str — an
out-of-set value passed Pydantic, reached MySQL, and 500'd (create_minutes
inserts the value raw). Request schemas now validate meeting_type against the
correct enum per model (MeetingType for meetings; MinutesMeetingType, which
includes 'executive', for minutes/templates). DB-free.
"""

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from app.schemas.meetings import MeetingCreate, MeetingUpdate
from app.schemas.minute import (
    MinutesCreate,
    MinutesUpdate,
    TemplateCreate,
    TemplateUpdate,
)


class TestMeetingTypeValidation:
    def test_meeting_create_accepts_valid_and_normalizes_case(self):
        m = MeetingCreate(
            title="T", meeting_type="BOARD", meeting_date=date(2026, 8, 9)
        )
        assert m.meeting_type == "board"

    def test_meeting_create_rejects_unknown(self):
        with pytest.raises(ValidationError):
            MeetingCreate(
                title="T", meeting_type="bogus", meeting_date=date(2026, 8, 9)
            )

    def test_meeting_rejects_minutes_only_type(self):
        # 'trustee'/'executive' are MinutesMeetingType values, NOT MeetingType —
        # a Meeting must reject them (they'd 500 at the Meeting ENUM column).
        with pytest.raises(ValidationError):
            MeetingCreate(
                title="T", meeting_type="trustee", meeting_date=date(2026, 8, 9)
            )

    def test_meeting_update_rejects_unknown(self):
        with pytest.raises(ValidationError):
            MeetingUpdate(meeting_type="nope")

    def test_meeting_update_allows_omitted(self):
        assert MeetingUpdate(title="x").meeting_type is None


class TestMinutesTypeValidation:
    def test_minutes_create_accepts_executive(self):
        # Critical: 'executive' must stay valid — it's the value the
        # executive-session read restriction keys on.
        m = MinutesCreate(
            title="T", meeting_type="executive", meeting_date=datetime(2026, 8, 9)
        )
        assert m.meeting_type == "executive"

    def test_minutes_create_accepts_annual_and_trustee(self):
        for t in ("annual", "trustee"):
            m = MinutesCreate(
                title="T", meeting_type=t, meeting_date=datetime(2026, 8, 9)
            )
            assert m.meeting_type == t

    def test_minutes_create_rejects_unknown(self):
        with pytest.raises(ValidationError):
            MinutesCreate(
                title="T", meeting_type="bogus", meeting_date=datetime(2026, 8, 9)
            )

    def test_minutes_update_allows_omitted(self):
        assert MinutesUpdate(title="x").meeting_type is None

    def test_template_create_accepts_executive(self):
        t = TemplateCreate(name="X", meeting_type="executive", sections=[])
        assert t.meeting_type == "executive"

    def test_template_update_rejects_unknown(self):
        with pytest.raises(ValidationError):
            TemplateUpdate(meeting_type="nope")


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
