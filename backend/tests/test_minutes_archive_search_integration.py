"""Searching the minutes archive: what is read, who may see it, how it is shown.

The search matches the words of titles, sections, motions and action items,
groups what it finds by minutes, and applies the listing's visibility rule so a
member never searches — or is quoted — a draft or an executive session.
"""

from datetime import datetime, timezone
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import minute_service
from tests.minutes_support import (
    _approve,
    _client,
    _create,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

SEPT = datetime(2026, 9, 3, 19, 0, tzinfo=timezone.utc)
OCT = datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc)


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


async def _write(w: _World, minutes_id: str, key: str, text: str) -> None:
    async with _client(w.db, w.secretary) as c:
        current = (await c.get(f"/minutes/{minutes_id}")).json()
        sections = [
            {**s, "content": text if s["key"] == key else s["content"]}
            for s in current["sections"]
        ]
        resp = await c.put(f"/minutes/{minutes_id}", json={"sections": sections})
    assert resp.status_code == 200, resp.text


async def _search(w: _World, who, q: str, **params: Any):
    async with _client(w.db, who) as c:
        return await c.get("/minutes/archive-search", params={"q": q, **params})


async def _hits(w: _World, who, q: str, **params: Any) -> list[dict[str, Any]]:
    resp = await _search(w, who, q, **params)
    assert resp.status_code == 200, resp.text
    return resp.json()["hits"]


def _plain(match: dict[str, Any]) -> str:
    return "".join(p["text"] for p in match["parts"])


class TestWhatIsSearched:
    async def test_a_section_a_motion_and_an_action_item_are_found_and_grouped(
        self, world
    ):
        minutes = await _create(
            world,
            title="October meeting",
            items=[{"description": "Price new turnout hose", "assignee_name": "Sam"}],
        )
        await _write(world, minutes["id"], "treasurer_report", "Hose budget reviewed.")
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/motions",
                json={"motion_text": "Motion to buy hose for Engine 2."},
            )
            assert resp.status_code == 201, resp.text

        hits = await _hits(world, world.secretary, "hose")

        assert [h["id"] for h in hits] == [minutes["id"]]
        kinds = {m["kind"] for m in hits[0]["matches"]}
        assert kinds == {"section", "motion", "action_item"}
        section = next(m for m in hits[0]["matches"] if m["kind"] == "section")
        assert section["label"] == "Treasurer's Report"
        assert [p["text"] for p in section["parts"] if p["hit"]] == ["Hose"]

    async def test_every_word_must_appear_but_may_be_in_different_places(self, world):
        minutes = await _create(world, title="October meeting")
        await _write(world, minutes["id"], "treasurer_report", "The budget passed.")
        await _write(world, minutes["id"], "new_business", "Engine 2 needs hose.")

        assert len(await _hits(world, world.secretary, "budget hose")) == 1
        assert await _hits(world, world.secretary, "budget ladder") == []

    async def test_a_word_matches_where_a_word_starts(self, world):
        minutes = await _create(world)
        await _write(world, minutes["id"], "new_business", "Four hoses were tested.")

        assert len(await _hits(world, world.secretary, "hose")) == 1
        assert await _hits(world, world.secretary, "ose") == []

    async def test_a_quoted_phrase_must_appear_as_typed(self, world):
        minutes = await _create(world)
        await _write(world, minutes["id"], "new_business", "Fire prevention week.")

        assert len(await _hits(world, world.secretary, '"fire prevention"')) == 1
        assert await _hits(world, world.secretary, '"prevention fire"') == []

    async def test_rich_text_is_searched_as_words_not_markup(self, world):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            current = (await c.get(f"/minutes/{minutes['id']}")).json()
            sections = [
                (
                    {
                        **s,
                        "format": "html",
                        "content": "<p>Bought <strong>hose</strong></p>",
                    }
                    if s["key"] == "new_business"
                    else s
                )
                for s in current["sections"]
            ]
            assert (
                await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
            ).status_code == 200

        hits = await _hits(world, world.secretary, "hose")

        assert _plain(hits[0]["matches"][0]) == "Bought hose"
        assert await _hits(world, world.secretary, "strong") == []

    async def test_a_prepared_motion_nobody_acted_on_is_not_searched(self, world):
        await _create(world)

        assert await _hits(world, world.secretary, "adjourn") == []

    async def test_results_are_newest_meeting_first_and_filter_by_type(self, world):
        old = await _create(world, title="Hose in September", when=SEPT)
        new = await _create(world, title="Hose in October", when=OCT)
        await _create(world, title="Hose committee", meeting_type="committee", when=OCT)

        everything = await _hits(world, world.secretary, "hose")
        only_business = await _hits(
            world, world.secretary, "hose", meeting_type="business"
        )

        assert [h["id"] for h in only_business] == [new["id"], old["id"]]
        assert len(everything) == 3

    async def test_the_number_of_minutes_returned_is_limited(self, world):
        for n in range(3):
            await _create(world, title=f"Hose {n}")

        resp = await _search(world, world.secretary, "hose", limit=2)

        assert len(resp.json()["hits"]) == 2


