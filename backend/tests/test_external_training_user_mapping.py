"""
Mapping an external training user to a member by hand.

The Mappings screen's **Map User** button had no handler, so a provider user
whose email matched nobody could only be mapped through the API. The screen now
offers a member picker, and the endpoint behind it had two gaps the picker
exposes:

- **Unmapping did nothing.** ``internal_user_id: null`` was read as "leave
  alone", so choosing "Not mapped" kept the old member on the row and every
  later sync went on crediting them.
- **Mapping did not reach records already waiting.** Sync attaches a waiting
  record to a member only when the provider sends that record again, and a
  completion older than the provider's lookback never comes back.

These run the real endpoint against the database so the bulk UPDATE on
``external_training_imports`` is exercised, not mocked.
"""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.external_training import (
    list_user_mappings,
    update_user_mapping,
)
from app.models.training import (
    ExternalProviderType,
    ExternalTrainingImport,
    ExternalTrainingProvider,
    ExternalUserMapping,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.training import ExternalUserMappingUpdate

pytestmark = pytest.mark.integration


async def _org(db_session) -> Organization:
    org = Organization(
        id=str(uuid.uuid4()),
        name="Mapping Test Department",
        slug=f"map-{uuid.uuid4().hex[:8]}",
    )
    db_session.add(org)
    await db_session.flush()
    return org


async def _member(db_session, org, deleted=False) -> User:
    user = User(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        username=f"u{uuid.uuid4().hex[:10]}",
        email=f"{uuid.uuid4().hex[:8]}@dept.test",
        first_name="Pat",
        last_name="Member",
        password_hash="x",
        status=UserStatus.ACTIVE,
        deleted_at=datetime.now(timezone.utc) if deleted else None,
    )
    db_session.add(user)
    await db_session.flush()
    return user


async def _setup(db_session):
    org = await _org(db_session)
    officer = await _member(db_session, org)
    provider = ExternalTrainingProvider(
        id=str(uuid.uuid4()),
        organization_id=org.id,
        name="Vector",
        provider_type=ExternalProviderType.VECTOR_SOLUTIONS,
        api_base_url="https://lms.example.test",
    )
    db_session.add(provider)
    await db_session.flush()
    mapping = ExternalUserMapping(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=org.id,
        external_user_id="EXT-42",
        external_name="Pat Member",
        is_mapped=False,
        auto_mapped=False,
    )
    db_session.add(mapping)
    await db_session.flush()
    caller = SimpleNamespace(id=officer.id, organization_id=org.id)
    return org, provider, mapping, caller


async def _import(db_session, provider, external_user_id, status, user_id=None):
    row = ExternalTrainingImport(
        id=str(uuid.uuid4()),
        provider_id=provider.id,
        organization_id=provider.organization_id,
        external_record_id=f"R-{uuid.uuid4().hex[:8]}",
        external_user_id=external_user_id,
        course_title="Hazmat Awareness",
        import_status=status,
        user_id=user_id,
    )
    db_session.add(row)
    await db_session.flush()
    return row.id


async def _user_id_of(db_session, import_id):
    return (
        await db_session.execute(
            select(ExternalTrainingImport.user_id).where(
                ExternalTrainingImport.id == import_id
            )
        )
    ).scalar_one()


class TestMapUserByHand:
    async def test_maps_and_attaches_waiting_records(self, db_session):
        org, provider, mapping, caller = await _setup(db_session)
        member = await _member(db_session, org)
        pending = await _import(db_session, provider, "EXT-42", "pending")
        failed = await _import(db_session, provider, "EXT-42", "failed")

        response = await update_user_mapping(
            uuid.UUID(provider.id),
            uuid.UUID(mapping.id),
            ExternalUserMappingUpdate(internal_user_id=uuid.UUID(member.id)),
            db_session,
            caller,
        )

        assert response.is_mapped is True
        assert str(response.internal_user_id) == member.id
        assert response.auto_mapped is False
        assert response.internal_user_name == "Pat Member"
        assert response.internal_user_email == member.email
        assert await _user_id_of(db_session, pending) == member.id
        assert await _user_id_of(db_session, failed) == member.id

    async def test_imported_records_keep_their_member(self, db_session):
        org, provider, mapping, caller = await _setup(db_session)
        first = await _member(db_session, org)
        second = await _member(db_session, org)
        imported = await _import(
            db_session, provider, "EXT-42", "imported", user_id=first.id
        )

        await update_user_mapping(
            uuid.UUID(provider.id),
            uuid.UUID(mapping.id),
            ExternalUserMappingUpdate(internal_user_id=uuid.UUID(second.id)),
            db_session,
            caller,
        )

        # A training record already exists for the first member; moving the
        # staging row would contradict it.
        assert await _user_id_of(db_session, imported) == first.id

    async def test_other_external_users_records_are_untouched(self, db_session):
        org, provider, mapping, caller = await _setup(db_session)
        member = await _member(db_session, org)
        someone_else = await _import(db_session, provider, "EXT-99", "pending")

        await update_user_mapping(
            uuid.UUID(provider.id),
            uuid.UUID(mapping.id),
            ExternalUserMappingUpdate(internal_user_id=uuid.UUID(member.id)),
            db_session,
            caller,
        )

        assert await _user_id_of(db_session, someone_else) is None

    async def test_explicit_null_unmaps_and_detaches_waiting_records(self, db_session):
        org, provider, mapping, caller = await _setup(db_session)
        member = await _member(db_session, org)
        mapping.internal_user_id = member.id
        mapping.is_mapped = True
        await db_session.flush()
        pending = await _import(
            db_session, provider, "EXT-42", "pending", user_id=member.id
        )

        response = await update_user_mapping(
            uuid.UUID(provider.id),
            uuid.UUID(mapping.id),
            ExternalUserMappingUpdate(internal_user_id=None),
            db_session,
            caller,
        )

        assert response.is_mapped is False
        assert response.internal_user_id is None
        assert await _user_id_of(db_session, pending) is None

    async def test_omitted_field_leaves_the_mapping_alone(self, db_session):
        org, provider, mapping, caller = await _setup(db_session)
        member = await _member(db_session, org)
        mapping.internal_user_id = member.id
        mapping.is_mapped = True
        await db_session.flush()

        response = await update_user_mapping(
            uuid.UUID(provider.id),
            uuid.UUID(mapping.id),
            ExternalUserMappingUpdate(),
            db_session,
            caller,
        )

        assert str(response.internal_user_id) == member.id
        assert response.is_mapped is True

    async def test_refuses_a_member_of_another_org(self, db_session):
        _, provider, mapping, caller = await _setup(db_session)
        other_org = await _org(db_session)
        outsider = await _member(db_session, other_org)

        with pytest.raises(HTTPException) as exc:
            await update_user_mapping(
                uuid.UUID(provider.id),
                uuid.UUID(mapping.id),
                ExternalUserMappingUpdate(internal_user_id=uuid.UUID(outsider.id)),
                db_session,
                caller,
            )
        assert exc.value.status_code == 404
        assert mapping.internal_user_id is None

    async def test_refuses_a_deleted_member(self, db_session):
        org, provider, mapping, caller = await _setup(db_session)
        gone = await _member(db_session, org, deleted=True)

        with pytest.raises(HTTPException) as exc:
            await update_user_mapping(
                uuid.UUID(provider.id),
                uuid.UUID(mapping.id),
                ExternalUserMappingUpdate(internal_user_id=uuid.UUID(gone.id)),
                db_session,
                caller,
            )
        assert exc.value.status_code == 404
        assert mapping.internal_user_id is None


class TestListUserMappings:
    async def test_lists_a_mapped_user_with_the_members_name(self, db_session):
        # select(User.full_name, ...) raised on the first mapped row, so the
        # Users tab came back empty for any provider with one email match.
        org, provider, mapping, caller = await _setup(db_session)
        member = await _member(db_session, org)
        mapping.internal_user_id = member.id
        mapping.is_mapped = True
        mapping.auto_mapped = True
        await db_session.flush()

        rows = await list_user_mappings(
            uuid.UUID(provider.id), False, db_session, caller
        )

        assert len(rows) == 1
        assert rows[0].internal_user_name == "Pat Member"
        assert rows[0].internal_user_email == member.email
