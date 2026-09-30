"""An applicant's target position cannot grant more than its chooser holds.

The stored ``target_role_id`` becomes the new member's position at conversion.
Before this was checked, a holder of ``prospective_members.manage`` could store
the organization's administrator position on an applicant whose email they
controlled and convert them -- with ``role_ids`` omitted, so the ceiling on
explicit roles never ran, and a password of their choosing -- minting an
administrator account. Automatic conversion applied the stored role with no
check at all.

Three places now hold the line:

- saving a target position (create and update) is granting it, so the saver's
  ceiling applies, and the server records who chose it;
- manual conversion checks the position actually applied against the caller,
  including the stored one when no roles are sent;
- automatic conversion applies the stored position only while whoever chose it
  still holds every permission it grants.
"""

import inspect
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.requests import Request

from app.api.v1.endpoints import membership_pipeline as endpoints
from app.api.v1.endpoints.users import _enforce_role_grant_ceiling
from app.models.membership_pipeline import ProspectActivityLog
from app.models.user import Organization, Role, User, UserStatus
from app.schemas.membership_pipeline import TransferProspectRequest
from app.services.membership_pipeline_service import (
    TARGET_ROLE_SET_BY_KEY,
    MembershipPipelineService,
)

pytestmark = [pytest.mark.integration]

ADMIN_PERMS = ["settings.manage", "users.edit", "prospective_members.manage"]
COORDINATOR_PERMS = ["prospective_members.manage"]


def _hex() -> str:
    return uuid.uuid4().hex[:8]


def _request() -> Request:
    return Request({"type": "http", "headers": [], "client": ("127.0.0.1", 1)})


async def _org(db: AsyncSession) -> Organization:
    org = Organization(name="Ceiling Test VFD", slug=f"ceiling-{_hex()}")
    db.add(org)
    await db.flush()
    return org


async def _position(db: AsyncSession, org: Organization, perms: list[str]) -> Role:
    role = Role(
        organization_id=org.id,
        name=f"Position {_hex()}",
        slug=f"position-{_hex()}",
        permissions=perms,
    )
    db.add(role)
    await db.flush()
    return role


