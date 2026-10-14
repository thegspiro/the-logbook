"""Meeting-minutes record keeping, end to end over HTTP against the real schema.

A mocked session never evaluates a constraint, a lock or a unique key, and the
things under test here are exactly those: one revision per approval, a
(minutes, election) pair filed once, an item carried forward once, and the
org and executive-session boundaries. So this drives the real routers.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import minutes as minutes_endpoints
from app.api.v1.endpoints import minutes_records as records_endpoints
from app.core.database import get_db
from app.models.election import Election, ElectionStatus
from app.models.event import Event, EventExternalAttendee, EventRSVP, EventType
from app.models.minute import (
    ActionItem,
    MeetingMinutes,
    MinutesAttachment,
    MinutesMeetingType,
    MinutesRevision,
    MinutesStatus,
)
from app.models.user import User
from app.services import file_storage_service as file_storage
from app.services import upload_scanning
from app.utils.minutes_pdf import render_minutes_pdf

pytestmark = [pytest.mark.integration]


# ── Fixtures ─────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(file_storage, "UPLOADS_ROOT", str(tmp_path))
    monkeypatch.setattr(upload_scanning, "is_malware_scan_enabled", lambda: False)
    return tmp_path


def _pdf_bytes() -> bytes:
    return render_minutes_pdf({"title": "Attachment"}, {"generated_at": "now"}).read()


async def _org(db: AsyncSession, label: str) -> str:
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, :name, 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "name": label, "slug": f"{label}-{org_id[:8]}".lower()},
    )
    return org_id


async def _user(
    db: AsyncSession,
    org_id: str,
    first: str,
    permissions: list[str],
    preferences: Optional[str] = None,
) -> User:
    user_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status, notification_preferences) "
            "VALUES (:id, :org, :un, :fn, 'Tester', :em, 'hashed', 'active', :prefs)"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"{first.lower()}-{user_id[:8]}",
            "fn": first,
            "em": f"{first.lower()}-{user_id[:8]}@test.example",
            "prefs": preferences or "{}",
        },
    )
    position_id = str(uuid.uuid4())
    perms = ", ".join(f'"{p}"' for p in permissions)
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, :name, :slug, :perms)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": f"{first} role",
            "slug": f"{first.lower()}-{position_id[:8]}",
            "perms": f"[{perms}]",
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


MANAGE = ["minutes.view", "minutes.manage"]


class _World:
    db: AsyncSession
    org_id: str
    secretary: User
    approver: User
    member: User
    assignee: User
    outsider: User
    other_org_id: str


@pytest.fixture
async def world(db_session: AsyncSession) -> _World:
    w = _World()
    w.db = db_session
    w.org_id = await _org(db_session, "alpha")
    w.other_org_id = await _org(db_session, "bravo")
    w.secretary = await _user(db_session, w.org_id, "Secretary", MANAGE)
    w.approver = await _user(db_session, w.org_id, "Approver", MANAGE)
    w.member = await _user(db_session, w.org_id, "Member", ["minutes.view"])
    w.assignee = await _user(db_session, w.org_id, "Assignee", ["minutes.view"])
    w.outsider = await _user(db_session, w.other_org_id, "Outsider", MANAGE)
    return w


def _client(db: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(minutes_endpoints.router, prefix="/minutes")
    app.include_router(records_endpoints.router, prefix="/minutes")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def _create(
    w: _World,
    *,
    meeting_type: str = "business",
    when: Optional[datetime] = None,
    items: Optional[list[dict[str, Any]]] = None,
    **extra: Any,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": "Monthly meeting",
        "meeting_type": meeting_type,
        "meeting_date": (
            when or datetime(2026, 10, 1, 19, 0, tzinfo=timezone.utc)
        ).isoformat(),
        "location": "Station 1",
        "attendees": [
            {"user_id": str(w.secretary.id), "name": "Secretary", "status": "present"},
            {"user_id": str(w.member.id), "name": "Member", "status": "excused"},
            {"name": "A visitor", "status": "guest"},
        ],
        "action_items": items or [],
    }
    payload.update(extra)
    async with _client(w.db, w.secretary) as c:
        resp = await c.post("/minutes", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _approve(w: _World, minutes_id: str) -> dict[str, Any]:
    async with _client(w.db, w.secretary) as c:
        assert (await c.post(f"/minutes/{minutes_id}/submit")).status_code == 200
    async with _client(w.db, w.approver) as c:
        resp = await c.post(f"/minutes/{minutes_id}/approve")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _closed_election(
    db: AsyncSession, org_id: str, title: str = "Officer election", closed: bool = True
) -> Election:
    now = datetime.now(timezone.utc)
    election = Election(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title=title,
        election_type="general",
        positions=["Chief"],
        start_date=now - timedelta(days=2),
        end_date=now - timedelta(days=1),
        status=ElectionStatus.CLOSED if closed else ElectionStatus.OPEN,
        closed_at=now - timedelta(days=1) if closed else None,
    )
    db.add(election)
    await db.flush()
    return election


# ── Attendance ───────────────────────────────────────────────────────


class TestAttendance:
    async def test_the_roll_is_stored_with_a_status_and_a_derived_present(
        self, world: _World
    ):
        minutes = await _create(world)
        by_name = {a["name"]: a for a in minutes["attendees"]}
        assert by_name["Secretary"]["present"] is True
        assert by_name["Member"]["status"] == "excused"
        assert by_name["Member"]["present"] is False
        assert by_name["A visitor"]["status"] == "guest"
        assert by_name["A visitor"]["present"] is False

    async def test_quorum_counts_members_in_the_room_and_not_guests(
        self, world: _World
    ):
        minutes = await _create(
            world,
            attendees=[
                {"user_id": str(world.secretary.id), "name": "S", "status": "present"},
                {"user_id": str(world.approver.id), "name": "A", "status": "late"},
                {"user_id": str(world.member.id), "name": "M", "status": "left_early"},
                {"name": "Visitor", "status": "guest"},
                {"user_id": str(world.assignee.id), "name": "X", "status": "absent"},
            ],
        )
        async with _client(world.db, world.secretary) as c:
            await c.patch(
                f"/minutes/{minutes['id']}/quorum-config",
                params={"quorum_type": "count", "quorum_threshold": 3},
            )
            resp = await c.get(f"/minutes/{minutes['id']}/quorum")
        assert resp.status_code == 200, resp.text
        assert resp.json()["present_count"] == 3
        assert resp.json()["quorum_met"] is True

    async def test_a_member_listed_twice_is_refused(self, world: _World):
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                "/minutes",
                json={
                    "title": "Dup",
                    "meeting_type": "business",
                    "meeting_date": "2026-10-01T19:00:00Z",
                    "attendees": [
                        {"user_id": str(world.member.id), "name": "M"},
                        {"user_id": str(world.member.id), "name": "M again"},
                    ],
                },
            )
        assert resp.status_code == 422

    async def test_an_attendee_from_another_department_is_refused(self, world: _World):
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                "/minutes",
                json={
                    "title": "Foreign",
                    "meeting_type": "business",
                    "meeting_date": "2026-10-01T19:00:00Z",
                    "attendees": [
                        {"user_id": str(world.outsider.id), "name": "Outsider"}
                    ],
                },
            )
        assert resp.status_code == 400

    async def test_suggestions_come_from_the_roster_when_there_is_no_event(
        self, world: _World
    ):
        minutes = await _create(world, attendees=[])
        async with _client(world.db, world.secretary) as c:
            resp = await c.get(f"/minutes/{minutes['id']}/attendance-suggestions")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["source"] == "roster"
        ids = {e["user_id"] for e in body["entries"]}
        assert ids == {
            str(u.id)
            for u in (world.secretary, world.approver, world.member, world.assignee)
        }
        assert str(world.outsider.id) not in ids
        assert {e["status"] for e in body["entries"]} == {"absent"}

    async def test_suggestions_use_event_check_ins_and_keep_the_secretarys_edits(
        self, world: _World
    ):
        now = datetime.now(timezone.utc)
        event = Event(
            id=str(uuid.uuid4()),
            organization_id=world.org_id,
            title="October business meeting",
            event_type=EventType.BUSINESS_MEETING,
            start_datetime=now,
            end_datetime=now + timedelta(hours=2),
        )
        world.db.add(event)
        await world.db.flush()
        world.db.add_all(
            [
                EventRSVP(
                    organization_id=world.org_id,
                    event_id=event.id,
                    user_id=str(world.approver.id),
                    checked_in=True,
                ),
                EventExternalAttendee(
                    organization_id=world.org_id,
                    event_id=event.id,
                    name="Guest Speaker",
                    checked_in=True,
                ),
            ]
        )
        await world.db.flush()
        minutes = await _create(
            world,
            event_id=event.id,
            attendees=[
                {
                    "user_id": str(world.assignee.id),
                    "name": "Assignee",
                    "status": "excused",
                    "note": "Family emergency",
                }
            ],
        )
        async with _client(world.db, world.secretary) as c:
            resp = await c.get(f"/minutes/{minutes['id']}/attendance-suggestions")
        body = resp.json()
        assert body["source"] == "event"
        assert body["event_title"] == "October business meeting"
        by_user = {e["user_id"]: e for e in body["entries"] if e["user_id"]}
        assert by_user[str(world.approver.id)]["status"] == "present"
        assert by_user[str(world.secretary.id)]["status"] == "absent"
        kept = by_user[str(world.assignee.id)]
        assert (kept["status"], kept["note"]) == ("excused", "Family emergency")
        guests = [e for e in body["entries"] if e["user_id"] is None]
        assert [(g["name"], g["status"]) for g in guests] == [
            ("Guest Speaker", "guest")
        ]

    async def test_a_member_cannot_ask_for_suggestions(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.member) as c:
            resp = await c.get(f"/minutes/{minutes['id']}/attendance-suggestions")
        assert resp.status_code == 403


# ── Approval, revisions, locking ─────────────────────────────────────


class TestRevisions:
    async def test_approval_records_version_one_and_it_verifies(self, world: _World):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            revisions = (await c.get(f"/minutes/{minutes['id']}/revisions")).json()
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert [r["version"] for r in revisions] == [1]
        assert revisions[0]["approved_by"] == str(world.approver.id)
        assert "Approver" in revisions[0]["approved_by_name"]
        assert "Secretary" in revisions[0]["submitted_by_name"]
        assert revisions[0]["superseded_at"] is None
        assert len(revisions[0]["content_hash"]) == 64
        assert verify["verified"] is True
        assert verify["version"] == 1

    async def test_progress_on_an_action_item_does_not_unverify_the_record(
        self, world: _World
    ):
        minutes = await _create(
            world,
            items=[
                {"description": "Order hose", "assignee_id": str(world.assignee.id)}
            ],
        )
        await _approve(world, minutes["id"])
        item_id = minutes["action_items"][0]["id"]
        async with _client(world.db, world.assignee) as c:
            done = await c.put(
                f"/minutes/{minutes['id']}/action-items/{item_id}",
                json={"status": "completed", "completion_notes": "Ordered"},
            )
            assert done.status_code == 200, done.text
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is True

    async def test_a_change_behind_the_apps_back_is_detected_and_located(
        self, world: _World
    ):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        await world.db.execute(
            text(
                "UPDATE meeting_minutes SET location = 'Somewhere else' WHERE id = :i"
            ),
            {"i": minutes["id"]},
        )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        assert verify["changed"] == ["location"]
        assert verify["content_hash"] != verify["current_hash"]

    async def test_approved_minutes_are_locked_and_unapproved_ones_have_no_version(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.member) as c:
            draft = await c.get(f"/minutes/{minutes['id']}/verify")
        assert draft.status_code == 404  # a draft is invisible to a member
        async with _client(world.db, world.secretary) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            edit = await c.put(f"/minutes/{minutes['id']}", json={"location": "X"})
        assert edit.status_code == 400

    async def test_reopen_keeps_the_first_version_and_the_correction_is_version_two(
        self, world: _World
    ):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            reopened = await c.post(
                f"/minutes/{minutes['id']}/reopen",
                json={"reason": "The location was recorded wrongly"},
            )
            assert reopened.status_code == 200, reopened.text
            fixed = await c.put(f"/minutes/{minutes['id']}", json={"location": "Hall"})
            assert fixed.status_code == 200, fixed.text
            revisions = (await c.get(f"/minutes/{minutes['id']}/revisions")).json()
        assert [r["version"] for r in revisions] == [1]
        assert revisions[0]["superseded_reason"] == (
            "The location was recorded wrongly"
        )
        assert revisions[0]["superseded_by"] == str(world.secretary.id)

        await _approve(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            revisions = (await c.get(f"/minutes/{minutes['id']}/revisions")).json()
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
            first = await c.get(
                f"/minutes/{minutes['id']}/revisions/{revisions[1]['id']}"
            )
        assert [r["version"] for r in revisions] == [2, 1]
        assert revisions[0]["superseded_at"] is None
        assert verify["verified"] is True
        assert verify["version"] == 2
        assert first.json()["snapshot"]["location"] == "Station 1"

    async def test_two_approvals_cannot_write_the_same_version(self, world: _World):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        rows = (
            (
                await world.db.execute(
                    select(MinutesRevision).where(
                        MinutesRevision.minutes_id == minutes["id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        world.db.add(
            MinutesRevision(
                minutes_id=minutes["id"],
                organization_id=world.org_id,
                version=1,
                snapshot={},
                content_hash="0" * 64,
                approved_at=datetime.now(timezone.utc),
            )
        )
        with pytest.raises(IntegrityError):
            await world.db.flush()
        await world.db.rollback()

    async def test_minutes_approved_before_versions_existed_say_so(self, world: _World):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        await world.db.execute(
            text("DELETE FROM minutes_revisions WHERE minutes_id = :i"),
            {"i": minutes["id"]},
        )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        assert "before approved versions were recorded" in verify["detail"]

    async def test_another_departments_revisions_are_not_found(self, world: _World):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        async with _client(world.db, world.outsider) as c:
            assert (
                await c.get(f"/minutes/{minutes['id']}/revisions")
            ).status_code == 404
            assert (await c.get(f"/minutes/{minutes['id']}/verify")).status_code == 404


# ── Election results ─────────────────────────────────────────────────


class TestElectionResults:
    async def test_a_closed_elections_result_is_frozen_into_the_minutes(
        self, world: _World
    ):
        election = await _closed_election(world.db, world.org_id)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            offered = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
            assert [e["id"] for e in offered] == [election.id]
            assert offered[0]["already_imported"] is False
            filed = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
            assert filed.status_code == 201, filed.text
            body = filed.json()
            assert "Secretary" in body["captured_by_name"]
            assert body["election_title"] == "Officer election"
            assert body["snapshot"]["election_title"] == "Officer election"
            again = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
            offered = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
        assert again.status_code == 400
        assert "already filed" in again.json()["detail"]
        assert offered[0]["already_imported"] is True

    async def test_later_changes_to_the_election_do_not_rewrite_the_record(
        self, world: _World
    ):
        election = await _closed_election(world.db, world.org_id, title="Original")
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
        election.title = "Renamed afterwards"
        await world.db.flush()
        async with _client(world.db, world.secretary) as c:
            rows = (await c.get(f"/minutes/{minutes['id']}/election-results")).json()
        assert rows[0]["election_title"] == "Original"
        assert rows[0]["snapshot"]["election_title"] == "Original"

    async def test_an_election_that_is_still_open_has_nothing_to_file(
        self, world: _World
    ):
        election = await _closed_election(world.db, world.org_id, closed=False)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
            offered = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
        assert resp.status_code == 400
        assert "closed election" in resp.json()["detail"]
        assert offered == []

    async def test_another_departments_election_is_refused_like_a_missing_one(
        self, world: _World
    ):
        foreign = await _closed_election(world.db, world.other_org_id)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": foreign.id},
            )
            missing = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": str(uuid.uuid4())},
            )
            offered = (
                await c.get(f"/minutes/{minutes['id']}/importable-elections")
            ).json()
        assert resp.status_code == missing.status_code == 400
        assert resp.json()["detail"] == missing.json()["detail"]
        assert offered == []

    async def test_results_are_part_of_the_approved_record_and_lock_with_it(
        self, world: _World
    ):
        election = await _closed_election(world.db, world.org_id)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            filed = (
                await c.post(
                    f"/minutes/{minutes['id']}/election-results",
                    json={"election_id": election.id},
                )
            ).json()
        await _approve(world, minutes["id"])
        other = await _closed_election(world.db, world.org_id, title="Second")
        async with _client(world.db, world.secretary) as c:
            add = await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": other.id},
            )
            remove = await c.delete(
                f"/minutes/{minutes['id']}/election-results/{filed['id']}"
            )
        assert add.status_code == 400
        assert remove.status_code == 400
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
            revision = (await c.get(f"/minutes/{minutes['id']}/revisions")).json()[0]
            detail = (
                await c.get(f"/minutes/{minutes['id']}/revisions/{revision['id']}")
            ).json()
        assert verify["verified"] is True
        assert [
            r["election_title"] for r in detail["snapshot"]["election_results"]
        ] == ["Officer election"]

    async def test_a_filed_result_can_be_removed_from_a_draft(self, world: _World):
        election = await _closed_election(world.db, world.org_id)
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            filed = (
                await c.post(
                    f"/minutes/{minutes['id']}/election-results",
                    json={"election_id": election.id},
                )
            ).json()
            gone = await c.delete(
                f"/minutes/{minutes['id']}/election-results/{filed['id']}"
            )
            again = await c.delete(
                f"/minutes/{minutes['id']}/election-results/{filed['id']}"
            )
        assert gone.status_code == 204
        assert again.status_code == 404


# ── Attachments ──────────────────────────────────────────────────────


async def _upload(
    client: AsyncClient,
    minutes_id: str,
    *,
    title: str = "Treasurer report",
    category: str = "report",
    content: Optional[bytes] = None,
):
    return await client.post(
        f"/minutes/{minutes_id}/attachments",
        files={"file": ("report.pdf", content or _pdf_bytes(), "application/pdf")},
        data={"title": title, "category": category},
    )


class TestAttachments:
    async def test_a_file_round_trips_byte_for_byte(self, world: _World):
        minutes = await _create(world)
        content = _pdf_bytes()
        async with _client(world.db, world.secretary) as c:
            resp = await _upload(c, minutes["id"], content=content)
            assert resp.status_code == 201, resp.text
            meta = resp.json()
            download = await c.get(
                f"/minutes/{minutes['id']}/attachments/{meta['id']}/file"
            )
            listed = (await c.get(f"/minutes/{minutes['id']}/attachments")).json()
        assert meta["category"] == "report"
        assert "Secretary" in meta["uploaded_by_name"]
        assert "Secretary" in listed[0]["uploaded_by_name"]
        assert meta["file_size"] == len(content)
        assert len(meta["sha256"]) == 64
        assert download.status_code == 200
        assert download.content == content
        assert "attachment" in download.headers["content-disposition"]
        assert [a["id"] for a in listed] == [meta["id"]]

    async def test_a_disallowed_type_is_refused(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{minutes['id']}/attachments",
                files={
                    "file": ("run.sh", b"#!/bin/sh\necho hi\n", "text/x-shellscript")
                },
                data={"title": "Script"},
            )
        assert resp.status_code in (400, 415)
        rows = (await world.db.execute(select(MinutesAttachment))).scalars().all()
        assert rows == []

    async def test_an_unknown_category_is_refused(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await _upload(c, minutes["id"], category="secret")
        assert resp.status_code == 400

    async def test_a_signed_copy_belongs_after_approval_and_nothing_else_does(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            early = await _upload(c, minutes["id"], category="signed_copy")
            kept = await _upload(c, minutes["id"], title="Handout", category="handout")
        assert early.status_code == 400
        assert kept.status_code == 201

        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            other = await _upload(c, minutes["id"], title="Late handout")
            signed = await _upload(
                c, minutes["id"], title="Signed", category="signed_copy"
            )
            delete_kept = await c.delete(
                f"/minutes/{minutes['id']}/attachments/{kept.json()['id']}"
            )
            delete_signed = await c.delete(
                f"/minutes/{minutes['id']}/attachments/{signed.json()['id']}"
            )
        assert other.status_code == 400
        assert signed.status_code == 201, signed.text
        assert delete_kept.status_code == 400
        assert delete_signed.status_code == 400

    async def test_the_signed_copy_does_not_change_what_was_approved(
        self, world: _World
    ):
        minutes = await _create(world)
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            await _upload(c, minutes["id"], title="Signed", category="signed_copy")
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is True

    async def test_an_approved_attachment_is_part_of_the_approved_record(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await _upload(c, minutes["id"])
        await _approve(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is True
        await world.db.execute(
            text("UPDATE minutes_attachments SET sha256 = :h"), {"h": "f" * 64}
        )
        async with _client(world.db, world.member) as c:
            verify = (await c.get(f"/minutes/{minutes['id']}/verify")).json()
        assert verify["verified"] is False
        assert verify["changed"] == ["attachments"]

    async def test_a_member_sees_attachments_only_once_the_minutes_are_approved(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            meta = (await _upload(c, minutes["id"])).json()
        url = f"/minutes/{minutes['id']}/attachments"
        async with _client(world.db, world.member) as c:
            assert (await c.get(url)).status_code == 404
            assert (await c.get(f"{url}/{meta['id']}/file")).status_code == 404
        await _approve(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            assert (await c.get(url)).status_code == 200
            assert (await c.get(f"{url}/{meta['id']}/file")).status_code == 200

    async def test_executive_session_attachments_stay_with_the_managers(
        self, world: _World
    ):
        minutes = await _create(world, meeting_type="executive")
        async with _client(world.db, world.secretary) as c:
            meta = (await _upload(c, minutes["id"])).json()
        await _approve(world, minutes["id"])
        url = f"/minutes/{minutes['id']}/attachments"
        async with _client(world.db, world.member) as c:
            assert (await c.get(url)).status_code == 404
            assert (await c.get(f"{url}/{meta['id']}/file")).status_code == 404
            assert (await c.get(f"/minutes/{minutes['id']}/pdf")).status_code == 404
        async with _client(world.db, world.approver) as c:
            assert (await c.get(f"{url}/{meta['id']}/file")).status_code == 200

    async def test_another_department_cannot_reach_a_file(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            meta = (await _upload(c, minutes["id"])).json()
        url = f"/minutes/{minutes['id']}/attachments"
        async with _client(world.db, world.outsider) as c:
            assert (await c.get(url)).status_code == 404
            assert (await c.get(f"{url}/{meta['id']}/file")).status_code == 404
            assert (await c.delete(f"{url}/{meta['id']}")).status_code == 404
            assert (await _upload(c, minutes["id"])).status_code == 404

    async def test_deleting_removes_the_record_and_the_stored_file(
        self, world: _World, storage
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            meta = (await _upload(c, minutes["id"])).json()
            stored = [p for p in storage.rglob("*") if p.is_file()]
            assert len(stored) == 1
            assert (
                await c.delete(f"/minutes/{minutes['id']}/attachments/{meta['id']}")
            ).status_code == 204
        assert [p for p in storage.rglob("*") if p.is_file()] == []

    async def test_files_are_filed_under_the_departments_own_directory(
        self, world: _World, storage
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await _upload(c, minutes["id"])
        (path,) = [p for p in storage.rglob("*") if p.is_file()]
        relative = path.relative_to(storage).parts
        assert relative[:3] == (world.org_id, "minutes-attachments", minutes["id"])


# ── Carry-forward and my action items ────────────────────────────────


class TestCarryForward:
    async def _earlier(self, world: _World, **extra: Any) -> dict[str, Any]:
        minutes = await _create(
            world,
            when=datetime(2026, 9, 1, 19, 0, tzinfo=timezone.utc),
            items=[
                {
                    "description": "Order hose",
                    "assignee_id": str(world.assignee.id),
                    "priority": "high",
                },
                {"description": "Paint the bay"},
            ],
            **extra,
        )
        await _approve(world, minutes["id"])
        return minutes

    async def test_open_items_from_earlier_approved_minutes_are_offered(
        self, world: _World
    ):
        earlier = await self._earlier(world)
        current = await _create(world)
        async with _client(world.db, world.secretary) as c:
            offered = (
                await c.get(f"/minutes/{current['id']}/open-action-items")
            ).json()
        assert {o["description"] for o in offered} == {"Order hose", "Paint the bay"}
        assert {o["minutes_id"] for o in offered} == {earlier["id"]}
        assert offered[0]["minutes_title"] == "Monthly meeting"

    async def test_carrying_copies_the_item_and_retires_the_original(
        self, world: _World
    ):
        earlier = await self._earlier(world)
        current = await _create(world)
        hose = next(
            i for i in earlier["action_items"] if i["description"] == "Order hose"
        )
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{current['id']}/carry-forward",
                json={"item_ids": [hose["id"]]},
            )
            assert resp.status_code == 201, resp.text
            (copy,) = resp.json()
            offered = (
                await c.get(f"/minutes/{current['id']}/open-action-items")
            ).json()
            stats = (await c.get("/minutes/stats")).json()
            detail = (await c.get(f"/minutes/{current['id']}")).json()
            listing = (await c.get("/minutes")).json()
        assert copy["carried_from_id"] == hose["id"]
        assert copy["assignee_id"] == str(world.assignee.id)
        assert copy["priority"] == "high"
        assert copy["status"] == "pending"
        assert [o["description"] for o in offered] == ["Paint the bay"]
        assert stats["open_action_items"] == 2  # the paint job + the copy
        assert [a["id"] for a in detail["action_items"]] == [copy["id"]]
        original = next(m for m in listing if m["id"] == earlier["id"])
        assert original["open_action_items"] == 1

    async def test_the_same_item_cannot_be_carried_twice(self, world: _World):
        earlier = await self._earlier(world)
        first = await _create(world)
        second = await _create(world, title="Another")
        item = earlier["action_items"][0]["id"]
        async with _client(world.db, world.secretary) as c:
            ok = await c.post(
                f"/minutes/{first['id']}/carry-forward", json={"item_ids": [item]}
            )
            dup = await c.post(
                f"/minutes/{second['id']}/carry-forward", json={"item_ids": [item]}
            )
        assert ok.status_code == 201
        assert dup.status_code == 400

    async def test_one_bad_id_carries_nothing(self, world: _World):
        earlier = await self._earlier(world)
        current = await _create(world)
        good = earlier["action_items"][0]["id"]
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{current['id']}/carry-forward",
                json={"item_ids": [good, str(uuid.uuid4())]},
            )
            detail = (await c.get(f"/minutes/{current['id']}")).json()
        assert resp.status_code == 400
        assert detail["action_items"] == []

    async def test_only_approved_minutes_items_are_offered(self, world: _World):
        draft = await _create(
            world,
            when=datetime(2026, 9, 1, 19, 0, tzinfo=timezone.utc),
            items=[{"description": "Not yet a commitment"}],
        )
        current = await _create(world)
        async with _client(world.db, world.secretary) as c:
            offered = (
                await c.get(f"/minutes/{current['id']}/open-action-items")
            ).json()
            forced = await c.post(
                f"/minutes/{current['id']}/carry-forward",
                json={"item_ids": [draft["action_items"][0]["id"]]},
            )
        assert offered == []
        assert forced.status_code == 400

    async def test_a_committees_follow_ups_stay_with_the_committee_unless_asked(
        self, world: _World
    ):
        await self._earlier(world, meeting_type="committee")
        current = await _create(world)
        async with _client(world.db, world.secretary) as c:
            same_type = (
                await c.get(f"/minutes/{current['id']}/open-action-items")
            ).json()
            any_type = (
                await c.get(
                    f"/minutes/{current['id']}/open-action-items",
                    params={"include_other_types": "true"},
                )
            ).json()
        assert same_type == []
        assert len(any_type) == 2

    async def test_executive_items_never_surface_in_another_kind_of_meeting(
        self, world: _World
    ):
        executive = await self._earlier(world, meeting_type="executive")
        current = await _create(world)
        async with _client(world.db, world.secretary) as c:
            wide = (
                await c.get(
                    f"/minutes/{current['id']}/open-action-items",
                    params={"include_other_types": "true"},
                )
            ).json()
            forced = await c.post(
                f"/minutes/{current['id']}/carry-forward",
                params={"include_other_types": "true"},
                json={"item_ids": [executive["action_items"][0]["id"]]},
            )
        assert wide == []
        assert forced.status_code == 400

    async def test_nothing_can_be_carried_into_approved_minutes(self, world: _World):
        earlier = await self._earlier(world)
        target = await _create(world)
        await _approve(world, target["id"])
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{target['id']}/carry-forward",
                json={"item_ids": [earlier["action_items"][0]["id"]]},
            )
        assert resp.status_code == 400

    async def test_another_departments_items_cannot_be_carried(self, world: _World):
        foreign_minutes = MeetingMinutes(
            id=str(uuid.uuid4()),
            organization_id=world.other_org_id,
            title="Elsewhere",
            meeting_type=MinutesMeetingType.BUSINESS,
            meeting_date=datetime(2026, 9, 1, tzinfo=timezone.utc),
            status=MinutesStatus.APPROVED,
        )
        world.db.add(foreign_minutes)
        await world.db.flush()
        foreign_item = ActionItem(
            id=str(uuid.uuid4()), minutes_id=foreign_minutes.id, description="Theirs"
        )
        world.db.add(foreign_item)
        await world.db.flush()
        current = await _create(world)
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(
                f"/minutes/{current['id']}/carry-forward",
                json={"item_ids": [foreign_item.id]},
            )
        assert resp.status_code == 400
        await world.db.refresh(foreign_item)
        assert foreign_item.carried_forward_at is None

    async def test_only_a_manager_may_carry_items(self, world: _World):
        current = await _create(world)
        async with _client(world.db, world.member) as c:
            resp = await c.post(
                f"/minutes/{current['id']}/carry-forward",
                json={"item_ids": [str(uuid.uuid4())]},
            )
        assert resp.status_code == 403


class TestMyActionItems:
    async def test_an_assignee_sees_their_own_items_from_approved_minutes_only(
        self, world: _World
    ):
        approved = await _create(
            world,
            items=[
                {"description": "Mine", "assignee_id": str(world.assignee.id)},
                {"description": "Someone else's", "assignee_id": str(world.member.id)},
                {"description": "Nobody's"},
            ],
        )
        await _approve(world, approved["id"])
        await _create(
            world,
            title="Draft",
            items=[
                {"description": "From a draft", "assignee_id": str(world.assignee.id)}
            ],
        )
        async with _client(world.db, world.assignee) as c:
            mine = (await c.get("/minutes/action-items/mine")).json()
        assert [i["description"] for i in mine] == ["Mine"]
        assert mine[0]["minutes_title"] == "Monthly meeting"
        assert mine[0]["minutes_status"] == "approved"

    async def test_completed_items_appear_only_when_asked_for(self, world: _World):
        minutes = await _create(
            world,
            items=[{"description": "Done soon", "assignee_id": str(world.assignee.id)}],
        )
        await _approve(world, minutes["id"])
        item_id = minutes["action_items"][0]["id"]
        async with _client(world.db, world.assignee) as c:
            await c.put(
                f"/minutes/{minutes['id']}/action-items/{item_id}",
                json={"status": "completed"},
            )
            open_only = (await c.get("/minutes/action-items/mine")).json()
            everything = (
                await c.get(
                    "/minutes/action-items/mine", params={"include_closed": "true"}
                )
            ).json()
        assert open_only == []
        assert [i["status"] for i in everything] == ["completed"]

    async def test_a_carried_item_shows_where_it_now_lives(self, world: _World):
        earlier = await _create(
            world,
            when=datetime(2026, 9, 1, 19, 0, tzinfo=timezone.utc),
            items=[{"description": "Long job", "assignee_id": str(world.assignee.id)}],
        )
        await _approve(world, earlier["id"])
        current = await _create(world, title="October")
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{current['id']}/carry-forward",
                json={"item_ids": [earlier["action_items"][0]["id"]]},
            )
        await _approve(world, current["id"])
        async with _client(world.db, world.assignee) as c:
            mine = (await c.get("/minutes/action-items/mine")).json()
        assert [(i["minutes_title"], i["description"]) for i in mine] == [
            ("October", "Long job")
        ]

    async def test_another_departments_member_sees_none_of_it(self, world: _World):
        minutes = await _create(
            world,
            items=[{"description": "Mine", "assignee_id": str(world.assignee.id)}],
        )
        await _approve(world, minutes["id"])
        async with _client(world.db, world.outsider) as c:
            assert (await c.get("/minutes/action-items/mine")).json() == []


# ── Assignment email ─────────────────────────────────────────────────


class TestAssignmentEmail:
    @pytest.fixture
    def mailer(self, monkeypatch):
        sender = MagicMock()
        sender.send_email = AsyncMock(return_value=(1, 0))
        monkeypatch.setattr(
            "app.services.minutes_notifications.EmailService", lambda: sender
        )
        return sender

    async def test_assignees_are_emailed_when_the_minutes_are_approved(
        self, world: _World, mailer
    ):
        minutes = await _create(
            world,
            items=[
                {"description": "Order hose", "assignee_id": str(world.assignee.id)},
                {"description": "Fix door", "assignee_id": str(world.assignee.id)},
            ],
        )
        mailer.send_email.assert_not_called()
        await _approve(world, minutes["id"])
        assert mailer.send_email.await_count == 1
        kwargs = mailer.send_email.await_args.kwargs
        assert kwargs["to_emails"] == [world.assignee.email]
        assert "Order hose" in kwargs["html_body"]
        assert "Fix door" in kwargs["html_body"]

    async def test_a_member_who_opted_out_is_not_emailed_but_keeps_the_item(
        self, world: _World, mailer
    ):
        quiet = await _user(
            world.db,
            world.org_id,
            "Quiet",
            ["minutes.view"],
            preferences='{"email_kinds": {"minutes_action_items": false}}',
        )
        minutes = await _create(
            world,
            items=[{"description": "Quietly", "assignee_id": str(quiet.id)}],
        )
        await _approve(world, minutes["id"])
        mailer.send_email.assert_not_called()
        async with _client(world.db, quiet) as c:
            mine = (await c.get("/minutes/action-items/mine")).json()
        assert [i["description"] for i in mine] == ["Quietly"]

    async def test_a_mail_failure_does_not_fail_the_approval(
        self, world: _World, mailer
    ):
        mailer.send_email.side_effect = RuntimeError("smtp down")
        minutes = await _create(
            world,
            items=[{"description": "x", "assignee_id": str(world.assignee.id)}],
        )
        approved = await _approve(world, minutes["id"])
        assert approved["status"] == "approved"

    async def test_markup_in_an_item_is_escaped_in_the_email(
        self, world: _World, mailer
    ):
        minutes = await _create(
            world,
            items=[
                {
                    "description": "<script>alert(1)</script>",
                    "assignee_id": str(world.assignee.id),
                }
            ],
        )
        await _approve(world, minutes["id"])
        html_body = mailer.send_email.await_args.kwargs["html_body"]
        assert "<script>alert(1)</script>" not in html_body
        assert "&lt;script&gt;" in html_body


# ── PDF ──────────────────────────────────────────────────────────────


class TestPdf:
    async def test_approved_minutes_print_with_their_version(self, world: _World):
        election = await _closed_election(world.db, world.org_id)
        minutes = await _create(
            world,
            items=[
                {"description": "Order hose", "assignee_id": str(world.assignee.id)}
            ],
        )
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
            await _upload(c, minutes["id"])
        await _approve(world, minutes["id"])
        async with _client(world.db, world.member) as c:
            resp = await c.get(f"/minutes/{minutes['id']}/pdf")
        assert resp.status_code == 200, resp.text
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.content.startswith(b"%PDF")
        assert ".pdf" in resp.headers["content-disposition"]

    async def test_a_title_in_another_script_still_downloads(self, world: _World):
        minutes = await _create(world, title="Réunion 会議 Совет")
        async with _client(world.db, world.secretary) as c:
            resp = await c.get(f"/minutes/{minutes['id']}/pdf")
        assert resp.status_code == 200, resp.text
        assert resp.content.startswith(b"%PDF")
        assert "filename*=utf-8''" in resp.headers["content-disposition"]

    async def test_a_draft_prints_for_a_manager_and_is_invisible_to_a_member(
        self, world: _World
    ):
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            assert (await c.get(f"/minutes/{minutes['id']}/pdf")).status_code == 200
        async with _client(world.db, world.member) as c:
            assert (await c.get(f"/minutes/{minutes['id']}/pdf")).status_code == 404

    async def test_another_department_gets_nothing(self, world: _World):
        minutes = await _create(world)
        async with _client(world.db, world.outsider) as c:
            assert (await c.get(f"/minutes/{minutes['id']}/pdf")).status_code == 404


# ── Publishing ───────────────────────────────────────────────────────


class TestPublish:
    async def test_the_published_copy_carries_the_roll_and_the_filed_result(
        self, world: _World
    ):
        election = await _closed_election(world.db, world.org_id, "Board election")
        minutes = await _create(world)
        async with _client(world.db, world.secretary) as c:
            await c.post(
                f"/minutes/{minutes['id']}/election-results",
                json={"election_id": election.id},
            )
        await _approve(world, minutes["id"])
        async with _client(world.db, world.secretary) as c:
            resp = await c.post(f"/minutes/{minutes['id']}/publish")
        assert resp.status_code == 200, resp.text
        html = resp.json()["content_html"]
        assert "Present (1):" in html
        assert "Excused (1):" in html
        assert "Guests (1):" in html
        assert "Absent" not in html
        assert "Election result — Board election" in html
