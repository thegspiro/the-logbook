"""
Closed applications leave the pipeline.

A rejected applicant used to stay exactly where they were: a card in the
stage they were rejected at, a row in the applicant table, a "ready"
election package an officer could still add to a ballot, and a prospect an
interview could still be filed against. The status blocked *movement* and
nothing else.

These cover the drop: the open-only list filter the board and table use, the
gate on the work that only makes sense on an open application, and the
single-record status path — which reached the database through the update
endpoint as ``notes``, overwriting the coordinator's notes with the
rejection reason (the bug already fixed for the bulk path).
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.membership_pipeline import router as pipeline_router
from app.models.membership_pipeline import ProspectActivityLog, ProspectStatus
from app.services.membership_pipeline_service import (
    CLOSED_PROSPECT_STATUSES,
    MembershipPipelineService,
)

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org_and_admin(db_session: AsyncSession):
    org_id = _uid()
    admin_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :org, :un, 'Admin', 'User', :em, 'hashed', 'active')"
        ),
        {
            "id": admin_id,
            "org": org_id,
            "un": f"admin-{org_id[:8]}",
            "em": f"admin-{org_id[:8]}@test.example",
        },
    )
    await db_session.flush()
    return org_id, admin_id


async def _pipeline_with_steps(svc, org_id, count=2):
    pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
    steps = [
        await svc.add_step(pipeline.id, org_id, {"name": f"Stage {i + 1}"})
        for i in range(count)
    ]
    return pipeline, steps


async def _prospect(svc, org_id, pipeline_id, **overrides):
    data = {
        "first_name": "App",
        "last_name": f"Licant{_uid()[:4]}",
        "email": f"a-{_uid()[:8]}@example.com",
        "pipeline_id": pipeline_id,
    }
    data.update(overrides)
    return await svc.create_prospect(organization_id=org_id, data=data)


# =========================================================================
# 1. The board and table stop showing closed applications
# =========================================================================


class TestOpenOnlyListing:

    async def test_every_closed_status_is_dropped(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)

        for status in CLOSED_PROSPECT_STATUSES:
            p = await _prospect(svc, org_id, pipeline.id)
            if status == ProspectStatus.TRANSFERRED:
                # Derived state — only transfer_prospect produces it.
                p.status = status
                await db_session.flush()
            else:
                await svc.set_prospect_status(p.id, org_id, status.value, admin_id)

        prospects, total = await svc.list_prospects(org_id, open_only=True)

        assert total == 0
        assert prospects == []

    async def test_active_and_on_hold_stay_on_the_board(
        self, db_session: AsyncSession, org_and_admin
    ):
        """On hold is a pause the coordinator means to lift, not a closed
        application — it keeps its card."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        active = await _prospect(svc, org_id, pipeline.id)
        held = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(held.id, org_id, "on_hold", admin_id)
        rejected = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(rejected.id, org_id, "rejected", admin_id)

        prospects, total = await svc.list_prospects(org_id, open_only=True)

        assert total == 2
        assert {str(p.id) for p in prospects} == {str(active.id), str(held.id)}

    async def test_the_archive_views_can_still_ask_for_one_closed_status(
        self, db_session: AsyncSession, org_and_admin
    ):
        """open_only defaults off, so the Rejected / Withdrawn / Inactive
        tabs keep working through the status filter."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        rejected = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(rejected.id, org_id, "rejected", admin_id)
        await _prospect(svc, org_id, pipeline.id)

        found, total = await svc.list_prospects(org_id, status="rejected")

        assert total == 1
        assert str(found[0].id) == str(rejected.id)

        _, unfiltered_total = await svc.list_prospects(org_id)
        assert unfiltered_total == 2


# =========================================================================
# 2. The rejection reason does not overwrite the coordinator notes
# =========================================================================


class TestSingleStatusChange:

    async def test_the_reason_is_logged_and_notes_survive(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(
            svc, org_id, pipeline.id, notes="Strong reference from Engine 2."
        )

        await svc.set_prospect_status(
            p.id, org_id, "rejected", admin_id, reason="Failed the agility test"
        )

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.status == ProspectStatus.REJECTED
        assert refreshed.notes == "Strong reference from Engine 2."

        entry = await db_session.scalar(
            select(ProspectActivityLog).where(
                ProspectActivityLog.prospect_id == p.id,
                ProspectActivityLog.action == "prospect_status_changed",
            )
        )
        assert entry is not None
        assert entry.details["reason"] == "Failed the agility test"
        assert entry.details["from"] == "active"
        assert entry.details["to"] == "rejected"
        assert entry.details["bulk"] is False

    async def test_a_no_op_status_change_is_refused(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        with pytest.raises(ValueError, match="already active"):
            await svc.set_prospect_status(p.id, org_id, "active", admin_id)

    async def test_an_invalid_status_is_refused(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        with pytest.raises(ValueError, match="Invalid status"):
            await svc.set_prospect_status(p.id, org_id, "banished", admin_id)

    async def test_another_organizations_prospect_is_not_found(
        self, db_session: AsyncSession, org_and_admin
    ):
        """CLAUDE.md #14b — the permission dependency asserts the caller holds
        the permission in their own org, not that this row is theirs."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        assert await svc.set_prospect_status(p.id, _uid(), "rejected", admin_id) is None

    async def test_transferred_cannot_be_set_by_a_status_change(
        self, db_session: AsyncSession, org_and_admin
    ):
        """Transferred is stamped by transfer_prospect as it creates the User.

        Setting it here would close the application and count it as a
        conversion in the stats with no member behind it.
        """
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        with pytest.raises(ValueError, match="transfer endpoint"):
            await svc.set_prospect_status(p.id, org_id, "transferred", admin_id)

        results = await svc.bulk_set_prospect_status(
            [p.id], org_id, "transferred", admin_id
        )
        assert results[0]["succeeded"] is False
        assert "transfer endpoint" in results[0]["error"]

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.status == ProspectStatus.ACTIVE

    async def test_a_member_cannot_be_put_back_on_the_board(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The mirror image: clearing transferred would return somebody who is
        already a member to the pipeline, under the active-email index."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        p.status = ProspectStatus.TRANSFERRED
        await db_session.flush()

        with pytest.raises(ValueError, match="already a member"):
            await svc.set_prospect_status(p.id, org_id, "active", admin_id)

    async def test_reactivating_returns_a_closed_application_to_the_board(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, steps = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(p.id, org_id, "rejected", admin_id)

        await svc.set_prospect_status(
            p.id, org_id, "active", admin_id, reason="Appealed successfully"
        )

        prospects, total = await svc.list_prospects(org_id, open_only=True)
        assert total == 1
        # Back at the stage it left from, not at the start.
        assert str(prospects[0].current_step_id) == str(steps[0].id)


# =========================================================================
# 3. A closed application cannot be voted on or interviewed
# =========================================================================


class TestClosedApplicationGates:

    async def test_a_rejected_applicant_gets_no_election_package(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(p.id, org_id, "rejected", admin_id)

        with pytest.raises(ValueError, match="rejected"):
            await svc.create_election_package(p.id, org_id, created_by=admin_id)

    async def test_a_ready_package_cannot_reach_a_ballot_after_rejection(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The package's own status is a snapshot and stays "ready" — the
        applicant's status is what decides."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.create_election_package(p.id, org_id, created_by=admin_id)
        await svc.update_election_package(p.id, org_id, {"status": "ready"}, admin_id)
        await svc.set_prospect_status(p.id, org_id, "rejected", admin_id)

        with pytest.raises(ValueError, match="rejected"):
            await svc.assign_package_to_election(p.id, org_id, _uid(), admin_id)

    async def test_a_closed_applicants_package_leaves_the_ballot_picker(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        open_app = await _prospect(svc, org_id, pipeline.id)
        closed_app = await _prospect(svc, org_id, pipeline.id)
        for prospect in (open_app, closed_app):
            await svc.create_election_package(prospect.id, org_id, created_by=admin_id)
            await svc.update_election_package(
                prospect.id, org_id, {"status": "ready"}, admin_id
            )
        await svc.set_prospect_status(closed_app.id, org_id, "rejected", admin_id)

        listed = await svc.list_election_packages(org_id, status_filter="ready")
        assert [pkg.prospect_id for pkg in listed] == [str(open_app.id)]

        # A history view can still ask for them.
        everything = await svc.list_election_packages(
            org_id, status_filter="ready", include_closed=True
        )
        assert {pkg.prospect_id for pkg in everything} == {
            str(open_app.id),
            str(closed_app.id),
        }

    async def test_a_rejected_applicant_cannot_be_interviewed(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(p.id, org_id, "rejected", admin_id)

        with pytest.raises(ValueError, match="rejected"):
            await svc.create_interview(p.id, org_id, admin_id, notes="n")

    async def test_an_on_hold_applicant_can_still_be_interviewed(
        self, db_session: AsyncSession, org_and_admin
    ):
        """A pause is not a closure: an interview held while a candidate
        sorts out a scheduling conflict still needs recording."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        await svc.set_prospect_status(p.id, org_id, "on_hold", admin_id)

        interview = await svc.create_interview(p.id, org_id, admin_id, notes="n")

        assert interview.id is not None


# =========================================================================
# 3b. The generic update endpoint cannot be used to work around the same
#     TRANSFERRED guard, and an explicit null actually clears a field
# =========================================================================


class TestGenericUpdateStatusGuard:
    """PUT /prospects/{id} reaches the same status column as the dedicated
    status endpoint, through a second code path (update_prospect) that used
    to have none of set_prospect_status's guards. Both must refuse the same
    TRANSFERRED manipulation."""

    async def test_transferred_cannot_be_set_via_the_generic_update(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        with pytest.raises(ValueError, match="cannot be set or cleared"):
            await svc.update_prospect(
                p.id, org_id, {"status": "transferred"}, updated_by=admin_id
            )

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.status == ProspectStatus.ACTIVE

    async def test_a_member_cannot_be_put_back_on_the_board_via_generic_update(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)
        p.status = ProspectStatus.TRANSFERRED
        await db_session.flush()

        with pytest.raises(ValueError, match="cannot be set or cleared"):
            await svc.update_prospect(
                p.id, org_id, {"status": "active"}, updated_by=admin_id
            )

    async def test_an_ordinary_status_change_via_generic_update_still_works(
        self, db_session: AsyncSession, org_and_admin
    ):
        """The guard targets TRANSFERRED specifically — it must not block the
        ordinary edits this endpoint has always allowed."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        await svc.update_prospect(
            p.id, org_id, {"status": "on_hold"}, updated_by=admin_id
        )

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.status == ProspectStatus.ON_HOLD


class TestGenericUpdateExplicitNull:
    """CLAUDE.md Pitfall #1: an update payload built with exclude_unset=True
    sends an explicit null to mean "clear this field". The old `if value is
    not None` guard silently dropped it — the request returned 200 with the
    old value still in the database."""

    async def test_explicit_null_clears_referred_by(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id, referred_by=admin_id)
        assert (await svc.get_prospect(p.id, org_id)).referred_by == admin_id

        await svc.update_prospect(
            p.id, org_id, {"referred_by": None}, updated_by=admin_id
        )

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.referred_by is None

    async def test_explicit_null_clears_phone(
        self, db_session: AsyncSession, org_and_admin
    ):
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id, phone="555-0100")
        assert (await svc.get_prospect(p.id, org_id)).phone == "555-0100"

        await svc.update_prospect(p.id, org_id, {"phone": None}, updated_by=admin_id)

        refreshed = await svc.get_prospect(p.id, org_id)
        assert refreshed.phone is None

    async def test_explicit_null_against_a_not_null_column_is_a_400_not_a_no_op(
        self, db_session: AsyncSession, org_and_admin
    ):
        """email is NOT NULL on the model. Silently dropping the null (the
        old behavior) is worse here than the previous status-only case: it
        would return 200 while giving no indication the clear never
        happened."""
        org_id, admin_id = org_and_admin
        svc = MembershipPipelineService(db_session)
        pipeline, _ = await _pipeline_with_steps(svc, org_id)
        p = await _prospect(svc, org_id, pipeline.id)

        with pytest.raises(ValueError, match="cannot be cleared"):
            await svc.update_prospect(
                p.id, org_id, {"email": None}, updated_by=admin_id
            )


# =========================================================================
# 4. The single-record status route is gated like the bulk one
# =========================================================================


def _permission_set(path: str, method: str) -> set:
    for route in pipeline_router.routes:
        if route.path == path and method in route.methods:
            for dependency in route.dependant.dependencies:
                permissions = getattr(dependency.call, "required_permissions", None)
                if permissions is not None:
                    return set(permissions)
    pytest.fail(f"Permission dependency not found for {method} {path}")


def test_the_status_route_is_gated_like_the_bulk_one():
    """Doing one at a time must not be the cheap way past the permission the
    bulk endpoint asks for."""
    single = _permission_set("/prospects/{prospect_id}/status", "POST")

    assert single == _permission_set("/prospects/bulk-status", "POST")
    assert single == {"members.manage", "prospective_members.manage"}
