"""The annual review's waiver data points (owner decisions, 2026-11-10).

Four sources show a member's requests to be excused from training sessions
and business meetings: a summary count and a per-request history for each
workflow. They are measured by session date over the evaluation's own review
period, within the member's coverage, and they never carry the member's
reason, the deciders' notes or any attachment: an evaluation is permanent,
the member reads it, and any of the three may be medical.
"""

import json
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.attendance_waiver import (
    LIVE_STATUSES,
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
    live_key_for,
)
from app.models.user import MemberServicePeriod, User
from app.schemas.evaluation import DataBlock
from app.services.evaluation_data_sources import DATA_SOURCES_BY_KEY
from tests.test_evaluation_workflow import _org, _period, _template, _user

pytestmark = [pytest.mark.integration]

ClientFactory = Callable[..., Awaitable[AsyncClient]]

TRAINING = AttendanceWaiverWorkflow.TRAINING_SESSION
MEETING = AttendanceWaiverWorkflow.BUSINESS_MEETING
WAIVER_KEYS = (
    "training.session_waivers_summary",
    "training.session_waiver_history",
    "meetings.waivers_summary",
    "meetings.waiver_history",
)
REASON = "SECRET-REASON cardiology follow-up"
NOTE = "SECRET-NOTE saw the cardiology letter"

DEFINITION: dict[str, Any] = {
    "overall_mode": "none",
    "sections": [
        {
            "key": "waivers",
            "title": "Waivers",
            "items": [
                {
                    "key": key.replace(".", "_"),
                    "label": key,
                    "tool": "narrative",
                    "data_block": {"source": key},
                }
                for key in WAIVER_KEYS
            ],
        }
    ],
}


@pytest.fixture
async def make_client(db_session: AsyncSession) -> AsyncGenerator[ClientFactory]:
    opened: list[AsyncClient] = []

    async def factory(user: User) -> AsyncClient:
        app = FastAPI()
        app.include_router(endpoints.router, prefix="/evaluations")
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: db_session
        client = AsyncClient(
            transport=ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
        )
        opened.append(client)
        return client

    yield factory
    for client in opened:
        await client.aclose()


class _Dept:
    def __init__(self, db, org, manager, evaluator, member, officer, chief, period):
        self.db = db
        self.org = org
        self.manager = manager
        self.evaluator = evaluator
        self.member = member
        self.officer = officer
        self.chief = chief
        self.period = period


@pytest.fixture
async def dept(db_session: AsyncSession) -> _Dept:
    org = await _org(db_session)
    manager = await _user(
        db_session,
        org,
        ["evaluations.manage", "evaluations.conduct", "evaluations.view_all"],
    )
    evaluator = await _user(db_session, org, ["evaluations.conduct"])
    member = await _user(db_session, org, [])
    officer = await _user(db_session, org, ["training.manage"])
    chief = await _user(db_session, org, [])
    period = await _period(db_session, org)
    return _Dept(db_session, org, manager, evaluator, member, officer, chief, period)


def _at(day: date, hour: int) -> datetime:
    return datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)


