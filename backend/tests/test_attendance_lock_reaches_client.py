"""An attendance-lock refusal reaches the client as a sentence and a 409.

Finalizing an event closes its attendance, and the services refuse every write
that would change what it credited with ``attendance_locked_error``: a sentence
behind the internal ``ATTENDANCE_LOCKED::`` prefix. Eleven routes mapped that
refusal by hand and got it wrong in two ways:

* Some never looked for the prefix, so members saw
  ``ATTENDANCE_LOCKED::Attendance for this event…`` with a 400 or a 404 —
  series cancel and delete, updating future occurrences, the cohort class
  routes, the event-request calendar moves, and the legacy session finalize.
* Some sanitized the message *before* mapping it. ``safe_error_detail`` caps a
  message at 300 characters, and some refusals run past that: an edit that
  also sets ``custom_category`` or the actual times, or a series edit through
  update-future with its "(N of M occurrences …)" suffix. The member was told
  "An unexpected error occurred".

Every route now maps the raw error through ``attendance_lock_http_error``
first. DB and services mocked; no MySQL.
"""

import ast
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.attendance_lock import attendance_lock_http_error
from app.api.v1.endpoints import course_cohorts, events, training_sessions
from app.core.utils import _GENERIC_ERROR, safe_error_detail
from app.schemas.course_cohort import (
    CohortClassCancel,
    CohortClassReschedule,
    CohortShiftRequest,
)
from app.schemas.event import BulkAddAttendees, EventCancel, EventUpdate
from app.services.event_service import (
    ATTENDANCE_LOCKED_PREFIX,
    ATTENDANCE_SENSITIVE_UPDATE_FIELDS,
    EventService,
    attendance_lock_reason,
    attendance_locked_error,
)
from app.services.training_session_service import TRAINING_DETAILS_EXIST

pytestmark = pytest.mark.unit

SHORT = attendance_locked_error("cancelling the event")
# What update_event builds for an edit touching every sensitive field.
LONG = attendance_locked_error(
    "changing " + ", ".join(sorted(ATTENDANCE_SENSITIVE_UPDATE_FIELDS))
)
# Errors that are not the lock and that the sanitizer must still replace.
UNSAFE = [
    "x" * 301,
    "(pymysql.err.OperationalError) SELECT * FROM events WHERE id = %s",
]


def _sentence(refusal):
    return refusal[len(ATTENDANCE_LOCKED_PREFIX) :]


def _user():
    return SimpleNamespace(
        id="user-1",
        organization_id="org-1",
        username="officer",
        positions=[],
        rank=None,
    )


async def _refused(call):
    with pytest.raises(HTTPException) as exc:
        await call
    return exc.value


class TestTheHelpers:
    @pytest.mark.parametrize("error", [SHORT, ValueError(SHORT)])
    def test_a_refusal_is_a_409_without_the_marker(self, error):
        mapped = attendance_lock_http_error(error)
        assert mapped.status_code == 409
        assert mapped.detail == _sentence(SHORT)
        assert ATTENDANCE_LOCKED_PREFIX not in mapped.detail

    @pytest.mark.parametrize("error", ["Event not found", ValueError("Bad date")])
    def test_anything_else_is_left_to_the_route(self, error):
        assert attendance_lock_http_error(error) is None
        assert attendance_lock_reason(error) is None

    def test_a_long_refusal_arrives_whole(self):
        """The edit form's refusal is longer than the sanitizer's cap. The cap
        still applies to everything else; the refusal just never reaches it."""
        assert len(LONG) > 300
        assert attendance_lock_http_error(ValueError(LONG)).detail == _sentence(LONG)
        assert safe_error_detail(ValueError(LONG)) == _GENERIC_ERROR

    def test_the_route_mappers_are_unchanged(self):
        assert events._event_error(SHORT).status_code == 409
        assert events._event_error(SHORT).detail == _sentence(SHORT)
        assert events._event_error("Bad", 422).status_code == 422
        assert training_sessions._session_error(SHORT).status_code == 409
        assert training_sessions._session_error(TRAINING_DETAILS_EXIST).status_code == (
            409
        )
        assert training_sessions._session_error("Event not found").status_code == 404
        assert training_sessions._session_error("Bad").status_code == 400


