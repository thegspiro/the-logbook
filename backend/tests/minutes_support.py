"""Shared setup for the meeting-minutes integration tests.

Plain helpers over the real routers and schema; the fixtures that use them
live in each test module so pytest and flake8 both see them used.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import minutes as minutes_endpoints
from app.api.v1.endpoints import minutes_records as records_endpoints
from app.core.database import get_db
from app.models.election import Election, ElectionStatus
from app.models.user import User
from app.utils.minutes_pdf import render_minutes_pdf


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


async def _fill_required_sections(w: _World, minutes_id: str) -> None:
    """The outline's required sections need text before minutes circulate."""
    async with _client(w.db, w.secretary) as c:
        current = (await c.get(f"/minutes/{minutes_id}")).json()
        sections = [
            {**s, "content": s["content"] or "Recorded."} for s in current["sections"]
        ]
        resp = await c.put(f"/minutes/{minutes_id}", json={"sections": sections})
        assert resp.status_code == 200, resp.text


async def _approve(w: _World, minutes_id: str) -> dict[str, Any]:
    await _fill_required_sections(w, minutes_id)
    async with _client(w.db, w.secretary) as c:
        assert (await c.post(f"/minutes/{minutes_id}/submit")).status_code == 200
    async with _client(w.db, w.approver) as c:
        resp = await c.post(f"/minutes/{minutes_id}/approve")
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _closed_election(
    db: AsyncSession,
    org_id: str,
    title: str = "Officer election",
    closed: bool = True,
    ballot_items: Optional[list[dict[str, Any]]] = None,
    event_id: Optional[str] = None,
) -> Election:
    now = datetime.now(timezone.utc)
    election = Election(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        title=title,
        election_type="general",
        positions=["Chief"],
        ballot_items=ballot_items,
        event_id=event_id,
        start_date=now - timedelta(days=2),
        end_date=now - timedelta(days=1),
        status=ElectionStatus.CLOSED if closed else ElectionStatus.OPEN,
        closed_at=now - timedelta(days=1) if closed else None,
    )
    db.add(election)
    await db.flush()
    return election


async def build_world(db_session: AsyncSession) -> _World:
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