async def _member(
    db: AsyncSession,
    org: Organization,
    perms: list[str],
    status: UserStatus = UserStatus.ACTIVE,
) -> User:
    position = await _position(db, org, perms)
    user = User(
        organization_id=org.id,
        username=f"member-{_hex()}",
        email=f"member-{_hex()}@example.org",
        first_name="Alex",
        last_name="Reyes",
        status=status,
    )
    user.positions = [position]
    db.add(user)
    await db.flush()
    # Reloaded with positions eager, as get_current_user returns them.
    return (
        await db.execute(
            select(User)
            .where(User.id == user.id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _prospect(svc, org, created_by=None, **extra):
    data = {
        "first_name": "Devon",
        "last_name": "Marsh",
        "email": f"devon-{_hex()}@example.org",
    }
    data.update(extra)
    return await svc.create_prospect(
        organization_id=org.id, data=data, created_by=created_by
    )


async def _position_ids_of(db: AsyncSession, user_id: str) -> set[str]:
    user = (
        await db.execute(
            select(User)
            .where(User.id == user_id)
            .options(selectinload(User.positions))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return {str(p.id) for p in user.positions}


class TestWhoChoseTheRoleIsServerOwned:
    async def test_a_forged_setter_in_client_metadata_is_discarded(
        self, db_session: AsyncSession
    ):
        # A public form's answers land at the top level of metadata, so the
        # key must never be taken from the client.
        org = await _org(db_session)
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        chief = await _member(db_session, org, ADMIN_PERMS)
        role = await _position(db_session, org, COORDINATOR_PERMS)
        svc = MembershipPipelineService(db_session)

        prospect = await _prospect(
            svc,
            org,
            created_by=str(coordinator.id),
            target_role_id=str(role.id),
            metadata_={TARGET_ROLE_SET_BY_KEY: str(chief.id), "answer": "yes"},
        )

        assert prospect.metadata_[TARGET_ROLE_SET_BY_KEY] == str(coordinator.id)
        assert prospect.metadata_["answer"] == "yes"

    async def test_without_a_target_role_nothing_is_recorded(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        chief = await _member(db_session, org, ADMIN_PERMS)
        svc = MembershipPipelineService(db_session)

        prospect = await _prospect(
            svc, org, metadata_={TARGET_ROLE_SET_BY_KEY: str(chief.id)}
        )

        assert TARGET_ROLE_SET_BY_KEY not in prospect.metadata_

    async def test_resaving_the_same_role_keeps_who_chose_it(
        self, db_session: AsyncSession
    ):
        # The applicant drawer re-sends the role on every save; a coordinator
        # editing a phone number must not become its chooser.
        org = await _org(db_session)
        chief = await _member(db_session, org, ADMIN_PERMS)
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        role = await _position(db_session, org, ["settings.manage"])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(
            svc, org, created_by=str(chief.id), target_role_id=str(role.id)
        )

        updated = await svc.update_prospect(
            str(prospect.id),
            org.id,
            {"target_role_id": str(role.id), "phone": "555-0100"},
            updated_by=str(coordinator.id),
        )

        assert updated.metadata_[TARGET_ROLE_SET_BY_KEY] == str(chief.id)

    async def test_changing_or_clearing_the_role_rerecords_it(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        chief = await _member(db_session, org, ADMIN_PERMS)
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        first = await _position(db_session, org, [])
        second = await _position(db_session, org, [])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(
            svc, org, created_by=str(chief.id), target_role_id=str(first.id)
        )

        changed = await svc.update_prospect(
            str(prospect.id),
            org.id,
            {"target_role_id": str(second.id)},
            updated_by=str(coordinator.id),
        )
        assert changed.metadata_[TARGET_ROLE_SET_BY_KEY] == str(coordinator.id)

        cleared = await svc.update_prospect(
            str(prospect.id),
            org.id,
            {"target_role_id": None},
            updated_by=str(coordinator.id),
        )
        assert TARGET_ROLE_SET_BY_KEY not in cleared.metadata_


class TestAutomaticConversion:
    """`_do_transfer` with no roles is the automatic path (see complete_step)."""

    async def _convert(self, db_session, svc, org, prospect):
        loaded = await svc.get_prospect(str(prospect.id), org.id)
        result = await svc._do_transfer(loaded, None)
        assert result["success"] is True
        return result

    async def test_a_role_its_chooser_may_grant_is_applied(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        chief = await _member(db_session, org, ADMIN_PERMS)
        role = await _position(db_session, org, ["settings.manage"])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(
            svc, org, created_by=str(chief.id), target_role_id=str(role.id)
        )

        result = await self._convert(db_session, svc, org, prospect)

        assert str(role.id) in await _position_ids_of(db_session, result["user_id"])

    async def test_a_role_beyond_its_chooser_is_not_applied(
        self, db_session: AsyncSession
    ):
        # The escalation this closes: stored by someone who cannot grant it.
        org = await _org(db_session)
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        admin_role = await _position(db_session, org, ["*"])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(
            svc,
            org,
            created_by=str(coordinator.id),
            target_role_id=str(admin_role.id),
        )

        result = await self._convert(db_session, svc, org, prospect)

        assert str(admin_role.id) not in await _position_ids_of(
            db_session, result["user_id"]
        )
        logged = (
            (
                await db_session.execute(
                    select(ProspectActivityLog.action).where(
                        ProspectActivityLog.prospect_id == prospect.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert "target_role_not_applied" in logged

    async def test_a_role_saved_before_choosers_were_recorded_is_not_applied(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        role = await _position(db_session, org, [])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(svc, org, target_role_id=str(role.id))

        result = await self._convert(db_session, svc, org, prospect)

        assert str(role.id) not in await _position_ids_of(db_session, result["user_id"])

    async def test_a_chooser_who_has_left_no_longer_vouches(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        chief = await _member(db_session, org, ADMIN_PERMS)
        role = await _position(db_session, org, ["settings.manage"])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(
            svc, org, created_by=str(chief.id), target_role_id=str(role.id)
        )
        chief.status = UserStatus.ARCHIVED
        chief.deleted_at = datetime.now(timezone.utc)
        await db_session.flush()

        result = await self._convert(db_session, svc, org, prospect)

        assert str(role.id) not in await _position_ids_of(db_session, result["user_id"])


class TestSavingATargetRoleIsGrantingIt:
    async def test_a_role_beyond_the_caller_is_refused_and_reported(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        admin_role = await _position(db_session, org, ["*"])

        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            with pytest.raises(HTTPException) as refused:
                await endpoints._enforce_target_role_ceiling(
                    coordinator, admin_role.id, db_session, _request()
                )

        assert refused.value.status_code == 403
        reported.assert_awaited_once()

    async def test_a_role_within_the_caller_is_allowed(self, db_session: AsyncSession):
        org = await _org(db_session)
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        role = await _position(db_session, org, COORDINATOR_PERMS)

        await endpoints._enforce_target_role_ceiling(
            coordinator, role.id, db_session, _request()
        )

    def test_create_and_update_check_before_writing(self):
        for handler, write in (
            (endpoints.create_prospect, "service.create_prospect("),
            (endpoints.update_prospect, "service.update_prospect("),
        ):
            source = inspect.getsource(handler)
            assert "_enforce_target_role_ceiling(" in source, handler.__name__
            # A refusal commits its security alert, so the check must come
            # before anything the commit could persist.
            assert source.index("_enforce_target_role_ceiling(") < source.index(
                write
            ), handler.__name__


class TestManualConversion:
    async def _transfer(self, db_session, caller, prospect):
        return await endpoints.transfer_prospect(
            prospect_id=prospect.id,
            data=TransferProspectRequest(),
            request=_request(),
            db=db_session,
            current_user=caller,
        )

    async def test_the_stored_role_is_held_to_the_callers_ceiling(
        self, db_session: AsyncSession
    ):
        # The exploit's last step: no role_ids, so only the stored role is
        # applied. It is checked -- without an alert, since this caller did not
        # choose it.
        org = await _org(db_session)
        chief = await _member(db_session, org, ["*"])
        coordinator = await _member(db_session, org, COORDINATOR_PERMS)
        admin_role = await _position(db_session, org, ["*"])
        svc = MembershipPipelineService(db_session)
        prospect = await _prospect(
            svc, org, created_by=str(chief.id), target_role_id=str(admin_role.id)
        )

        with patch(
            "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
            new=AsyncMock(),
        ) as reported:
            with pytest.raises(HTTPException) as refused:
                await self._transfer(db_session, coordinator, prospect)

        assert refused.value.status_code == 403
        assert "target position" in refused.value.detail
        reported.assert_not_awaited()

    async def test_a_stored_role_within_the_caller_is_applied(
        self, db_session: AsyncSession
    ):
        org = await _org(db_session)
        chief = await _member(db_session, org, ADMIN_PERMS)
        role = await _position(db_session, org, COORDINATOR_PERMS)
        svc = MembershipPipelineService(db_session)
        # Stored with no recorded chooser: the manual path vouches by the
        # caller, not by who stored it.
        prospect = await _prospect(svc, org, target_role_id=str(role.id))

        result = await self._transfer(db_session, chief, prospect)

        assert str(role.id) in await _position_ids_of(db_session, result["user_id"])


async def test_the_ceiling_can_refuse_without_an_alert(db_session: AsyncSession):
    org = await _org(db_session)
    coordinator = await _member(db_session, org, COORDINATOR_PERMS)
    admin_role = await _position(db_session, org, ["*"])

    with patch(
        "app.api.v1.endpoints.users.report_privilege_escalation_attempt",
        new=AsyncMock(),
    ) as reported:
        with pytest.raises(HTTPException) as refused:
            await _enforce_role_grant_ceiling(
                coordinator,
                [admin_role],
                db_session,
                None,
                report=False,
                detail="custom",
            )

    assert refused.value.detail == "custom"
    reported.assert_not_awaited()
