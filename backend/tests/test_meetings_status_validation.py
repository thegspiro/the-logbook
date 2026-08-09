"""
MM2-3 (app-review B6 pass 4): the `status` field on the meetings-module request
schemas (`MeetingUpdate`, `ActionItemUpdate` in app.schemas.meetings) maps to a
strict MySQL ENUM (Meeting.status / MeetingActionItem.status), but was typed as a
free str. Unlike the MinuteService motion/action-item paths — which coerce the
value through the enum constructor and so raise a caught ValueError → 400 — the
MeetingsService update paths apply these via a blind `setattr`, so a bad value
reaches MySQL (a 500/DB-error under strict mode, a silent '' under non-strict).
The request schemas now validate `status` against the enum, so a bad value is a
clean 422. DB-free.
"""

import pytest
from pydantic import ValidationError

from app.models.meeting import ActionItemStatus, MeetingStatus
from app.schemas.meetings import ActionItemUpdate, MeetingUpdate


class TestMeetingStatusValidation:
    def test_accepts_every_valid_status(self):
        for value in (e.value for e in MeetingStatus):
            assert MeetingUpdate(status=value).status == value

    def test_normalizes_case(self):
        assert MeetingUpdate(status="APPROVED").status == "approved"

    def test_rejects_unknown(self):
        with pytest.raises(ValidationError):
            MeetingUpdate(status="bogus")

    def test_none_passes_through(self):
        # status omitted on a partial update must stay None (leaves it unchanged).
        assert MeetingUpdate(title="Renamed").status is None


class TestActionItemStatusValidation:
    def test_accepts_every_valid_status(self):
        for value in (e.value for e in ActionItemStatus):
            assert ActionItemUpdate(status=value).status == value

    def test_normalizes_case(self):
        assert ActionItemUpdate(status="COMPLETED").status == "completed"

    def test_rejects_unknown(self):
        with pytest.raises(ValidationError):
            ActionItemUpdate(status="done")  # not an ActionItemStatus value

    def test_none_passes_through(self):
        assert ActionItemUpdate(priority=2).status is None

    def test_priority_still_bounded_int(self):
        # priority is a validated int (0-2), not the enum concern — unchanged.
        with pytest.raises(ValidationError):
            ActionItemUpdate(priority=5)