class TestWhoMaySee:
    async def test_a_member_never_searches_drafts_or_executive_sessions(self, world):
        draft = await _create(world, title="Draft hose notes")
        circulated = await _create(world, title="Adopted hose minutes", when=SEPT)
        await _approve(world, circulated["id"])
        executive = await _create(
            world, title="Hose in executive session", meeting_type="executive"
        )

        member = await _hits(world, world.member, "hose")
        manager = await _hits(world, world.secretary, "hose")

        assert [h["id"] for h in member] == [circulated["id"]]
        assert {h["id"] for h in manager} == {
            draft["id"],
            circulated["id"],
            executive["id"],
        }
        assert {h["status"] for h in manager} >= {"draft", "approved"}

    async def test_a_member_is_not_quoted_text_from_a_draft_section(self, world):
        draft = await _create(world, title="Plain title")
        await _write(world, draft["id"], "new_business", "Secret hose plan.")

        resp = await _search(world, world.member, "secret")

        assert resp.json()["hits"] == []

    async def test_another_departments_minutes_are_never_searched(self, world):
        mine = await _create(world, title="Our hose")
        async with _client(world.db, world.outsider) as c:
            theirs = (
                await c.post(
                    "/minutes",
                    json={
                        "title": "Their hose",
                        "meeting_type": "business",
                        "meeting_date": OCT.isoformat(),
                    },
                )
            ).json()

        ours = await _hits(world, world.secretary, "hose")
        theirs_seen = await _hits(world, world.outsider, "hose")

        assert [h["id"] for h in ours] == [mine["id"]]
        assert [h["id"] for h in theirs_seen] == [theirs["id"]]


class TestTheRequest:
    async def test_a_query_with_no_usable_word_is_refused(self, world):
        for q in ("a", "  ", "%", '""'):
            assert (await _search(world, world.secretary, q)).status_code == 400

    async def test_a_percent_sign_is_not_a_wildcard(self, world):
        await _create(world, title="Plain title")

        resp = await _search(world, world.secretary, "100%")

        assert resp.status_code == 200
        assert resp.json()["hits"] == []

    async def test_a_caller_without_view_permission_is_refused(self, world):
        nobody = await _user(world.db, world.org_id, "Nobody", [])

        assert (await _search(world, nobody, "hose")).status_code == 403

    async def test_the_response_says_what_was_searched_for(self, world):
        await _create(world, title="Plain title")

        body = (await _search(world, world.secretary, 'Hose "fire prevention"')).json()

        assert body["terms"] == ["hose", "fire prevention"]
        assert body["searched"] == 1
        assert body["truncated"] is False

    async def test_it_says_when_older_minutes_were_left_out(self, world, monkeypatch):
        monkeypatch.setattr(minute_service, "ARCHIVE_SCAN_LIMIT", 1)
        await _create(world, title="Newest", when=OCT)
        await _create(world, title="Older hose", when=SEPT)

        body = (await _search(world, world.secretary, "hose")).json()

        assert body["hits"] == []
        assert body["truncated"] is True
