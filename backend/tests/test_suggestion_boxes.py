"""
Suggestion boxes: anonymity, reviewer-only visibility, follow-up threads.

The anonymity tests assert on what is actually in the database and on disk,
not on what an endpoint chooses to render — "anonymous" that is merely hidden
in the response is the failure these exist to catch.
"""

import importlib.util
import io
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import func, select, text

from app.api.v1.endpoints import suggestions as suggestion_endpoints
from app.models.audit import AuditLog
from app.models.suggestion import Suggestion, SuggestionAttachment, SuggestionMessage
from app.models.user import User
from app.schemas.suggestion import SuggestionBoxWrite
from app.services import suggestion_service
from app.services.suggestion_service import (
    SuggestionService,
    anonymous_timestamp,
    forward_notice,
    hash_follow_up_key,
    reviewer_notice,
    submitter_notice,
)


def _uid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


async def _org(db) -> str:
    org_id = _uid()
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"s-{org_id[:8]}"},
    )
    return org_id


async def _user(db, org_id: str, first: str, status: str = "active") -> str:
    user_id = _uid()
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, last_name, "
            "email, password_hash, status) "
            "VALUES (:id, :org, :un, :fn, 'Member', :em, 'hashed', :st)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.example",
            "st": status,
        },
    )
    return user_id


async def _position(
    db, org_id: str, name: str, permissions=(), slug=None, is_system=False
) -> str:
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions, "
            "is_system) VALUES (:id, :org, :name, :slug, :perms, :sys)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": slug or f"p-{position_id[:8]}",
            "perms": json.dumps(list(permissions)),
            "sys": is_system,
        },
    )
    return position_id


async def _assign(db, user_id: str, position_id: str) -> None:
    await db.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )


@pytest.fixture
async def dept(db_session):
    """One department: a training officer (reviewer by position), a member,
    an administrator who reviews nothing, and a direct-member reviewer."""
    org_id = await _org(db_session)
    training_officer = await _user(db_session, org_id, "Tina")
    member = await _user(db_session, org_id, "Sam")
    admin = await _user(db_session, org_id, "Ada")
    direct_reviewer = await _user(db_session, org_id, "Drew")
    inactive_holder = await _user(db_session, org_id, "Ivan", status="inactive")

    training_pos = await _position(db_session, org_id, "Training Officer")
    admin_pos = await _position(
        db_session, org_id, "Box Admin", permissions=["suggestions.manage"]
    )
    await _assign(db_session, training_officer, training_pos)
    await _assign(db_session, inactive_holder, training_pos)
    await _assign(db_session, admin, admin_pos)
    await db_session.flush()
    return {
        "org": org_id,
        "training_officer": training_officer,
        "member": member,
        "admin": admin,
        "direct_reviewer": direct_reviewer,
        "inactive_holder": inactive_holder,
        "training_pos": training_pos,
    }


async def _box(db, dept, **overrides):
    data = SuggestionBoxWrite(
        name=overrides.pop("name", f"Box {uuid.uuid4().hex[:6]}"),
        reviewer_position_ids=overrides.pop(
            "reviewer_position_ids", [dept["training_pos"]]
        ),
        **overrides,
    )
    view = await SuggestionService(db).create_box(dept["org"], data, dept["admin"])
    return await SuggestionService(db).get_box(dept["org"], view["id"])


async def _submit(db, box, user_id, anonymous=False, screenshots=()):
    return await SuggestionService(db).submit(
        box=box,
        user_id=user_id,
        title="More night drills",
        details="Details that must never leave the application.",
        anonymous=anonymous,
        screenshots=list(screenshots),
    )


@pytest.fixture
def upload_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(suggestion_service, "SUGGESTION_ATTACHMENT_DIR", str(tmp_path))
    return tmp_path


def _webp() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buf, format="WEBP")
    return buf.getvalue()


