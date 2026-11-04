"""Re-verification on the member paths that grant a rank or roles (PERM-10).

Owner decision 2026-11-01: creating a member or editing a profile asks the
caller to confirm it's them only when the request grants a rank or roles, the
part that carries permissions. Ordinary profile saves and onboarding a member
with neither never prompt. (Rank CRUD, member status and archive take the
whole-handler gate and are pinned in ``test_mfa_policy.STEPUP_HANDLERS``.)
"""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select

from app.api.v1.endpoints.users import create_member, update_user_profile
from app.models.user import Organization, Role, User, UserStatus
from app.schemas.user import AdminUserCreate, UserUpdate

USERS = "app.api.v1.endpoints.users"
REFUSED = HTTPException(status_code=403, detail="Please confirm your identity.")


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value


def _caller():
    return SimpleNamespace(
        id=str(uuid4()),
        organization_id=str(uuid4()),
        username="secretary",
        rank=None,
        positions=[SimpleNamespace(permissions=["members.manage"])],
    )


def _target(rank=None):
    return SimpleNamespace(
        id=str(uuid4()),
        rank=rank,
        member_class="operational",
        member_status=None,
        membership_type="active",
        membership_type_changed_at=None,
        status=UserStatus.ACTIVE,
        status_changed_at=None,
        status_change_reason=None,
        full_name="Dana Reyes",
        display_name="Dana Reyes",
        preferred_name=None,
        mobile=None,
        phone=None,
    )


@pytest.mark.unit
class TestProfileUpdate:
    async def _save(self, payload, *, target, stepup):
        caller = _caller()
        db = AsyncMock()
        # caller's permissions, the target, the caller again for the
        # restricted fields, then the re-read after commit
        db.execute.side_effect = [
            _Result(caller),
            _Result(target),
            _Result(caller),
            _Result(target),
        ]
        with (
            patch(
                f"{USERS}.OperationalRankService",
                return_value=SimpleNamespace(
                    resolve_rank_code=AsyncMock(side_effect=lambda _org, code: code)
                ),
            ),
            patch(f"{USERS}.log_audit_event", new=AsyncMock()),
            patch(f"{USERS}._enforce_rank_grant_ceiling", new=AsyncMock()),
            patch(f"{USERS}.ensure_stepup", new=stepup),
        ):
            await update_user_profile(
                uuid4(),
                payload,
                db,
                caller,
                authorization=None,
                access_token="session-token",
            )
        return db

    async def test_a_rank_change_asks_on_the_callers_session(self):
        stepup = AsyncMock()
        target = _target(rank="firefighter")

        await self._save(UserUpdate(rank="captain"), target=target, stepup=stepup)

        stepup.assert_awaited_once()
        assert stepup.call_args.args[1] == "session-token"
        assert target.rank == "captain"

    async def test_a_refused_check_writes_nothing(self):
        target = _target(rank="firefighter")

        with pytest.raises(HTTPException) as exc:
            await self._save(
                UserUpdate(rank="captain"),
                target=target,
                stepup=AsyncMock(side_effect=REFUSED),
            )

        assert exc.value.status_code == 403
        assert target.rank == "firefighter"

    async def test_the_same_rank_sent_back_does_not_ask(self):
        stepup = AsyncMock()

        await self._save(
            UserUpdate(rank="captain", station="2"),
            target=_target(rank="captain"),
            stepup=stepup,
        )

        stepup.assert_not_awaited()

    async def test_clearing_a_rank_does_not_ask(self):
        stepup = AsyncMock()
        target = _target(rank="captain")

        await self._save(UserUpdate(rank=None), target=target, stepup=stepup)

        stepup.assert_not_awaited()
        assert target.rank is None

    async def test_an_ordinary_save_does_not_ask(self):
        stepup = AsyncMock()

        await self._save(
            UserUpdate(station="3", platoon="B"),
            target=_target(rank="captain"),
            stepup=stepup,
        )

        stepup.assert_not_awaited()


@pytest.mark.integration
class TestCreateMember:
    async def _create(self, db_session, stepup, with_role=False, **fields):
        org = Organization(
            id=str(uuid.uuid4()),
            name="Step-up Department",
            slug=f"stepup-{uuid.uuid4().hex[:8]}",
        )
        db_session.add(org)
        await db_session.flush()
        handle = uuid.uuid4().hex[:8]
        officer = User(
            id=str(uuid.uuid4()),
            organization_id=org.id,
            username=f"officer-{handle}",
            email=f"officer-{handle}@example.org",
            first_name="Olive",
            last_name="Officer",
            password_hash="x",
            status=UserStatus.ACTIVE,
        )
        db_session.add(officer)
        await db_session.flush()
        if with_role:
            role = Role(
                organization_id=org.id,
                name="Lieutenant",
                slug=f"lt-{handle}",
                permissions=["events.manage"],
            )
            db_session.add(role)
            await db_session.flush()
            fields["role_ids"] = [role.id]
        data = AdminUserCreate(
            username=f"new-{handle}",
            email=f"new-{handle}@example.org",
            first_name="New",
            last_name="Member",
            password="Corr3ct-Horse-Battery!",
            send_welcome_email=False,
            **fields,
        )
        with (
            patch(
                f"{USERS}._canonical_rank_or_400",
                new=AsyncMock(side_effect=lambda rank, _org, _db: rank),
            ),
            patch(f"{USERS}._enforce_rank_grant_ceiling", new=AsyncMock()),
            patch(f"{USERS}._enforce_role_grant_ceiling", new=AsyncMock()),
            patch(f"{USERS}.ensure_stepup", new=stepup),
        ):
            await create_member(
                user_data=data,
                background_tasks=BackgroundTasks(),
                request=MagicMock(),
                db=db_session,
                current_user=officer,
                access_token="session-token",
            )
        return data.username, org.id

    async def _exists(self, db_session, username, org_id):
        result = await db_session.execute(
            select(User.id).where(
                User.username == username, User.organization_id == org_id
            )
        )
        return result.scalar_one_or_none() is not None

    async def test_a_member_with_a_rank_asks(self, db_session):
        stepup = AsyncMock()

        await self._create(db_session, stepup, rank="captain")

        stepup.assert_awaited_once()
        assert stepup.call_args.args[1] == "session-token"

    async def test_a_member_with_roles_asks(self, db_session):
        stepup = AsyncMock()

        await self._create(db_session, stepup, with_role=True)

        stepup.assert_awaited_once()

    async def test_a_refused_check_creates_nobody(self, db_session):
        stepup = AsyncMock(side_effect=REFUSED)

        with pytest.raises(HTTPException) as exc:
            await self._create(db_session, stepup, rank="captain")

        assert exc.value.status_code == 403
        rows = await db_session.execute(
            select(User.id).where(User.first_name == "New", User.last_name == "Member")
        )
        assert rows.first() is None

    async def test_a_member_with_neither_does_not_ask(self, db_session):
        stepup = AsyncMock()

        username, org_id = await self._create(db_session, stepup)

        stepup.assert_not_awaited()
        assert await self._exists(db_session, username, org_id)
