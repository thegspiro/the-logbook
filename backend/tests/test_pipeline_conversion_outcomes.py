"""What an applicant becomes when a pipeline converts them to a member.

Each pipeline chooses a class and starting status per applicant track: a
department can make administrative applicants regular administrative members
while operational applicants become probationary operational ones.

Before this, automatic conversion (an election vote or final approval on a
pipeline with auto-transfer) ignored the applicant's track entirely and made
everyone a probationary operational member -- an elected treasurer came out a
probationary firefighter.
"""

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.schemas.membership_pipeline import (
    PipelineConversionConfig,
    PipelineResponse,
    PipelineUpdate,
    TransferProspectRequest,
    resolve_conversion_outcome,
)
from app.services.membership_pipeline_service import MembershipPipelineService


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.mark.unit
class TestTheRule:
    def test_defaults_are_what_the_convert_dialog_produced(self):
        assert resolve_conversion_outcome(None, None) == ("operational", "probationary")
        assert resolve_conversion_outcome(None, "probationary") == (
            "operational",
            "probationary",
        )
        assert resolve_conversion_outcome({}, "administrative") == (
            "administrative",
            "regular",
        )

    def test_a_configured_outcome_is_used_for_its_track(self):
        config = PipelineConversionConfig.model_validate(
            {
                "operational": {
                    "member_class": "operational",
                    "member_status": "regular",
                },
                "administrative": {
                    "member_class": "administrative",
                    "member_status": "probationary",
                },
            }
        ).model_dump()

        assert resolve_conversion_outcome(config, "administrative") == (
            "administrative",
            "probationary",
        )
        assert resolve_conversion_outcome(config, "probationary") == (
            "operational",
            "regular",
        )

    def test_a_malformed_stored_outcome_falls_back_rather_than_failing(self):
        config = {"administrative": {"member_class": "chief", "member_status": "x"}}

        assert resolve_conversion_outcome(config, "administrative") == (
            "administrative",
            "regular",
        )

    @pytest.mark.parametrize(
        "outcome",
        [
            {"member_class": "chief", "member_status": "regular"},
            {"member_class": "operational", "member_status": "life"},
        ],
    )
    def test_only_known_classes_and_starting_statuses_are_accepted(self, outcome):
        with pytest.raises(ValidationError):
            PipelineUpdate(conversion_config={"operational": outcome})

    def test_the_response_always_carries_the_effective_outcomes(self):
        # The Convert dialog pre-fills from this, so an unconfigured pipeline
        # must report the defaults conversion will use, not nothing.
        validated = PipelineResponse.model_validate(
            {
                "id": uuid.uuid4(),
                "organization_id": uuid.uuid4(),
                "name": "P",
                "created_at": "2026-09-30T00:00:00Z",
                "updated_at": "2026-09-30T00:00:00Z",
                "conversion_config": None,
            }
        )

        assert validated.conversion_config.administrative.model_dump() == {
            "member_class": "administrative",
            "member_status": "regular",
        }

    def test_class_and_status_are_sent_together(self):
        with pytest.raises(ValidationError, match="together"):
            TransferProspectRequest(member_class="administrative")
        TransferProspectRequest(member_class="administrative", member_status="regular")


async def _org(db_session: AsyncSession) -> str:
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"d-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _convert(svc, db_session, org_id, pipeline_id, desired, **transfer):
    prospect = await svc.create_prospect(
        organization_id=org_id,
        data={
            "first_name": "Jordan",
            "last_name": f"Hale{_uid()[:4]}",
            "email": f"j-{_uid()[:8]}@example.com",
            "pipeline_id": pipeline_id,
            "desired_membership_type": desired,
        },
    )
    loaded = await svc.get_prospect(str(prospect.id), org_id)
    # _do_transfer with no class, status or membership_type is exactly what
    # complete_step's automatic conversion calls.
    result = await svc._do_transfer(loaded, None, **transfer)
    assert result["success"] is True, result
    return (
        await db_session.execute(
            select(User)
            .where(User.id == result["user_id"])
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


ADMIN_PROBATION = {
    "operational": {"member_class": "operational", "member_status": "probationary"},
    "administrative": {
        "member_class": "administrative",
        "member_status": "probationary",
    },
}


@pytest.mark.integration
class TestConversion:
    async def test_an_elected_administrative_applicant_is_administrative(
        self, db_session: AsyncSession
    ):
        # The defect: no configuration at all, and this came out a
        # probationary operational member.
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")

        user = await _convert(
            svc, db_session, org_id, str(pipeline.id), "administrative"
        )

        assert (user.member_class, user.member_status) == ("administrative", "regular")

    async def test_the_pipeline_rule_decides_each_track(self, db_session: AsyncSession):
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="P", conversion_config=ADMIN_PROBATION
        )

        admin = await _convert(
            svc, db_session, org_id, str(pipeline.id), "administrative"
        )
        operational = await _convert(
            svc, db_session, org_id, str(pipeline.id), "probationary"
        )

        # A probationary administrative member: the legacy membership_type
        # cannot spell it, which is why class and status are written directly.
        assert (admin.member_class, admin.member_status) == (
            "administrative",
            "probationary",
        )
        assert (operational.member_class, operational.member_status) == (
            "operational",
            "probationary",
        )

    async def test_an_explicit_choice_overrides_the_rule(
        self, db_session: AsyncSession
    ):
        # The Convert dialog pre-fills from the rule; a coordinator may change
        # it for one applicant.
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="P", conversion_config=ADMIN_PROBATION
        )

        user = await _convert(
            svc,
            db_session,
            org_id,
            str(pipeline.id),
            "administrative",
            member_class="social",
            member_status="regular",
        )

        assert (user.member_class, user.member_status) == ("social", "regular")

    async def test_a_legacy_membership_type_still_decides_for_old_callers(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(
            organization_id=org_id, name="P", conversion_config=ADMIN_PROBATION
        )

        user = await _convert(
            svc,
            db_session,
            org_id,
            str(pipeline.id),
            "administrative",
            membership_type="administrative",
        )

        assert user.membership_type == "administrative"
        assert (user.member_class, user.member_status) == ("administrative", "regular")


@pytest.mark.integration
class TestStoringTheRule:
    async def test_it_is_saved_updated_cleared_and_duplicated(
        self, db_session: AsyncSession
    ):
        org_id = await _org(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline = await svc.create_pipeline(organization_id=org_id, name="P")
        assert pipeline.conversion_config is None

        updated = await svc.update_pipeline(
            str(pipeline.id),
            org_id,
            PipelineUpdate(conversion_config=ADMIN_PROBATION).model_dump(
                exclude_unset=True
            ),
        )
        assert updated.conversion_config["administrative"] == {
            "member_class": "administrative",
            "member_status": "probationary",
        }

        copy = await svc.duplicate_pipeline(str(pipeline.id), org_id, "Copy")
        assert copy.conversion_config == updated.conversion_config

        cleared = await svc.update_pipeline(
            str(pipeline.id), org_id, {"conversion_config": None}
        )
        assert cleared.conversion_config is None