def _jpeg_with_exif() -> bytes:
    exif = Image.Exif()
    exif[0x010F] = "Captain's Phone"  # Make
    exif[0x013B] = "Sam Member"  # Artist
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), "blue").save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Anonymity
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestAnonymousSubmissionsStoreNoAuthor:
    async def test_row_has_no_author_and_day_precision(
        self, db_session, dept, upload_dir
    ):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, key = await _submit(
            db_session, box, dept["member"], anonymous=True, screenshots=[_webp()]
        )

        row = await db_session.get(Suggestion, suggestion.id)
        assert row.is_anonymous is True
        assert row.submitted_by is None
        created = row.created_at
        assert (created.hour, created.minute, created.second, created.microsecond) == (
            12,
            0,
            0,
            0,
        )
        assert row.updated_at == row.created_at
        # The key is returned once and only its digest is kept.
        assert key
        assert row.follow_up_key_hash == hash_follow_up_key(key)
        assert key not in (row.follow_up_key_hash, row.title, row.details)

        attachment = (
            await db_session.execute(
                select(SuggestionAttachment).where(
                    SuggestionAttachment.suggestion_id == row.id
                )
            )
        ).scalar_one()
        assert attachment.file_name == "screenshot-1.webp"
        stamp = anonymous_timestamp(datetime.now(timezone.utc)).timestamp()
        assert os.stat(attachment.file_path).st_mtime == pytest.approx(stamp, abs=1)

    async def test_member_id_appears_nowhere_on_the_submission(
        self, db_session, dept, upload_dir
    ):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, key = await _submit(db_session, box, dept["member"], anonymous=True)
        await SuggestionService(db_session).add_submitter_message(
            await SuggestionService(db_session).get_by_key(dept["org"], key),
            None,
            "Still happening",
        )
        for table, column in (
            ("suggestions", "id"),
            ("suggestion_messages", "suggestion_id"),
            ("suggestion_attachments", "suggestion_id"),
        ):
            rows = (
                (
                    await db_session.execute(
                        text(f"SELECT * FROM {table} WHERE {column} = :id"),
                        {"id": suggestion.id},
                    )
                )
                .mappings()
                .all()
            )
            for row in rows:
                assert dept["member"] not in {str(v) for v in row.values()}, table

    async def test_one_way_box_issues_no_key(self, db_session, dept):
        box = await _box(db_session, dept, follow_up_enabled=False)
        suggestion, key = await _submit(db_session, box, dept["member"], anonymous=True)
        assert key is None
        assert suggestion.follow_up_key_hash is None

    async def test_required_mode_forces_anonymity(self, db_session, dept):
        box = await _box(db_session, dept, anonymity_mode="required")
        suggestion, _ = await _submit(db_session, box, dept["member"], anonymous=False)
        assert suggestion.is_anonymous is True
        assert suggestion.submitted_by is None

    async def test_disabled_mode_refuses_anonymity(self, db_session, dept):
        box = await _box(db_session, dept, anonymity_mode="disabled")
        with pytest.raises(ValueError, match="does not accept anonymous"):
            await _submit(db_session, box, dept["member"], anonymous=True)

    async def test_anonymous_submissions_are_not_listed_as_mine(self, db_session, dept):
        box = await _box(db_session, dept)
        await _submit(db_session, box, dept["member"], anonymous=True)
        named, _ = await _submit(db_session, box, dept["member"], anonymous=False)
        mine = await SuggestionService(db_session).list_mine(
            dept["org"], dept["member"]
        )
        assert [m["id"] for m in mine] == [named.id]