def _event_route_calls():
    """(route name, service method, the call) for each ValueError route."""
    event_id = uuid4()
    cancel = EventCancel(cancellation_reason="Weather closed the drill ground")
    return [
        (
            "PATCH /events/{id}",
            "update_event",
            lambda db: events.update_event(
                event_id=event_id,
                event_data=EventUpdate(description="Bring gloves"),
                db=db,
                current_user=_user(),
            ),
        ),
        (
            "PATCH /events/{id}/update-future",
            "update_future_events",
            lambda db: events.update_future_events(
                event_id=event_id,
                event_data=EventUpdate(description="Bring gloves"),
                db=db,
                current_user=_user(),
            ),
        ),
        (
            "DELETE /events/{id}",
            "delete_event",
            lambda db: events.delete_event(
                event_id=event_id, db=db, current_user=_user()
            ),
        ),
        (
            "DELETE /events/{id}/series",
            "delete_event_series",
            lambda db: events.delete_event_series(
                event_id=event_id,
                delete_future_only=False,
                db=db,
                current_user=_user(),
            ),
        ),
        (
            "POST /events/{id}/cancel",
            "cancel_event",
            lambda db: events.cancel_event(
                event_id=event_id, cancel_data=cancel, db=db, current_user=_user()
            ),
        ),
        (
            "POST /events/{id}/cancel-series",
            "cancel_series",
            lambda db: events.cancel_event_series(
                event_id=event_id,
                cancel_data=cancel,
                cancel_future_only=False,
                db=db,
                current_user=_user(),
            ),
        ),
    ]


class TestEventRoutes:
    @pytest.mark.parametrize("refusal", [SHORT, LONG], ids=["short", "long"])
    @pytest.mark.parametrize(
        ("route", "method", "call"),
        _event_route_calls(),
        ids=[c[0] for c in _event_route_calls()],
    )
    async def test_a_refusal_is_a_409_with_the_sentence(
        self, route, method, call, refusal
    ):
        with patch.object(
            EventService, method, AsyncMock(side_effect=ValueError(refusal))
        ):
            error = await _refused(call(MagicMock()))

        assert error.status_code == 409, route
        assert error.detail == _sentence(refusal), route

    @pytest.mark.parametrize(
        ("route", "method", "call"),
        _event_route_calls(),
        ids=[c[0] for c in _event_route_calls()],
    )
    async def test_any_other_refusal_keeps_its_400(self, route, method, call):
        with patch.object(
            EventService,
            method,
            AsyncMock(side_effect=ValueError("Cannot update a cancelled event")),
        ):
            error = await _refused(call(MagicMock()))

        assert error.status_code == 400, route
        assert error.detail == "Cannot update a cancelled event", route

    @pytest.mark.parametrize("message", UNSAFE, ids=["long", "sql"])
    @pytest.mark.parametrize(
        ("route", "method", "call"),
        _event_route_calls(),
        ids=[c[0] for c in _event_route_calls()],
    )
    async def test_any_other_refusal_is_still_sanitized(
        self, route, method, call, message
    ):
        """Mapping the raw error first must not let anything else through
        unsanitized."""
        with patch.object(
            EventService, method, AsyncMock(side_effect=ValueError(message))
        ):
            error = await _refused(call(MagicMock()))

        assert (error.status_code, error.detail) == (400, _GENERIC_ERROR), route

    async def test_cancelling_an_unknown_event_is_a_404_not_a_500(self):
        """The handler's own 404 was caught by its blanket ``except Exception``
        and reported as a server error."""
        with patch.object(EventService, "cancel_event", AsyncMock(return_value=None)):
            error = await _refused(
                events.cancel_event(
                    event_id=uuid4(),
                    cancel_data=EventCancel(
                        cancellation_reason="Weather closed the drill ground"
                    ),
                    db=MagicMock(),
                    current_user=_user(),
                )
            )

        assert (error.status_code, error.detail) == (404, "Event not found")

    async def test_bulk_add_rows_carry_the_sentence(self):
        """A finalize can land between bulk add's up-front lock check and a
        row; the row's error is shown to the officer."""
        member = uuid4()
        users = MagicMock()
        users.scalars.return_value.all.return_value = [SimpleNamespace(id=str(member))]
        db = MagicMock()
        db.execute = AsyncMock(return_value=users)

        with patch.object(
            EventService, "attendance_lock_error_for", AsyncMock(return_value=None)
        ), patch.object(
            EventService,
            "manager_add_attendee",
            AsyncMock(return_value=(None, attendance_locked_error("adding attendees"))),
        ), patch.object(
            events, "log_audit_event", AsyncMock()
        ):
            response = await events.bulk_add_attendees(
                event_id=uuid4(),
                data=BulkAddAttendees(user_ids=[member], status="going"),
                db=db,
                current_user=_user(),
            )

        assert response.created_count == 0
        (row,) = response.errors
        assert row.error == _sentence(attendance_locked_error("adding attendees"))


