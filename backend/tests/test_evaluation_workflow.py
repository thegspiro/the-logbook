"""Evaluations driven over HTTP: drafting, the snapshot, who sees what, and the
forward-only workflow.

Covers who may draft (a manager assigns any evaluator holding
``evaluations.conduct``; a conductor drafts only for themselves; nobody
evaluates themselves), that every id resolves inside the caller's
department, that the evaluator never reads a self-evaluation before the
member submits it and the member never reads the evaluation before it is
released to them, and the figures the snapshot records.
"""

import json
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable
from datetime import date, datetime, timezone
from typing import Any, Optional

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import evaluations as endpoints
from app.core.database import get_db
from app.models.audit import AuditLog
from app.models.evaluation import (
    Evaluation,
    EvaluationPeriod,
    EvaluationTemplate,
    EvaluationTemplateVersion,
)
from app.models.event import Event, EventRSVP, EventType
from app.models.meeting import Meeting, MeetingAttendee
from app.models.training import TrainingRecord, TrainingStatus, TrainingType
from app.models.user import MemberLeaveOfAbsence, User

pytestmark = [pytest.mark.integration]

ClientFactory = Callable[..., Awaitable[AsyncClient]]

PERIOD = (date(2025, 1, 1), date(2025, 12, 31))
LEVELS = [{"value": v, "label": f"L{v}", "anchor": f"A{v}"} for v in range(1, 6)]
DEFINITION: dict[str, Any] = {
    "overall_mode": "weighted",
    "officer_ranks": ["captain"],
    "sections": [
        {
            "key": "core",
            "title": "Core",
            "items": [
                {
                    "key": "training",
                    "label": "Training",
                    "tool": "labeled_scale",
                    "levels": LEVELS,
                    "weight": 100,
                    "data_block": {
                        "source": "training.hours",
                        "scoring_rule": {
                            "bands": [
                                {"min": 0, "max": 10, "score": 2},
                                {"min": 10, "score": 4},
                            ]
                        },
                    },
                },
                {
                    "key": "meetings",
                    "label": "Meetings",
                    "tool": "narrative",
                    "include_in_self_evaluation": False,
                    "data_block": {"source": "events.meeting_attendance_pct"},
                },
            ],
        },
        {
            "key": "leadership",
            "title": "Leadership",
            "officer_only": True,
            "items": [
                {
                    "key": "lead",
                    "label": "Leads the crew",
                    "tool": "narrative",
                    "include_in_self_evaluation": False,
                    "data_block": {"source": "positions.held"},
                }
            ],
        },
    ],
}


def _step(key: str, kind: str, actor: str, due: int) -> dict:
    return {
        "key": key,
        "type": kind,
        "label": key.title(),
        "actor": {"kind": actor},
        "due_days": due,
    }


ANNUAL = {
    "steps": [
        _step("self_evaluation", "self_evaluation", "member", 14),
        _step("evaluator", "evaluator", "evaluator", 30),
        _step("member_acknowledgement", "member_acknowledgement", "member", 58),
    ]
}
WITH_CALIBRATION = {
    "steps": [
        _step("self_evaluation", "self_evaluation", "member", 14),
        _step("evaluator", "evaluator", "evaluator", 30),
        _step("calibration", "calibration", "view_all", 40),
        _step("member_acknowledgement", "member_acknowledgement", "member", 58),
    ]
}
INTERIM = {
    "steps": [
        _step("self_evaluation", "self_evaluation", "member", 14),
        _step("evaluator", "evaluator", "evaluator", 30),
    ]
}
# A rating of 2 is what the figures suggest for a member with no training
# hours, so the stock answer needs no justification.
EVALUATOR_ANSWERS = {
    "answers": {
        "training": {"rating": 2},
        "meetings": {"text": "Steady attendance."},
    }
}
SELF_ANSWERS = {"answers": {"training": {"rating": 5}}}


def _uid() -> str:
    return str(uuid.uuid4())


async def _org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Eval Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"eval-{org_id[:8]}"},
    )
    return org_id


async def _user(
    db: AsyncSession,
    org_id: str,
    permissions: list[str],
    *,
    rank: Optional[str] = None,
    hire_date: date = date(2015, 3, 1),
    position_kind: str = "office",
    position_name: Optional[str] = None,
) -> User:
    user_id, position_id = _uid(), _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, `rank`, hire_date, member_class) "
            "VALUES (:id, :org, :un, 'Eval', :ln, :em, 'hashed', 'active', :rank, "
            ":hire, 'operational')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"eval-{user_id[:8]}",
            "ln": user_id[:6],
            "em": f"eval-{user_id[:8]}@test.example",
            "rank": rank,
            "hire": hire_date,
        },
    )
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, kind) "
            "VALUES (:id, :org, :name, :slug, :perms, :kind)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": position_name or f"Pos {position_id[:6]}",
            "slug": f"pos-{position_id[:8]}",
            "perms": json.dumps(permissions),
            "kind": position_kind,
        },
    )
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    user = await db.get(User, user_id)
    assert user is not None
    await db.refresh(user, ["positions"])
    return user