# ---------------------------------------------------------------------------
# Who can read a box
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestOnlyReviewersReadABox:
    async def test_position_reviewer_reads_and_admin_does_not(self, db_session, dept):
        box = await _box(db_session, dept)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)

        assert await service.get_for_review(
            dept["org"], dept["training_officer"], suggestion.id
        )
        # suggestions.manage configures boxes; it does not read them.
        assert (
            await service.get_for_review(dept["org"], dept["admin"], suggestion.id)
            is None
        )
        items, total = await service.list_for_review(dept["org"], dept["admin"])
        assert (items, total) == ([], 0)

    async def test_direct_member_reviewer(self, db_session, dept):
        box = await _box(
            db_session,
            dept,
            reviewer_position_ids=[],
            reviewer_member_ids=[dept["direct_reviewer"]],
        )
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)
        assert await service.get_for_review(
            dept["org"], dept["direct_reviewer"], suggestion.id
        )
        assert (
            await service.get_for_review(
                dept["org"], dept["training_officer"], suggestion.id
            )
            is None
        )

    async def test_reviewing_one_box_does_not_open_another(self, db_session, dept):
        mine = await _box(db_session, dept)
        other = await _box(
            db_session,
            dept,
            reviewer_position_ids=[],
            reviewer_member_ids=[dept["direct_reviewer"]],
        )
        hidden, _ = await _submit(db_session, other, dept["member"])
        service = SuggestionService(db_session)
        assert (
            await service.get_for_review(
                dept["org"], dept["training_officer"], hidden.id
            )
            is None
        )
        items, _ = await service.list_for_review(
            dept["org"], dept["training_officer"], box_id=other.id
        )
        assert items == []
        await _submit(db_session, mine, dept["member"])
        items, total = await service.list_for_review(
            dept["org"], dept["training_officer"]
        )
        assert total == 1
        assert items[0]["box_id"] == mine.id

    async def test_other_org_cannot_read_even_by_id(self, db_session, dept):
        box = await _box(db_session, dept)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        other_org = await _org(db_session)
        outsider = await _user(db_session, other_org, "Olga")
        await _assign(db_session, outsider, dept["training_pos"])
        await db_session.flush()
        service = SuggestionService(db_session)
        assert await service.get_for_review(other_org, outsider, suggestion.id) is None
        assert await service.get_mine(other_org, dept["member"], suggestion.id) is None

    async def test_recipients_are_active_reviewers_only(self, db_session, dept):
        box = await _box(
            db_session, dept, reviewer_member_ids=[dept["direct_reviewer"]]
        )
        recipients = await SuggestionService(db_session).reviewer_recipient_ids(
            dept["org"], box.id
        )
        assert set(recipients) == {dept["training_officer"], dept["direct_reviewer"]}


@pytest.mark.integration
class TestBoxConfiguration:
    async def test_foreign_reviewer_ids_are_rejected(self, db_session, dept):
        other_org = await _org(db_session)
        foreign_pos = await _position(db_session, other_org, "Chief")
        foreign_user = await _user(db_session, other_org, "Fred")
        await db_session.flush()
        service = SuggestionService(db_session)
        for data in (
            SuggestionBoxWrite(name="A", reviewer_position_ids=[foreign_pos]),
            SuggestionBoxWrite(name="B", reviewer_member_ids=[foreign_user]),
        ):
            with pytest.raises(ValueError, match="Invalid reviewer"):
                await service.create_box(dept["org"], data, dept["admin"])

    async def test_active_box_needs_a_reviewer(self, db_session, dept):
        with pytest.raises(ValueError, match="at least one reviewer"):
            await SuggestionService(db_session).create_box(
                dept["org"], SuggestionBoxWrite(name="Empty"), dept["admin"]
            )

    async def test_names_are_unique_per_org(self, db_session, dept):
        await _box(db_session, dept, name="Ideas")
        with pytest.raises(ValueError, match="already exists"):
            await _box(db_session, dept, name="Ideas")

    async def test_update_replaces_reviewers(self, db_session, dept):
        box = await _box(db_session, dept, name="Ideas")
        view = await SuggestionService(db_session).update_box(
            dept["org"],
            box.id,
            SuggestionBoxWrite(
                name="Ideas", reviewer_member_ids=[dept["direct_reviewer"]]
            ),
        )
        assert view["reviewer_positions"] == []
        assert [m["id"] for m in view["reviewer_members"]] == [dept["direct_reviewer"]]

    async def test_archived_box_takes_no_submissions(self, db_session, dept):
        box = await _box(db_session, dept, is_active=False)
        service = SuggestionService(db_session)
        assert await service.get_open_box(dept["org"], box.id) is None
        assert box.id not in {b.id for b in await service.list_open_boxes(dept["org"])}


