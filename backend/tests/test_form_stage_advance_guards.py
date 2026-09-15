"""A form submission advances the stage it belongs to, and only that one.

``_complete_form_submission_step`` resolved its stage from the *form* and then
completed it wherever the applicant actually was. Three defects fell out of
that, all because it wrote the progress row by hand and called the private
``_advance_current_step`` instead of going through ``complete_step``:

1. A second submission of a form dragged an applicant *backward* — from the
   membership vote to the welcome email — because nothing checked they were on
   the stage being completed. The ``COMPLETED`` early return hid it for most
   applicants, but it is an equality check against one status, and ``SKIPPED``
   falls straight through. The public form endpoint runs this same path.
2. It bypassed ``_assert_movable``, every stage gate, the row lock and the
   activity log — the one advance in this system that left no audit trail.
3. It ignored ``auto_advance`` entirely, and the path that does read it only
   ever matches the submission that created the prospect, so the stage
   builder's box decided nothing in either direction.
"""

import uuid

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.forms import Form, FormField, FormSubmission
from app.models.membership_pipeline import (
    ProspectActivityLog,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.services.forms_service import FormsService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]


def _uid() -> str:
    return str(uuid.uuid4())


@pytest.fixture
async def org(db_session: AsyncSession):
    org_id = _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone)"
            " VALUES (:id, 'Dept', 'fire_department', :slug, 'UTC')"
        ),
        {"id": org_id, "slug": f"fs-{org_id[:8]}"},
    )
    await db_session.flush()
    return org_id


async def _form(db_session: AsyncSession, org_id: str):
    """A published form whose labels the membership mapper recognises."""
    form = Form(
        id=_uid(),
        organization_id=org_id,
        name="Interest Form",
        status="published",
        version=1,
    )
    db_session.add(form)
    await db_session.flush()
    field_ids = {}
    for label, field_type in (
        ("First Name", "text"),
        ("Last Name", "text"),
        ("Email", "email"),
    ):
        field_id = _uid()
        field_ids[label] = field_id
        db_session.add(
            FormField(id=field_id, form_id=form.id, label=label, field_type=field_type)
        )
    await db_session.flush()
    await db_session.refresh(form, ["fields"])
    return form, field_ids


async def _submission(db_session: AsyncSession, org_id, form, field_ids, email):
    submission = FormSubmission(
        id=_uid(),
        organization_id=org_id,
        form_id=form.id,
        data={
            field_ids["First Name"]: "Dana",
            field_ids["Last Name"]: "Reed",
            field_ids["Email"]: email,
        },
    )
    db_session.add(submission)
    await db_session.flush()
    return submission


async def _pipeline(svc, org_id, form_id, *, auto_advance=None):
    """Four stages, the form first, so there is somewhere to be dragged from."""
    config = {"form_id": form_id}
    if auto_advance is not None:
        config["auto_advance"] = auto_advance
    pipeline = await svc.create_pipeline(organization_id=org_id, name="Recruit")
    steps = [
        await svc.add_step(
            pipeline.id,
            org_id,
            {
                "name": "Interest Form",
                "step_type": "form_submission",
                "sort_order": 0,
                "config": config,
            },
        )
    ]
    for i, (name, kind) in enumerate(
        (("Welcome", "checkbox"), ("Interview", "note"), ("Vote", "checkbox")), start=1
    ):
        steps.append(
            await svc.add_step(
                pipeline.id,
                org_id,
                {"name": name, "step_type": kind, "sort_order": i},
            )
        )
    return pipeline, steps


async def _current_step_id(svc, prospect_id, org_id) -> str:
    return str((await svc.get_prospect(prospect_id, org_id)).current_step_id)


async def _progress(db_session, prospect_id, step_id):
    result = await db_session.execute(
        select(ProspectStepProgress).where(
            ProspectStepProgress.prospect_id == str(prospect_id),
            ProspectStepProgress.step_id == str(step_id),
        )
    )
    return result.scalars().first()


