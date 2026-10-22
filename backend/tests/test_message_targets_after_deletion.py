"""A deleted role or member must not leave a department message unsaveable.

The edit form sends a message's stored audience back on every save. Once a
targeted role was deleted, or a targeted member hard-deleted, that stored id
no longer existed in the organization and ``_validate_targeting`` refused every
later save — a title fix included — over an entry the editor never touched and
could not see. Entries already stored are now dropped when their row is gone;
an unknown id the caller is *adding* is still refused. Deleting a role also
takes it out of every message audience, so the message stops claiming an
audience that reaches nobody.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select, text

from app.models.notification import DepartmentMessage
from app.models.user import Position, User, user_roles
from app.services.messaging_service import MessagingService
from app.services.role_service import role_service

pytestmark = pytest.mark.integration


async def _position(db, org_id, name, permissions=None):
    position = Position(
        organization_id=org_id,
        name=name,
        slug=f"{name.lower().replace(' ', '-')}-{uuid.uuid4().hex[:6]}",
        permissions=permissions or [],
    )
    db.add(position)
    await db.flush()
    return position


async def _member(db, org_id, first_name):
    user = User(
        organization_id=org_id,
        username=f"{first_name.lower()}-{uuid.uuid4().hex[:8]}",
        first_name=first_name,
        last_name="Member",
        email=f"{uuid.uuid4().hex[:10]}@example.test",
        password_hash="hashed",
    )
    db.add(user)
    await db.flush()
    return user


async def _other_org(db):
    org_id = str(uuid.uuid4())
    await db.execute(
        text(
            "INSERT INTO organizations "
            "(id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Other Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"other-{org_id[:8]}"},
    )
    return org_id


@pytest.fixture
async def dept(db_session, setup_org_and_admin):
    org_id, admin_id = setup_org_and_admin
    # Deleting a position is refused if it would leave no administrator.
    chief = await _position(db_session, org_id, "Chief", ["*"])
    await db_session.execute(
        user_roles.insert().values(user_id=admin_id, position_id=chief.id)
    )
    await db_session.flush()
    return org_id, admin_id


async def _role_message(db, org_id, admin_id, roles):
    message, error = await MessagingService(db).create_message(
        organization_id=org_id,
        posted_by=admin_id,
        title="Drill night",
        body="Bring your gear.",
        target_type="roles",
        target_roles=roles,
    )
    assert error is None, error
    return message.id


async def _stored(db, message_id, column):
    return (
        await db.execute(
            select(getattr(DepartmentMessage, column)).where(
                DepartmentMessage.id == message_id
            )
        )
    ).scalar_one()


class TestAnEditAfterARoleIsDeleted:
    async def test_a_title_only_edit_succeeds_and_drops_the_deleted_role(
        self, db_session, dept
    ):
        org_id, admin_id = dept
        engine = await _position(db_session, org_id, "Engine Company")
        truck = await _position(db_session, org_id, "Truck Company")
        engine_id, truck_id = str(engine.id), str(truck.id)
        message_id = await _role_message(
            db_session, org_id, admin_id, [engine_id, truck_id]
        )
        # Removed underneath the message, as a role deleted before the
        # role-delete cleanup existed would have been.
        await db_session.execute(delete(Position).where(Position.id == truck_id))
        await db_session.commit()

        updated, error = await MessagingService(db_session).update_message(
            message_id,
            org_id,
            {
                "title": "Drill night (moved)",
                "target_type": "roles",
                "target_roles": [engine_id, truck_id],
                "target_statuses": None,
                "target_member_ids": None,
            },
        )

        assert error is None
        assert updated is not None
        assert await _stored(db_session, message_id, "title") == "Drill night (moved)"
        assert await _stored(db_session, message_id, "target_roles") == [engine_id]

    async def test_adding_an_unknown_role_is_still_refused(self, db_session, dept):
        org_id, admin_id = dept
        engine = await _position(db_session, org_id, "Engine Company")
        engine_id = str(engine.id)
        message_id = await _role_message(db_session, org_id, admin_id, [engine_id])
        await db_session.commit()
        planted = str(uuid.uuid4())

        updated, error = await MessagingService(db_session).update_message(
            message_id,
            org_id,
            {"target_type": "roles", "target_roles": [engine_id, planted]},
        )

        assert updated is None
        assert error is not None
        assert "target roles" in error
        assert await _stored(db_session, message_id, "target_roles") == [engine_id]

    async def test_another_orgs_role_is_never_kept(self, db_session, dept):
        # Existence is checked within the caller's organization only, so a
        # foreign id already on the row reads as gone and is dropped, and one
        # being added is refused. Either way it is never persisted.
        org_id, admin_id = dept
        other_org = await _other_org(db_session)
        foreign = await _position(db_session, other_org, "Their Captain")
        engine = await _position(db_session, org_id, "Engine Company")
        engine_id, foreign_id = str(engine.id), str(foreign.id)
        stored_foreign = await _role_message(db_session, org_id, admin_id, [engine_id])
        await db_session.execute(
            DepartmentMessage.__table__.update()
            .where(DepartmentMessage.id == stored_foreign)
            .values(target_roles=[engine_id, foreign_id])
        )
        added_foreign = await _role_message(db_session, org_id, admin_id, [engine_id])
        await db_session.commit()
        service = MessagingService(db_session)

        _, kept_error = await service.update_message(
            stored_foreign,
            org_id,
            {
                "title": "x",
                "target_type": "roles",
                "target_roles": [engine_id, foreign_id],
            },
        )
        _, added_error = await service.update_message(
            added_foreign,
            org_id,
            {"target_type": "roles", "target_roles": [engine_id, foreign_id]},
        )

        assert kept_error is None
        assert await _stored(db_session, stored_foreign, "target_roles") == [engine_id]
        assert added_error is not None
        assert "target roles" in added_error
        assert await _stored(db_session, added_foreign, "target_roles") == [engine_id]


class TestAnEditAfterAMemberIsHardDeleted:
    async def test_a_title_only_edit_succeeds_and_drops_the_deleted_member(
        self, db_session, dept
    ):
        org_id, admin_id = dept
        stays = await _member(db_session, org_id, "Stays")
        goes = await _member(db_session, org_id, "Goes")
        stays_id, goes_id = str(stays.id), str(goes.id)
        message, error = await MessagingService(db_session).create_message(
            organization_id=org_id,
            posted_by=admin_id,
            title="Uniform fitting",
            body="See the quartermaster.",
            target_type="members",
            target_member_ids=[stays_id, goes_id],
            # Scheduled, so no recipient rows reference the member deleted below.
            scheduled_at=datetime.now(timezone.utc) + timedelta(days=2),
        )
        assert error is None, error
        message_id = message.id
        await db_session.execute(delete(User).where(User.id == goes_id))
        await db_session.commit()

        updated, error = await MessagingService(db_session).update_message(
            message_id,
            org_id,
            {
                "title": "Uniform fitting (room 2)",
                "target_type": "members",
                "target_roles": None,
                "target_statuses": None,
                "target_member_ids": [stays_id, goes_id],
            },
        )

        assert error is None
        assert updated is not None
        assert await _stored(db_session, message_id, "target_member_ids") == [stays_id]

    async def test_adding_an_unknown_member_is_still_refused(self, db_session, dept):
        org_id, admin_id = dept
        stays = await _member(db_session, org_id, "Stays")
        stays_id = str(stays.id)
        message, error = await MessagingService(db_session).create_message(
            organization_id=org_id,
            posted_by=admin_id,
            title="Uniform fitting",
            body="See the quartermaster.",
            target_type="members",
            target_member_ids=[stays_id],
        )
        assert error is None, error
        message_id = message.id
        await db_session.commit()

        _, error = await MessagingService(db_session).update_message(
            message_id,
            org_id,
            {"target_type": "members", "target_member_ids": [stays_id, "nobody"]},
        )

        assert error is not None

        assert "target members" in error


class TestDeletingARole:
    async def test_it_leaves_every_message_audience_that_names_it(
        self, db_session, dept
    ):
        org_id, admin_id = dept
        engine = await _position(db_session, org_id, "Engine Company")
        truck = await _position(db_session, org_id, "Truck Company")
        engine_id, truck_id = str(engine.id), str(truck.id)
        by_id = await _role_message(db_session, org_id, admin_id, [engine_id, truck_id])
        # A legacy row that targets the role by name.
        by_name = await _role_message(db_session, org_id, admin_id, [engine_id])
        await db_session.execute(
            DepartmentMessage.__table__.update()
            .where(DepartmentMessage.id == by_name)
            .values(target_roles=[engine_id, "Truck Company"])
        )
        # Another department's message naming a role of the same name is
        # theirs, and is left alone.
        other_org = await _other_org(db_session)
        theirs = DepartmentMessage(
            id=str(uuid.uuid4()),
            organization_id=other_org,
            title="Their notice",
            body="Not ours.",
            target_type="roles",
            target_roles=["Truck Company"],
        )
        db_session.add(theirs)
        theirs_id = theirs.id
        await db_session.commit()

        await role_service.delete_role(db_session, truck_id, org_id, admin_id)

        assert await _stored(db_session, by_id, "target_roles") == [engine_id]
        assert await _stored(db_session, by_name, "target_roles") == [engine_id]
        assert await _stored(db_session, theirs_id, "target_roles") == ["Truck Company"]