# ---------------------------------------------------------------------------
# Follow-up
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestFollowUp:
    async def test_named_thread_round_trip(self, db_session, dept):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)

        reviewed = await service.get_for_review(
            dept["org"], dept["training_officer"], suggestion.id
        )
        await service.add_reviewer_message(
            reviewed, dept["training_officer"], "Which shift?"
        )
        mine = await service.get_mine(dept["org"], dept["member"], suggestion.id)
        await service.add_submitter_message(mine, dept["member"], "B shift")

        view = await service.submitter_view(
            await service.get_mine(dept["org"], dept["member"], suggestion.id),
            dept["member"],
        )
        assert [
            (m["author_role"], m["body"], m["is_mine"]) for m in view["messages"]
        ] == [
            ("reviewer", "Which shift?", False),
            ("submitter", "B shift", True),
        ]
        assert view["disposition"] == "new"

    async def test_anonymous_reply_by_key_keeps_no_author(self, db_session, dept):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, key = await _submit(db_session, box, dept["member"], anonymous=True)
        service = SuggestionService(db_session)
        before = suggestion.updated_at

        await service.add_submitter_message(
            await service.get_by_key(dept["org"], key), None, "More detail"
        )
        message = (
            await db_session.execute(
                select(SuggestionMessage).where(
                    SuggestionMessage.suggestion_id == suggestion.id
                )
            )
        ).scalar_one()
        assert message.author_id is None
        assert (message.created_at.hour, message.created_at.minute) == (12, 0)
        row = await db_session.get(Suggestion, suggestion.id)
        assert row.updated_at == before

        review = await service.reviewer_view(
            await service.get_for_review(
                dept["org"], dept["training_officer"], suggestion.id
            ),
            dept["training_officer"],
        )
        assert review["submitter_name"] is None
        assert review["messages"][0]["author_name"] is None
        assert review["messages"][0]["timestamp_precision"] == "day"

    async def test_sequences_increment(self, db_session, dept):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)
        for body in ("one", "two", "three"):
            reviewed = await service.get_for_review(
                dept["org"], dept["training_officer"], suggestion.id
            )
            await service.add_reviewer_message(reviewed, dept["training_officer"], body)
        sequences = (
            (
                await db_session.execute(
                    select(SuggestionMessage.sequence)
                    .where(SuggestionMessage.suggestion_id == suggestion.id)
                    .order_by(SuggestionMessage.sequence)
                )
            )
            .scalars()
            .all()
        )
        assert sequences == [1, 2, 3]

    async def test_one_way_box_refuses_replies_and_hides_status(self, db_session, dept):
        box = await _box(db_session, dept, follow_up_enabled=False)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)
        reviewed = await service.get_for_review(
            dept["org"], dept["training_officer"], suggestion.id
        )
        with pytest.raises(ValueError, match="does not take follow-up"):
            await service.add_reviewer_message(reviewed, dept["training_officer"], "Hi")
        mine = await service.get_mine(dept["org"], dept["member"], suggestion.id)
        with pytest.raises(ValueError, match="does not take follow-up"):
            await service.add_submitter_message(mine, dept["member"], "Hi")
        await service.update_disposition(
            reviewed, dept["training_officer"], {"disposition": "declined"}
        )
        view = await service.submitter_view(
            await service.get_mine(dept["org"], dept["member"], suggestion.id),
            dept["member"],
        )
        assert view["disposition"] is None
        assert view["messages"] == []

    async def test_keyless_anonymous_submission_cannot_be_followed_up(
        self, db_session, dept
    ):
        box = await _box(db_session, dept, name="Late", follow_up_enabled=False)
        suggestion, key = await _submit(db_session, box, dept["member"], anonymous=True)
        assert key is None
        await SuggestionService(db_session).update_box(
            dept["org"],
            box.id,
            SuggestionBoxWrite(
                name="Late",
                follow_up_enabled=True,
                reviewer_position_ids=[dept["training_pos"]],
            ),
        )
        reviewed = await SuggestionService(db_session).get_for_review(
            dept["org"], dept["training_officer"], suggestion.id
        )
        assert SuggestionService.can_follow_up(reviewed) is False

    async def test_internal_note_is_not_in_the_submitter_view(self, db_session, dept):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)
        reviewed = await service.get_for_review(
            dept["org"], dept["training_officer"], suggestion.id
        )
        previous = await service.update_disposition(
            reviewed,
            dept["training_officer"],
            {"disposition": "accepted", "internal_note": "Budget line 4"},
        )
        assert previous == "new"
        view = await service.submitter_view(
            await service.get_mine(dept["org"], dept["member"], suggestion.id),
            dept["member"],
        )
        assert "internal_note" not in view
        assert "Budget line 4" not in json.dumps(view, default=str)

    async def test_null_clears_internal_note(self, db_session, dept):
        box = await _box(db_session, dept)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)
        reviewed = await service.get_for_review(
            dept["org"], dept["training_officer"], suggestion.id
        )
        await service.update_disposition(
            reviewed, dept["training_officer"], {"internal_note": "x"}
        )
        await service.update_disposition(
            reviewed, dept["training_officer"], {"internal_note": None}
        )
        assert (await db_session.get(Suggestion, suggestion.id)).internal_note is None