async def _request(
    dept: _Dept,
    day: date,
    *,
    steps: tuple[tuple[AttendanceWaiverAction, Optional[User]], ...] = (),
    status: AttendanceWaiverStatus = AttendanceWaiverStatus.PENDING,
    workflow: AttendanceWaiverWorkflow = TRAINING,
    member: Optional[User] = None,
    org: Optional[str] = None,
    title: str = "Pump drill",
    category: Optional[str] = None,
    event_key: Optional[str] = None,
) -> AttendanceWaiverRequest:
    """A request written as the request engine writes one: the submission
    and each later step in the log, the deciding step on the request, and
    the live key held while it is pending, approved or denied."""
    who = member or dept.member
    org_id = org or dept.org
    decided = [
        (action, actor)
        for action, actor in steps
        if action
        in (
            AttendanceWaiverAction.APPROVED,
            AttendanceWaiverAction.DENIED,
            AttendanceWaiverAction.CHIEF_OVERRIDE,
        )
    ]
    request = AttendanceWaiverRequest(
        organization_id=org_id,
        workflow=workflow,
        user_id=who.id,
        event_id=None,
        event_title_snapshot=title,
        event_start_snapshot=_at(day, 19),
        session_date=day,
        status=status,
        live_key=(
            live_key_for(workflow.value, event_key or str(uuid.uuid4()), who.id)
            if status in LIVE_STATUSES
            else None
        ),
        category=category,
        reason=REASON,
        submitted_at=_at(day, 8) - timedelta(days=2),
        decided_by=decided[-1][1].id if decided and decided[-1][1] else None,
        decided_at=_at(day, 9) - timedelta(days=1) if decided else None,
        chief_override=any(
            a == AttendanceWaiverAction.CHIEF_OVERRIDE for a, _ in decided
        ),
    )
    dept.db.add(request)
    await dept.db.flush()
    log = ((AttendanceWaiverAction.SUBMITTED, who),) + steps
    for action, actor in log:
        dept.db.add(
            AttendanceWaiverRequestAction(
                organization_id=org_id,
                request_id=request.id,
                action=action,
                actor_id=actor.id if actor else None,
                note=None if action == AttendanceWaiverAction.SUBMITTED else NOTE,
                # Every step in the same second, so the order rests on the
                # lifecycle rather than on the clock.
                created_at=_at(day, 8) - timedelta(days=2),
            )
        )
    await dept.db.flush()
    return request


