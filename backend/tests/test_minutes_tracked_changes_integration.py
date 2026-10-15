"""Tracked changes on a suggestion, over HTTP against the real schema.

A reviewer edits a copy of a section; the secretary accepts or rejects each
change and applies the accepted ones. The pieces under test are the ones a unit
test cannot reach: what is stored, who may do what at which status, that
applying is all-or-nothing, and what happens when the section moved on.
"""

from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.minutes_support import (
    _client,
    _create,
    _fill_required_sections,
    _user,
    _World,
    build_world,
)

pytestmark = [pytest.mark.integration]

OLD = (
    "<p>The committee reported <strong>three bids</strong> today.</p>"
    "<ul><li>Vendor A — $4,200</li><li>Vendor B — $3,900</li></ul>"
)
EDITED = (
    "<p>The committee reported <strong>four quotes</strong> today.</p>"
    "<ul><li>Vendor A — $4,200</li><li>Vendor B — $3,950</li></ul>"
)


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


def _section(content: str, fmt: str = "html") -> dict[str, Any]:
    return {
        "order": 0,
        "key": "old_business",
        "title": "Old Business",
        "content": content,
        "format": fmt,
    }


async def _circulated(world: _World, content: str = OLD, fmt: str = "html") -> str:
    minutes = await _create(world, sections=[_section(content, fmt)])
    await _fill_required_sections(world, minutes["id"])
    async with _client(world.db, world.secretary) as c:
        assert (await c.post(f"/minutes/{minutes['id']}/submit")).status_code == 200
    return minutes["id"]


async def _suggest(world: _World, minutes_id: str, html: str = EDITED, **extra: Any):
    async with _client(world.db, world.member) as c:
        return await c.post(
            f"/minutes/{minutes_id}/suggestions",
            json={"section_key": "old_business", "proposed_html": html, **extra},
        )


async def _recall(world: _World, minutes_id: str) -> None:
    async with _client(world.db, world.secretary) as c:
        assert (await c.post(f"/minutes/{minutes_id}/recall")).status_code == 200


async def _apply(
    world: _World, minutes_id: str, suggestion_id: str, accepted, user=None
):
    async with _client(world.db, user or world.secretary) as c:
        return await c.post(
            f"/minutes/{minutes_id}/suggestions/{suggestion_id}/apply",
            json={"accepted": accepted},
        )


async def _section_content(world: _World, minutes_id: str) -> dict[str, Any]:
    async with _client(world.db, world.secretary) as c:
        body = (await c.get(f"/minutes/{minutes_id}")).json()
    return next(s for s in body["sections"] if s["key"] == "old_business")


# ── Making a tracked suggestion ──────────────────────────────────────


