"""Preceptor links for outside-shift evaluations, against real tables.

Pins the rules agreed for the no-login link an outside preceptor uses:

  * the member who logged the shift, or a training officer, makes it; anyone
    else is told the shift does not exist;
  * it opens until the department's window after the shift has passed
    (7 days by default), and making another revokes the open one;
  * the preceptor sees the member, the shift, the unit and a blank form;
  * it submits once, naming the preceptor; a refused submission leaves it
    open; a second submission is told it already arrived;
  * the member sees it, and credit lands, at once; a shift still awaiting
    approval is credited when it is approved;
  * the evaluation says it came through a link, and whether the member made
    the link themselves.
"""

import uuid
from datetime import timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.v1.endpoints.shift_evaluations import _entry_for_link
from app.models.shift_evaluation import ShiftEvaluationLink
from app.models.training import RequirementType, TrainingModuleConfig
from app.models.user import User
from app.schemas.shift_evaluation import (
    PreceptorEvaluationSubmit,
    ShiftEvaluationSettingsUpdate,
)
from app.services.email_service import EmailService
from app.services.external_shift_hours_service import ExternalShiftHoursService
from app.services.shift_evaluation_link_service import (
    LinkAlreadyUsed,
    ShiftEvaluationLinkService,
)
from app.services.shift_evaluation_service import ShiftEvaluationService
from app.services.shift_evaluation_template_service import (
    ShiftEvaluationTemplateService,
)
from tests.test_outside_shift_evaluations import _outside
from tests.test_shift_evaluation_credit import _requirement, _value
from tests.test_shift_evaluations import _complete, _member, _scene

pytestmark = pytest.mark.integration


async def _link(db, scene, entry, creator=None, **kwargs):
    link, _ = await ShiftEvaluationLinkService(db).create(
        entry, scene.org_id, creator or scene.trainee, **kwargs
    )
    return link


def _preceptor_body(**overrides):
    """The example form's full answer, as a preceptor link's page sends it."""
    return PreceptorEvaluationSubmit.model_validate(
        _complete(**overrides).model_dump(exclude={"template_id", "submit"})
    )


def _answers(**overrides):
    return _preceptor_body(preceptor_name="Pat Preceptor", **overrides)


def _aware(value):
    """UTC, to the second: MySQL DATETIME keeps no microseconds."""
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return aware.replace(microsecond=0)


async def _with_positions(db, user):
    """The caller as the request dependency loads them, positions included."""
    return (
        await db.execute(
            select(User).options(selectinload(User.positions)).where(User.id == user.id)
        )
    ).scalar_one()


