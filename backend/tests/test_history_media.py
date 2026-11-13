"""History photos and media against the database.

Uploads that keep the original byte for byte and show everyone else a
stripped copy; who reads what; range requests a player makes; each tagged
person's photo-use answer as a warning that never blocks; clearance for an
item; albums; sources; a person merge carrying tags; delete removing files;
and nothing reaching across departments.
"""

import io
import os
import wave
from datetime import date

import pytest
from fastapi import HTTPException
from PIL import Image
from sqlalchemy import select
from starlette.requests import Request

from app.api.v1.endpoints import history_media as endpoint
from app.models.consent import ConsentType, UserConsent
from app.models.history import (
    AlbumLevel,
    ClearanceDecisionKind,
    ClearancePurpose,
    HistoryMediaTag,
    MediaFileRole,
    MediaKind,
    PublicationLevel,
)
from app.services import file_storage_service
from app.services.history_clearance_service import HistoryClearanceService
from app.services.history_collection_service import (
    HistoryAlbumService,
    HistorySourceService,
)
from app.services.history_media_service import HistoryMediaService
from app.services.history_merge_service import HistoryMergeService
from app.services.history_service import HistoryService, Viewer
from tests.test_history_module import _org, _position, _user

pytestmark = pytest.mark.integration


def _jpeg() -> bytes:
    image = Image.new("RGB", (300, 100), "blue")
    exif = image.getexif()
    exif[0x0112] = 6
    exif[0x010F] = "CameraMaker"
    exif[0x8825] = {1: "N", 2: (40.0, 1.0, 2.0)}
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif.tobytes())
    return out.getvalue()


def _wav() -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(bytes(range(256)) * 100)
    return out.getvalue()


class _Dept:
    def __init__(self, org_id, historian, member, president_position, president):
        self.org_id = org_id
        self.historian = historian
        self.member = member
        self.president_position = president_position
        self.president = president
        self.actor = str(historian.id)

    @property
    def keeper(self) -> Viewer:
        return Viewer.of(self.historian)

    @property
    def reader(self) -> Viewer:
        return Viewer.of(self.member)


@pytest.fixture
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage_service, "UPLOADS_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
async def dept(db_session, uploads):
    org_id = await _org(db_session)
    historian_pos = await _position(
        db_session,
        org_id,
        "Historian",
        ["history.view", "history.manage", "history.publish"],
        slug="historian",
    )
    president_pos = await _position(db_session, org_id, "President", [])
    historian = await _user(db_session, org_id, "Hannah", historian_pos)
    member = await _user(db_session, org_id, "Mark")
    president = await _user(db_session, org_id, "Pat", president_pos)
    return _Dept(org_id, historian, member, president_pos, president)


async def _upload(db, dept, content=None, name="parade.jpg", **values):
    item, _ = await HistoryMediaService(db).store_media_upload(
        dept.org_id,
        content=content if content is not None else _jpeg(),
        filename=name,
        values=values,
        batch_id=None,
        actor=dept.historian,
    )
    return item


async def _person(db, dept, **values):
    values.setdefault("last_name", "Smith")
    return await HistoryService(db).create_person(dept.org_id, values, dept.actor)


def _files_on_disk(root) -> list[str]:
    return sorted(
        os.path.join(d, f)
        for d, _dirs, names in os.walk(root)
        for f in names
        if "history-media" in d
    )


def _request(range_header=None) -> Request:
    headers = [(b"range", range_header.encode())] if range_header else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


async def _body(response) -> bytes:
    return b"".join([chunk async for chunk in response.body_iterator])


