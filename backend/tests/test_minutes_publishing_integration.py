"""Publishing minutes to the library and the public page, over HTTP against the
real schema.

What matters, in order: nothing reaches the public unless the department said
so; executive-session minutes need every switch the department set for them;
the public copy never carries what the printed copy does; the page obeys the
settings at read time, so turning posting off or withdrawing a copy takes it
down at once; and republishing says what it replaced.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.public import minutes as public_minutes
from app.core.database import get_db
from app.models.document import Document, DocumentFolder, FolderVisibility
from app.models.user import Organization
from tests.minutes_support import (
    MANAGE,
    _approve,
    _client,
    _create,
    _org,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

PUBLIC_ON = {"public_posting": True}
ALL_EXECUTIVE = {
    "public_posting": True,
    "executive_library_publishing": True,
    "executive_public_posting": True,
}


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    """Two organizations, for the tenancy tests."""
    return await build_world(db_session)


@pytest.fixture
async def one_org(db_session: AsyncSession) -> _World:
    """Exactly one organization, which is what the public page answers on."""
    w = _World()
    w.db = db_session
    w.org_id = await _org(db_session, "solo")
    w.other_org_id = ""
    w.secretary = await _user(db_session, w.org_id, "Secretary", MANAGE)
    w.approver = await _user(db_session, w.org_id, "Approver", MANAGE)
    w.member = await _user(db_session, w.org_id, "Member", ["minutes.view"])
    w.assignee = w.member
    w.outsider = w.member
    return w


def _public_client(db: AsyncSession) -> AsyncClient:
    app = FastAPI()
    app.include_router(public_minutes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[public_minutes._rate_limit_minutes] = lambda: None
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _settings(w: _World, minutes_settings: dict[str, Any]) -> None:
    org = await w.db.get(Organization, w.org_id)
    assert org is not None
    org.settings = {**(org.settings or {}), "minutes": minutes_settings}
    await w.db.flush()


async def _adopted(w: _World, **extra: Any) -> str:
    minutes = await _create(w, **extra)
    await _approve(w, minutes["id"])
    return minutes["id"]


async def _publish(w: _World, minutes_id: str):
    async with _client(w.db, w.secretary) as c:
        return await c.post(f"/minutes/{minutes_id}/publish")


async def _reopen_and_readopt(w: _World, minutes_id: str) -> None:
    async with _client(w.db, w.approver) as c:
        resp = await c.post(
            f"/minutes/{minutes_id}/reopen", json={"reason": "A correction"}
        )
    assert resp.status_code == 200, resp.text
    await _approve(w, minutes_id)


async def _public_list(w: _World) -> list[dict[str, Any]]:
    async with _public_client(w.db) as c:
        resp = await c.get("/public/v1/minutes")
    assert resp.status_code == 200, resp.text
    return resp.json()["minutes"]


class TestNothingIsPublicByDefault:
    async def test_publishing_with_default_settings_files_the_library_copy_only(
        self, one_org
    ):
        minutes_id = await _adopted(one_org)
        resp = await _publish(one_org, minutes_id)

        assert resp.status_code == 200, resp.text
        assert resp.json()["public_posted"] is False
        assert resp.json()["public_allowed"] is False
        assert await _public_list(one_org) == []

    @pytest.mark.parametrize(
        "bad_value", ["true", 1, "yes", [True], {"on": True}], ids=repr
    )
    async def test_a_malformed_setting_reads_as_off(self, one_org, bad_value):
        await _settings(one_org, {"public_posting": bad_value})
        minutes_id = await _adopted(one_org)
        resp = await _publish(one_org, minutes_id)

        assert resp.json()["public_posted"] is False
        assert await _public_list(one_org) == []


class TestPostingPublicly:
    async def test_a_published_set_appears_on_the_public_page(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        resp = await _publish(one_org, minutes_id)

        assert resp.json()["public_posted"] is True
        (item,) = await _public_list(one_org)
        assert item["title"] == "Monthly meeting"
        assert item["version"] == 1

        async with _public_client(one_org.db) as c:
            detail = await c.get(f"/public/v1/minutes/{item['id']}")
        assert detail.status_code == 200
        body = detail.json()
        assert body["organization_name"] == "solo"
        assert body["replaces"] is None
        assert body["content"]["approval"]["version"] == 1

    async def test_the_public_copy_leaves_out_what_the_printed_copy_carries(
        self, one_org
    ):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)

        (item,) = await _public_list(one_org)
        async with _public_client(one_org.db) as c:
            text = (await c.get(f"/public/v1/minutes/{item['id']}")).text

        # _create puts these on the roll; none is an officer with a title.
        assert "A visitor" not in text
        assert "Member" not in text
        counts = (await _public_detail(one_org, item["id"]))["content"]["attendance"]
        assert counts["guests"] == 1
        assert counts["excused"] == 1

    async def test_the_response_is_never_cached(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        await _publish(one_org, await _adopted(one_org))
        async with _public_client(one_org.db) as c:
            resp = await c.get("/public/v1/minutes")
        assert resp.headers["cache-control"] == "no-store"

    async def test_an_unadopted_set_cannot_be_published(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes = await _create(one_org)
        resp = await _publish(one_org, minutes["id"])

        assert resp.status_code == 400
        assert await _public_list(one_org) == []


async def _public_detail(w: _World, copy_id: str) -> dict[str, Any]:
    async with _public_client(w.db) as c:
        resp = await c.get(f"/public/v1/minutes/{copy_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestTheSettingsAreCheckedAtReadTime:
    async def test_switching_public_posting_off_takes_the_page_down(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        await _publish(one_org, await _adopted(one_org))
        (item,) = await _public_list(one_org)

        await _settings(one_org, {"public_posting": False})

        assert await _public_list(one_org) == []
        async with _public_client(one_org.db) as c:
            assert (await c.get(f"/public/v1/minutes/{item['id']}")).status_code == 404

    async def test_switching_it_back_on_restores_the_copy(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        await _publish(one_org, await _adopted(one_org))
        await _settings(one_org, {})
        assert await _public_list(one_org) == []
        await _settings(one_org, PUBLIC_ON)
        assert len(await _public_list(one_org)) == 1


class TestWithdrawing:
    async def test_withdrawing_stops_serving_it_and_keeps_the_library_copy(
        self, one_org
    ):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        published = (await _publish(one_org, minutes_id)).json()
        (item,) = await _public_list(one_org)

        async with _client(one_org.db, one_org.secretary) as c:
            resp = await c.delete(f"/minutes/{minutes_id}/public-posting")
        assert resp.status_code == 204, resp.text

        assert await _public_list(one_org) == []
        async with _public_client(one_org.db) as c:
            assert (await c.get(f"/public/v1/minutes/{item['id']}")).status_code == 404
        library = await one_org.db.get(Document, published["id"])
        assert library is not None

    async def test_publishing_again_after_a_withdrawal_posts_afresh(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)
        async with _client(one_org.db, one_org.secretary) as c:
            await c.delete(f"/minutes/{minutes_id}/public-posting")

        await _publish(one_org, minutes_id)

        (item,) = await _public_list(one_org)
        detail = await _public_detail(one_org, item["id"])
        assert detail["replaces"] is None

    async def test_withdrawing_nothing_is_a_404(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        async with _client(one_org.db, one_org.secretary) as c:
            resp = await c.delete(f"/minutes/{minutes_id}/public-posting")
        assert resp.status_code == 404

    async def test_a_member_cannot_withdraw_or_publish_or_read_status(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)
        async with _client(one_org.db, one_org.member) as c:
            assert (
                await c.delete(f"/minutes/{minutes_id}/public-posting")
            ).status_code == 403
            assert (await c.post(f"/minutes/{minutes_id}/publish")).status_code == 403
            assert (await c.get(f"/minutes/{minutes_id}/publishing")).status_code == 403


class TestRepublishing:
    async def test_the_library_copy_says_which_version_it_replaced(self, one_org):
        minutes_id = await _adopted(one_org)
        first = (await _publish(one_org, minutes_id)).json()
        assert "replaces version" not in first["content_html"]

        await _reopen_and_readopt(one_org, minutes_id)
        second = (await _publish(one_org, minutes_id)).json()

        assert second["id"] == first["id"]
        assert "This version replaces version 1" in second["content_html"]

    async def test_the_public_copy_is_replaced_in_place_with_a_note(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)
        (before,) = await _public_list(one_org)

        await _reopen_and_readopt(one_org, minutes_id)
        await _publish(one_org, minutes_id)

        (after,) = await _public_list(one_org)
        assert after["id"] == before["id"]
        assert after["version"] == 2
        assert after["under_correction"] is False
        detail = await _public_detail(one_org, after["id"])
        assert detail["replaces"]["version"] == 1
        assert detail["replaces"]["posted_on"]

    async def test_reopening_flags_the_standing_public_copy(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)

        async with _client(one_org.db, one_org.approver) as c:
            reopened = await c.post(
                f"/minutes/{minutes_id}/reopen", json={"reason": "Fix a typo here"}
            )
        assert reopened.status_code == 200, reopened.text

        (item,) = await _public_list(one_org)
        assert item["under_correction"] is True

    async def test_the_public_copy_is_a_snapshot_not_a_live_view(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)
        (item,) = await _public_list(one_org)
        before = (await _public_detail(one_org, item["id"]))["content"]

        async with _client(one_org.db, one_org.approver) as c:
            reopened = await c.post(
                f"/minutes/{minutes_id}/reopen", json={"reason": "Fix a typo here"}
            )
        assert reopened.status_code == 200, reopened.text
        async with _client(one_org.db, one_org.secretary) as c:
            await c.put(
                f"/minutes/{minutes_id}",
                json={"location": "Somewhere nobody approved"},
            )

        after = (await _public_detail(one_org, item["id"]))["content"]
        assert after == before
        assert "nobody approved" not in str(after)


class TestExecutiveSession:
    async def test_executive_minutes_cannot_be_published_by_default(self, one_org):
        minutes_id = await _adopted(one_org, meeting_type="executive")
        resp = await _publish(one_org, minutes_id)

        assert resp.status_code == 400
        assert "Executive" in resp.text

    async def test_the_public_switch_alone_does_not_open_executive_minutes(
        self, one_org
    ):
        await _settings(
            one_org, {"public_posting": True, "executive_public_posting": True}
        )
        minutes_id = await _adopted(one_org, meeting_type="executive")
        resp = await _publish(one_org, minutes_id)

        assert resp.status_code == 400
        assert await _public_list(one_org) == []

    async def test_with_the_library_switch_they_go_to_a_restricted_folder_only(
        self, one_org
    ):
        await _settings(one_org, {"executive_library_publishing": True})
        minutes_id = await _adopted(one_org, meeting_type="executive")
        resp = await _publish(one_org, minutes_id)

        assert resp.status_code == 200, resp.text
        assert resp.json()["public_posted"] is False
        folder = await one_org.db.get(DocumentFolder, resp.json()["folder_id"])
        assert folder is not None
        assert folder.visibility == FolderVisibility.LEADERSHIP
        assert await _public_list(one_org) == []

    async def test_public_posting_alone_still_keeps_executive_minutes_private(
        self, one_org
    ):
        await _settings(
            one_org,
            {"public_posting": True, "executive_library_publishing": True},
        )
        minutes_id = await _adopted(one_org, meeting_type="executive")
        resp = await _publish(one_org, minutes_id)

        assert resp.status_code == 200
        assert resp.json()["public_posted"] is False
        assert await _public_list(one_org) == []

    async def test_with_all_three_switches_they_are_posted_publicly(self, one_org):
        await _settings(one_org, ALL_EXECUTIVE)
        minutes_id = await _adopted(one_org, meeting_type="executive")
        resp = await _publish(one_org, minutes_id)

        assert resp.status_code == 200, resp.text
        assert resp.json()["public_posted"] is True
        assert len(await _public_list(one_org)) == 1

    async def test_withdrawing_one_switch_later_takes_an_executive_copy_down(
        self, one_org
    ):
        await _settings(one_org, ALL_EXECUTIVE)
        await _publish(one_org, await _adopted(one_org, meeting_type="executive"))
        assert len(await _public_list(one_org)) == 1

        await _settings(one_org, {**ALL_EXECUTIVE, "executive_public_posting": False})

        assert await _public_list(one_org) == []

    async def test_a_loosened_executive_folder_is_refused(self, one_org):
        await _settings(one_org, {"executive_library_publishing": True})
        first = await _adopted(one_org, meeting_type="executive")
        folder_id = (await _publish(one_org, first)).json()["folder_id"]
        folder = await one_org.db.get(DocumentFolder, folder_id)
        assert folder is not None
        folder.visibility = FolderVisibility.ORGANIZATION
        await one_org.db.flush()

        second = await _adopted(one_org, meeting_type="executive")
        resp = await _publish(one_org, second)

        assert resp.status_code == 400
        assert "restricted" in resp.text


class TestTenancyAndExposure:
    async def test_another_organizations_manager_cannot_read_status_or_withdraw(
        self, world
    ):
        minutes_id = await _adopted(world)
        async with _client(world.db, world.outsider) as c:
            status_resp = await c.get(f"/minutes/{minutes_id}/publishing")
            withdraw = await c.delete(f"/minutes/{minutes_id}/public-posting")
        assert status_resp.status_code == 404
        assert withdraw.status_code == 404

    async def test_with_two_organizations_the_public_page_answers_404(self, world):
        async with _public_client(world.db) as c:
            listing = await c.get("/public/v1/minutes")
        assert listing.status_code == 404

    async def test_an_unknown_copy_is_a_404(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        async with _public_client(one_org.db) as c:
            resp = await c.get(
                "/public/v1/minutes/00000000-0000-0000-0000-000000000000"
            )
            bad = await c.get("/public/v1/minutes/not-a-uuid")
        assert resp.status_code == 404
        assert bad.status_code == 422

    async def test_switching_the_minutes_module_off_hides_the_page(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        await _publish(one_org, await _adopted(one_org))
        org = await one_org.db.get(Organization, one_org.org_id)
        assert org is not None
        org.settings = {
            **(org.settings or {}),
            "modules": {"minutes": False, "_user_configured": True},
        }
        await one_org.db.flush()

        async with _public_client(one_org.db) as c:
            resp = await c.get("/public/v1/minutes")
        assert resp.status_code == 404


class TestStatusAndSettingsReport:
    async def test_status_reports_where_the_minutes_stand(self, one_org):
        await _settings(one_org, PUBLIC_ON)
        minutes_id = await _adopted(one_org)
        await _publish(one_org, minutes_id)

        async with _client(one_org.db, one_org.secretary) as c:
            status_resp = await c.get(f"/minutes/{minutes_id}/publishing")
        body = status_resp.json()
        assert body["library_published"] is True
        assert body["library_version"] == 1
        assert body["public_allowed"] is True
        assert body["public_posted"] is True
        assert body["public_version"] == 1

    async def test_the_settings_report_what_the_server_applies(self, one_org):
        await _settings(
            one_org,
            {"public_posting": True, "executive_public_posting": True},
        )
        async with _client(one_org.db, one_org.secretary) as c:
            resp = await c.get("/minutes/settings")
        body = resp.json()
        assert body["public_posting"] is True
        assert body["executive_public_posting"] is True
        assert body["executive_library_publishing"] is False
        # Two of the three executive switches are not enough, and the screen is
        # told so rather than left to work it out.
        assert body["executive_effective_library"] is False
        assert body["executive_effective_public"] is False