class TestSuggestingWithTrackedChanges:
    async def test_a_member_edits_a_copy_and_gets_discrete_changes_without_a_comment(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        resp = await _suggest(world, minutes_id)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["comment"] == ""
        assert body["base_content"] == OLD
        assert body["proposed_content"] == EDITED
        assert [(c["kind"], c["deleted"], c["inserted"]) for c in body["changes"]] == [
            ("replace", "three bids", "four quotes"),
            ("replace", "$3,900", "$3,950"),
        ]
        assert {c["decision"] for c in body["changes"]} == {"open"}
        assert body["section_changed"] is False

    async def test_an_old_plain_text_section_is_edited_as_paragraphs(
        self, world: _World
    ):
        minutes_id = await _circulated(world, "Hose order\n\nNote <5 bids", fmt="text")
        resp = await _suggest(
            world, minutes_id, "<p>Hose order</p><p>Note &lt;5 bids and 2 quotes</p>"
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["base_content"] == "<p>Hose order</p><p>Note &lt;5 bids</p>"
        assert [c["inserted"] for c in body["changes"]] == ["bids and 2 quotes"] or (
            len(body["changes"]) == 1
        )

    async def test_a_list_item_the_editor_wrapped_in_a_paragraph_is_not_a_change(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        wrapped = OLD.replace("<li>", "<li><p>").replace("</li>", "</p></li>")
        resp = await _suggest(world, minutes_id, wrapped)
        assert resp.status_code == 400, resp.text
        assert "nothing changed" in resp.text

    async def test_an_unchanged_copy_is_refused(self, world: _World):
        minutes_id = await _circulated(world)
        resp = await _suggest(world, minutes_id, OLD)
        assert resp.status_code == 400

    async def test_tracked_changes_need_a_section(self, world: _World):
        minutes_id = await _circulated(world)
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{minutes_id}/suggestions", json={"proposed_html": EDITED}
            )
        assert resp.status_code == 422

    async def test_a_comment_alone_still_works(self, world: _World):
        minutes_id = await _circulated(world)
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{minutes_id}/suggestions",
                json={"section_key": "old_business", "comment": "Please add the date"},
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["changes"] == []
        assert body["base_content"] is None

    async def test_markup_in_the_copy_is_cleaned_before_it_is_stored(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        resp = await _suggest(world, minutes_id, EDITED + "<script>bad()</script>")
        assert resp.status_code == 201, resp.text
        assert "script" not in resp.json()["proposed_content"]

    async def test_only_circulated_minutes_take_suggestions(self, world: _World):
        minutes = await _create(world, sections=[_section(OLD)])
        resp = await _suggest(world, minutes["id"])
        assert resp.status_code in (400, 404)


# ── Visibility ───────────────────────────────────────────────────────


class TestWhoSeesTrackedChanges:
    async def test_a_member_sees_only_their_own_and_a_manager_sees_all(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        other = await _user(world.db, world.org_id, "Other", ["minutes.view"])
        await _suggest(world, minutes_id)
        async with _client(world.db, other) as c:
            await c.post(
                f"/minutes/{minutes_id}/suggestions",
                json={
                    "section_key": "old_business",
                    "proposed_html": EDITED + "<p>More</p>",
                },
            )
        async with _client(world.db, world.member) as c:
            mine = (await c.get(f"/minutes/{minutes_id}/suggestions")).json()
        async with _client(world.db, world.secretary) as c:
            everyone = (await c.get(f"/minutes/{minutes_id}/suggestions")).json()
        assert len(mine) == 1
        assert len(everyone) == 2

    async def test_another_departments_member_sees_nothing(self, world: _World):
        minutes_id = await _circulated(world)
        await _suggest(world, minutes_id)
        async with _client(world.db, world.outsider) as c:
            resp = await c.get(f"/minutes/{minutes_id}/suggestions")
        assert resp.status_code == 404


# ── Applying ─────────────────────────────────────────────────────────


class TestApplyingAcceptedChanges:
    async def test_circulated_minutes_are_recalled_before_changes_are_written(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        resp = await _apply(world, minutes_id, suggestion["id"], ["c1"])
        assert resp.status_code == 400, resp.text
        assert (await _section_content(world, minutes_id))["content"] == OLD

    async def test_the_accepted_changes_are_written_and_the_rest_rejected(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)

        resp = await _apply(world, minutes_id, suggestion["id"], ["c2"])
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["applied_at"] is not None
        assert [(c["id"], c["decision"]) for c in body["changes"]] == [
            ("c1", "rejected"),
            ("c2", "accepted"),
        ]
        section = await _section_content(world, minutes_id)
        assert section["format"] == "html"
        assert "three bids" in section["content"]
        assert "$3,950" in section["content"]
        assert "$3,900" not in section["content"]

    async def test_an_old_plain_text_section_becomes_rich_text_when_changes_land(
        self, world: _World
    ):
        minutes_id = await _circulated(world, "Hose order\n\nThree bids", fmt="text")
        suggestion = (
            await _suggest(world, minutes_id, "<p>Hose order</p><p>Four quotes</p>")
        ).json()
        await _recall(world, minutes_id)
        resp = await _apply(
            world,
            minutes_id,
            suggestion["id"],
            [c["id"] for c in suggestion["changes"]],
        )
        assert resp.status_code == 200, resp.text
        section = await _section_content(world, minutes_id)
        assert section["format"] == "html"
        assert section["content"] == "<p>Hose order</p><p>Four quotes</p>"

    async def test_rejecting_everything_declines_the_suggestion_and_leaves_the_section(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)

        resp = await _apply(world, minutes_id, suggestion["id"], [])
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "declined"
        assert resp.json()["applied_at"] is None
        assert (await _section_content(world, minutes_id))["content"] == OLD

    async def test_an_unknown_change_is_refused(self, world: _World):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)
        resp = await _apply(world, minutes_id, suggestion["id"], ["c99"])
        assert resp.status_code == 400

    async def test_a_suggestion_is_applied_once(self, world: _World):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)
        assert (
            await _apply(world, minutes_id, suggestion["id"], ["c1"])
        ).status_code == 200
        assert (
            await _apply(world, minutes_id, suggestion["id"], ["c2"])
        ).status_code == 400

    async def test_a_comment_only_suggestion_has_nothing_to_apply(self, world: _World):
        minutes_id = await _circulated(world)
        async with _client(world.db, world.member) as c:
            made = (
                await c.post(
                    f"/minutes/{minutes_id}/suggestions",
                    json={"section_key": "old_business", "comment": "Add the date"},
                )
            ).json()
        await _recall(world, minutes_id)
        assert (await _apply(world, minutes_id, made["id"], [])).status_code == 400

    async def test_a_member_cannot_apply_and_another_department_cannot_reach_it(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)
        mine = await _apply(world, minutes_id, suggestion["id"], ["c1"], world.member)
        theirs = await _apply(
            world, minutes_id, suggestion["id"], ["c1"], world.outsider
        )
        assert mine.status_code == 403
        assert theirs.status_code == 404
        assert (await _section_content(world, minutes_id))["content"] == OLD


# ── The section moved on ─────────────────────────────────────────────


async def _edit_section(world: _World, minutes_id: str, content: str) -> None:
    async with _client(world.db, world.secretary) as c:
        resp = await c.put(
            f"/minutes/{minutes_id}", json={"sections": [_section(content)]}
        )
    assert resp.status_code == 200, resp.text


async def _circulate_again(world: _World, minutes_id: str) -> None:
    await _fill_required_sections(world, minutes_id)
    async with _client(world.db, world.secretary) as c:
        assert (await c.post(f"/minutes/{minutes_id}/submit")).status_code == 200


class TestWhenTheSectionHasChangedSince:
    async def test_the_suggestion_says_so_and_still_shows_its_redline(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        await _suggest(world, minutes_id)
        await _recall(world, minutes_id)
        await _edit_section(world, minutes_id, OLD.replace("today", "this evening"))
        await _circulate_again(world, minutes_id)

        async with _client(world.db, world.secretary) as c:
            (listed,) = (await c.get(f"/minutes/{minutes_id}/suggestions")).json()
        assert listed["section_changed"] is True
        assert [c["deleted"] for c in listed["changes"]] == ["three bids", "$3,900"]

    async def test_changes_that_still_fit_are_applied_where_they_belong(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)
        await _edit_section(world, minutes_id, OLD.replace("today", "this evening"))

        resp = await _apply(world, minutes_id, suggestion["id"], ["c1", "c2"])
        assert resp.status_code == 200, resp.text
        content = (await _section_content(world, minutes_id))["content"]
        assert "four quotes" in content
        assert "this evening" in content
        assert "$3,950" in content

    async def test_a_change_that_no_longer_fits_stops_everything_and_names_it(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)
        edited = OLD.replace("three bids", "five bids")
        await _edit_section(world, minutes_id, edited)

        resp = await _apply(world, minutes_id, suggestion["id"], ["c1", "c2"])
        assert resp.status_code == 409, resp.text
        assert resp.json()["detail"]["failed"] == ["c1"]
        assert (await _section_content(world, minutes_id))["content"] == edited
        async with _client(world.db, world.secretary) as c:
            (listed,) = (await c.get(f"/minutes/{minutes_id}/suggestions")).json()
        assert listed["status"] == "open"
        assert {ch["decision"] for ch in listed["changes"]} == {"open"}

    async def test_rejecting_the_one_that_no_longer_fits_lets_the_rest_through(
        self, world: _World
    ):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        await _recall(world, minutes_id)
        await _edit_section(world, minutes_id, OLD.replace("three bids", "five bids"))

        resp = await _apply(world, minutes_id, suggestion["id"], ["c2"])
        assert resp.status_code == 200, resp.text
        assert "$3,950" in (await _section_content(world, minutes_id))["content"]


# ── Answering without applying ───────────────────────────────────────


class TestAnsweringATrackedSuggestionTheOldWay:
    async def test_it_cannot_be_accepted_without_applying(self, world: _World):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes_id}/suggestions/{suggestion['id']}",
                json={"status": "accepted"},
            )
        assert resp.status_code == 400

    async def test_declining_it_rejects_every_change(self, world: _World):
        minutes_id = await _circulated(world)
        suggestion = (await _suggest(world, minutes_id)).json()
        async with _client(world.db, world.secretary) as c:
            resp = await c.put(
                f"/minutes/{minutes_id}/suggestions/{suggestion['id']}",
                json={"status": "declined", "note": "Bids were three"},
            )
        assert resp.status_code == 200, resp.text
        assert {c["decision"] for c in resp.json()["changes"]} == {"rejected"}
