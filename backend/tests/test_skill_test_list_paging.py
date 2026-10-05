"""Paging and bounding for the skills-testing lists and export (SKT3-2).

``GET /tests`` returned an organization's entire skill-test history on every
unfiltered load, ``GET /tests/export/csv`` built a file of the same unbounded
set in memory, and ``GET /templates`` had no cap. These drive the routes through
a real app so the Query constraints (the caps) are exercised along with the
handlers, and read the rows back from MySQL so ordering and org scoping are the
database's answer rather than a mock's.
"""

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints import skills_testing as endpoint
from app.models.skills_testing import SkillTemplate, SkillTest
from app.models.user import Position, User, user_positions

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


SECTIONS = [{"name": "Donning", "criteria": [{"label": "Mask seal"}]}]


async def _make_org(db: AsyncSession) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    return org_id


async def _make_user(
    db: AsyncSession, org_id: str, first: str, last: str, officer: bool = False
) -> User:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, :ln, :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"u-{user_id[:8]}",
            "fn": first,
            "ln": last,
            "em": f"u-{user_id[:8]}@test.example",
        },
    )
    if officer:
        position = Position(
            organization_id=org_id,
            name="Training Officer",
            slug=f"training-officer-{user_id[:8]}",
            permissions=["training.manage"],
        )
        db.add(position)
        await db.flush()
        await db.execute(
            insert(user_positions).values(user_id=user_id, position_id=position.id)
        )
    await db.flush()
    # Positions loaded eagerly: the permission check reads them, and a lazy
    # load inside the async handler would raise.
    return (
        await db.execute(
            select(User).options(selectinload(User.positions)).where(User.id == user_id)
        )
    ).scalar_one()


@pytest.fixture
async def dept(db_session: AsyncSession):
    """One org with five official tests a day apart, and a second org's test."""
    org_id = await _make_org(db_session)
    officer = await _make_user(db_session, org_id, "Olive", "Officer", officer=True)
    member = await _make_user(db_session, org_id, "Mary", "Member")
    bystander = await _make_user(db_session, org_id, "Bob", "Bystander")

    scba = SkillTemplate(
        organization_id=org_id,
        name="SCBA Donning",
        sections=SECTIONS,
        status="published",
    )
    ladder = SkillTemplate(
        organization_id=org_id,
        name="Ladder Raise",
        sections=SECTIONS,
        status="published",
    )
    db_session.add_all([scba, ladder])
    await db_session.flush()

    now = datetime.now(timezone.utc).replace(microsecond=0)
    tests = []
    for i in range(5):
        stamp = now - timedelta(days=i)
        tests.append(
            SkillTest(
                organization_id=org_id,
                template_id=(scba if i % 2 == 0 else ladder).id,
                # Mary is the candidate on three of the five.
                candidate_id=(member if i < 3 else bystander).id,
                examiner_id=officer.id,
                status="completed",
                result="pass",
                started_at=stamp,
                completed_at=stamp,
                created_at=stamp,
                validated_at=stamp,
            )
        )
    db_session.add_all(tests)

    other_org = await _make_org(db_session)
    outsider = await _make_user(db_session, other_org, "Olive", "Outsider")
    foreign_tmpl = SkillTemplate(
        organization_id=other_org,
        name="SCBA Donning",
        sections=SECTIONS,
        status="published",
    )
    db_session.add(foreign_tmpl)
    await db_session.flush()
    foreign = SkillTest(
        organization_id=other_org,
        template_id=foreign_tmpl.id,
        candidate_id=outsider.id,
        examiner_id=outsider.id,
        status="completed",
        result="pass",
        completed_at=now,
        created_at=now,
    )
    db_session.add(foreign)
    await db_session.flush()

    return {
        "org_id": org_id,
        "officer": officer,
        "member": member,
        "tests": tests,  # newest first
        "foreign": foreign,
        "scba": scba,
        "ladder": ladder,
    }