class TestUpload:
    async def test_the_original_is_kept_and_everyone_else_sees_a_stripped_copy(
        self, db_session, dept
    ):
        content = _jpeg()
        item = await _upload(db_session, dept, content)
        service = HistoryMediaService(db_session)
        assert item.kind == MediaKind.PHOTO
        assert item.title == "parade"
        assert (item.width, item.height) == (100, 300)
        original = service.file_of(item, MediaFileRole.ORIGINAL)
        display = service.file_of(item, MediaFileRole.DISPLAY)
        assert await file_storage_service.read_bytes(original.file_path) == content
        shown = Image.open(
            io.BytesIO(await file_storage_service.read_bytes(display.file_path))
        )
        assert shown.format == "WEBP"
        assert dict(shown.getexif()) == {}
        assert service.file_of(item, MediaFileRole.THUMBNAIL) is not None

    async def test_files_are_encrypted_on_disk(self, db_session, dept, uploads):
        await _upload(db_session, dept)
        for path in _files_on_disk(uploads):
            with open(path, "rb") as handle:
                assert b"CameraMaker" not in handle.read()

    async def test_audio_keeps_its_file_and_has_no_copies(self, db_session, dept):
        item = await _upload(db_session, dept, _wav(), "interview.wav")
        assert item.kind == MediaKind.AUDIO
        assert {f.role for f in item.files} == {MediaFileRole.ORIGINAL}

    async def test_a_name_the_archive_does_not_accept_is_refused(
        self, db_session, dept, uploads
    ):
        with pytest.raises(ValueError, match="not accepted"):
            await _upload(db_session, dept, b"%PDF-1.4", "letter.pdf")
        assert _files_on_disk(uploads) == []

    async def test_contents_that_contradict_the_name_are_refused(
        self, db_session, dept, uploads
    ):
        with pytest.raises(HTTPException) as caught:
            await _upload(db_session, dept, _jpeg(), "interview.mp3")
        assert caught.value.status_code == 400
        assert _files_on_disk(uploads) == []

    async def test_another_departments_source_or_person_is_refused(
        self, db_session, dept, uploads
    ):
        other_org = await _org(db_session)
        other_pos = await _position(db_session, other_org, "H", ["history.manage"])
        other_user = await _user(db_session, other_org, "Olga", other_pos)
        foreign_person = await HistoryService(db_session).create_person(
            other_org, {"last_name": "Elsewhere"}, str(other_user.id)
        )
        foreign_source = await HistorySourceService(db_session).create_source(
            other_org, "Their donor", str(other_user.id)
        )
        with pytest.raises(ValueError, match="not in this department"):
            await _upload(db_session, dept, tag_member_ids=[foreign_person.id])
        with pytest.raises(ValueError, match="not on this department"):
            await _upload(db_session, dept, source_id=foreign_source.id)
        assert _files_on_disk(uploads) == []


class TestWhoSeesWhat:
    async def test_a_draft_is_hidden_from_members_everywhere(self, db_session, dept):
        person = await _person(db_session, dept)
        await HistoryService(db_session).publish(
            person, PublicationLevel.MEMBERS, dept.actor
        )
        item = await _upload(db_session, dept, tag_member_ids=[person.id])
        service = HistoryMediaService(db_session)
        assert await service.get_readable_media(dept.reader, item.id) is None
        _, total = await service.list_media(dept.reader)
        assert total == 0
        assert await service.for_person(dept.reader, person) == []
        with pytest.raises(HTTPException) as caught:
            await endpoint.media_thumbnail(
                media_id=item.id,
                request=_request(),
                db=db_session,
                current_user=dept.member,
            )
        assert caught.value.status_code == 404

    async def test_a_member_reads_the_published_view_without_research(
        self, db_session, dept
    ):
        hidden = await _person(db_session, dept, first_name="Draft")
        shown = await _person(db_session, dept, first_name="Known")
        await HistoryService(db_session).publish(
            shown, PublicationLevel.MEMBERS, dept.actor
        )
        item = await _upload(
            db_session,
            dept,
            research_notes="From the chief's attic",
            tag_member_ids=[hidden.id, shown.id],
        )
        service = HistoryMediaService(db_session)
        await service.publish(item, PublicationLevel.MEMBERS, dept.actor)
        view = await endpoint.get_media(
            media_id=item.id, db=db_session, current_user=dept.member
        )
        dumped = view.model_dump()
        # Both layers: the service builds no restricted field, and the member
        # schema has none to carry.
        assert "research_notes" not in service.member_view(dept.reader, item)
        assert dumped["view"] == "member"
        assert "research_notes" not in dumped
        assert "original_filename" not in dumped
        assert [t["member_id"] for t in dumped["tags"]] == [shown.id]

    async def test_another_department_cannot_reach_the_item(self, db_session, dept):
        item = await _upload(db_session, dept)
        other_org = await _org(db_session)
        assert (
            await HistoryMediaService(db_session).get_media(other_org, item.id) is None
        )


