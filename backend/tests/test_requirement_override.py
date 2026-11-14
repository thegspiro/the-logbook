"""A Chief's override of a session-attendance requirement.

Pins the rules agreed with the department:

  * an override counts a member as meeting the requirement whenever it is
    graded as of a date in the range the Chief chose, however short they are;
  * it excuses no session and no month: the count is reported as it stands,
    and no other requirement's proration moves;
  * it counts only while the requirement still allows overrides, and is
    labelled an override only for a member who would otherwise fall short;
  * only a member holding a Chief position records or revokes one, and only
    on a requirement that allows it; revoked overrides stay on record.
"""

import uuid
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints import training as endpoint
from app.models.training import TrainingRequirementOverride
from app.schemas.training import RequirementOverrideCreate
from app.services.requirement_override_service import (
    RequirementOverrideService,
    holds_chief_position,
)
from app.services.training_compliance import (
    evaluate_member_requirement_detail,
    tally_session_attendance,
)
from app.services.training_service import TrainingService
from app.services.training_waiver_service import (
    SOURCE_OVERRIDE,
    WaiverPeriod,
    adjust_required,
    fetch_org_waivers,
    fetch_user_waivers,
    month_waivers,
)
from tests.test_session_attendance_requirement import (
    FIVE,
    REQ_ID,
    TODAY,
    _attended,
    _held,
    _member,
    _org,
    _req,
    _requirement,
)

YEAR = (date(2026, 1, 1), date(2026, 12, 31))


def _override(start=YEAR[0], end=YEAR[1], req_id=REQ_ID):
    return WaiverPeriod(start, end, requirement_ids=[req_id], source=SOURCE_OVERRIDE)


@pytest.mark.unit
class TestTheRule:
    def test_an_override_meets_a_short_member_and_keeps_the_count(self):
        tally = tally_session_attendance(
            _req(allows_chief_override=True),
            _attended(FIVE[0]),
            _held(*FIVE),
            TODAY,
            waivers=[_override()],
        )
        assert tally.met
        assert tally.overridden
        assert (tally.attended, tally.charged, tally.needed) == (1, 5, 3)

    def test_it_counts_only_inside_the_chosen_dates(self):
        tally = tally_session_attendance(
            _req(allows_chief_override=True),
            [],
            _held(*FIVE),
            TODAY,
            waivers=[_override(date(2026, 1, 1), date(2026, 6, 30))],
        )
        assert not tally.met
        assert not tally.overridden

    def test_switching_the_setting_off_suspends_it(self):
        tally = tally_session_attendance(
            _req(allows_chief_override=False),
            [],
            _held(*FIVE),
            TODAY,
            waivers=[_override()],
        )
        assert not tally.met

    def test_an_override_for_another_requirement_does_nothing(self):
        tally = tally_session_attendance(
            _req(allows_chief_override=True),
            [],
            _held(*FIVE),
            TODAY,
            waivers=[_override(req_id="another")],
        )
        assert not tally.met

    def test_a_member_who_met_it_is_not_labelled_overridden(self):
        tally = tally_session_attendance(
            _req(allows_chief_override=True),
            _attended(*FIVE[:3]),
            _held(*FIVE),
            TODAY,
            waivers=[_override()],
        )
        assert tally.met
        assert not tally.overridden

    def test_it_excuses_no_month(self):
        waivers = [_override(req_id="hours-req")]
        assert month_waivers(waivers, *YEAR, "hours-req") == {}
        # The full target over all twelve months: nothing was prorated.
        assert adjust_required(24, *YEAR, waivers, "hours-req") == (24, 0, 12)

    def test_every_grader_reports_it(self):
        req = _req(allows_chief_override=True)
        held = {REQ_ID: _held(*FIVE)}
        ev = evaluate_member_requirement_detail(
            req, [], TODAY, waivers=[_override()], held_sessions=held
        )
        detail = TrainingService.evaluate_requirement_detail(
            req, [], TODAY, waivers=[_override()], held_sessions=held
        )
        assert ev.status == "completed"
        assert ev.overridden
        assert detail["is_met"]
        assert detail["overridden"]

    def test_the_chief_is_a_position_not_a_permission(self):
        chief = SimpleNamespace(positions=[SimpleNamespace(slug="fire_chief")])
        it_manager = SimpleNamespace(positions=[SimpleNamespace(slug="it_manager")])
        assert holds_chief_position(chief)
        assert not holds_chief_position(it_manager)


# ---------------------------------------------------------------------------
# Against real tables
# ---------------------------------------------------------------------------


async def _accepting_requirement(db, org, allows=True):
    requirement = await _requirement(db, org)
    requirement.allows_chief_override = allows
    await db.flush()
    return requirement


def _actor(user, slug="fire_chief"):
    return SimpleNamespace(
        id=user.id,
        organization_id=user.organization_id,
        username=user.username,
        positions=[SimpleNamespace(slug=slug, permissions=[])] if slug else [],
        rank=None,
    )


def _body(member, start=YEAR[0], end=YEAR[1], reason="Deployed overseas"):
    return RequirementOverrideCreate(
        user_id=member.id, start_date=start, end_date=end, reason=reason
    )


