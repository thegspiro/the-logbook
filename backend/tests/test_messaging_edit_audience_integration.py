"""Editing a published message does not re-resolve an audience it did not change.

MSG2-10: the edit form sends the audience type and all three target lists on
every save, and ``update_message`` treated any of those keys being present as
an audience change. So a typo fix on an "Everyone" message re-resolved its
audience against today's roster: members who had joined since it was posted
were added and emailed, and members who had dropped out lost an unread row.
The audience is now compared as stored before and after the update.
"""

import uuid

import pytest

from app.models.user import Organization, User, UserStatus
from app.services.messaging_service import MessagingService

pytestmark = [pytest.mark.integration]


async def _org(db):
    org = Organization(name="Audience FD", slug=f"aud-{uuid.uuid4().hex[:8]}")
    db.add(org)
    await db.flush()
    return org


async def _user(db, org):
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"m-{uuid.uuid4().hex[:8]}",
        email=f"{uuid.uuid4().hex[:8]}@example.test",
        first_name="A",
        last_name="B",
        password_hash="x",
        status=UserStatus.ACTIVE,
    )
    db.add(user)
    await db.flush()
    return user


# Exactly what MessageComposeForm sends for a title-only fix on an "Everyone"
# message.
TITLE_ONLY_EDIT = {
    "title": "t (typo fixed)",
    "body": "b",
    "priority": "normal",
    "target_type": "all",
    "target_roles": None,
    "target_statuses": None,
    "target_member_ids": None,
    "is_pinned": False,
    "is_persistent": False,
    "requires_acknowledgment": False,
}


async def test_a_title_fix_does_not_add_members_who_joined_since(db_session):
    org = await _org(db_session)
    author = await _user(db_session, org)
    await _user(db_session, org)
    await db_session.commit()
    service = MessagingService(db_session)
    message, err = await service.create_message(
        organization_id=org.id, posted_by=author.id, title="t", body="b"
    )
    assert err is None
    await _user(db_session, org)
    await db_session.commit()

    updated, err = await service.update_message(
        message.id, org.id, dict(TITLE_ONLY_EDIT)
    )

    assert err is None, err
    assert updated._newly_targeted == set()


async def test_an_actual_audience_change_still_reaches_the_new_audience(db_session):
    org = await _org(db_session)
    author = await _user(db_session, org)
    picked = await _user(db_session, org)
    await db_session.commit()
    service = MessagingService(db_session)
    message, err = await service.create_message(
        organization_id=org.id,
        posted_by=author.id,
        title="t",
        body="b",
        target_type="members",
        target_member_ids=[author.id],
    )
    assert err is None, err

    updated, err = await service.update_message(
        message.id,
        org.id,
        {
            **TITLE_ONLY_EDIT,
            "target_type": "members",
            "target_member_ids": [author.id, picked.id],
        },
    )

    assert err is None, err
    assert updated._newly_targeted == {picked.id}