class TestASubmissionNeverMovesSomebodyBackward:
    async def test_a_resubmission_leaves_an_applicant_where_they_are(
        self, db_session: AsyncSession, org
    ):
        """The reported shape: a skipped form stage, an applicant at the vote,
        and a second submission of the same form."""
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id)
        email = f"dana-{_uid()[:8]}@example.com"

        first = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            first, None, form=form
        )
        prospect_id = result["prospect_id"]

        # Skip the form stage rather than completing it — a paper form handed
        # in at the station — and walk them to the vote.
        progress = await _progress(db_session, prospect_id, steps[0].id)
        progress.status = StepProgressStatus.SKIPPED
        await db_session.execute(
            text("UPDATE prospective_members SET current_step_id = :s WHERE id = :p"),
            {"s": steps[3].id, "p": prospect_id},
        )
        await db_session.commit()
        assert await _current_step_id(svc, prospect_id, org) == str(steps[3].id)

        second = await _submission(db_session, org, form, field_ids, email)
        await FormsService(db_session)._process_membership_interest(
            second, None, form=form
        )
        await db_session.commit()

        assert await _current_step_id(svc, prospect_id, org) == str(steps[3].id)

    async def test_the_resubmitted_answers_are_still_recorded(
        self, db_session: AsyncSession, org
    ):
        """Refusing to move somebody is not a reason to drop what they sent."""
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id)
        email = f"dana-{_uid()[:8]}@example.com"

        first = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            first, None, form=form
        )
        prospect_id = result["prospect_id"]
        progress = await _progress(db_session, prospect_id, steps[0].id)
        progress.status = StepProgressStatus.SKIPPED
        await db_session.execute(
            text("UPDATE prospective_members SET current_step_id = :s WHERE id = :p"),
            {"s": steps[3].id, "p": prospect_id},
        )
        await db_session.commit()

        second = await _submission(db_session, org, form, field_ids, email)
        await FormsService(db_session)._process_membership_interest(
            second, None, form=form
        )
        await db_session.commit()

        stored = await _progress(db_session, prospect_id, steps[0].id)
        await db_session.refresh(stored)
        assert stored.action_result["form_submission_id"] == str(second.id)
        assert stored.status == StepProgressStatus.SKIPPED


class TestTheAutoAdvanceBoxDecides:
    async def test_it_advances_when_the_box_is_ticked(
        self, db_session: AsyncSession, org
    ):
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id, auto_advance=True)
        email = f"dana-{_uid()[:8]}@example.com"

        submission = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            submission, None, form=form
        )
        await db_session.commit()

        assert await _current_step_id(svc, result["prospect_id"], org) == str(
            steps[1].id
        )

    async def test_it_holds_them_when_the_box_is_un_ticked(
        self, db_session: AsyncSession, org
    ):
        """The coordinator who wants to read the answers before anyone moves.
        Ticked or un-ticked, the applicant used to advance regardless."""
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id, auto_advance=False)
        email = f"dana-{_uid()[:8]}@example.com"

        submission = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            submission, None, form=form
        )
        await db_session.commit()
        prospect_id = result["prospect_id"]

        assert await _current_step_id(svc, prospect_id, org) == str(steps[0].id)
        # Held, but the answers are on file for the coordinator to read.
        stored = await _progress(db_session, prospect_id, steps[0].id)
        await db_session.refresh(stored)
        assert stored.action_result["form_submission_id"] == str(submission.id)

    async def test_a_stage_with_no_setting_still_advances(
        self, db_session: AsyncSession, org
    ):
        """The backward-compatible case, and the reason absence cannot mean
        off: the seeded pipelines store no config at all, and the box writes
        its key only once somebody toggles it."""
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id, auto_advance=None)
        email = f"dana-{_uid()[:8]}@example.com"

        submission = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            submission, None, form=form
        )
        await db_session.commit()

        assert await _current_step_id(svc, result["prospect_id"], org) == str(
            steps[1].id
        )


class TestTheAdvanceGoesThroughCompleteStep:
    async def test_a_held_applicant_is_not_advanced_by_a_submission(
        self, db_session: AsyncSession, org
    ):
        """_assert_movable applies to this path now, like every other."""
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id, auto_advance=True)
        email = f"dana-{_uid()[:8]}@example.com"

        first = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            first, None, form=form
        )
        prospect_id = result["prospect_id"]
        # Put them back on the form stage, on hold.
        await db_session.execute(
            text(
                "UPDATE prospective_members SET current_step_id = :s, "
                "status = 'on_hold' WHERE id = :p"
            ),
            {"s": steps[0].id, "p": prospect_id},
        )
        await db_session.execute(
            text(
                "UPDATE prospect_step_progress SET status = 'in_progress' "
                "WHERE prospect_id = :p AND step_id = :s"
            ),
            {"p": prospect_id, "s": steps[0].id},
        )
        await db_session.commit()

        second = await _submission(db_session, org, form, field_ids, email)
        await FormsService(db_session)._complete_form_submission_step(
            svc,
            await svc.get_prospect(prospect_id, org),
            second,
            {"first_name": "Dana"},
            __import__("loguru").logger,
        )
        await db_session.commit()

        assert await _current_step_id(svc, prospect_id, org) == str(steps[0].id)

    async def test_the_advance_leaves_an_audit_entry(
        self, db_session: AsyncSession, org
    ):
        """It wrote the progress row by hand before, so this was the one
        advance in the system that moved somebody with no activity record."""
        svc = MembershipPipelineService(db_session)
        form, field_ids = await _form(db_session, org)
        pipeline, steps = await _pipeline(svc, org, form.id, auto_advance=True)
        email = f"dana-{_uid()[:8]}@example.com"

        submission = await _submission(db_session, org, form, field_ids, email)
        result = await FormsService(db_session)._process_membership_interest(
            submission, None, form=form
        )
        await db_session.commit()

        entries = (
            (
                await db_session.execute(
                    select(ProspectActivityLog).where(
                        ProspectActivityLog.prospect_id == result["prospect_id"],
                        ProspectActivityLog.action == "step_completed",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert entries, "the form advance recorded no activity entry"