class TestTheLegacySessionFinalize:
    async def _finalize(self, error):
        service = MagicMock()
        service.finalize_training_session = AsyncMock(return_value=(None, error))
        with patch.object(
            training_sessions, "TrainingSessionService", return_value=service
        ), patch.object(training_sessions, "user_has_permission", return_value=False):
            return await _refused(
                training_sessions.finalize_training_session(
                    training_session_id=uuid4(), db=MagicMock(), current_user=_user()
                )
            )

    async def test_a_refusal_is_a_409_with_the_sentence(self):
        refusal = attendance_locked_error("finalizing attendance again")
        error = await self._finalize(refusal)
        assert (error.status_code, error.detail) == (409, _sentence(refusal))

    @pytest.mark.parametrize(
        "message",
        [
            # Two of these come back after the event's finalize has committed,
            # which is why nothing but the lock is remapped on this route.
            "Training session not found",
            "Event not found",
            "Event has no end time",
            "Cannot finalize attendance for a cancelled event",
            "This event is no longer a Training event",
        ],
    )
    async def test_every_other_error_keeps_its_400(self, message):
        error = await self._finalize(message)
        assert (error.status_code, error.detail) == (400, message)


def _cohort_route_calls():
    start = datetime(2026, 10, 3, 13, 0)
    end = start.replace(hour=16)
    return [
        (
            "POST /training/cohorts/{id}/shift",
            "shift_remaining",
            400,
            lambda: course_cohorts.shift_cohort_classes(
                cohort_id=uuid4(),
                data=CohortShiftRequest(days=7),
                db=MagicMock(),
                current_user=_user(),
            ),
        ),
        (
            "POST /training/cohorts/{id}/cancel",
            "cancel_cohort",
            404,
            lambda: course_cohorts.cancel_cohort(
                cohort_id=uuid4(),
                data=CohortClassCancel(reason="Instructor unavailable"),
                db=MagicMock(),
                current_user=_user(),
            ),
        ),
        (
            "PATCH /training/cohorts/{id}/classes/{cid}",
            "reschedule_class",
            400,
            lambda: course_cohorts.reschedule_cohort_class(
                cohort_id=uuid4(),
                cohort_class_id=uuid4(),
                data=CohortClassReschedule(scheduled_start=start, scheduled_end=end),
                db=MagicMock(),
                current_user=_user(),
            ),
        ),
        (
            "POST /training/cohorts/{id}/classes/{cid}/cancel",
            "cancel_class",
            404,
            lambda: course_cohorts.cancel_cohort_class(
                cohort_id=uuid4(),
                cohort_class_id=uuid4(),
                data=CohortClassCancel(reason="Instructor unavailable"),
                db=MagicMock(),
                current_user=_user(),
            ),
        ),
    ]