# ---------------------------------------------------------------------------
# Over HTTP
# ---------------------------------------------------------------------------


async def _client(db_session, user_id):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.api.dependencies import get_current_user
    from app.core.database import get_db

    user = await db_session.get(User, user_id)
    await db_session.refresh(user, ["positions"])
    app = FastAPI()
    app.include_router(suggestion_endpoints.router, prefix="/suggestions")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def sent(monkeypatch):
    notices = []

    async def _capture(organization_id, user_ids, notice):
        notices.append((organization_id, sorted(user_ids), notice))

    monkeypatch.setattr(suggestion_endpoints, "send_suggestion_notice", _capture)
    return notices


@pytest.mark.integration
class TestOverHttp:
    async def test_anonymous_upload_strips_exif_and_writes_no_audit(
        self, db_session, dept, upload_dir, sent
    ):
        box = await _box(db_session, dept, follow_up_enabled=True)
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.post(
                f"/suggestions/boxes/{box.id}/submissions",
                data={"title": "Hose", "details": "Leaks", "anonymous": "true"},
                files=[
                    ("screenshots", ("IMG_Sam.jpg", _jpeg_with_exif(), "image/jpeg"))
                ],
            )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["id"] is None
        assert body["isAnonymous"] is True
        assert body["followUpKey"]

        attachment = (
            await db_session.execute(
                select(SuggestionAttachment).where(
                    SuggestionAttachment.organization_id == dept["org"]
                )
            )
        ).scalar_one()
        stored = Path(attachment.file_path).read_bytes()
        assert b"Sam Member" not in stored
        assert b"Captain" not in stored
        with Image.open(io.BytesIO(stored)) as image:
            assert image.format == "WEBP"
            assert not image.getexif()
        assert attachment.file_name == "screenshot-1.webp"

        audits = await db_session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.event_type == "suggestion_submitted",
                AuditLog.user_id == dept["member"],
            )
        )
        assert audits == 0
        # Reviewers are told, with no submission content in the notice.
        ((_, recipients, notice),) = sent
        assert recipients == [dept["training_officer"]]
        assert "Leaks" not in notice["body_html"]

    async def test_non_image_upload_is_refused(
        self, db_session, dept, upload_dir, sent
    ):
        box = await _box(db_session, dept)
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.post(
                f"/suggestions/boxes/{box.id}/submissions",
                data={"title": "T", "details": "D"},
                files=[
                    ("screenshots", ("x.png", b"#!/bin/sh\necho hi\n", "image/png"))
                ],
            )
        assert resp.status_code == 400
        assert (
            await db_session.scalar(
                select(func.count(Suggestion.id)).where(Suggestion.box_id == box.id)
            )
            == 0
        )

    async def test_too_many_screenshots_is_refused(self, db_session, dept, sent):
        box = await _box(db_session, dept)
        files = [
            ("screenshots", (f"{i}.webp", _webp(), "image/webp")) for i in range(6)
        ]
        async with await _client(db_session, dept["member"]) as client:
            resp = await client.post(
                f"/suggestions/boxes/{box.id}/submissions",
                data={"title": "T", "details": "D"},
                files=files,
            )
        assert resp.status_code == 400

    async def test_key_lookup_and_reply(self, db_session, dept, upload_dir, sent):
        box = await _box(db_session, dept, follow_up_enabled=True)
        _, key = await _submit(db_session, box, dept["member"], anonymous=True)
        async with await _client(db_session, dept["direct_reviewer"]) as client:
            wrong = await client.post(
                "/suggestions/follow-up/lookup", json={"key": "x" * 43}
            )
            reply = await client.post(
                "/suggestions/follow-up/messages", json={"key": key, "body": "Update"}
            )
        assert wrong.status_code == 404
        assert reply.status_code == 200, reply.text
        detail = reply.json()
        assert detail["id"] is None
        assert [m["body"] for m in detail["messages"]] == ["Update"]
        assert detail["messages"][0]["isMine"] is True
        assert "internalNote" not in detail

    async def test_admin_routes_need_suggestions_manage(self, db_session, dept, sent):
        async with await _client(db_session, dept["training_officer"]) as client:
            denied = await client.get("/suggestions/admin/boxes")
        async with await _client(db_session, dept["admin"]) as client:
            created = await client.post(
                "/suggestions/admin/boxes",
                json={
                    "name": "Complaints",
                    "anonymityMode": "allowed",
                    "followUpEnabled": True,
                    "reviewerMemberIds": [dept["direct_reviewer"]],
                },
            )
        assert denied.status_code == 403
        assert created.status_code == 201, created.text
        assert created.json()["reviewerMembers"][0]["id"] == dept["direct_reviewer"]

    async def test_disposition_change_notifies_named_submitter(
        self, db_session, dept, sent
    ):
        box = await _box(db_session, dept, follow_up_enabled=True)
        suggestion, _ = await _submit(db_session, box, dept["member"])
        async with await _client(db_session, dept["admin"]) as client:
            outsider = await client.patch(
                f"/suggestions/review/{suggestion.id}", json={"disposition": "accepted"}
            )
        async with await _client(db_session, dept["training_officer"]) as client:
            resp = await client.patch(
                f"/suggestions/review/{suggestion.id}", json={"disposition": "accepted"}
            )
        assert outsider.status_code == 404
        assert resp.status_code == 200, resp.text
        assert resp.json()["disposition"] == "accepted"
        ((_, recipients, notice),) = sent
        assert recipients == [dept["member"]]
        assert "accepted" in notice["body_html"]