def _client(db_session, viewer):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    app = FastAPI()
    app.include_router(endpoint.router, prefix="/skills-testing")
    app.dependency_overrides[get_current_user] = lambda: viewer
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestListPaging:
    async def test_officer_pages_with_a_total_and_a_stable_order(
        self, db_session, dept
    ):
        expected = [t.id for t in dept["tests"]]
        async with _client(db_session, dept["officer"]) as client:
            first = await client.get(
                "/skills-testing/tests", params={"limit": 2, "offset": 0}
            )
            second = await client.get(
                "/skills-testing/tests", params={"limit": 2, "offset": 2}
            )
            third = await client.get(
                "/skills-testing/tests", params={"limit": 2, "offset": 4}
            )

        assert first.status_code == 200
        bodies = [first.json(), second.json(), third.json()]
        # The second org's test is never counted, on any page.
        assert {b["total"] for b in bodies} == {5}
        assert [len(b["items"]) for b in bodies] == [2, 2, 1]
        # Newest first, and every row exactly once across the pages.
        paged = [item["id"] for b in bodies for item in b["items"]]
        assert paged == expected
        assert dept["foreign"].id not in paged

    async def test_default_page_is_bounded(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            body = (await client.get("/skills-testing/tests")).json()
        assert body["total"] == 5
        assert len(body["items"]) == 5
        assert endpoint.TEST_LIST_DEFAULT_LIMIT <= endpoint.TEST_LIST_MAX_LIMIT

    async def test_limit_above_the_cap_is_refused(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            over = await client.get(
                "/skills-testing/tests",
                params={"limit": endpoint.TEST_LIST_MAX_LIMIT + 1},
            )
            negative = await client.get("/skills-testing/tests", params={"offset": -1})
        assert over.status_code == 422
        assert negative.status_code == 422

    async def test_non_officer_total_counts_only_their_own_rows(self, db_session, dept):
        """The disclosure pass runs before paging, so the total is what they see."""
        member_ids = [t.id for t in dept["tests"][:3]]
        async with _client(db_session, dept["member"]) as client:
            first = (
                await client.get("/skills-testing/tests", params={"limit": 2})
            ).json()
            rest = (
                await client.get(
                    "/skills-testing/tests", params={"limit": 2, "offset": 2}
                )
            ).json()

        assert first["total"] == 3
        assert rest["total"] == 3
        assert [i["id"] for i in first["items"] + rest["items"]] == member_ids

    async def test_search_matches_template_and_people_server_side(
        self, db_session, dept
    ):
        tests = dept["tests"]
        async with _client(db_session, dept["officer"]) as client:
            by_template = (
                await client.get("/skills-testing/tests", params={"search": "ladder"})
            ).json()
            by_candidate = (
                await client.get(
                    "/skills-testing/tests", params={"search": "Mary Member"}
                )
            ).json()
            # A wildcard is a literal, not "everything".
            wildcard = (
                await client.get("/skills-testing/tests", params={"search": "%"})
            ).json()

        assert {i["id"] for i in by_template["items"]} == {tests[1].id, tests[3].id}
        assert by_template["total"] == 2
        assert {i["id"] for i in by_candidate["items"]} == {t.id for t in tests[:3]}
        # The other org has a template and a user named alike; neither leaks.
        assert dept["foreign"].id not in {i["id"] for i in by_candidate["items"]}
        assert wildcard["total"] == 0

    async def test_date_window_filters_the_list(self, db_session, dept):
        tests = dept["tests"]
        newest = tests[0].completed_at.date()
        async with _client(db_session, dept["officer"]) as client:
            body = (
                await client.get(
                    "/skills-testing/tests",
                    params={
                        "date_from": (newest - timedelta(days=1)).isoformat(),
                        "date_to": newest.isoformat(),
                    },
                )
            ).json()
            backwards = await client.get(
                "/skills-testing/tests",
                params={
                    "date_from": newest.isoformat(),
                    "date_to": (newest - timedelta(days=1)).isoformat(),
                },
            )

        assert {i["id"] for i in body["items"]} == {tests[0].id, tests[1].id}
        assert backwards.status_code == 400

    async def test_an_unfinished_test_is_dated_by_when_it_was_opened(
        self, db_session, dept
    ):
        """No completion date must not mean "outside every window"."""
        opened = datetime.now(timezone.utc).replace(microsecond=0)
        draft = SkillTest(
            organization_id=dept["org_id"],
            template_id=dept["scba"].id,
            candidate_id=dept["member"].id,
            examiner_id=dept["officer"].id,
            status="in_progress",
            result="incomplete",
            created_at=opened,
        )
        db_session.add(draft)
        await db_session.flush()

        async with _client(db_session, dept["officer"]) as client:
            body = (
                await client.get(
                    "/skills-testing/tests",
                    params={
                        "status": "in_progress",
                        "date_from": opened.date().isoformat(),
                        "date_to": opened.date().isoformat(),
                    },
                )
            ).json()
        assert [i["id"] for i in body["items"]] == [draft.id]


class TestExportRequiresAWindow:
    async def test_export_without_dates_is_refused(self, db_session, dept):
        today = date.today()
        async with _client(db_session, dept["officer"]) as client:
            neither = await client.get("/skills-testing/tests/export/csv")
            one_end = await client.get(
                "/skills-testing/tests/export/csv",
                params={"date_from": today.isoformat()},
            )
        assert neither.status_code == 400
        assert "date range" in neither.json()["detail"]
        assert one_end.status_code == 400

    async def test_export_span_is_capped(self, db_session, dept):
        today = date.today()
        async with _client(db_session, dept["officer"]) as client:
            too_long = await client.get(
                "/skills-testing/tests/export/csv",
                params={
                    "date_from": (
                        today - timedelta(days=endpoint.EXPORT_MAX_SPAN_DAYS + 1)
                    ).isoformat(),
                    "date_to": today.isoformat(),
                },
            )
            at_cap = await client.get(
                "/skills-testing/tests/export/csv",
                params={
                    "date_from": (
                        today - timedelta(days=endpoint.EXPORT_MAX_SPAN_DAYS)
                    ).isoformat(),
                    "date_to": today.isoformat(),
                },
            )
        assert too_long.status_code == 400
        assert at_cap.status_code == 200

    async def test_export_covers_only_the_window(self, db_session, dept):
        tests = dept["tests"]
        newest = tests[0].completed_at.date()
        async with _client(db_session, dept["officer"]) as client:
            response = await client.get(
                "/skills-testing/tests/export/csv",
                params={
                    "date_from": (newest - timedelta(days=1)).isoformat(),
                    "date_to": newest.isoformat(),
                },
            )
        assert response.status_code == 200
        ids = {line.split(",")[0] for line in response.text.splitlines()[1:]}
        assert ids == {tests[0].id, tests[1].id}


class TestTemplateListBound:
    async def test_templates_page_and_stay_org_scoped(self, db_session, dept):
        async with _client(db_session, dept["officer"]) as client:
            first = await client.get("/skills-testing/templates", params={"limit": 1})
            second = await client.get(
                "/skills-testing/templates", params={"limit": 1, "offset": 1}
            )
            over = await client.get(
                "/skills-testing/templates",
                params={"limit": endpoint.TEMPLATE_LIST_MAX_LIMIT + 1},
            )
        # Ordered by name: Ladder Raise, then SCBA Donning — never the other
        # org's identically named template.
        assert [t["id"] for t in first.json()] == [dept["ladder"].id]
        assert [t["id"] for t in second.json()] == [dept["scba"].id]
        assert over.status_code == 422

    async def test_member_paging_skips_officer_only_templates(self, db_session, dept):
        """Visibility is filtered before the limit, so a page is never short."""
        hidden = SkillTemplate(
            organization_id=dept["org_id"],
            name="Aardvark officer drill",
            sections=SECTIONS,
            status="published",
            visibility="officers_only",
        )
        db_session.add(hidden)
        await db_session.flush()

        async with _client(db_session, dept["member"]) as client:
            first = (
                await client.get("/skills-testing/templates", params={"limit": 1})
            ).json()
        assert [t["id"] for t in first] == [dept["ladder"].id]
