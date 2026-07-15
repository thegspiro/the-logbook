"""
Tests for the training-session certification-eligibility toggle
(TrainingSession.counts_toward_certification) in _finalize_training_records.

A session that doesn't count toward certification must still create the
attendee's training record (the member keeps general credit) but must NOT queue
any pipeline/certificate progress updates. When it does count, the linked
requirement is queued as before.

DB is mocked; no MySQL.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.services.training_session_service import TrainingSessionService


def _one(obj):
    return MagicMock(scalar_one_or_none=MagicMock(return_value=obj))


def _scalars_first(obj):
    r = MagicMock()
    r.scalars.return_value.first.return_value = obj
    return r


class RecordingSession:
    def __init__(self, results):
        self._results = list(results)
        self.added = []
        self.commit = AsyncMock()
        self.refresh = AsyncMock()

    def add(self, obj):
        self.added.append(obj)

    async def execute(self, *args, **kwargs):
        return self._results.pop(0) if self._results else MagicMock()


def _session(**over):
    base = dict(
        id="sess-1",
        organization_id="org-1",
        program_id="prog-1",
        requirement_id="req-1",
        category_id=None,
        phase_id=None,
        counts_toward_certification=True,
        course_id=None,
        course=None,
        course_name="Ropes Practice",
        credit_hours=3.0,
        training_type="skills_practice",
        instructor="Capt. Ruiz",
    )
    base.update(over)
    return SimpleNamespace(**base)


def _run(counts_toward_certification: bool):
    """Drive _finalize_training_records for one attendee with a 2h override."""
    user = uuid4()
    session = _session(counts_toward_certification=counts_toward_certification)
    event = SimpleNamespace(
        start_datetime=datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),
        location="Training Grounds",
    )
    # session lookup, event lookup, existing-record lookup (none → create).
    db = RecordingSession([_one(session), _one(event), _scalars_first(None)])
    svc = TrainingSessionService(db)

    approval = SimpleNamespace(training_session_id="sess-1", event_id="evt-1")
    attendee = SimpleNamespace(
        user_id=user,
        override_duration_minutes=120,  # 2.0 hours; avoids the RSVP lookup
        override_check_in_at=None,
        override_check_out_at=None,
    )
    return svc, db, user, approval, attendee


class TestCertificationEligibilityGate:
    async def test_ineligible_session_still_records_but_no_pipeline_feed(self):
        svc, db, user, approval, attendee = _run(counts_toward_certification=False)

        updates = await svc._finalize_training_records(approval, [attendee], uuid4())

        # A training record was still created (member keeps credit)...
        assert len(db.added) == 1
        assert db.added[0].hours_completed == 2.0
        # ...but nothing feeds the certificate/pipeline requirements.
        assert updates == []

    async def test_eligible_session_feeds_the_linked_requirement(self):
        svc, db, user, approval, attendee = _run(counts_toward_certification=True)

        updates = await svc._finalize_training_records(approval, [attendee], uuid4())

        assert len(db.added) == 1
        assert updates == [(str(user), "prog-1", "req-1", 2.0)]