# ---------------------------------------------------------------------------
# Pure helpers and the grant migration
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestForwarding:
    """A forward makes its recipients reviewers of one suggestion — never of
    the box, and never able to pass it on."""

    async def _forwarded(self, db_session, dept, **kwargs):
        box = await _box(db_session, dept, follow_up_enabled=True)
        target, _ = await _submit(db_session, box, dept["member"])
        other, _ = await _submit(db_session, box, dept["member"])
        service = SuggestionService(db_session)
        reviewed = await service.get_for_review(
            dept["org"], dept["training_officer"], target.id
        )
        added = await service.add_forwards(
            reviewed,
            dept["training_officer"],
            kwargs.get("position_ids", []),
            kwargs.get("member_ids", [dept["direct_reviewer"]]),
        )
        return service, target, other, added

    async def test_recipient_reviews_that_suggestion_only(self, db_session, dept):
        service, target, other, added = await self._forwarded(db_session, dept)
        assert added == ([], [dept["direct_reviewer"]])
        reader = dept["direct_reviewer"]

        forwarded = await service.get_for_review(dept["org"], reader, target.id)
        assert forwarded is not None
        assert await service.get_for_review(dept["org"], reader, other.id) is None
        items, total = await service.list_for_review(dept["org"], reader)
        assert total == 1
        assert items[0]["id"] == target.id
        assert items[0]["via_forward"] is True

        # Full reviewer of that item: disposition and reply both work.
        await service.update_disposition(forwarded, reader, {"disposition": "accepted"})
        await service.add_reviewer_message(forwarded, reader, "Looking into it")
        view = await service.reviewer_view(
            await service.get_for_review(dept["org"], reader, target.id), reader
        )
        assert view["disposition"] == "accepted"
        assert view["can_forward"] is False
        assert view["via_forward"] is True
        assert [f["target_id"] for f in view["forwards"]] == [reader]

        summary = await service.review_summary(dept["org"], reader)
        assert summary["is_reviewer"] is True
        assert summary["boxes"] == []

    async def test_forward_to_a_position(self, db_session, dept):
        pos = await _position(db_session, dept["org"], "Apparatus Officer")
        await _assign(db_session, dept["member"], pos)
        await db_session.flush()
        service, target, _, added = await self._forwarded(
            db_session, dept, position_ids=[pos], member_ids=[]
        )
        assert added == ([pos], [])
        assert await service.get_for_review(dept["org"], dept["member"], target.id)
        recipients = await service.suggestion_recipient_ids(target)
        assert dept["member"] in recipients
        assert dept["training_officer"] in recipients

    async def test_forwarding_twice_adds_nothing(self, db_session, dept):
        service, target, _, _ = await self._forwarded(db_session, dept)
        again = await service.add_forwards(
            target, dept["training_officer"], [], [dept["direct_reviewer"]]
        )
        assert again == ([], [])

    async def test_withdrawing_removes_access(self, db_session, dept):
        service, target, _, _ = await self._forwarded(db_session, dept)
        forward_id = (await service.list_forwards(target))[0]["id"]
        removed = await service.remove_forward(target, forward_id)
        assert removed == {"position_id": None, "user_id": dept["direct_reviewer"]}
        assert (
            await service.get_for_review(
                dept["org"], dept["direct_reviewer"], target.id
            )
            is None
        )
        assert await service.remove_forward(target, forward_id) is None

    async def test_foreign_targets_are_rejected(self, db_session, dept):
        box = await _box(db_session, dept)
        target, _ = await _submit(db_session, box, dept["member"])
        other_org = await _org(db_session)
        outsider = await _user(db_session, other_org, "Olga")
        await db_session.flush()
        with pytest.raises(ValueError, match="Invalid member"):
            await SuggestionService(db_session).add_forwards(
                target, dept["training_officer"], [], [outsider]
            )

    async def test_nothing_chosen_is_rejected(self, db_session, dept):
        box = await _box(db_session, dept)
        target, _ = await _submit(db_session, box, dept["member"])
        with pytest.raises(ValueError, match="at least one"):
            await SuggestionService(db_session).add_forwards(
                target, dept["training_officer"], [], []
            )

    async def test_over_http(self, db_session, dept, sent):
        box = await _box(db_session, dept)
        target, _ = await _submit(db_session, box, dept["member"])
        async with await _client(db_session, dept["training_officer"]) as client:
            options = await client.get("/suggestions/review/forward-options")
            resp = await client.post(
                f"/suggestions/review/{target.id}/forwards",
                json={"memberIds": [dept["direct_reviewer"]]},
            )
        assert options.status_code == 200
        assert resp.status_code == 200, resp.text
        forwards = resp.json()["forwards"]
        assert [f["targetId"] for f in forwards] == [dept["direct_reviewer"]]
        ((_, recipients, notice),) = sent
        assert recipients == [dept["direct_reviewer"]]
        assert "More night drills" not in notice["body_html"]
        audits = await db_session.scalar(
            select(func.count(AuditLog.id)).where(
                AuditLog.event_type == "suggestion_forwarded",
                AuditLog.user_id == dept["training_officer"],
            )
        )
        assert audits == 1

        # The recipient reviews the item but cannot forward it on, and is not
        # offered the picker.
        async with await _client(db_session, dept["direct_reviewer"]) as client:
            reread = await client.get(f"/suggestions/review/{target.id}")
            onward = await client.post(
                f"/suggestions/review/{target.id}/forwards",
                json={"memberIds": [dept["member"]]},
            )
            withdraw = await client.delete(
                f"/suggestions/review/{target.id}/forwards/{forwards[0]['id']}"
            )
            picker = await client.get("/suggestions/review/forward-options")
        assert reread.status_code == 200
        assert reread.json()["canForward"] is False
        assert onward.status_code == 403
        assert withdraw.status_code == 403
        assert picker.status_code == 403

        async with await _client(db_session, dept["training_officer"]) as client:
            resp = await client.delete(
                f"/suggestions/review/{target.id}/forwards/{forwards[0]['id']}"
            )
        assert resp.status_code == 200
        assert resp.json()["forwards"] == []