class TestServingFiles:
    async def test_a_range_is_answered_with_the_requested_bytes(self, db_session, dept):
        content = _wav()
        item = await _upload(db_session, dept, content, "interview.wav")
        response = await endpoint.media_view_file(
            media_id=item.id,
            request=_request("bytes=10-19"),
            db=db_session,
            current_user=dept.historian,
        )
        assert response.status_code == 206
        assert response.headers["content-range"] == f"bytes 10-19/{len(content)}"
        assert response.headers["accept-ranges"] == "bytes"
        assert await _body(response) == content[10:20]

    async def test_a_range_past_the_end_is_refused(self, db_session, dept):
        content = _wav()
        item = await _upload(db_session, dept, content, "interview.wav")
        response = await endpoint.media_view_file(
            media_id=item.id,
            request=_request(f"bytes={len(content)}-"),
            db=db_session,
            current_user=dept.historian,
        )
        assert response.status_code == 416
        assert response.headers["content-range"] == f"bytes */{len(content)}"

    async def test_without_a_range_the_whole_file_is_sent(self, db_session, dept):
        content = _wav()
        item = await _upload(db_session, dept, content, "interview.wav")
        response = await endpoint.media_view_file(
            media_id=item.id,
            request=_request(),
            db=db_session,
            current_user=dept.historian,
        )
        assert response.status_code == 200
        assert await _body(response) == content

    async def test_a_photos_view_is_the_stripped_copy(self, db_session, dept):
        item = await _upload(db_session, dept)
        response = await endpoint.media_view_file(
            media_id=item.id,
            request=_request(),
            db=db_session,
            current_user=dept.historian,
        )
        assert response.headers["content-type"] == "image/webp"
        assert response.headers["cache-control"] == "private, max-age=300"


class TestConsent:
    async def test_each_answer_is_reported_and_none_blocks(self, db_session, dept):
        granted = await _user(db_session, dept.org_id, "Gail")
        declined = await _user(db_session, dept.org_id, "Dora")
        silent = await _user(db_session, dept.org_id, "Nell")
        for user, answer in ((granted, True), (declined, False)):
            db_session.add(
                UserConsent(
                    organization_id=dept.org_id,
                    user_id=str(user.id),
                    consent_type=ConsentType.PHOTO_USE,
                    granted=answer,
                )
            )
        await db_session.flush()
        people = {
            name: await _person(db_session, dept, first_name=name, user_id=uid)
            for name, uid in (
                ("Gail", str(granted.id)),
                ("Dora", str(declined.id)),
                ("Nell", str(silent.id)),
                ("Old", None),
            )
        }
        item = await _upload(
            db_session, dept, tag_member_ids=[p.id for p in people.values()]
        )
        service = HistoryMediaService(db_session)
        states = await service.consent_states(dept.org_id, item.tags)
        assert {name: states[p.id] for name, p in people.items()} == {
            "Gail": "granted",
            "Dora": "declined",
            "Nell": "not_answered",
            "Old": "no_account",
        }
        item, warnings = await service.publish(
            item, PublicationLevel.MEMBERS, dept.actor
        )
        assert item.publication_level == PublicationLevel.MEMBERS
        assert sorted(warnings) == sorted([people["Dora"].id, people["Nell"].id])


