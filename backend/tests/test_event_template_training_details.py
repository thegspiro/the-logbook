"""Training event templates store the session's training details.

Owner decision 2026-11-20: a Training template saves the course (a library
course, a one-off name and code, or none), the training type, credit hours and
their source, the lead instructor and the certification settings, and picking
it fills Training Info. ``event_templates.training_details`` holds them in one
canonical shape settled at the write (pitfall #20).

The schema half needs no database. The HTTP half drives the real endpoints
against the real schema with a ``get_db`` that commits on success and rolls
back on an exception, as ``DatabaseManager.get_session`` does.
"""

import uuid
from collections.abc import AsyncGenerator
from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import events as endpoints
from app.core.database import get_db
from app.models.event import EventTemplate
from app.models.user import User
from app.schemas.event import EventTemplateTrainingDetails

COURSE = str(uuid.uuid4())


def _settle(**fields: Any) -> dict:
    return EventTemplateTrainingDetails.model_validate(fields).model_dump(mode="json")


@pytest.mark.unit
class TestTheStoredShapeIsSettledAtTheWrite:
    def test_a_library_course_drops_any_one_off_name_and_code(self) -> None:
        out = _settle(
            course_mode="library",
            course_id=COURSE,
            course_name="Stale",
            course_code="S-1",
        )
        assert out["course_id"] == COURSE
        assert out["course_name"] is None
        assert out["course_code"] is None

    def test_a_one_off_course_with_a_library_id_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="not both"):
            _settle(course_mode="oneoff", course_id=COURSE, course_name="Ropes")

    def test_a_one_off_course_needs_a_name(self) -> None:
        with pytest.raises(ValidationError, match="Name the one-off course"):
            _settle(course_mode="oneoff", course_name="   ")

    def test_a_library_course_needs_its_id(self) -> None:
        with pytest.raises(ValidationError, match="Course Library"):
            _settle(course_mode="library")

    def test_no_course_clears_every_course_field(self) -> None:
        out = _settle(course_mode="none", course_id=COURSE, course_name="Ropes")
        assert (out["course_id"], out["course_name"], out["course_code"]) == (
            None,
            None,
            None,
        )

    def test_without_certification_its_settings_are_cleared(self) -> None:
        out = _settle(
            issues_certification=False,
            certification_number_prefix="EMT-",
            issuing_agency="State",
            expiration_months=24,
        )
        assert out["certification_number_prefix"] is None
        assert out["issuing_agency"] is None
        assert out["expiration_months"] is None

    def test_certification_settings_are_kept_while_it_is_issued(self) -> None:
        out = _settle(
            issues_certification=True,
            certification_number_prefix=" EMT- ",
            issuing_agency="State",
            expiration_months=24,
        )
        assert out["certification_number_prefix"] == "EMT-"
        assert out["expiration_months"] == 24

    def test_hours_that_follow_the_event_store_no_figure(self) -> None:
        out = _settle(credit_hours=4, credit_hours_source="duration")
        assert out["credit_hours"] is None

    def test_course_hours_keep_the_figure_saved_with_them(self) -> None:
        out = _settle(
            course_mode="library",
            course_id=COURSE,
            credit_hours=3.5,
            credit_hours_source="course",
        )
        assert (out["credit_hours_source"], out["credit_hours"]) == ("course", 3.5)

    def test_course_hours_without_a_library_course_follow_the_event(self) -> None:
        out = _settle(
            course_mode="oneoff",
            course_name="Ropes",
            credit_hours=3,
            credit_hours_source="course",
        )
        assert (out["credit_hours_source"], out["credit_hours"]) == ("duration", None)

    def test_course_hours_with_no_figure_follow_the_event(self) -> None:
        out = _settle(
            course_mode="library", course_id=COURSE, credit_hours_source="course"
        )
        assert out["credit_hours_source"] == "duration"

    def test_manual_hours_need_a_figure(self) -> None:
        with pytest.raises(ValidationError, match="Enter the credit hours"):
            _settle(credit_hours_source="manual")

    def test_a_field_the_template_does_not_carry_is_refused(self) -> None:
        with pytest.raises(ValidationError):
            _settle(requirement_id=COURSE)

    def test_an_unknown_training_type_is_refused(self) -> None:
        with pytest.raises(ValidationError, match="training_type"):
            _settle(training_type="juggling")

    def test_an_empty_object_is_the_complete_default_shape(self) -> None:
        assert _settle() == {
            "course_mode": "none",
            "course_id": None,
            "course_name": None,
            "course_code": None,
            "training_type": "continuing_education",
            "credit_hours": None,
            "credit_hours_source": "duration",
            "instructor_id": None,
            "instructor": None,
            "issues_certification": False,
            "certification_number_prefix": None,
            "issuing_agency": None,
            "expiration_months": None,
        }