async def _figures(dept: _Dept, make_client: ClientFactory) -> dict:
    template = await _template(dept.db, dept.org, name="Waivers", definition=DEFINITION)
    client = await make_client(dept.manager)
    response = await client.post(
        "/evaluations",
        json={
            "member_id": dept.member.id,
            "period_id": dept.period.id,
            "evaluator_id": dept.evaluator.id,
            "template_id": template.id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _training(detail: dict) -> tuple[dict, list[dict]]:
    return (
        detail["data"]["training.session_waivers_summary"],
        detail["data"]["training.session_waiver_history"]["value"],
    )


EMPTY = {
    "requested": 0,
    "approved": 0,
    "overridden": 0,
    "denied": 0,
    "withdrawn": 0,
    "pending": 0,
    "voided": 0,
}


class TestTheCatalog:
    def test_the_waiver_sources_cannot_be_scored(self):
        for key in WAIVER_KEYS:
            assert DATA_SOURCES_BY_KEY[key].scoreable is False, key
        with pytest.raises(ValidationError, match="cannot be scored"):
            DataBlock(
                source="training.session_waivers_summary",
                scoring_rule={"bands": [{"min": 0, "score": 3}]},
            )

    def test_the_older_count_sources_are_still_scoreable(self):
        assert DATA_SOURCES_BY_KEY["events.attended_count"].scoreable is True


class TestWaiverSources:
    async def test_with_no_requests_the_counts_are_zero_and_the_lists_empty(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _figures(dept, make_client)
        for key in ("training.session_waivers_summary", "meetings.waivers_summary"):
            assert detail["data"][key] == {
                "available": True,
                "value": 0,
                **EMPTY,
                "breakdown": "0 approved, 0 denied, 0 withdrawn",
            }
        for key in ("training.session_waiver_history", "meetings.waiver_history"):
            assert detail["data"][key] == {"available": True, "value": []}

    async def test_only_sessions_held_in_the_review_period_count(
        self, dept: _Dept, make_client: ClientFactory
    ):
        # The period is calendar 2025; by session date, not by when asked.
        await _request(dept, date(2024, 12, 31), title="Before")
        await _request(dept, date(2025, 1, 1), title="First day")
        await _request(dept, date(2025, 12, 31), title="Last day")
        await _request(dept, date(2026, 1, 1), title="After")

        summary, history = _training(await _figures(dept, make_client))

        assert summary["value"] == 2
        assert summary["pending"] == 2
        assert [line["event_title"] for line in history] == ["First day", "Last day"]
        assert history[0]["label"] == "2025-01-01 First day: pending"
        assert history[0]["session_date"] == "2025-01-01"

    async def test_a_session_between_stints_of_membership_is_dropped(
        self, dept: _Dept, make_client: ClientFactory
    ):
        dept.db.add_all(
            [
                MemberServicePeriod(
                    organization_id=dept.org,
                    user_id=dept.member.id,
                    start_date=date(2015, 3, 1),
                    end_date=date(2025, 4, 30),
                    separation_status="dropped_voluntary",
                ),
                MemberServicePeriod(
                    organization_id=dept.org,
                    user_id=dept.member.id,
                    start_date=date(2025, 7, 1),
                ),
            ]
        )
        await dept.db.flush()
        await _request(dept, date(2025, 3, 4), title="Served")
        await _request(dept, date(2025, 6, 3), title="Separated")
        await _request(dept, date(2025, 9, 2), title="Rejoined")

        summary, history = _training(await _figures(dept, make_client))

        assert summary["value"] == 2
        assert [line["event_title"] for line in history] == ["Served", "Rejoined"]

    async def test_a_withdrawn_request_and_its_resubmission_both_show(
        self, dept: _Dept, make_client: ClientFactory
    ):
        day = date(2025, 5, 6)
        await _request(
            dept,
            day,
            steps=((AttendanceWaiverAction.WITHDRAWN, dept.member),),
            status=AttendanceWaiverStatus.WITHDRAWN,
        )
        await _request(
            dept,
            day,
            steps=((AttendanceWaiverAction.APPROVED, dept.officer),),
            status=AttendanceWaiverStatus.APPROVED,
            category="Work",
        )

        summary, history = _training(await _figures(dept, make_client))

        assert {k: summary[k] for k in EMPTY} == {
            **EMPTY,
            "requested": 2,
            "approved": 1,
            "withdrawn": 1,
        }
        assert summary["breakdown"] == "1 approved, 0 denied, 1 withdrawn"
        officer = dept.officer.display_name
        assert [line["outcome"] for line in history] == [
            "withdrawn",
            f"approved by {officer}",
        ]
        assert history[1]["label"] == (
            f"2025-05-06 Pump drill: approved by {officer} (category: Work)"
        )
        assert history[1]["category"] == "Work"
        assert history[1]["decided_by"] == officer
        assert history[0]["decided_by"] is None

    async def test_a_denial_the_chief_overrode_shows_both_decisions(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _request(
            dept,
            date(2025, 8, 5),
            steps=(
                (AttendanceWaiverAction.DENIED, dept.officer),
                (AttendanceWaiverAction.CHIEF_OVERRIDE, dept.chief),
            ),
            status=AttendanceWaiverStatus.APPROVED,
        )

        summary, history = _training(await _figures(dept, make_client))

        # It counts as approved, as it does toward the cap; the denial it
        # overturned is no longer a standing denial.
        assert {k: summary[k] for k in EMPTY} == {
            **EMPTY,
            "requested": 1,
            "approved": 1,
            "overridden": 1,
        }
        assert summary["breakdown"] == (
            "1 approved (1 on the Chief's override), 0 denied, 0 withdrawn"
        )
        (line,) = history
        officer, chief = dept.officer.display_name, dept.chief.display_name
        assert line["outcome"] == (
            f"denied by {officer}, then approved on the Chief's override by {chief}"
        )
        assert line["chief_override"] is True
        assert line["decided_by"] == chief
        assert line["status"] == "approved"
        assert line["attachment_on_file"] is False
        assert [(s["action"], s["by"]) for s in line["history"]] == [
            ("submitted", dept.member.display_name),
            ("denied", officer),
            ("chief_override", chief),
        ]
        assert line["history"][0]["on"] == "2025-08-03"

    async def test_a_standing_denial_counts_as_denied(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _request(
            dept,
            date(2025, 8, 5),
            steps=((AttendanceWaiverAction.DENIED, dept.officer),),
            status=AttendanceWaiverStatus.DENIED,
        )

        summary, history = _training(await _figures(dept, make_client))

        assert summary["denied"] == 1
        assert summary["approved"] == 0
        assert history[0]["outcome"] == f"denied by {dept.officer.display_name}"

    async def test_a_voided_request_is_listed_but_not_counted_as_approved(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _request(
            dept,
            date(2025, 10, 7),
            steps=(
                (AttendanceWaiverAction.APPROVED, dept.officer),
                (AttendanceWaiverAction.VOIDED, dept.manager),
            ),
            status=AttendanceWaiverStatus.VOIDED,
        )

        summary, history = _training(await _figures(dept, make_client))

        assert {k: summary[k] for k in EMPTY} == {
            **EMPTY,
            "requested": 1,
            "voided": 1,
        }
        assert summary["breakdown"] == "0 approved, 0 denied, 0 withdrawn, 1 voided"
        assert history[0]["outcome"] == (
            f"approved by {dept.officer.display_name}, "
            f"then voided by {dept.manager.display_name}"
        )

    async def test_other_members_and_other_departments_are_left_out(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _request(dept, date(2025, 4, 1), member=dept.evaluator)
        other_org = await _org(dept.db)
        outsider = await _user(dept.db, other_org, [])
        await _request(dept, date(2025, 4, 1), member=outsider, org=other_org)
        # Even a row stamped with another department but naming this member
        # is not this department's record.
        await _request(dept, date(2025, 4, 2), org=other_org)

        detail = await _figures(dept, make_client)

        for key in WAIVER_KEYS:
            entry = detail["data"][key]
            assert entry["value"] in (0, []), key

    async def test_an_actor_from_outside_the_department_is_not_named(
        self, dept: _Dept, make_client: ClientFactory
    ):
        other_org = await _org(dept.db)
        outsider = await _user(dept.db, other_org, [])
        await _request(
            dept,
            date(2025, 4, 1),
            steps=((AttendanceWaiverAction.APPROVED, outsider),),
            status=AttendanceWaiverStatus.APPROVED,
        )

        _, history = _training(await _figures(dept, make_client))

        assert history[0]["decided_by"] == "a former member"
        assert outsider.display_name not in json.dumps(history)

    async def test_training_and_meeting_requests_are_kept_apart(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _request(dept, date(2025, 2, 4), title="Drill")
        await _request(
            dept,
            date(2025, 2, 11),
            workflow=MEETING,
            title="February business meeting",
            steps=((AttendanceWaiverAction.APPROVED, dept.officer),),
            status=AttendanceWaiverStatus.APPROVED,
        )

        detail = await _figures(dept, make_client)

        assert detail["data"]["training.session_waivers_summary"]["value"] == 1
        assert detail["data"]["meetings.waivers_summary"]["value"] == 1
        assert detail["data"]["meetings.waivers_summary"]["approved"] == 1
        assert [
            line["event_title"]
            for line in detail["data"]["meetings.waiver_history"]["value"]
        ] == ["February business meeting"]
        assert [
            line["event_title"]
            for line in detail["data"]["training.session_waiver_history"]["value"]
        ] == ["Drill"]

    async def test_no_reason_or_decider_note_appears_anywhere(
        self, dept: _Dept, make_client: ClientFactory
    ):
        for workflow in (TRAINING, MEETING):
            await _request(
                dept,
                date(2025, 3, 4),
                workflow=workflow,
                steps=(
                    (AttendanceWaiverAction.DENIED, dept.officer),
                    (AttendanceWaiverAction.CHIEF_OVERRIDE, dept.chief),
                ),
                status=AttendanceWaiverStatus.APPROVED,
                category="Medical",
            )

        detail = await _figures(dept, make_client)
        client = await make_client(dept.manager)
        stored = await client.get(f"/evaluations/{detail['id']}")
        assert stored.status_code == 200, stored.text

        for body in (detail, stored.json()):
            text = json.dumps(body)
            assert "SECRET-REASON" not in text
            assert "SECRET-NOTE" not in text
            assert "cardiology" not in text
        # The category is the department's own label and is shown.
        assert "Medical" in json.dumps(detail["data"])


class TestThePreview:
    async def test_the_preview_shows_a_sample_for_every_waiver_source(
        self, db_session: AsyncSession, make_client: ClientFactory
    ):
        org = await _org(db_session)
        builder = await _user(db_session, org, ["evaluations.configure"])

        response = await (await make_client(builder)).post(
            "/evaluations/templates/preview", json={"definition": DEFINITION}
        )

        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert sorted(data) == sorted(WAIVER_KEYS)
        assert data["training.session_waivers_summary"]["value"] == 3
        assert data["meetings.waiver_history"]["value"][0]["label"]
