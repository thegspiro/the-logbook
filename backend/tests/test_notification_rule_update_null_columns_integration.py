"""``PATCH /notifications/rules/{id}`` refuses an explicit ``null`` it cannot honour.

``NotificationRuleUpdate`` types every field ``Optional`` so a PATCH can omit it,
and the handler dumps with ``exclude_unset``, so a ``null`` that was sent reaches
the write. Three cases matter and they fail differently:

* ``name`` / ``trigger`` / ``category`` / ``channel`` are NOT NULL columns;
  ``apply_updates`` refuses the null and the handler answers 400.
* ``enabled`` is a *nullable* column (``Mapped[Optional[bool]]``) behind a
  response field that is a plain ``bool``. ``apply_updates`` therefore wrote the
  NULL, the commit succeeded, and serializing the response raised -- a 500 *after*
  the bad value was already stored. The row then failed validation in every later
  ``GET /rules`` listing too, and the resolver reads a NULL ``enabled`` as off.
* ``description`` / ``config`` are genuinely nullable and must still clear.

Driven over HTTP against the real schema, because a mocked session never
evaluates a constraint or a response model, and the status code (plus the state
the row is left in) is what is under test.
"""

import uuid

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import notifications as notification_endpoints
from app.core.database import get_db
from app.models.notification import NotificationRule, NotificationTrigger
from app.models.user import User

pytestmark = [pytest.mark.integration]


class _Bench:
    def __init__(self, user: User, rule_id: str):
        self.user = user
        self.rule_id = rule_id


@pytest.fixture
async def bench(db_session: AsyncSession) -> _Bench:
    org_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    position_id = str(uuid.uuid4())
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Rule Bench', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"rule-bench-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Bench', 'Chief', :em, 'hashed', 'active')"
        ),
        {
            "id": user_id,
            "org": org_id,
            "un": f"bench-{user_id[:8]}",
            "em": f"bench-{user_id[:8]}@test.example",
        },
    )
    await db_session.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug, permissions) "
            "VALUES (:id, :org, 'Chief', 'chief', "
            '\'["notifications.manage", "notifications.view"]\')'
        ),
        {"id": position_id, "org": org_id},
    )
    await db_session.execute(
        text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
        {"u": user_id, "p": position_id},
    )
    rule = NotificationRule(
        id=str(uuid.uuid4()),
        organization_id=org_id,
        name="Event reminders",
        description="Remind members before an event",
        trigger=NotificationTrigger.EVENT_REMINDER,
        config={"default_reminder_schedule": [24]},
    )
    db_session.add(rule)
    await db_session.flush()

    user = await db_session.get(User, user_id)
    assert user is not None
    await db_session.refresh(user, ["positions"])
    return _Bench(user, rule.id)


def _client(db_session: AsyncSession, user: User) -> AsyncClient:
    app = FastAPI()
    app.include_router(notification_endpoints.router, prefix="/notifications")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db_session
    # An escaped exception must come back as the 500 a caller would see, not be
    # re-raised into the test, or the status code could never be asserted.
    return AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


def _not_null_columns() -> list[str]:
    from app.schemas.notifications import NotificationRuleUpdate

    required = {c.key for c in NotificationRule.__table__.columns if not c.nullable}
    return sorted(set(NotificationRuleUpdate.model_fields) & required)


def test_the_required_columns_are_the_ones_this_file_expects():
    assert {"name", "trigger", "category", "channel"} <= set(_not_null_columns())


@pytest.mark.parametrize("field", _not_null_columns() + ["enabled"])
async def test_null_is_a_4xx_not_a_500(
    db_session: AsyncSession, bench: _Bench, field: str
):
    async with _client(db_session, bench.user) as client:
        resp = await client.patch(
            f"/notifications/rules/{bench.rule_id}", json={field: None}
        )
    # Exactly 400/422, not any 4xx: a 404/405 from a wrong route or verb would
    # otherwise satisfy this and prove nothing about the guard.
    assert resp.status_code in (400, 422), (field, resp.status_code)


async def test_a_refused_enabled_null_leaves_the_rule_listable_and_on(
    db_session: AsyncSession, bench: _Bench
):
    async with _client(db_session, bench.user) as client:
        await client.patch(
            f"/notifications/rules/{bench.rule_id}", json={"enabled": None}
        )
        listing = await client.get("/notifications/rules")
    assert listing.status_code == 200, listing.text
    row = await db_session.get(NotificationRule, bench.rule_id)
    assert row is not None
    await db_session.refresh(row)
    assert row.enabled is True


@pytest.mark.parametrize(
    ("field", "attr"), [("description", "description"), ("config", "config")]
)
async def test_nullable_columns_still_clear(
    db_session: AsyncSession, bench: _Bench, field: str, attr: str
):
    async with _client(db_session, bench.user) as client:
        resp = await client.patch(
            f"/notifications/rules/{bench.rule_id}", json={field: None}
        )
    assert resp.status_code == 200, (field, resp.status_code, resp.text[:200])
    row = await db_session.get(NotificationRule, bench.rule_id)
    assert row is not None
    await db_session.refresh(row)
    assert getattr(row, attr) is None
    assert row.name == "Event reminders"