class TestMakingALink:
    async def test_the_member_makes_one_open_seven_days_after_the_shift(
        self, db_session
    ):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        link = await _link(db_session, scene, entry)

        assert link.scope_key == scene.enrollment.id
        assert link.created_by == scene.trainee.id
        assert link.created_by_member is True
        assert link.token_hash == ShiftEvaluationLink.hash_token(link.token)
        assert link.token not in link.token_hash
        assert _aware(link.expires_at) == _aware(entry.end_at) + timedelta(days=7)

    async def test_the_department_sets_the_window(self, db_session):
        scene = await _scene(db_session)
        db_session.add(
            TrainingModuleConfig(
                organization_id=scene.org_id, shift_evaluation_link_days=3
            )
        )
        await db_session.flush()
        _, entry = await _outside(db_session, scene)

        link = await _link(db_session, scene, entry, creator=scene.officer)

        assert link.created_by_member is False
        assert _aware(link.expires_at) == _aware(entry.end_at) + timedelta(days=3)

    async def test_a_shift_past_its_window_gets_no_link(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene, days_ago=10)

        with pytest.raises(ValueError, match="window for this shift has passed"):
            await _link(db_session, scene, entry)

    async def test_a_new_link_revokes_the_open_one(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        service = ShiftEvaluationLinkService(db_session)
        first = await _link(db_session, scene, entry)
        first_token = first.token

        second = await _link(db_session, scene, entry)

        assert await service.resolve(first_token) is None
        assert (await service.resolve(second.token)) is not None
        assert (
            await service.active_link(entry.id, scene.enrollment.id, scene.org_id)
        ).id == second.id

    async def test_a_shift_on_an_agency_left_off_gets_no_link(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene, evaluate=False)

        with pytest.raises(ValueError, match="no evaluation waiting"):
            await _link(db_session, scene, entry)

    async def test_the_link_is_emailed_when_asked(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        sender = AsyncMock(return_value=True)

        with patch.object(
            EmailService, "send_shift_evaluation_preceptor_link_email", sender
        ):
            link, sent = await ShiftEvaluationLinkService(db_session).create(
                entry,
                scene.org_id,
                scene.trainee,
                preceptor_email="preceptor@acfd.test",
            )

        assert sent is True
        assert link.preceptor_email == "preceptor@acfd.test"
        assert link.last_sent_at is not None
        kwargs = sender.await_args.kwargs
        assert kwargs["to_email"] == "preceptor@acfd.test"
        assert kwargs["evaluation_url"].endswith(f"/shift-evaluation/{link.token}")
        assert kwargs["unit_label"].endswith("Medic 101")


class TestWhoMayMakeOne:
    async def test_another_member_is_told_the_shift_does_not_exist(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        with pytest.raises(HTTPException) as refused:
            await _entry_for_link(
                db_session,
                await _with_positions(db_session, scene.crew),
                uuid.UUID(entry.id),
            )

        assert refused.value.status_code == 404

    async def test_the_member_who_logged_it_may(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)

        _, found = await _entry_for_link(
            db_session,
            await _with_positions(db_session, scene.trainee),
            uuid.UUID(entry.id),
        )

        assert found.id == entry.id


class TestThePreceptorsPage:
    async def test_shows_the_member_the_shift_and_the_form(self, db_session):
        scene = await _scene(db_session)
        agency, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)

        view = await ShiftEvaluationLinkService(db_session).public_view(link.token)

        assert view.member_name == "Terry Member"
        assert view.shift_date == entry.shift_date
        assert view.unit_label == f"{agency.name} Medic 101"
        assert view.template["name"] == "EMT Shift Evaluation"
        assert view.organization_name == "FD"

    async def test_an_unknown_token_shows_nothing(self, db_session):
        assert (
            await ShiftEvaluationLinkService(db_session).public_view("x" * 43) is None
        )

    async def test_a_rejected_shift_closes_the_link(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)
        await ExternalShiftHoursService(db_session).reject(
            scene.org_id, entry.id, scene.officer.id, "Not on duty"
        )

        assert await ShiftEvaluationLinkService(db_session).resolve(link.token) is None


class TestSubmitting:
    async def test_submits_once_and_credits_at_once(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        transports = await _requirement(
            db_session, scene, RequirementType.TRANSPORTS, required_transports=20
        )
        link = await _link(db_session, scene, entry)
        token = link.token
        service = ShiftEvaluationLinkService(db_session)

        evaluation = await service.submit(
            token, _answers(), ip_address="203.0.113.9", user_agent="Phone"
        )

        assert evaluation.status == "submitted"
        assert evaluation.evaluator_id is None
        assert evaluation.preceptor_name == "Pat Preceptor"
        assert evaluation.external_shift_id == entry.id
        assert await _value(db_session, transports) == 4
        assert await ShiftEvaluationService(db_session).visible_to_member(
            evaluation, scene.org_id
        )
        stored = (
            await db_session.execute(
                select(ShiftEvaluationLink).where(ShiftEvaluationLink.id == link.id)
            )
        ).scalar_one()
        await db_session.refresh(stored)
        assert stored.used_at is not None
        assert stored.evaluation_id == evaluation.id
        assert stored.submitted_ip == "203.0.113.9"

        with pytest.raises(LinkAlreadyUsed):
            await service.submit(token, _answers(), ip_address=None, user_agent=None)
        with pytest.raises(LinkAlreadyUsed):
            await service.public_view(token)

    async def test_the_preceptor_must_give_their_name(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)
        token = link.token
        service = ShiftEvaluationLinkService(db_session)

        with pytest.raises(ValueError, match="Enter your name"):
            await service.submit(
                token, _preceptor_body(), ip_address=None, user_agent=None
            )

        assert await service.resolve(token) is not None

    async def test_an_unknown_link_is_not_found_whatever_the_answers(self, db_session):
        # The link decides first: a stranger's request learns nothing from
        # which answer the form would have asked them to fix.
        service = ShiftEvaluationLinkService(db_session)

        assert (
            await service.submit(
                "x" * 43, _preceptor_body(), ip_address=None, user_agent=None
            )
            is None
        )

    async def test_an_item_both_rated_and_na_is_sent_back_to_correct(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)
        token = link.token
        service = ShiftEvaluationLinkService(db_session)
        body = _answers()
        body.responses["als_assist"].not_applicable = True

        with pytest.raises(ValueError, match="either rated or N/A"):
            await service.submit(token, body, ip_address=None, user_agent=None)
        assert await service.resolve(token) is not None
        assert (
            await service.submit("x" * 43, body, ip_address=None, user_agent=None)
            is None
        )

    async def test_a_used_link_says_so_even_without_a_name(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)
        token = link.token
        service = ShiftEvaluationLinkService(db_session)
        await service.submit(token, _answers(), ip_address=None, user_agent=None)

        with pytest.raises(LinkAlreadyUsed):
            await service.submit(
                token, _preceptor_body(), ip_address=None, user_agent=None
            )

    async def test_an_unfinished_form_leaves_the_link_open(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)
        token = link.token
        service = ShiftEvaluationLinkService(db_session)

        with pytest.raises(ValueError, match="Finish the evaluation"):
            await service.submit(
                token, _answers(responses={}), ip_address=None, user_agent=None
            )

        assert await service.resolve(token) is not None

    async def test_the_evaluation_says_how_it_arrived(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        link = await _link(db_session, scene, entry)

        evaluation = await ShiftEvaluationLinkService(db_session).submit(
            link.token, _answers(), ip_address=None, user_agent=None
        )
        detail = await ShiftEvaluationService(db_session).detail(
            evaluation, scene.org_id
        )

        assert detail.via_preceptor_link is True
        assert detail.link_created_by_member is True
        assert detail.preceptor_name == "Pat Preceptor"
        assert detail.evaluator_id is None


class TestAShiftAwaitingApproval:
    async def test_is_evaluated_but_credited_only_once_approved(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene, status="pending")
        shifts = await _requirement(
            db_session, scene, RequirementType.EVALUATED_SHIFTS, required_shifts=10
        )
        link = await _link(db_session, scene, entry)

        evaluation = await ShiftEvaluationLinkService(db_session).submit(
            link.token, _answers(), ip_address=None, user_agent=None
        )

        service = ShiftEvaluationService(db_session)
        assert await service.visible_to_member(evaluation, scene.org_id) is False
        assert await _value(db_session, shifts) == 0

        await ExternalShiftHoursService(db_session).approve(
            scene.org_id, entry.id, scene.officer.id
        )

        assert await _value(db_session, shifts) == 1


class TestTenancy:
    async def test_another_departments_officer_cannot_reach_the_shift(self, db_session):
        scene = await _scene(db_session)
        _, entry = await _outside(db_session, scene)
        other = await _scene(db_session)

        with pytest.raises(HTTPException) as refused:
            await _entry_for_link(
                db_session,
                await _with_positions(db_session, other.officer),
                uuid.UUID(entry.id),
            )

        assert refused.value.status_code == 404


async def test_a_stranger_in_the_same_department_cannot_either(db_session):
    scene = await _scene(db_session)
    _, entry = await _outside(db_session, scene)
    stranger = await _member(db_session, scene.org_id, "Sam")

    with pytest.raises(HTTPException):
        await _entry_for_link(
            db_session, await _with_positions(db_session, stranger), uuid.UUID(entry.id)
        )


class TestTheWindowSetting:
    async def test_is_saved_and_read_back(self, db_session):
        scene = await _scene(db_session)
        service = ShiftEvaluationTemplateService(db_session)

        assert (
            await service.get_settings(scene.org_id)
        ).shift_evaluation_link_days == 7
        saved = await service.update_settings(
            scene.org_id,
            ShiftEvaluationSettingsUpdate(shift_evaluation_link_days=14),
            scene.officer.id,
        )

        assert saved.shift_evaluation_link_days == 14

    @pytest.mark.parametrize("days", [0, 61])
    def test_refuses_a_window_out_of_range(self, days):
        with pytest.raises(ValidationError):
            ShiftEvaluationSettingsUpdate(shift_evaluation_link_days=days)