@pytest.mark.unit
class TestNotices:
    def test_reviewer_notice_escapes_and_carries_no_content(self):
        notice = reviewer_notice("<Complaints>", "abc", reply=False)
        assert "&lt;Complaints&gt;" in notice["body_html"]
        assert "<Complaints>" not in notice["body_html"]
        assert "tab=review&amp;id=abc" in notice["body_html"]

    def test_subject_cannot_carry_a_line_break(self):
        notice = reviewer_notice("Ideas\r\nBcc: x@example.com", "abc", reply=False)
        assert "\n" not in notice["subject"]
        assert "\r" not in notice["subject"]

    def test_forward_notice_carries_no_content(self):
        notice = forward_notice("Complaints", "abc")
        assert "forwarded" in notice["subject"]
        assert "tab=review&amp;id=abc" in notice["body_html"]

    def test_submitter_notice_names_the_status(self):
        notice = submitter_notice("Ideas", "abc", disposition="under_review")
        assert "under review" in notice["body_html"]

    def test_anonymous_timestamp_is_noon_utc(self):
        moment = datetime(2026, 9, 23, 22, 17, 5, 123, tzinfo=timezone.utc)
        assert anonymous_timestamp(moment) == datetime(
            2026, 9, 23, 12, 0, tzinfo=timezone.utc
        )