class _Bench:
    def __init__(self, db: AsyncSession, client: AsyncClient, user: User, org_id: str):
        self.db = db
        self.client = client
        self.user = user
        self.org_id = org_id

    async def _reset(self) -> None:
        """A commit or rollback expires the caller; reload it."""
        self.db.expire_all()
        await self.db.refresh(self.user)
        await self.db.refresh(self.user, ["positions"])

    async def org(self, label: str) -> str:
        org_id = str(uuid.uuid4())
        await self.db.execute(
            text(
                "INSERT INTO organizations (id, name, organization_type, slug, "
                "timezone) VALUES (:id, :n, 'fire_department', :slug, 'UTC')"
            ),
            {"id": org_id, "n": label, "slug": f"tt-{org_id[:8]}"},
        )
        await self.db.commit()
        await self._reset()
        return org_id

    async def member(self, org_id: str, status: str = "active") -> str:
        user_id = str(uuid.uuid4())
        await self.db.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES (:id, :org, :un, "
                "'Pat', 'Instructor', :em, 'hashed', :st)"
            ),
            {
                "id": user_id,
                "org": org_id,
                "un": f"tt-{user_id[:8]}",
                "em": f"tt-{user_id[:8]}@test.example",
                "st": status,
            },
        )
        await self.db.commit()
        await self._reset()
        return user_id

    async def course(self, org_id: str, active: bool = True) -> str:
        course_id = str(uuid.uuid4())
        await self.db.execute(
            text(
                "INSERT INTO training_courses (id, organization_id, name, "
                "training_type, active) VALUES (:id, :org, 'Ladders', "
                "'continuing_education', :a)"
            ),
            {"id": course_id, "org": org_id, "a": active},
        )
        await self.db.commit()
        await self._reset()
        return course_id

    async def stored(self, template_id: str) -> Any:
        await self._reset()
        row = await self.db.get(EventTemplate, template_id)
        assert row is not None
        await self.db.refresh(row)
        return row.training_details

    async def create(self, **body: Any):
        response = await self.client.post(
            "/events/templates", json={"name": "Drill", **body}
        )
        await self._reset()
        return response

    async def patch(self, template_id: str, body: dict):
        response = await self.client.patch(
            f"/events/templates/{template_id}", json=body
        )
        await self._reset()
        return response


@pytest.fixture
async def bench(db_session: AsyncSession) -> AsyncGenerator[_Bench]:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Template Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"tt-bench-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Bench', 'Officer', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"tt-bench-{user_id[:8]}",
            "em": f"tt-bench-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Events Officer', 'events_officer', "
            '\'["events.manage", "events.view"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    # Committed, so a refused request's rollback cannot take the caller away.
    await db_session.commit()
    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])

    async def get_session_like() -> AsyncGenerator[AsyncSession]:
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app = FastAPI()
    app.include_router(endpoints.router, prefix="/events")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = get_session_like
    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        yield _Bench(db_session, client, user, org_id)


