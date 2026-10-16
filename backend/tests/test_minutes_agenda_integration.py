"""A meeting's structured agenda becoming the sections of its minutes.

What matters: items validate and store in one shape, a linked document must be
one the caller could open themselves (and its name comes from the library, not
the request), minutes drafted from a meeting are laid out as the agenda, a
client cannot forge the agenda-born fields on a section, sync moves the frame
without touching what was written, and an item the meeting never reached stays
in the record.
"""

from typing import Any

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import meetings as meetings_endpoints
from app.api.v1.endpoints import minutes as minutes_endpoints
from app.api.v1.endpoints import minutes_records as records_endpoints
from app.core.database import get_db
from app.models.document import Document, DocumentFolder, FolderVisibility
from app.models.user import User
from tests.minutes_support import _client, _user, _World, build_world

pytestmark = [pytest.mark.integration]

CLERK_PERMISSIONS = [
    "meetings.view",
    "meetings.manage",
    "minutes.view",
    "minutes.manage",
]


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    return await build_world(db_session)


@pytest.fixture
async def clerk(world: _World) -> User:
    return await _user(world.db, world.org_id, "Clerk", CLERK_PERMISSIONS)


def _meetings_client(db: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(meetings_endpoints.router, prefix="/meetings")
    app.include_router(minutes_endpoints.router, prefix="/minutes")
    app.include_router(records_endpoints.router, prefix="/minutes")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


def _item(key: str, title: str, **extra: Any) -> dict[str, Any]:
    return {"key": key, "title": title, **extra}


async def _meeting(
    world: _World, user: User, items: list[dict[str, Any]] | None
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "title": "October business meeting",
        "meeting_type": "business",
        "meeting_date": "2026-10-20",
        "start_time": "19:00:00",
    }
    if items is not None:
        body["agenda_items"] = items
    async with _meetings_client(world.db, user) as c:
        resp = await c.post("/meetings", json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _draft(world: _World, user: User, meeting_id: str) -> dict[str, Any]:
    async with _meetings_client(world.db, user) as c:
        resp = await c.post(f"/minutes/from-meeting/{meeting_id}")
    assert resp.status_code == 201, resp.text
    async with _meetings_client(world.db, user) as c:
        got = await c.get(f"/minutes/{resp.json()['id']}")
    assert got.status_code == 200, got.text
    return got.json()


async def _document(world: _World, name: str, folder: DocumentFolder | None = None):
    document = Document(
        organization_id=world.org_id,
        folder_id=folder.id if folder else None,
        name=name,
        uploaded_by=world.secretary.id,
    )
    world.db.add(document)
    await world.db.flush()
    return document


class TestAgendaItems:
    async def test_items_are_stored_and_returned_in_order(self, world, clerk):
        meeting = await _meeting(
            world,
            clerk,
            [
                _item("call", "Call to order"),
                _item("treasurer", "Treasurer's report", presenter="Pat"),
            ],
        )

        assert [i["key"] for i in meeting["agenda_items"]] == ["call", "treasurer"]
        assert meeting["agenda_items"][1]["presenter"] == "Pat"
        assert meeting["agenda_items"][0]["documents"] == []

    async def test_a_meeting_without_items_returns_an_empty_list(self, world, clerk):
        meeting = await _meeting(world, clerk, None)
        assert meeting["agenda_items"] == []

    @pytest.mark.parametrize(
        "items",
        [
            [_item("Bad Key", "Title")],
            [_item("a", "   ")],
            [_item("a", "One"), _item("a", "Two")],
            [_item("a", "x" * 201)],
        ],
        ids=["bad-key", "blank-title", "duplicate-key", "long-title"],
    )
    async def test_invalid_items_are_refused(self, world, clerk, items):
        async with _meetings_client(world.db, clerk) as c:
            resp = await c.post(
                "/meetings",
                json={
                    "title": "M",
                    "meeting_date": "2026-10-20",
                    "agenda_items": items,
                },
            )
        assert resp.status_code == 422

    async def test_items_can_be_replaced_and_cleared(self, world, clerk):
        meeting = await _meeting(world, clerk, [_item("a", "One")])
        async with _meetings_client(world.db, clerk) as c:
            replaced = await c.patch(
                f"/meetings/{meeting['id']}",
                json={"agenda_items": [_item("b", "Two")]},
            )
            cleared = await c.patch(
                f"/meetings/{meeting['id']}", json={"agenda_items": None}
            )

        assert [i["key"] for i in replaced.json()["agenda_items"]] == ["b"]
        assert cleared.json()["agenda_items"] == []

    async def test_a_member_without_meetings_manage_cannot_set_items(
        self, world, clerk
    ):
        meeting = await _meeting(world, clerk, [_item("a", "One")])
        async with _meetings_client(world.db, world.member) as c:
            resp = await c.patch(
                f"/meetings/{meeting['id']}",
                json={"agenda_items": [_item("b", "Two")]},
            )
        assert resp.status_code == 403


class TestLinkedDocuments:
    async def test_the_stored_name_is_the_librarys_not_the_requests(self, world, clerk):
        document = await _document(world, "Treasurer report Oct")
        meeting = await _meeting(
            world,
            clerk,
            [
                _item(
                    "t",
                    "Treasurer",
                    documents=[{"id": document.id, "name": "Forged name"}],
                )
            ],
        )

        assert meeting["agenda_items"][0]["documents"] == [
            {"id": document.id, "name": "Treasurer report Oct"}
        ]

    async def test_a_document_from_another_org_is_refused(self, world, clerk):
        foreign = Document(
            organization_id=world.other_org_id,
            name="Other dept",
            uploaded_by=world.outsider.id,
        )
        world.db.add(foreign)
        await world.db.flush()

        async with _meetings_client(world.db, clerk) as c:
            resp = await c.post(
                "/meetings",
                json={
                    "title": "M",
                    "meeting_date": "2026-10-20",
                    "agenda_items": [_item("a", "One", documents=[{"id": foreign.id}])],
                },
            )
        assert resp.status_code == 400

    async def test_a_document_the_caller_cannot_open_is_refused(self, world, clerk):
        restricted = DocumentFolder(
            organization_id=world.org_id,
            name="Board only",
            visibility=FolderVisibility.LEADERSHIP,
        )
        world.db.add(restricted)
        await world.db.flush()
        secret = await _document(world, "Personnel matter", restricted)

        async with _meetings_client(world.db, clerk) as c:
            resp = await c.post(
                "/meetings",
                json={
                    "title": "M",
                    "meeting_date": "2026-10-20",
                    "agenda_items": [_item("a", "One", documents=[{"id": secret.id}])],
                },
            )
        assert resp.status_code == 400
        assert "Personnel matter" not in resp.text


class TestDraftingFromTheAgenda:
    async def test_sections_are_the_agenda_items_in_order(self, world, clerk):
        document = await _document(world, "Budget")
        meeting = await _meeting(
            world,
            clerk,
            [
                _item("call", "Call to order"),
                _item(
                    "budget",
                    "Adopt the budget",
                    presenter="Pat",
                    notes="Draft attached.",
                    needs_motion=True,
                    motion_text="Move to adopt the budget as presented.",
                    documents=[{"id": document.id}],
                ),
            ],
        )

        minutes = await _draft(world, clerk, meeting["id"])

        assert [s["key"] for s in minutes["sections"]] == [
            "agenda-call",
            "agenda-budget",
        ]
        budget = minutes["sections"][1]
        assert budget["title"] == "Adopt the budget"
        assert budget["presenter"] == "Pat"
        assert budget["content"] == "Draft attached."
        assert budget["needs_motion"] is True
        assert budget["motion_text"] == "Move to adopt the budget as presented."
        assert budget["agenda_key"] == "budget"
        assert budget["documents"] == [{"id": document.id, "name": "Budget"}]

    async def test_a_meeting_without_items_keeps_the_outline_sections(
        self, world, clerk
    ):
        meeting = await _meeting(world, clerk, None)
        minutes = await _draft(world, clerk, meeting["id"])

        assert minutes["sections"]
        assert not any(s["key"].startswith("agenda-") for s in minutes["sections"])


class TestForgery:
    async def test_a_client_cannot_set_agenda_fields_on_a_section(self, world, clerk):
        meeting = await _meeting(world, clerk, [_item("a", "One")])
        minutes = await _draft(world, clerk, meeting["id"])
        sections = [
            {
                **s,
                "documents": [{"id": "x" * 36, "name": "Leaked secret"}],
                "agenda_key": "somebody-else",
            }
            for s in minutes["sections"]
        ] + [
            {
                "order": 9,
                "key": "extra",
                "title": "Extra",
                "content": "",
                "agenda_key": "a",
                "documents": [{"id": "y" * 36, "name": "Invented"}],
            }
        ]

        async with _meetings_client(world.db, clerk) as c:
            resp = await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
            assert resp.status_code == 200, resp.text
            saved = (await c.get(f"/minutes/{minutes['id']}")).json()["sections"]

        by_key = {s["key"]: s for s in saved}
        assert by_key["agenda-a"]["agenda_key"] == "a"
        assert by_key["agenda-a"]["documents"] == []
        assert by_key["extra"]["agenda_key"] is None
        assert by_key["extra"]["documents"] == []


class TestSync:
    async def _setup(self, world, clerk):
        meeting = await _meeting(
            world,
            clerk,
            [_item("a", "One"), _item("b", "Two"), _item("c", "Three")],
        )
        minutes = await _draft(world, clerk, meeting["id"])
        return meeting, minutes

    async def _patch_agenda(self, world, clerk, meeting_id, items):
        async with _meetings_client(world.db, clerk) as c:
            resp = await c.patch(
                f"/meetings/{meeting_id}", json={"agenda_items": items}
            )
        assert resp.status_code == 200, resp.text

    async def _preview(self, world, clerk, minutes_id):
        async with _meetings_client(world.db, clerk) as c:
            resp = await c.get(f"/minutes/{minutes_id}/agenda-sync")
        assert resp.status_code == 200, resp.text
        return resp.json()

    async def _apply(self, world, clerk, minutes_id, accept):
        async with _meetings_client(world.db, clerk) as c:
            return await c.post(
                f"/minutes/{minutes_id}/agenda-sync", json={"accept": accept}
            )

    async def test_an_unchanged_agenda_has_nothing_to_sync(self, world, clerk):
        _, minutes = await self._setup(world, clerk)
        assert (await self._preview(world, clerk, minutes["id"]))["changes"] == []

    async def test_added_renamed_and_removed_items_are_offered(self, world, clerk):
        meeting, minutes = await self._setup(world, clerk)
        await self._patch_agenda(
            world,
            clerk,
            meeting["id"],
            [_item("a", "One (revised)"), _item("c", "Three"), _item("d", "Four")],
        )

        changes = (await self._preview(world, clerk, minutes["id"]))["changes"]

        assert {c["id"] for c in changes} == {"update:a", "remove:b", "add:d"}
        update = next(c for c in changes if c["id"] == "update:a")
        assert update["fields"] == [
            {"field": "Title", "before": "One", "after": "One (revised)"}
        ]

    async def test_only_the_chosen_changes_are_applied(self, world, clerk):
        meeting, minutes = await self._setup(world, clerk)
        await self._patch_agenda(
            world,
            clerk,
            meeting["id"],
            [_item("a", "One (revised)"), _item("b", "Two"), _item("d", "Four")],
        )

        resp = await self._apply(world, clerk, minutes["id"], ["add:d"])

        assert resp.status_code == 200, resp.text
        titles = [s["title"] for s in resp.json()["sections"]]
        assert "Four" in titles
        assert "One" in titles
        assert "One (revised)" not in titles
        assert "Three" in titles

    async def test_written_text_survives_a_title_change(self, world, clerk):
        meeting, minutes = await self._setup(world, clerk)
        sections = [
            {**s, "content": "We talked." if s["key"] == "agenda-a" else s["content"]}
            for s in minutes["sections"]
        ]
        async with _meetings_client(world.db, clerk) as c:
            await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
        await self._patch_agenda(
            world,
            clerk,
            meeting["id"],
            [_item("a", "One (revised)"), _item("b", "Two"), _item("c", "Three")],
        )

        resp = await self._apply(world, clerk, minutes["id"], ["update:a"])

        section = next(s for s in resp.json()["sections"] if s["key"] == "agenda-a")
        assert section["title"] == "One (revised)"
        assert section["content"] == "We talked."

    async def test_removing_an_item_with_text_detaches_instead_of_deleting(
        self, world, clerk
    ):
        meeting, minutes = await self._setup(world, clerk)
        sections = [
            {**s, "content": "Discussed." if s["key"] == "agenda-b" else s["content"]}
            for s in minutes["sections"]
        ]
        async with _meetings_client(world.db, clerk) as c:
            await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
        await self._patch_agenda(
            world, clerk, meeting["id"], [_item("a", "One"), _item("c", "Three")]
        )

        resp = await self._apply(world, clerk, minutes["id"], ["remove:b"])

        by_key = {s["key"]: s for s in resp.json()["sections"]}
        assert by_key["agenda-b"]["content"] == "Discussed."
        assert by_key["agenda-b"]["agenda_key"] is None
        assert (await self._preview(world, clerk, minutes["id"]))["changes"] == []

    async def test_removing_an_empty_item_deletes_the_section(self, world, clerk):
        meeting, minutes = await self._setup(world, clerk)
        await self._patch_agenda(
            world, clerk, meeting["id"], [_item("a", "One"), _item("c", "Three")]
        )

        resp = await self._apply(world, clerk, minutes["id"], ["remove:b"])

        assert [s["key"] for s in resp.json()["sections"]] == [
            "agenda-a",
            "agenda-c",
        ]

    async def test_a_reordered_agenda_offers_a_reorder(self, world, clerk):
        meeting, minutes = await self._setup(world, clerk)
        await self._patch_agenda(
            world,
            clerk,
            meeting["id"],
            [_item("c", "Three"), _item("a", "One"), _item("b", "Two")],
        )

        changes = (await self._preview(world, clerk, minutes["id"]))["changes"]
        assert [c["id"] for c in changes] == ["reorder"]

        untouched = await self._apply(world, clerk, minutes["id"], [])
        assert [s["key"] for s in untouched.json()["sections"]] == [
            "agenda-a",
            "agenda-b",
            "agenda-c",
        ]
        resp = await self._apply(world, clerk, minutes["id"], ["reorder"])
        assert [s["key"] for s in resp.json()["sections"]] == [
            "agenda-c",
            "agenda-a",
            "agenda-b",
        ]
        assert (await self._preview(world, clerk, minutes["id"]))["changes"] == []

    async def test_a_stale_id_is_ignored(self, world, clerk):
        _, minutes = await self._setup(world, clerk)
        resp = await self._apply(world, clerk, minutes["id"], ["add:nothing"])
        assert resp.status_code == 200
        assert len(resp.json()["sections"]) == 3

    async def test_adopted_minutes_cannot_be_synced(self, world, clerk):
        meeting, minutes = await self._setup(world, clerk)
        from app.models.minute import MeetingMinutes, MinutesStatus

        row = await world.db.get(MeetingMinutes, minutes["id"])
        row.status = MinutesStatus.APPROVED.value
        await world.db.flush()

        resp = await self._apply(world, clerk, minutes["id"], [])
        assert resp.status_code == 400

    async def test_minutes_without_a_meeting_are_refused(self, world):
        async with _client(world.db, world.secretary) as c:
            created = await c.post(
                "/minutes",
                json={
                    "title": "Loose",
                    "meeting_type": "business",
                    "meeting_date": "2026-10-01T19:00:00+00:00",
                },
            )
            resp = await c.get(f"/minutes/{created.json()['id']}/agenda-sync")
        assert resp.status_code == 400

    async def test_another_orgs_minutes_are_not_found(self, world, clerk):
        _, minutes = await self._setup(world, clerk)
        resp = await self._preview_as(world, world.outsider, minutes["id"])
        assert resp.status_code == 404

    async def _preview_as(self, world, user, minutes_id):
        async with _meetings_client(world.db, user) as c:
            return await c.get(f"/minutes/{minutes_id}/agenda-sync")

    async def test_a_member_without_manage_cannot_sync(self, world, clerk):
        _, minutes = await self._setup(world, clerk)
        resp = await self._preview_as(world, world.member, minutes["id"])
        assert resp.status_code == 403


class TestNotTakenUp:
    async def test_an_unreached_item_is_kept_and_printed_as_such(self, world, clerk):
        meeting = await _meeting(
            world, clerk, [_item("a", "Old business"), _item("b", "New business")]
        )
        minutes = await _draft(world, clerk, meeting["id"])
        sections = [
            {**s, "not_taken_up": s["key"] == "agenda-b"} for s in minutes["sections"]
        ]
        async with _meetings_client(world.db, clerk) as c:
            resp = await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
            assert resp.status_code == 200, resp.text
            saved = (await c.get(f"/minutes/{minutes['id']}")).json()["sections"]

        assert next(s for s in saved if s["key"] == "agenda-b")["not_taken_up"] is True
        assert next(s for s in saved if s["key"] == "agenda-a")["not_taken_up"] is False


class TestApplyingAnOutlineKeepsTheAgenda:
    async def test_a_not_taken_up_item_survives_an_outline(self, world, clerk):
        meeting = await _meeting(
            world, clerk, [_item("a", "Old business"), _item("b", "New business")]
        )
        minutes = await _draft(world, clerk, meeting["id"])
        sections = [
            {**s, "not_taken_up": s["key"] == "agenda-b"} for s in minutes["sections"]
        ]
        async with _meetings_client(world.db, clerk) as c:
            await c.put(f"/minutes/{minutes['id']}", json={"sections": sections})
            outlines = (await c.get("/minutes/templates")).json()
            outline_id = outlines[0]["id"]
            resp = await c.post(
                f"/minutes/{minutes['id']}/apply-outline",
                json={"template_id": outline_id},
            )
            assert resp.status_code == 200, resp.text

        by_key = {s["key"]: s for s in resp.json()["sections"]}
        assert "agenda-b" in by_key
        assert by_key["agenda-b"]["not_taken_up"] is True

    async def test_a_blank_agenda_section_is_not_dropped_by_an_outline(
        self, world, clerk
    ):
        meeting = await _meeting(world, clerk, [_item("a", "Old business")])
        minutes = await _draft(world, clerk, meeting["id"])
        async with _meetings_client(world.db, clerk) as c:
            outline_id = (await c.get("/minutes/templates")).json()[0]["id"]
            resp = await c.post(
                f"/minutes/{minutes['id']}/apply-outline",
                json={"template_id": outline_id},
            )

        keys = [s["key"] for s in resp.json()["sections"]]
        assert "agenda-a" in keys


MANAGER_WITH_LIBRARY = [
    "meetings.view",
    "meetings.manage",
    "minutes.view",
    "minutes.manage",
    "documents.view",
    "documents.manage",
]
SECRET = "Confidential personnel review"


async def _board_document(world: _World) -> Document:
    folder = DocumentFolder(
        organization_id=world.org_id,
        name="Board only",
        visibility=FolderVisibility.LEADERSHIP,
    )
    world.db.add(folder)
    await world.db.flush()
    return await _document(world, SECRET, folder)


class TestLinkedDocumentNamesReachOnlyThoseWhoCanOpenThem:
    """Linking is checked against the linker, but the name is read by everyone
    who can read the meeting or the minutes."""

    async def _linked(self, world):
        library_manager = await _user(
            world.db, world.org_id, "Librarian", MANAGER_WITH_LIBRARY
        )
        document = await _board_document(world)
        meeting = await _meeting(
            world,
            library_manager,
            [_item("a", "Executive item", documents=[{"id": document.id}])],
        )
        return library_manager, document, meeting

    async def test_a_viewer_without_access_is_not_shown_the_name(self, world):
        _, _, meeting = await self._linked(world)
        viewer = await _user(
            world.db, world.org_id, "Viewer", ["meetings.view", "minutes.view"]
        )
        async with _meetings_client(world.db, viewer) as c:
            listing = await c.get("/meetings")
            detail = await c.get(f"/meetings/{meeting['id']}")

        assert listing.status_code == 200
        assert detail.status_code == 200
        assert SECRET not in listing.text
        assert SECRET not in detail.text
        assert detail.json()["agenda_items"][0]["documents"] == []

    async def test_a_library_manager_still_sees_it(self, world):
        manager, _, meeting = await self._linked(world)
        async with _meetings_client(world.db, manager) as c:
            listing = await c.get("/meetings")
            detail = await c.get(f"/meetings/{meeting['id']}")

        assert SECRET in listing.text
        assert SECRET in detail.text

    async def test_the_minutes_sections_are_narrowed_the_same_way(self, world):
        manager, _, meeting = await self._linked(world)
        minutes = await _draft(world, manager, meeting["id"])
        # Draft minutes are shown to minutes managers only, so the reader to
        # narrow for is one who manages minutes without library access.
        other_manager = await _user(
            world.db, world.org_id, "Other", ["minutes.view", "minutes.manage"]
        )

        async with _meetings_client(world.db, other_manager) as c:
            seen = await c.get(f"/minutes/{minutes['id']}")
        async with _meetings_client(world.db, manager) as c:
            full = await c.get(f"/minutes/{minutes['id']}")

        assert seen.status_code == 200
        assert SECRET not in seen.text
        assert SECRET in full.text

    async def test_an_editor_who_cannot_see_a_link_does_not_unlink_it(self, world):
        manager, document, meeting = await self._linked(world)
        editor = await _user(world.db, world.org_id, "Editor", CLERK_PERMISSIONS)

        async with _meetings_client(world.db, editor) as c:
            shown = (await c.get(f"/meetings/{meeting['id']}")).json()
            assert shown["agenda_items"][0]["documents"] == []
            saved = await c.patch(
                f"/meetings/{meeting['id']}",
                json={
                    "agenda_items": [
                        {**shown["agenda_items"][0], "title": "Executive item (rev)"}
                    ]
                },
            )
            assert saved.status_code == 200, saved.text

        async with _meetings_client(world.db, manager) as c:
            after = (await c.get(f"/meetings/{meeting['id']}")).json()
        item = after["agenda_items"][0]
        assert item["title"] == "Executive item (rev)"
        assert [d["id"] for d in item["documents"]] == [document.id]

    async def test_an_editor_who_can_see_a_link_can_remove_it(self, world):
        manager, _, meeting = await self._linked(world)
        async with _meetings_client(world.db, manager) as c:
            shown = (await c.get(f"/meetings/{meeting['id']}")).json()
            await c.patch(
                f"/meetings/{meeting['id']}",
                json={"agenda_items": [{**shown["agenda_items"][0], "documents": []}]},
            )
            after = (await c.get(f"/meetings/{meeting['id']}")).json()

        assert after["agenda_items"][0]["documents"] == []

    async def test_removing_the_whole_item_drops_its_hidden_links_too(self, world):
        manager, _, meeting = await self._linked(world)
        editor = await _user(world.db, world.org_id, "Editor", CLERK_PERMISSIONS)
        async with _meetings_client(world.db, editor) as c:
            await c.patch(f"/meetings/{meeting['id']}", json={"agenda_items": []})
        async with _meetings_client(world.db, manager) as c:
            after = (await c.get(f"/meetings/{meeting['id']}")).json()

        assert after["agenda_items"] == []