async def _template(
    db: AsyncSession,
    org_id: str,
    *,
    name: str = "Operational Annual",
    kind: str = "annual",
    workflow: Optional[dict] = None,
    definition: Optional[dict] = None,
    member_class: Optional[str] = None,
    member_status: Optional[str] = None,
) -> EvaluationTemplate:
    template = EvaluationTemplate(
        organization_id=org_id,
        name=name,
        kind=kind,
        member_class=member_class,
        member_status=member_status,
        is_active=True,
    )
    db.add(template)
    await db.flush()
    db.add(
        EvaluationTemplateVersion(
            organization_id=org_id,
            template_id=template.id,
            version_number=1,
            definition=definition or DEFINITION,
            workflow=workflow or ANNUAL,
            published_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        )
    )
    await db.flush()
    return template


async def _period(
    db: AsyncSession, org_id: str, *, closed: bool = False
) -> EvaluationPeriod:
    period = EvaluationPeriod(
        organization_id=org_id,
        name=f"2025 Annual {_uid()[:4]}",
        start_date=PERIOD[0],
        end_date=PERIOD[1],
        is_closed=closed,
    )
    db.add(period)
    await db.flush()
    return period


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
    """A department with a Chief (manage, conduct and view_all, as seeded), a
    conductor, a member and a reader who holds view_all alone."""

    def __init__(self, db, org, manager, evaluator, member, reader, period, template):
        self.db = db
        self.org = org
        self.manager = manager
        self.evaluator = evaluator
        self.member = member
        self.reader = reader
        self.period = period
        self.template = template


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
    reader = await _user(db_session, org, ["evaluations.view_all"])
    period = await _period(db_session, org)
    template = await _template(db_session, org)
    return _Dept(db_session, org, manager, evaluator, member, reader, period, template)