class TestPublicationAndClearance:
    async def test_public_waits_for_clearance(self, db_session, dept):
        await HistoryClearanceService(db_session).replace_steps(
            dept.org_id, [{"name": "President", "position_id": dept.president_position}]
        )
        service = HistoryMediaService(db_session)
        item = await _upload(db_session, dept)
        with pytest.raises(ValueError, match="clearance list"):
            await service.publish(item, PublicationLevel.PUBLIC, dept.actor)
        clearance = HistoryClearanceService(db_session)
        request, notify = await clearance.submit(
            item, ClearancePurpose.PUBLIC, dept.actor
        )
        assert request.record_type == "media"
        assert notify == [str(dept.president.id)]
        await clearance.decide(
            request, ClearanceDecisionKind.CLEARED, None, str(dept.president.id)
        )
        item, _ = await service.publish(item, PublicationLevel.PUBLIC, dept.actor)
        assert item.public_snapshot["title"] == "parade"

    async def test_a_title_change_is_substantial_and_keeps_the_public_copy(
        self, db_session, dept
    ):
        service = HistoryMediaService(db_session)
        item = await _upload(db_session, dept, title="Parade, 1962")
        item, _ = await service.publish(item, PublicationLevel.PUBLIC, dept.actor)
        item = await service.update(
            item,
            {"title": "Parade, 1963"},
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert service.public_changes_pending(item)
        assert item.public_snapshot["title"] == "Parade, 1962"

    async def test_a_minor_edit_reaches_the_public_copy(self, db_session, dept):
        service = HistoryMediaService(db_session)
        item = await _upload(db_session, dept)
        item, _ = await service.publish(item, PublicationLevel.PUBLIC, dept.actor)
        item = await service.update(
            item,
            {"place": "Main Street"},
            edit_kind="minor",
            edit_note=None,
            actor_id=dept.actor,
        )
        assert not service.public_changes_pending(item)
        assert item.public_snapshot["place"] == "Main Street"

    async def test_the_public_copy_names_only_public_people(self, db_session, dept):
        history = HistoryService(db_session)
        public = await _person(db_session, dept, first_name="Open")
        await history.publish(public, PublicationLevel.PUBLIC, dept.actor)
        private = await _person(db_session, dept, first_name="Quiet")
        item = await _upload(
            db_session,
            dept,
            research_notes="Notes",
            tag_member_ids=[public.id, private.id],
        )
        item, _ = await HistoryMediaService(db_session).publish(
            item, PublicationLevel.PUBLIC, dept.actor
        )
        assert item.public_snapshot["tags"] == ["Open Smith"]
        assert "research_notes" not in item.public_snapshot

    async def test_a_reviewer_reads_the_draft_item(self, db_session, dept):
        from app.api.v1.endpoints import history as people_endpoint

        await HistoryClearanceService(db_session).replace_steps(
            dept.org_id, [{"name": "President", "position_id": dept.president_position}]
        )
        item = await _upload(db_session, dept)
        request, _ = await HistoryClearanceService(db_session).submit(
            item, ClearancePurpose.PUBLIC, dept.actor
        )
        review = await people_endpoint.review_clearance_request(
            request_id=request.id, db=db_session, current_user=dept.president
        )
        assert review.request.record_type == "media"
        assert review.record.title == "parade"


class TestEditingAndDeleting:
    async def test_tags_are_replaced(self, db_session, dept):
        a = await _person(db_session, dept, first_name="Ann")
        b = await _person(db_session, dept, first_name="Ben")
        service = HistoryMediaService(db_session)
        item = await _upload(db_session, dept, tag_member_ids=[a.id])
        item = await service.replace_tags(item, [b.id], dept.actor)
        assert [t.member_id for t in item.tags] == [b.id]
        assert item.revision_number == 2

    async def test_delete_removes_a_draft_and_its_files(
        self, db_session, dept, uploads
    ):
        item = await _upload(db_session, dept)
        assert len(_files_on_disk(uploads)) == 3
        await endpoint.delete_media(
            media_id=item.id, db=db_session, current_user=dept.historian
        )
        assert _files_on_disk(uploads) == []
        assert (
            await HistoryMediaService(db_session).get_media(dept.org_id, item.id)
            is None
        )

    async def test_a_published_item_is_not_deleted(self, db_session, dept, uploads):
        service = HistoryMediaService(db_session)
        item = await _upload(db_session, dept)
        await service.publish(item, PublicationLevel.MEMBERS, dept.actor)
        with pytest.raises(ValueError, match="Unpublish"):
            await service.delete(item)
        assert len(_files_on_disk(uploads)) == 3


class TestMergeCarriesTags:
    async def test_tags_move_and_one_tagged_with_both_keeps_one(self, db_session, dept):
        keep = await _person(db_session, dept, first_name="John")
        other = await _person(db_session, dept, first_name="John")
        both = await _upload(db_session, dept, tag_member_ids=[keep.id, other.id])
        only_other = await _upload(db_session, dept, tag_member_ids=[other.id])
        await HistoryMergeService(db_session).merge(
            dept.org_id, keep.id, other.id, {}, dept.actor
        )
        rows = (
            await db_session.execute(
                select(HistoryMediaTag.media_id, HistoryMediaTag.member_id).where(
                    HistoryMediaTag.media_id.in_([both.id, only_other.id])
                )
            )
        ).all()
        assert sorted(rows) == sorted([(both.id, keep.id), (only_other.id, keep.id)])


class TestAlbums:
    async def test_members_see_published_albums_and_readable_items(
        self, db_session, dept
    ):
        media = HistoryMediaService(db_session)
        albums = HistoryAlbumService(db_session)
        shown = await _upload(db_session, dept)
        await media.publish(shown, PublicationLevel.MEMBERS, dept.actor)
        hidden = await _upload(db_session, dept)
        album = await albums.create_album(
            dept.org_id,
            {"name": "1962 Parade", "level": AlbumLevel.MEMBERS},
            dept.actor,
        )
        await albums.set_items(album, [hidden.id, shown.id])
        await albums.create_album(dept.org_id, {"name": "Unsorted"}, dept.actor)
        listed = await albums.list_albums(dept.reader)
        assert [(a.name, count) for a, count in listed] == [("1962 Parade", 1)]
        items = await albums.album_items(dept.reader, album)
        assert [i.id for i in items] == [shown.id]
        keeper_items = await albums.album_items(dept.keeper, album)
        assert [i.id for i in keeper_items] == [hidden.id, shown.id]

    async def test_an_album_cannot_hold_another_departments_item(
        self, db_session, dept
    ):
        other_org = await _org(db_session)
        other_pos = await _position(db_session, other_org, "H", ["history.manage"])
        other_user = await _user(db_session, other_org, "Olga", other_pos)
        foreign, _ = await HistoryMediaService(db_session).store_media_upload(
            other_org,
            content=_jpeg(),
            filename="theirs.jpg",
            values={},
            batch_id=None,
            actor=other_user,
        )
        album = await HistoryAlbumService(db_session).create_album(
            dept.org_id, {"name": "Ours"}, dept.actor
        )
        with pytest.raises(ValueError, match="not in this department"):
            await HistoryAlbumService(db_session).set_items(album, [foreign.id])


class TestSources:
    async def test_a_merge_moves_every_item(self, db_session, dept):
        sources = HistorySourceService(db_session)
        old = await sources.create_source(dept.org_id, "Smith family", dept.actor)
        new = await sources.create_source(dept.org_id, "The Smith Family", dept.actor)
        item = await _upload(db_session, dept, source_id=old.id)
        await sources.merge_source(old, new)
        reloaded = await HistoryMediaService(db_session).get_media(dept.org_id, item.id)
        assert reloaded.source_id == new.id
        with pytest.raises(ValueError, match="already on the list"):
            await sources.create_source(dept.org_id, "the smith family", dept.actor)

    async def test_a_dated_item_sorts_into_its_decade(self, db_session, dept):
        item = await _upload(
            db_session, dept, taken_date=date(1962, 7, 4), taken_date_precision="year"
        )
        assert item.taken_date == date(1962, 1, 1)
        items, _ = await HistoryMediaService(db_session).list_media(
            dept.keeper, decade=1960
        )
        assert [i.id for i in items] == [item.id]