class TestCohortRoutes:
    """A cohort's classes are events; one whose attendance is finalized
    refuses to be moved or cancelled."""

    @pytest.mark.parametrize(
        ("route", "method", "other_status", "call"),
        _cohort_route_calls(),
        ids=[c[0] for c in _cohort_route_calls()],
    )
    async def test_a_refusal_is_a_409_and_nothing_is_audited(
        self, route, method, other_status, call
    ):
        service = MagicMock()
        setattr(service, method, AsyncMock(side_effect=ValueError(LONG)))
        with patch.object(
            course_cohorts, "CourseCohortService", return_value=service
        ), patch.object(course_cohorts, "log_audit_event", AsyncMock()) as audit:
            error = await _refused(call())

        assert (error.status_code, error.detail) == (409, _sentence(LONG)), route
        audit.assert_not_awaited()

    @pytest.mark.parametrize(
        ("route", "method", "other_status", "call"),
        _cohort_route_calls(),
        ids=[c[0] for c in _cohort_route_calls()],
    )
    async def test_not_found_keeps_its_status(self, route, method, other_status, call):
        service = MagicMock()
        setattr(service, method, AsyncMock(side_effect=ValueError("Class not found")))
        with patch.object(
            course_cohorts, "CourseCohortService", return_value=service
        ), patch.object(course_cohorts, "log_audit_event", AsyncMock()):
            error = await _refused(call())

        assert (error.status_code, error.detail) == (
            other_status,
            "Class not found",
        ), route

    @pytest.mark.parametrize("message", UNSAFE, ids=["long", "sql"])
    @pytest.mark.parametrize(
        ("route", "method", "other_status", "call"),
        _cohort_route_calls(),
        ids=[c[0] for c in _cohort_route_calls()],
    )
    async def test_any_other_error_is_still_sanitized(
        self, route, method, other_status, call, message
    ):
        service = MagicMock()
        setattr(service, method, AsyncMock(side_effect=ValueError(message)))
        with patch.object(
            course_cohorts, "CourseCohortService", return_value=service
        ), patch.object(course_cohorts, "log_audit_event", AsyncMock()):
            error = await _refused(call())

        assert (error.status_code, error.detail) == (
            other_status,
            _GENERIC_ERROR,
        ), route


class TestNothingSanitizesARefusalFirst:
    """The shape that turned a long refusal into a generic error: sanitizing
    the message and *then* mapping it. ``safe_error_detail`` caps the length,
    so by the time the mapper looks, a long refusal is gone.

    No false positives: it flags only a lock mapper with a sanitizer call
    somewhere inside an argument, which is never correct. It does not catch
    everything — a message sanitized into a variable first gets past it.
    """

    MAPPERS = {
        "_event_error",
        "_session_error",
        "attendance_lock_http_error",
        "attendance_lock_reason",
    }
    SANITIZERS = {"safe_error_detail", "sanitize_error_message"}
    API = Path(__file__).resolve().parents[1] / "app" / "api"

    @staticmethod
    def _name(func):
        return getattr(func, "id", None) or getattr(func, "attr", None)

    @classmethod
    def _offenders(cls, tree):
        lines = []
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and cls._name(node.func) in cls.MAPPERS):
                continue
            values = [*node.args, *(kw.value for kw in node.keywords)]
            if any(
                isinstance(inner, ast.Call) and cls._name(inner.func) in cls.SANITIZERS
                for value in values
                for inner in ast.walk(value)
            ):
                lines.append(node.lineno)
        return lines

    def test_no_route_maps_a_sanitized_message(self):
        offenders = []
        for path in sorted(self.API.rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            offenders += [f"{path.name}:{n}" for n in self._offenders(tree)]

        assert not offenders, (
            "Map the raw error first — attendance_lock_http_error(e) or "
            "HTTPException(..., detail=safe_error_detail(e)) — so a refusal "
            "longer than the sanitizer's cap still reaches the client: "
            + ", ".join(offenders)
        )

    def test_the_check_still_sees_the_mappers(self):
        """A check that stopped finding calls would pass forever."""
        seen = set()
        for path in self.API.rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if isinstance(node, ast.Call) and self._name(node.func) in self.MAPPERS:
                    seen.add(self._name(node.func))
        assert seen == self.MAPPERS

    @pytest.mark.parametrize(
        "source",
        [
            "_event_error(safe_error_detail(e))",
            "_event_error(error=safe_error_detail(e))",
            "_session_error(sanitize_error_message(err))",
            "attendance_lock_http_error(error=sanitize_error_message(err))",
            "attendance_lock_http_error(ValueError(safe_error_detail(e)))",
            "attendance_lock_reason(safe_error_detail(ValueError(err)))",
        ],
    )
    def test_the_check_flags_a_sanitized_argument(self, source):
        """A misspelled or dropped name in either set would pass everything."""
        assert self._offenders(ast.parse(source)) == [1]

    def test_the_check_leaves_the_correct_shape_alone(self):
        source = (
            "attendance_lock_http_error(e) or "
            "HTTPException(status_code=400, detail=safe_error_detail(e))"
        )
        assert self._offenders(ast.parse(source)) == []