async def _draft(
    client: AsyncClient, dept: _Dept, *, member: Optional[User] = None, **extra
) -> dict:
    response = await client.post(
        "/evaluations",
        json={
            "member_id": (member or dept.member).id,
            "period_id": dept.period.id,
            "evaluator_id": dept.evaluator.id,
            **extra,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _set_today(monkeypatch, day: date) -> None:
    from app.services import evaluation_service

    monkeypatch.setattr(evaluation_service, "today_in", lambda tz: day)


class TestDrafting:
    async def test_draft_opens_the_parallel_steps_and_records_the_figures(
        self, dept: _Dept, make_client: ClientFactory
    ):
        dept.db.add_all(
            [
                TrainingRecord(
                    organization_id=dept.org,
                    user_id=dept.member.id,
                    course_name=name,
                    training_type=TrainingType.CONTINUING_EDUCATION,
                    hours_completed=hours,
                    status=TrainingStatus.COMPLETED,
                    completion_date=done,
                )
                for name, hours, done in (
                    ("Pump ops", 6, date(2025, 3, 4)),
                    ("Ladders", 5.5, date(2025, 9, 9)),
                    # Outside the period: not counted.
                    ("Last year", 40, date(2024, 12, 30)),
                )
            ]
        )
        await dept.db.flush()
        detail = await _draft(await make_client(dept.manager), dept)

        assert [(s["key"], s["status"]) for s in detail["steps"]] == [
            ("self_evaluation", "open"),
            ("evaluator", "open"),
            ("member_acknowledgement", "pending"),
        ]
        assert [s["due_date"] for s in detail["steps"]] == [
            "2026-01-14",
            "2026-01-30",
            "2026-02-27",
        ]
        assert detail["data"]["training.hours"] == {"available": True, "value": 11.5}
        assert [s["key"] for s in detail["sources"]] == [
            "training.hours",
            "events.meeting_attendance_pct",
        ]
        assert detail["sources"][0]["unit"] == "hours"
        assert detail["suggested_scores"] == {"training": 4}
        assert [s["key"] for s in detail["definition"]["sections"]] == ["core"]
        assert (detail["coverage_start"], detail["coverage_end"]) == (
            "2025-01-01",
            "2025-12-31",
        )

    async def test_an_officer_gets_the_officer_sections(
        self, dept: _Dept, make_client: ClientFactory
    ):
        captain = await _user(
            dept.db, dept.org, [], rank="captain", position_name="Safety Officer"
        )
        # Assigned during the period; a seat taken after it ended is not listed.
        await dept.db.execute(
            text("UPDATE user_positions SET assigned_at = :at WHERE user_id = :u"),
            {"at": datetime(2025, 6, 1, tzinfo=timezone.utc), "u": captain.id},
        )
        detail = await _draft(await make_client(dept.manager), dept, member=captain)

        assert detail["includes_officer_sections"] is True
        assert [s["key"] for s in detail["definition"]["sections"]] == [
            "core",
            "leadership",
        ]
        assert detail["data"]["positions.held"]["value"] == [
            {"label": "Safety Officer"}
        ]

    async def test_a_member_who_joined_mid_year_is_measured_from_the_next_full_month(
        self, dept: _Dept, make_client: ClientFactory
    ):
        late = await _user(dept.db, dept.org, [], hire_date=date(2025, 11, 14))
        detail = await _draft(await make_client(dept.manager), dept, member=late)
        assert (detail["coverage_start"], detail["coverage_end"]) == (
            "2025-12-01",
            "2025-12-31",
        )

    async def test_a_conductor_drafts_only_for_themselves(
        self, dept: _Dept, make_client: ClientFactory
    ):
        client = await make_client(dept.evaluator)
        other = await _user(dept.db, dept.org, ["evaluations.conduct"])
        response = await client.post(
            "/evaluations",
            json={
                "member_id": dept.member.id,
                "period_id": dept.period.id,
                "evaluator_id": other.id,
            },
        )
        assert response.status_code == 403
        response = await client.post(
            "/evaluations",
            json={"member_id": dept.member.id, "period_id": dept.period.id},
        )
        assert response.status_code == 201
        assert response.json()["evaluator"]["id"] == dept.evaluator.id

    @pytest.mark.parametrize(
        "case",
        ["self", "no_conduct", "duplicate", "closed", "foreign_member", "late_joiner"],
    )
    async def test_refusals(self, case: str, dept: _Dept, make_client: ClientFactory):
        client = await make_client(dept.manager)
        body: dict[str, Any] = {
            "member_id": dept.member.id,
            "period_id": dept.period.id,
            "evaluator_id": dept.evaluator.id,
        }
        if case == "self":
            body["evaluator_id"] = dept.member.id
            expected = "cannot evaluate themselves"
        elif case == "no_conduct":
            body["evaluator_id"] = dept.reader.id
            expected = "not able to conduct evaluations"
        elif case == "duplicate":
            await _draft(client, dept)
            expected = "already has an evaluation"
        elif case == "closed":
            body["period_id"] = (await _period(dept.db, dept.org, closed=True)).id
            expected = "is closed"
        elif case == "foreign_member":
            body["member_id"] = (await _user(dept.db, await _org(dept.db), [])).id
            expected = "Member not found"
        else:
            body["member_id"] = (
                await _user(dept.db, dept.org, [], hire_date=date(2025, 12, 2))
            ).id
            expected = "served no full month"
        response = await client.post("/evaluations", json=body)
        assert response.status_code == 400, response.text
        assert expected in response.json()["detail"]

    async def test_the_most_specific_template_wins_and_a_tie_is_refused(
        self, dept: _Dept, make_client: ClientFactory
    ):
        specific = await _template(
            dept.db, dept.org, name="Operational Regular", member_class="operational"
        )
        client = await make_client(dept.manager)
        detail = await _draft(client, dept)
        assert detail["template_name"] == specific.name

        await _template(dept.db, dept.org, name="By status", member_status="regular")
        dept.member.member_status = "regular"
        other = await _user(dept.db, dept.org, [])
        other.member_status = "regular"
        await dept.db.flush()
        response = await client.post(
            "/evaluations",
            json={
                "member_id": other.id,
                "period_id": dept.period.id,
                "evaluator_id": dept.evaluator.id,
            },
        )
        assert response.status_code == 400
        assert "More than one template fits" in response.json()["detail"]

    async def test_drafting_is_audited(self, dept: _Dept, make_client: ClientFactory):
        detail = await _draft(await make_client(dept.manager), dept)
        logged = (
            (
                await dept.db.execute(
                    select(AuditLog).where(AuditLog.event_type == "evaluation_created")
                )
            )
            .scalars()
            .all()
        )
        assert any(
            row.event_data.get("evaluation_id") == detail["id"] for row in logged
        )


class TestWhoSeesWhat:
    async def test_a_stranger_or_another_department_is_told_it_does_not_exist(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _draft(await make_client(dept.manager), dept)
        stranger = await _user(dept.db, dept.org, ["evaluations.conduct"])
        outsider = await _user(dept.db, await _org(dept.db), ["*"])
        for user in (stranger, outsider):
            response = await (await make_client(user)).get(
                f"/evaluations/{detail['id']}"
            )
            assert response.status_code == 404

    async def test_drafts_stay_with_their_authors_until_submitted(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _draft(await make_client(dept.manager), dept)
        member = await make_client(dept.member)
        evaluator = await make_client(dept.evaluator)
        url = f"/evaluations/{detail['id']}"

        assert (
            await member.put(
                f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS}
            )
        ).status_code == 200
        assert (
            await evaluator.put(
                f"{url}/parts/evaluator", json={"content": EVALUATOR_ANSWERS}
            )
        ).status_code == 200

        as_member = (await member.get(url)).json()
        as_evaluator = (await evaluator.get(url)).json()
        assert [p["kind"] for p in as_member["parts"]] == ["self_evaluation"]
        assert as_member["data"] is None
        assert [p["kind"] for p in as_evaluator["parts"]] == ["evaluator"]

        assert (
            await member.post(f"{url}/parts/self_evaluation/submit")
        ).status_code == 200
        as_evaluator = (await evaluator.get(url)).json()
        assert sorted(p["kind"] for p in as_evaluator["parts"]) == [
            "evaluator",
            "self_evaluation",
        ]

    async def test_a_manager_runs_the_process_without_reading_the_content(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _draft(await make_client(dept.evaluator), dept)
        await (await make_client(dept.evaluator)).put(
            f"/evaluations/{detail['id']}/parts/evaluator",
            json={"content": EVALUATOR_ANSWERS},
        )
        manager_only = await _user(dept.db, dept.org, ["evaluations.manage"])
        seen = (
            await (await make_client(manager_only)).get(f"/evaluations/{detail['id']}")
        ).json()
        assert seen["parts"] == []
        assert seen["data"] is None
        reader = (
            await (await make_client(dept.reader)).get(f"/evaluations/{detail['id']}")
        ).json()
        assert [p["kind"] for p in reader["parts"]] == ["evaluator"]

    async def test_only_the_author_writes_a_part(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _draft(await make_client(dept.manager), dept)
        url = f"/evaluations/{detail['id']}/parts"
        evaluator = await make_client(dept.evaluator)
        member = await make_client(dept.member)
        assert (
            await evaluator.put(
                f"{url}/self_evaluation", json={"content": SELF_ANSWERS}
            )
        ).status_code == 403
        assert (
            await member.put(f"{url}/evaluator", json={"content": EVALUATOR_ANSWERS})
        ).status_code == 403

    async def test_lists_are_scoped(self, dept: _Dept, make_client: ClientFactory):
        mine = await _draft(await make_client(dept.manager), dept)
        other_member = await _user(dept.db, dept.org, [])
        other_evaluator = await _user(dept.db, dept.org, ["evaluations.conduct"])
        await _draft(
            await make_client(dept.manager),
            dept,
            member=other_member,
            evaluator_id=other_evaluator.id,
        )
        conducting = (
            await (await make_client(dept.evaluator)).get("/evaluations")
        ).json()
        assert [e["id"] for e in conducting] == [mine["id"]]
        everything = (await (await make_client(dept.reader)).get("/evaluations")).json()
        assert len(everything) == 2
        own = (await (await make_client(dept.member)).get("/evaluations/mine")).json()
        assert [e["id"] for e in own] == [mine["id"]]
        assert (
            await (await make_client(dept.member)).get("/evaluations")
        ).status_code == 403


class TestWorkflow:
    async def _ready(
        self, dept: _Dept, make_client: ClientFactory, **extra
    ) -> tuple[str, AsyncClient, AsyncClient]:
        detail = await _draft(await make_client(dept.manager), dept, **extra)
        member = await make_client(dept.member)
        evaluator = await make_client(dept.evaluator)
        url = f"/evaluations/{detail['id']}"
        await evaluator.put(
            f"{url}/parts/evaluator", json={"content": EVALUATOR_ANSWERS}
        )
        return url, member, evaluator

    async def test_the_evaluator_waits_for_the_self_evaluation_until_its_deadline(
        self, dept: _Dept, make_client: ClientFactory, monkeypatch
    ):
        url, _member, evaluator = await self._ready(dept, make_client)
        await _set_today(monkeypatch, date(2026, 1, 14))
        response = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert response.status_code == 400
        assert "until 2026-01-14" in response.json()["detail"]

        await _set_today(monkeypatch, date(2026, 1, 15))
        response = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert response.status_code == 200
        steps = {s["key"]: s["status"] for s in response.json()["evaluation"]["steps"]}
        assert steps == {
            "self_evaluation": "skipped",
            "evaluator": "completed",
            "member_acknowledgement": "open",
        }

    async def test_locking_releases_the_evaluation_to_the_member(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, evaluator = await self._ready(dept, make_client)
        await member.put(f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS})
        assert (
            await member.post(f"{url}/parts/self_evaluation/submit")
        ).status_code == 200
        response = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert response.json()["outcome"] == "submitted"
        assert response.json()["evaluation"]["status"] == "in_progress"

        as_member = (await member.get(url)).json()
        assert sorted(p["kind"] for p in as_member["parts"]) == [
            "evaluator",
            "self_evaluation",
        ]
        assert as_member["data"]["training.hours"]["available"] is True
        # 2 on a 1..5 scale is a quarter of the way up; one item carries all
        # the weight.
        assert as_member["weighted_overall"] == 25.0
        assert as_member["current_step"] == "Member_Acknowledgement"

        locked = await evaluator.put(
            f"{url}/parts/evaluator", json={"content": EVALUATOR_ANSWERS}
        )
        assert locked.status_code == 400
        assert (await evaluator.post(f"{url}/refresh-data")).status_code == 400

    async def test_departing_from_the_suggested_score_needs_a_reason(
        self, dept: _Dept, make_client: ClientFactory
    ):
        dept.db.add(
            TrainingRecord(
                organization_id=dept.org,
                user_id=dept.member.id,
                course_name="Hours",
                training_type=TrainingType.CONTINUING_EDUCATION,
                hours_completed=2,
                status=TrainingStatus.COMPLETED,
                completion_date=date(2025, 5, 1),
            )
        )
        await dept.db.flush()
        url, member, evaluator = await self._ready(dept, make_client)
        await member.put(f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS})
        await member.post(f"{url}/parts/self_evaluation/submit")
        departing = {
            "answers": {**EVALUATOR_ANSWERS["answers"], "training": {"rating": 4}}
        }
        await evaluator.put(f"{url}/parts/evaluator", json={"content": departing})

        response = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert response.status_code == 400
        assert "differs from the 2 the figures suggest" in response.json()["detail"]

        departing["answers"]["training"]["justification"] = "Led every drill."
        await evaluator.put(f"{url}/parts/evaluator", json={"content": departing})
        assert (
            await evaluator.post(f"{url}/parts/evaluator/submit")
        ).status_code == 200

    async def test_a_check_in_finalizes_when_the_evaluator_locks(
        self, dept: _Dept, make_client: ClientFactory
    ):
        interim = await _template(
            dept.db, dept.org, name="Monthly check-in", kind="interim", workflow=INTERIM
        )
        url, member, evaluator = await self._ready(
            dept, make_client, kind="interim", template_id=interim.id
        )
        await member.put(f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS})
        await member.post(f"{url}/parts/self_evaluation/submit")
        response = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert response.json()["outcome"] == "finalized"
        assert response.json()["evaluation"]["status"] == "finalized"

    async def test_calibration_comes_before_the_lock_and_is_hidden_from_the_member(
        self, dept: _Dept, make_client: ClientFactory
    ):
        calibrated = await _template(
            dept.db,
            dept.org,
            name="Calibrated",
            workflow=WITH_CALIBRATION,
            member_class="operational",
        )
        url, member, evaluator = await self._ready(
            dept, make_client, template_id=calibrated.id
        )
        await member.put(f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS})
        await member.post(f"{url}/parts/self_evaluation/submit")

        first = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert first.json()["outcome"] == "sent_for_calibration"
        again = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert again.status_code == 400
        assert "with calibration" in again.json()["detail"]
        assert "calibration" not in [
            s["key"] for s in (await member.get(url)).json()["steps"]
        ]

        # A conductor cannot calibrate; a reader can.
        assert (await evaluator.post(f"{url}/calibration/complete")).status_code == 403
        reader = await make_client(dept.reader)
        assert (await reader.post(f"{url}/calibration/complete")).status_code == 200

        locked = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert locked.json()["outcome"] == "submitted"
        steps = {s["key"]: s["status"] for s in locked.json()["evaluation"]["steps"]}
        assert steps["calibration"] == "completed"
        assert steps["member_acknowledgement"] == "open"

    async def test_a_saved_answer_must_fit_the_form(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, evaluator = await self._ready(dept, make_client)
        off_scale = await evaluator.put(
            f"{url}/parts/evaluator",
            json={"content": {"answers": {"training": {"rating": 9}}}},
        )
        assert off_scale.status_code == 400
        not_on_self = await member.put(
            f"{url}/parts/self_evaluation",
            json={"content": {"answers": {"meetings": {"text": "x"}}}},
        )
        assert not_on_self.status_code == 400
        assert "'meetings' is not on this form" in not_on_self.json()["detail"]


class TestFigures:
    async def test_meetings_on_leave_are_dropped(
        self, dept: _Dept, make_client: ClientFactory
    ):
        meetings = [
            Meeting(
                organization_id=dept.org,
                title=f"M{i}",
                meeting_date=day,
                meeting_type="business",
            )
            for i, day in enumerate(
                [
                    date(2025, 2, 10),
                    date(2025, 5, 12),
                    date(2025, 8, 11),
                    date(2025, 10, 13),
                ]
            )
        ]
        dept.db.add_all(meetings)
        await dept.db.flush()
        dept.db.add_all(
            [
                MeetingAttendee(
                    organization_id=dept.org,
                    meeting_id=meetings[0].id,
                    user_id=dept.member.id,
                    present=True,
                ),
                MeetingAttendee(
                    organization_id=dept.org,
                    meeting_id=meetings[1].id,
                    user_id=dept.member.id,
                    present=False,
                ),
                MemberLeaveOfAbsence(
                    organization_id=dept.org,
                    user_id=dept.member.id,
                    start_date=date(2025, 8, 1),
                    end_date=date(2025, 10, 31),
                    active=True,
                ),
            ]
        )
        await dept.db.flush()
        detail = await _draft(await make_client(dept.manager), dept)
        assert detail["data"]["events.meeting_attendance_pct"] == {
            "available": True,
            "value": 50.0,
            "attended": 1,
            "held": 2,
        }
        assert [r["reason"] for r in detail["excluded_ranges"]] == ["leave"]

    async def test_no_meetings_held_is_not_a_perfect_record(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _draft(await make_client(dept.manager), dept)
        assert detail["data"]["events.meeting_attendance_pct"] == {
            "available": False,
            "value": None,
            "note": "No business meetings were held in the period.",
        }

    async def test_training_sessions_count_an_officers_override(
        self, dept: _Dept, make_client: ClientFactory
    ):
        definition = json.loads(json.dumps(DEFINITION))
        definition["sections"][0]["items"][1]["data_block"] = {
            "source": "training.session_attendance_pct"
        }
        sessions = await _template(
            dept.db,
            dept.org,
            name="Sessions",
            definition=definition,
            member_class="operational",
        )
        events = [
            Event(
                organization_id=dept.org,
                title=f"Drill {i}",
                event_type=EventType.TRAINING,
                start_datetime=datetime(2025, month, 3, 19, tzinfo=timezone.utc),
                end_datetime=datetime(2025, month, 3, 21, tzinfo=timezone.utc),
                is_cancelled=cancelled,
            )
            for i, (month, cancelled) in enumerate(
                [(3, False), (6, False), (9, False), (11, True)]
            )
        ]
        dept.db.add_all(events)
        await dept.db.flush()
        dept.db.add_all(
            [
                EventRSVP(
                    organization_id=dept.org,
                    event_id=events[0].id,
                    user_id=dept.member.id,
                    checked_in=True,
                ),
                EventRSVP(
                    organization_id=dept.org,
                    event_id=events[1].id,
                    user_id=dept.member.id,
                    checked_in=False,
                    override_check_in_at=datetime(2025, 6, 3, 19, tzinfo=timezone.utc),
                ),
            ]
        )
        await dept.db.flush()
        detail = await _draft(
            await make_client(dept.manager), dept, template_id=sessions.id
        )
        assert detail["data"]["training.session_attendance_pct"] == {
            "available": True,
            "value": 66.7,
            "attended": 2,
            "held": 3,
        }

    async def test_live_data_measures_the_member_now(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _draft(await make_client(dept.manager), dept)
        response = await (await make_client(dept.member)).get(
            "/evaluations/mine/live-data"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["period_id"] == dept.period.id
        assert [s["key"] for s in body["sources"]] == [
            "training.hours",
            "events.meeting_attendance_pct",
        ]
        assert body["data"]["training.hours"]["available"] is True

    async def test_refreshing_takes_the_figures_again_before_the_lock(
        self, dept: _Dept, make_client: ClientFactory
    ):
        detail = await _draft(await make_client(dept.manager), dept)
        dept.db.add(
            TrainingRecord(
                organization_id=dept.org,
                user_id=dept.member.id,
                course_name="Late entry",
                training_type=TrainingType.CONTINUING_EDUCATION,
                hours_completed=3,
                status=TrainingStatus.COMPLETED,
                completion_date=date(2025, 12, 20),
            )
        )
        await dept.db.flush()
        refreshed = await (await make_client(dept.evaluator)).post(
            f"/evaluations/{detail['id']}/refresh-data"
        )
        assert refreshed.status_code == 200
        assert refreshed.json()["data"]["training.hours"]["value"] == 3.0
        row = await dept.db.get(Evaluation, detail["id"])
        assert row is not None
        assert row.data_snapshot["values"]["training.hours"]["value"] == 3.0


class TestEverySource:
    async def test_every_catalog_source_is_measured_without_error(
        self, dept: _Dept, make_client: ClientFactory
    ):
        """Each source reaches into another module's code; a wrong argument
        there would surface only as a server error on drafting."""
        from app.services.evaluation_data_sources import DATA_SOURCES

        definition = {
            "overall_mode": "none",
            "sections": [
                {
                    "key": "all",
                    "title": "All",
                    "items": [
                        {
                            "key": source.key.replace(".", "_"),
                            "label": source.label,
                            "tool": "narrative",
                            "data_block": {"source": source.key},
                        }
                        for source in DATA_SOURCES
                    ],
                }
            ],
        }
        everything = await _template(
            dept.db,
            dept.org,
            name="Everything",
            definition=definition,
            member_class="operational",
        )
        detail = await _draft(
            await make_client(dept.manager), dept, template_id=everything.id
        )
        assert sorted(detail["data"]) == sorted(s.key for s in DATA_SOURCES)
        for key, entry in detail["data"].items():
            assert entry["available"] or entry["note"], key
        # With nothing recorded, the counts are honest zeros and the rates are
        # unavailable rather than 0% or 100%.
        assert detail["data"]["shifts.hours"] == {
            "available": True,
            "value": 0.0,
            "external_hours": 0.0,
        }
        assert detail["data"]["skills.tests_passed"]["value"] == 0
        assert detail["data"]["training.session_attendance_pct"]["available"] is False
        assert detail["data"]["calls.response_pct"]["available"] is False


class TestDraftingDefaults:
    async def _supervise(self, dept: _Dept, supervisor: User) -> None:
        from app.models.member_supervisor import MemberSupervisorAssignment

        dept.db.add(
            MemberSupervisorAssignment(
                organization_id=dept.org,
                member_id=dept.member.id,
                supervisor_id=supervisor.id,
                starts_on=date(2024, 1, 1),
            )
        )
        await dept.db.flush()

    async def _draft_unassigned(self, dept: _Dept, client: AsyncClient) -> dict:
        response = await client.post(
            "/evaluations",
            json={"member_id": dept.member.id, "period_id": dept.period.id},
        )
        assert response.status_code == 201, response.text
        return response.json()

    async def test_a_managers_draft_goes_to_the_members_supervisor(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await self._supervise(dept, dept.evaluator)
        detail = await self._draft_unassigned(dept, await make_client(dept.manager))
        assert detail["evaluator"]["id"] == dept.evaluator.id

    async def test_a_supervisor_who_cannot_evaluate_leaves_it_with_the_manager(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await self._supervise(dept, dept.reader)
        detail = await self._draft_unassigned(dept, await make_client(dept.manager))
        assert detail["evaluator"]["id"] == dept.manager.id

    async def test_a_conductors_draft_stays_their_own(
        self, dept: _Dept, make_client: ClientFactory
    ):
        conductor = await _user(dept.db, dept.org, ["evaluations.conduct"])
        await self._supervise(dept, dept.evaluator)
        detail = await self._draft_unassigned(dept, await make_client(conductor))
        assert detail["evaluator"]["id"] == conductor.id

    async def test_draft_options_list_members_open_periods_and_evaluators(
        self, dept: _Dept, make_client: ClientFactory
    ):
        await _period(dept.db, dept.org, closed=True)
        response = await (await make_client(dept.evaluator)).get(
            "/evaluations/draft-options"
        )
        assert response.status_code == 200
        body = response.json()
        member_ids = {m["id"] for m in body["members"]}
        assert {dept.member.id, dept.evaluator.id, dept.manager.id} <= member_ids
        assert {e["id"] for e in body["evaluators"]} == {
            dept.manager.id,
            dept.evaluator.id,
        }
        assert [p["id"] for p in body["periods"]] == [dept.period.id]

        member = await make_client(dept.member)
        assert (await member.get("/evaluations/draft-options")).status_code == 403


WITH_APPROVAL_STEPS = [
    _step("self_evaluation", "self_evaluation", "member", 14),
    _step("evaluator", "evaluator", "evaluator", 30),
    {
        "key": "chief_approval",
        "type": "approval",
        "label": "Chief approval",
        "actor": {"kind": "position", "position_id": "__POSITION__"},
        "due_days": 40,
    },
    _step("member_acknowledgement", "member_acknowledgement", "member", 58),
]


class TestSigning:
    async def _released(
        self, dept: _Dept, make_client: ClientFactory, **extra
    ) -> tuple[str, AsyncClient, AsyncClient]:
        """An annual evaluation whose evaluator has locked, waiting on the
        next signature."""
        detail = await _draft(await make_client(dept.manager), dept, **extra)
        member = await make_client(dept.member)
        evaluator = await make_client(dept.evaluator)
        url = f"/evaluations/{detail['id']}"
        await member.put(f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS})
        await member.post(f"{url}/parts/self_evaluation/submit")
        await evaluator.put(
            f"{url}/parts/evaluator", json={"content": EVALUATOR_ANSWERS}
        )
        response = await evaluator.post(f"{url}/parts/evaluator/submit")
        assert response.status_code == 200, response.text
        return url, member, evaluator

    @staticmethod
    def _signature(name: str, disposition: str = "acknowledged", **extra) -> dict:
        return {
            "signed_name": name,
            "disposition": disposition,
            "intent_confirmed": True,
            **extra,
        }

    async def test_the_members_acknowledgement_finalizes_and_freezes_the_pdf(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, _ = await self._released(dept, make_client)
        offered = (await member.get(url)).json()["viewer"]["can_sign"]
        assert offered == {
            "step_key": "member_acknowledgement",
            "label": "Member_Acknowledgement",
            "dispositions": ["acknowledged", "refused"],
        }

        response = await member.post(
            f"{url}/sign",
            json=self._signature(f"  eval   {dept.member.last_name.upper()} "),
            headers={"user-agent": "pytest-signing"},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["outcome"] == "finalized"
        assert body["evaluation"]["status"] == "finalized"
        assert body["evaluation"]["document_available"] is True
        assert [
            (s["step_key"], s["disposition"]) for s in body["evaluation"]["signatures"]
        ] == [("member_acknowledgement", "acknowledged")]

        from app.models.evaluation import EvaluationDocument, EvaluationSignature

        signature = (
            await dept.db.execute(
                select(EvaluationSignature).where(
                    EvaluationSignature.evaluation_id == body["evaluation"]["id"]
                )
            )
        ).scalar_one()
        assert signature.user_agent == "pytest-signing"
        assert signature.intent_confirmed is True
        assert len(signature.content_hash) == 64
        document = (
            await dept.db.execute(
                select(EvaluationDocument).where(
                    EvaluationDocument.evaluation_id == body["evaluation"]["id"]
                )
            )
        ).scalar_one()
        assert document.content_hash == signature.content_hash

        download = await member.get(f"{url}/document")
        assert download.status_code == 200
        assert download.headers["content-type"] == "application/pdf"
        assert download.content.startswith(b"%PDF")
        import hashlib

        assert hashlib.sha256(download.content).hexdigest() == document.file_sha256
        # Served as the same file on every request, not rebuilt.
        again = await (await make_client(dept.evaluator)).get(f"{url}/document")
        assert again.content == download.content

    async def test_the_typed_name_must_be_the_signers_own(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, _ = await self._released(dept, make_client)
        response = await member.post(
            f"{url}/sign", json=self._signature("Someone Else")
        )
        assert response.status_code == 400
        assert (
            "Type your name as it appears on your account" in response.json()["detail"]
        )

    async def test_a_refusal_needs_a_reason_and_still_finalizes(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, _ = await self._released(dept, make_client)
        name = dept.member.full_name
        missing = await member.post(
            f"{url}/sign", json=self._signature(name, "refused")
        )
        assert missing.status_code == 422
        refused = await member.post(
            f"{url}/sign",
            json=self._signature(
                name, "refused", comment="I dispute the training rating."
            ),
        )
        assert refused.status_code == 200
        assert refused.json()["outcome"] == "finalized"
        assert refused.json()["evaluation"]["signatures"][0]["comment"] == (
            "I dispute the training rating."
        )

    async def test_only_the_person_the_step_waits_on_may_sign_it(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, evaluator = await self._released(dept, make_client)
        assert (await evaluator.get(url)).json()["viewer"]["can_sign"] is None
        response = await evaluator.post(
            f"{url}/sign", json=self._signature(dept.evaluator.full_name)
        )
        assert response.status_code == 403
        approving = await member.post(
            f"{url}/sign", json=self._signature(dept.member.full_name, "signed")
        )
        assert approving.status_code == 400
        stranger = await _user(dept.db, dept.org, [])
        outside = await (await make_client(stranger)).post(
            f"{url}/sign", json=self._signature(stranger.full_name)
        )
        assert outside.status_code == 404

    async def test_a_step_is_signed_once(self, dept: _Dept, make_client: ClientFactory):
        url, member, _ = await self._released(dept, make_client)
        signature = self._signature(dept.member.full_name)
        assert (await member.post(f"{url}/sign", json=signature)).status_code == 200
        second = await member.post(f"{url}/sign", json=signature)
        assert second.status_code == 403

    async def test_an_approver_signs_before_the_member_is_asked(
        self, dept: _Dept, make_client: ClientFactory
    ):
        chief = await _user(dept.db, dept.org, [], position_name="Chief of Department")
        position_id = chief.positions[0].id
        steps = json.loads(
            json.dumps(WITH_APPROVAL_STEPS).replace("__POSITION__", position_id)
        )
        approved = await _template(
            dept.db,
            dept.org,
            name="With approval",
            workflow={"steps": steps},
            member_class="operational",
        )
        url, member, _ = await self._released(
            dept, make_client, template_id=approved.id
        )
        assert (await member.get(url)).json()["viewer"]["can_sign"] is None

        chief_client = await make_client(chief)
        offered = (await chief_client.get(url)).json()["viewer"]["can_sign"]
        assert offered["step_key"] == "chief_approval"
        assert offered["dispositions"] == ["signed"]
        signed = await chief_client.post(
            f"{url}/sign", json=self._signature(chief.full_name, "signed")
        )
        assert signed.json()["outcome"] == "signed"
        assert (await member.get(url)).json()["viewer"]["can_sign"]["step_key"] == (
            "member_acknowledgement"
        )

    # conftest treats step-up as satisfied unless a test asks for the real
    # check, which is what this one is about.
    @pytest.mark.real_stepup
    async def test_signing_requires_a_recent_re_verification(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, _, _ = await self._released(dept, make_client)
        unverified = await make_client(dept.member)
        response = await unverified.post(
            f"{url}/sign", json=self._signature(dept.member.full_name)
        )
        assert response.status_code == 403
        assert response.headers.get("x-stepup-required") == "true"

    async def test_a_check_in_gets_its_pdf_when_the_evaluator_locks(
        self, dept: _Dept, make_client: ClientFactory
    ):
        interim = await _template(
            dept.db, dept.org, name="Check-in", kind="interim", workflow=INTERIM
        )
        detail = await _draft(
            await make_client(dept.manager),
            dept,
            kind="interim",
            template_id=interim.id,
        )
        url = f"/evaluations/{detail['id']}"
        member = await make_client(dept.member)
        evaluator = await make_client(dept.evaluator)
        await member.put(f"{url}/parts/self_evaluation", json={"content": SELF_ANSWERS})
        await member.post(f"{url}/parts/self_evaluation/submit")
        await evaluator.put(
            f"{url}/parts/evaluator", json={"content": EVALUATOR_ANSWERS}
        )
        await evaluator.post(f"{url}/parts/evaluator/submit")
        download = await member.get(f"{url}/document")
        assert download.status_code == 200
        assert download.content.startswith(b"%PDF")

    async def test_no_pdf_before_finalization(
        self, dept: _Dept, make_client: ClientFactory
    ):
        url, member, _ = await self._released(dept, make_client)
        assert (await member.get(f"{url}/document")).status_code == 404


class TestContentHash:
    def test_it_changes_with_the_record_and_ignores_drafts(self):
        from types import SimpleNamespace

        from app.services.evaluation_service import content_hash

        evaluation = SimpleNamespace(
            id="e1",
            revision=1,
            template_version_id="v1",
            member_id="m1",
            evaluator_id="x1",
            period_start=date(2025, 1, 1),
            period_end=date(2025, 12, 31),
            coverage_start=date(2025, 1, 1),
            coverage_end=date(2025, 12, 31),
            excluded_ranges=[],
            data_snapshot={
                "values": {"training.hours": {"available": True, "value": 3}}
            },
        )
        submitted = SimpleNamespace(
            status="submitted",
            content={"answers": {"t": {"rating": 2}}},
            submitted_at=None,
        )
        base = content_hash(evaluation, {"evaluator": submitted})
        draft = SimpleNamespace(
            status="draft", content={"answers": {}}, submitted_at=None
        )
        assert (
            content_hash(evaluation, {"evaluator": submitted, "self_evaluation": draft})
            == base
        )
        changed = SimpleNamespace(
            status="submitted",
            content={"answers": {"t": {"rating": 3}}},
            submitted_at=None,
        )
        assert content_hash(evaluation, {"evaluator": changed}) != base
        evaluation.data_snapshot = {
            "values": {"training.hours": {"available": True, "value": 4}}
        }
        assert content_hash(evaluation, {"evaluator": submitted}) != base