@pytest.mark.integration
class TestTrainingTemplatesOverHttp:
    async def test_a_training_template_saves_the_canonical_shape(
        self, bench: _Bench
    ) -> None:
        course_id = await bench.course(bench.org_id)
        instructor_id = await bench.member(bench.org_id)
        response = await bench.create(
            event_type="training",
            training_details={
                "course_mode": "library",
                "course_id": course_id,
                "training_type": "skills_practice",
                "credit_hours": 3,
                "credit_hours_source": "course",
                "instructor_id": instructor_id,
                "instructor": "Pat Instructor",
                "issues_certification": True,
                "certification_number_prefix": "LAD-",
                "issuing_agency": "State Fire Academy",
                "expiration_months": 24,
            },
        )
        assert response.status_code == 201, response.text
        body = response.json()
        expected = {
            "course_mode": "library",
            "course_id": course_id,
            "course_name": None,
            "course_code": None,
            "training_type": "skills_practice",
            "credit_hours": 3.0,
            "credit_hours_source": "course",
            "instructor_id": instructor_id,
            "instructor": "Pat Instructor",
            "issues_certification": True,
            "certification_number_prefix": "LAD-",
            "issuing_agency": "State Fire Academy",
            "expiration_months": 24,
        }
        assert body["training_details"] == expected
        assert await bench.stored(body["id"]) == expected

    async def test_a_deactivated_course_and_a_former_member_still_save(
        self, bench: _Bench
    ) -> None:
        course_id = await bench.course(bench.org_id, active=False)
        instructor_id = await bench.member(bench.org_id, status="retired")
        response = await bench.create(
            event_type="training",
            training_details={
                "course_mode": "library",
                "course_id": course_id,
                "instructor_id": instructor_id,
            },
        )
        assert response.status_code == 201, response.text

    async def test_another_departments_course_is_refused(self, bench: _Bench) -> None:
        other = await bench.org("Other FD")
        course_id = await bench.course(other)
        response = await bench.create(
            event_type="training",
            training_details={"course_mode": "library", "course_id": course_id},
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Training course not found"
        count = await bench.db.execute(
            text("SELECT COUNT(*) FROM event_templates WHERE organization_id = :o"),
            {"o": bench.org_id},
        )
        assert count.scalar() == 0

    async def test_another_departments_instructor_is_refused(
        self, bench: _Bench
    ) -> None:
        other = await bench.org("Other FD")
        instructor_id = await bench.member(other)
        response = await bench.create(
            event_type="training", training_details={"instructor_id": instructor_id}
        )
        assert response.status_code == 400, response.text
        assert response.json()["detail"] == "Invalid instructor"

    async def test_a_non_training_template_cannot_carry_them(
        self, bench: _Bench
    ) -> None:
        response = await bench.create(
            event_type="business_meeting", training_details={"course_mode": "none"}
        )
        assert response.status_code == 400, response.text
        assert "Training template" in response.json()["detail"]

    async def test_a_field_outside_the_owners_list_is_refused(
        self, bench: _Bench
    ) -> None:
        response = await bench.create(
            event_type="training",
            training_details={"requirement_id": str(uuid.uuid4())},
        )
        assert response.status_code == 422, response.text

    async def _training_template(self, bench: _Bench) -> str:
        response = await bench.create(
            event_type="training",
            training_details={
                "course_mode": "oneoff",
                "course_name": "Ropes",
                "credit_hours": 2,
                "credit_hours_source": "manual",
            },
        )
        assert response.status_code == 201, response.text
        return str(response.json()["id"])

    async def test_moving_a_template_off_training_clears_them(
        self, bench: _Bench
    ) -> None:
        template_id = await self._training_template(bench)
        response = await bench.patch(template_id, {"event_type": "business_meeting"})
        assert response.status_code == 200, response.text
        assert await bench.stored(template_id) is None

    async def test_moving_off_training_while_sending_them_is_refused(
        self, bench: _Bench
    ) -> None:
        template_id = await self._training_template(bench)
        response = await bench.patch(
            template_id, {"event_type": "business_meeting", "training_details": {}}
        )
        assert response.status_code == 400, response.text
        assert (await bench.stored(template_id))["course_name"] == "Ropes"

    async def test_an_explicit_null_clears_them(self, bench: _Bench) -> None:
        template_id = await self._training_template(bench)
        response = await bench.patch(template_id, {"training_details": None})
        assert response.status_code == 200, response.text
        assert await bench.stored(template_id) is None

    async def test_an_explicit_null_is_accepted_on_any_type(
        self, bench: _Bench
    ) -> None:
        response = await bench.create(event_type="business_meeting")
        assert response.status_code == 201, response.text
        response = await bench.patch(response.json()["id"], {"training_details": None})
        assert response.status_code == 200, response.text

    async def test_an_unrelated_patch_leaves_them_alone(self, bench: _Bench) -> None:
        template_id = await self._training_template(bench)
        before = await bench.stored(template_id)
        # The Event Templates list's deactivate button sends exactly this.
        response = await bench.patch(template_id, {"is_active": False})
        assert response.status_code == 200, response.text
        assert await bench.stored(template_id) == before

    async def test_a_partial_object_is_stored_complete(self, bench: _Bench) -> None:
        template_id = await self._training_template(bench)
        response = await bench.patch(
            template_id, {"training_details": {"training_type": "refresher"}}
        )
        assert response.status_code == 200, response.text
        stored = await bench.stored(template_id)
        assert stored == {
            "course_mode": "none",
            "course_id": None,
            "course_name": None,
            "course_code": None,
            "training_type": "refresher",
            "credit_hours": None,
            "credit_hours_source": "duration",
            "instructor_id": None,
            "instructor": None,
            "issues_certification": False,
            "certification_number_prefix": None,
            "issuing_agency": None,
            "expiration_months": None,
        }

    async def test_an_existing_template_reads_back_none(self, bench: _Bench) -> None:
        response = await bench.create(event_type="training")
        assert response.status_code == 201, response.text
        assert response.json()["training_details"] is None