def _load_grant_migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/20260923_2219_394600cbfae2_grant_suggestions_manage.py"
    )
    spec = importlib.util.spec_from_file_location("grant_suggestions_manage", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.unit
def test_grant_migration_targets_exactly_the_registry_positions():
    from app.core.permissions import DEFAULT_POSITIONS

    seeded = {
        slug
        for slug, spec in DEFAULT_POSITIONS.items()
        if "suggestions.manage" in spec["permissions"]
    }
    assert set(_load_grant_migration()._SLUGS) == seeded


@pytest.mark.integration
async def test_grant_migration_rewrites_only_seeded_rows(db_session):
    migration = _load_grant_migration()
    org_id = await _org(db_session)
    seeded = await _position(
        db_session,
        org_id,
        "President",
        ["members.view"],
        slug="president",
        is_system=True,
    )
    # Slugs are unique per org, so the department-created one lives in another.
    custom = await _position(
        db_session,
        await _org(db_session),
        "President",
        ["members.view"],
        slug="president",
        is_system=False,
    )
    captain = await _position(
        db_session, org_id, "Captain", ["members.view"], slug="captain", is_system=True
    )
    await db_session.flush()

    async def perms(position_id):
        raw = await db_session.scalar(
            text("SELECT permissions FROM positions WHERE id = :id"),
            {"id": position_id},
        )
        return migration._load_permissions(raw)

    for _ in range(2):  # idempotent
        await db_session.run_sync(
            lambda s: migration._rewrite(s.connection(), migration._add)
        )
    assert await perms(seeded) == ["members.view", "suggestions.manage"]
    assert await perms(custom) == ["members.view"]
    assert await perms(captain) == ["members.view"]

    await db_session.run_sync(
        lambda s: migration._rewrite(s.connection(), migration._remove)
    )
    assert await perms(seeded) == ["members.view"]
