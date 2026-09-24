"""Prospect target role and lifecycle stamps.

Three things this covers, all of which shipped broken or missing:

* **The target role was displayed and then dropped.** `ConversionModal` sent
  `target_role_id` from a field nothing had ever populated, so `role_ids` was
  always empty and every converted member came out holding the default
  `member` position alone — silently, because that default is granted anyway.
  The automatic path was worse: `_complete_step` calls `_do_transfer` with no
  roles at all, so it could never have honoured the applicant's role.
* **The deactivation and withdrawal stamps had readers and no producer.** The
  drawer's banners and its Details block read five fields that no column
  backed.
* **A client-supplied role id is a cross-tenant FK.** It is copied onto the
  new User at transfer, so an unvalidated one grants another organization's
  position to a brand-new member (XC-1 / CLAUDE.md pitfall #14c).
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.membership_pipeline import ProspectStatus
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


async def _make_position(db: AsyncSession, org_id: str, name: str) -> str:
    """Insert one position, the table `Role` is an alias for."""
    position_id = _uid()
    await db.execute(
        text(
            "INSERT INTO positions (id, organization_id, name, slug) "
            "VALUES (:id, :org, :name, :slug)"
        ),
        {
            "id": position_id,
            "org": org_id,
            "name": name,
            "slug": f"{name.lower().replace(' ', '-')}-{position_id[:8]}",
        },
    )
    await db.flush()
    return position_id


async def _make_prospect(
    svc: MembershipPipelineService, org_id: str, **extra
) -> object:
    data = {
        "first_name": "Devon",
        "last_name": "Marsh",
        "email": f"devon-{_uid()[:8]}@example.org",
    }
    data.update(extra)
    return await svc.create_prospect(organization_id=org_id, data=data)


class TestTargetRoleIsOrgScoped:
    async def test_create_rejects_a_role_from_another_organization(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"other-{other_org[:8]}"},
        )
        foreign_role = await _make_position(db_session, other_org, "Chief")
        svc = MembershipPipelineService(db_session)

        with pytest.raises(ValueError, match="target role"):
            await _make_prospect(svc, org_id, target_role_id=foreign_role)

    async def test_update_rejects_a_role_from_another_organization(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        other_org = _uid()
        await db_session.execute(
            text(
                "INSERT INTO organizations "
                "(id, name, organization_type, slug, timezone) "
                "VALUES (:id, 'Other', 'fire_department', :slug, 'UTC')"
            ),
            {"id": other_org, "slug": f"other2-{other_org[:8]}"},
        )
        foreign_role = await _make_position(db_session, other_org, "Captain")
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        with pytest.raises(ValueError, match="target role"):
            await svc.update_prospect(
                prospect_id=str(prospect.id),
                organization_id=org_id,
                data={"target_role_id": foreign_role},
            )

    async def test_an_in_org_role_is_stored_and_its_name_resolved(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        role_id = await _make_position(db_session, org_id, "Safety Officer")
        svc = MembershipPipelineService(db_session)

        prospect = await _make_prospect(svc, org_id, target_role_id=role_id)
        fetched = await svc.get_prospect(str(prospect.id), org_id)

        assert str(fetched.target_role_id) == role_id
        # Serialised from the relationship rather than stored, so renaming the
        # position cannot leave a stale copy on the application.
        assert fetched.target_role_name == "Safety Officer"

    async def test_no_target_role_is_allowed(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)

        prospect = await _make_prospect(svc, org_id)
        fetched = await svc.get_prospect(str(prospect.id), org_id)

        assert fetched.target_role_id is None
        assert fetched.target_role_name is None


class TestLifecycleStamps:
    async def test_withdrawing_stamps_the_date_and_the_reason(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        updated = await svc.set_prospect_status(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            status="withdrawn",
            changed_by=admin_id,
            reason="Took a job out of state",
        )

        assert updated.withdrawn_at is not None
        assert updated.withdrawal_reason == "Took a job out of state"
        assert updated.deactivated_at is None

    async def test_deactivating_stamps_the_date_and_the_reason(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        updated = await svc.set_prospect_status(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            status="inactive",
            changed_by=admin_id,
            reason="No contact for 90 days",
        )

        assert updated.deactivated_at is not None
        assert updated.deactivated_reason == "No contact for 90 days"
        assert updated.reactivated_at is None

    async def test_reactivating_stamps_without_clearing_the_deactivation(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The drawer renders both as a history pair, so neither clears.

        Its Details block shows "Deactivated:" and "Last reactivated:" for an
        applicant whatever their status is now, and its inactive banner shows
        a *prior* reactivation on a record that has gone inactive again. The
        migration backfilled existing rows on the same rule.
        """
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        await svc.set_prospect_status(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            status="inactive",
            changed_by=admin_id,
            reason="Lapsed",
        )
        updated = await svc.set_prospect_status(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            status="active",
            changed_by=admin_id,
            reason="Came back",
        )

        assert updated.reactivated_at is not None
        assert updated.deactivated_at is not None
        assert updated.deactivated_reason == "Lapsed"
        assert updated.status == ProspectStatus.ACTIVE

    async def test_an_unrelated_transition_stamps_nothing(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        updated = await svc.set_prospect_status(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            status="on_hold",
            changed_by=admin_id,
            reason="Waiting on references",
        )

        assert updated.withdrawn_at is None
        assert updated.deactivated_at is None
        assert updated.reactivated_at is None

    async def test_the_stamps_cannot_be_set_through_the_generic_update(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """They are written by the status path only.

        ProspectUpdate does not declare them, so they cannot arrive through
        the endpoint; _PROSPECT_PROTECTED_FIELDS is the second lock, for a
        caller reaching the service directly.
        """
        org_id, _ = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        updated = await svc.update_prospect(
            prospect_id=str(prospect.id),
            organization_id=org_id,
            data={"withdrawn_at": "2020-01-01T00:00:00Z", "notes": "kept"},
        )

        assert updated.withdrawn_at is None
        assert updated.notes == "kept"


async def _roles_of(db: AsyncSession, user_id: str) -> set[str]:
    """Position names held by a user, read back through the join table."""
    result = await db.execute(
        text(
            "SELECT p.name FROM positions p "
            "JOIN user_positions up ON up.position_id = p.id "
            "WHERE up.user_id = :uid"
        ),
        {"uid": user_id},
    )
    return {row[0] for row in result.all()}


class TestTransferAppliesTheTargetRole:
    """The defect this change exists to close.

    `ConversionModal` displayed the target role and sent its id, but nothing
    had ever populated the field, so `role_ids` was always empty. The member
    came out with the default `member` position alone, and nothing said so.
    """

    async def test_the_stored_role_is_applied_when_the_caller_sends_none(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        org_id, admin_id = setup_org_and_admin
        role_id = await _make_position(db_session, org_id, "Safety Officer")
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id, target_role_id=role_id)

        result = await svc.transfer_to_membership(str(prospect.id), org_id, admin_id)

        assert result is not None
        assert result["success"] is True
        assert "Safety Officer" in await _roles_of(db_session, result["user_id"])

    async def test_an_explicit_role_wins_over_the_stored_one(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """The conversion dialog can correct the role at the last moment."""
        org_id, admin_id = setup_org_and_admin
        stored = await _make_position(db_session, org_id, "Safety Officer")
        chosen = await _make_position(db_session, org_id, "Training Officer")
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id, target_role_id=stored)

        result = await svc.transfer_to_membership(
            str(prospect.id), org_id, admin_id, role_ids=[chosen]
        )

        assert result is not None
        assert result["success"] is True
        held = await _roles_of(db_session, result["user_id"])
        assert "Training Officer" in held
        assert "Safety Officer" not in held

    async def test_no_target_role_still_transfers(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """An application that never named a role converts as it always did."""
        org_id, admin_id = setup_org_and_admin
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id)

        result = await svc.transfer_to_membership(str(prospect.id), org_id, admin_id)

        assert result is not None
        assert result["success"] is True

    async def test_the_automatic_path_honours_it_too(
        self, db_session: AsyncSession, setup_org_and_admin
    ):
        """`_complete_step` calls `_do_transfer` with no roles at all.

        Before the fallback that path could never have applied the
        applicant's role, whatever the coordinator had chosen.
        """
        org_id, admin_id = setup_org_and_admin
        role_id = await _make_position(db_session, org_id, "Engineer")
        svc = MembershipPipelineService(db_session)
        prospect = await _make_prospect(svc, org_id, target_role_id=role_id)
        loaded = await svc.get_prospect(str(prospect.id), org_id)

        transfer = await svc._do_transfer(loaded, admin_id)

        assert transfer is not None
        assert transfer["success"] is True
        assert "Engineer" in await _roles_of(db_session, transfer["user_id"])