@pytest.mark.integration
class TestRecordingOverrides:
    async def test_the_chief_grants_and_the_graders_receive_it(self, db_session):
        org = await _org(db_session)
        chief, member = await _member(db_session, org), await _member(db_session, org)
        req = await _accepting_requirement(db_session, org)

        granted = await endpoint.grant_requirement_override(
            req.id, _body(member), db=db_session, current_user=_actor(chief)
        )

        assert granted.member_name == member.display_name
        assert granted.reason == "Deployed overseas"
        user_periods = await fetch_user_waivers(db_session, org.id, member.id)
        org_periods = (await fetch_org_waivers(db_session, org.id))[member.id]
        for periods in (user_periods, org_periods):
            assert [(p.source, p.requirement_ids) for p in periods] == [
                (SOURCE_OVERRIDE, [req.id])
            ]

    async def test_a_revoked_override_reaches_no_grader_but_stays(self, db_session):
        org = await _org(db_session)
        chief, member = await _member(db_session, org), await _member(db_session, org)
        req = await _accepting_requirement(db_session, org)
        granted = await endpoint.grant_requirement_override(
            req.id, _body(member), db=db_session, current_user=_actor(chief)
        )

        revoked = await endpoint.revoke_requirement_override(
            req.id, granted.id, db=db_session, current_user=_actor(chief)
        )

        assert revoked.revoked_at is not None
        assert revoked.revoked_by_name == chief.display_name
        assert await fetch_user_waivers(db_session, org.id, member.id) == []
        listed = await endpoint.list_requirement_overrides(
            req.id, db=db_session, current_user=_actor(chief)
        )
        assert [o.id for o in listed] == [granted.id]

    async def test_only_the_chief_may_grant(self, db_session):
        org = await _org(db_session)
        officer, member = await _member(db_session, org), await _member(db_session, org)
        req = await _accepting_requirement(db_session, org)

        with pytest.raises(HTTPException) as refused:
            await endpoint.grant_requirement_override(
                req.id,
                _body(member),
                db=db_session,
                current_user=_actor(officer, slug="it_manager"),
            )

        assert refused.value.status_code == 403

    async def test_a_requirement_that_does_not_allow_it_refuses(self, db_session):
        org = await _org(db_session)
        chief, member = await _member(db_session, org), await _member(db_session, org)
        req = await _accepting_requirement(db_session, org, allows=False)

        with pytest.raises(HTTPException) as refused:
            await endpoint.grant_requirement_override(
                req.id, _body(member), db=db_session, current_user=_actor(chief)
            )

        assert refused.value.status_code == 400

    async def test_overlapping_dates_are_refused(self, db_session):
        org = await _org(db_session)
        chief, member = await _member(db_session, org), await _member(db_session, org)
        req = await _accepting_requirement(db_session, org)
        await endpoint.grant_requirement_override(
            req.id, _body(member), db=db_session, current_user=_actor(chief)
        )

        with pytest.raises(HTTPException) as refused:
            await endpoint.grant_requirement_override(
                req.id,
                _body(member, date(2026, 6, 1), date(2027, 5, 31)),
                db=db_session,
                current_user=_actor(chief),
            )

        assert refused.value.status_code == 400
        assert "already has an override" in refused.value.detail

    async def test_another_departments_member_or_requirement_is_refused(
        self, db_session
    ):
        org, other = await _org(db_session), await _org(db_session)
        chief = await _member(db_session, org)
        outsider = await _member(db_session, other)
        req = await _accepting_requirement(db_session, org)
        foreign_req = await _accepting_requirement(db_session, other)

        with pytest.raises(HTTPException) as member_refused:
            await endpoint.grant_requirement_override(
                req.id, _body(outsider), db=db_session, current_user=_actor(chief)
            )
        with pytest.raises(HTTPException) as requirement_refused:
            await endpoint.grant_requirement_override(
                foreign_req.id,
                _body(outsider),
                db=db_session,
                current_user=_actor(chief),
            )

        assert member_refused.value.status_code == 400
        assert requirement_refused.value.status_code == 404

    async def test_revoking_another_requirements_override_is_not_found(
        self, db_session
    ):
        org = await _org(db_session)
        chief, member = await _member(db_session, org), await _member(db_session, org)
        req, other_req = (
            await _accepting_requirement(db_session, org),
            await _accepting_requirement(db_session, org),
        )
        granted = await endpoint.grant_requirement_override(
            req.id, _body(member), db=db_session, current_user=_actor(chief)
        )

        with pytest.raises(HTTPException) as missing:
            await endpoint.revoke_requirement_override(
                other_req.id, granted.id, db=db_session, current_user=_actor(chief)
            )

        assert missing.value.status_code == 404

    async def test_a_member_without_the_chief_or_training_manage_cannot_list(
        self, db_session
    ):
        org = await _org(db_session)
        member = await _member(db_session, org)
        req = await _accepting_requirement(db_session, org)
        viewer = _actor(member, slug=None)

        with pytest.raises(HTTPException) as refused:
            await endpoint.list_requirement_overrides(
                req.id, db=db_session, current_user=viewer
            )

        assert refused.value.status_code == 403

    async def test_the_service_never_deletes_a_row(self, db_session):
        org = await _org(db_session)
        chief, member = await _member(db_session, org), await _member(db_session, org)
        req = await _accepting_requirement(db_session, org)
        service = RequirementOverrideService(db_session)
        override = await service.grant(
            org.id, req, member.id, *YEAR, "Reason", chief.id
        )

        await service.revoke(org.id, req.id, override.id, chief.id)
        await service.revoke(org.id, req.id, override.id, chief.id)

        assert (
            await db_session.get(TrainingRequirementOverride, override.id)
        ) is not None
        assert str(uuid.UUID(override.id)) == override.id
