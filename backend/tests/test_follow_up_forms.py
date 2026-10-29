"""Follow-up Form stages: the link, pre-fill, drafts, submission and write-back.

A Follow-up Form stage emails an applicant a personal link to a form from the
Forms module. These run against the real schema, because what matters most —
one request per applicant per stage, the stage advancing, the record being
written, the sensitive answer staying encrypted — is decided by constraints,
locks and column types a mocked session never evaluates.

Email is patched at the two EmailService senders, outside any concurrent code
(CLAUDE.md pitfall #22).
"""

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.api.public.follow_up_forms import router as public_router
from app.core.database import get_db
from app.models.forms import Form, FormField, FormStatus, FormSubmission
from app.models.membership_pipeline import (
    ProspectActivityLog,
    ProspectFormRequest,
    ProspectiveMember,
    ProspectStatus,
    ProspectStepProgress,
    StepProgressStatus,
)
from app.models.user import Organization
from app.services.email_service import EmailService
from app.services.follow_up_form_service import (
    FollowUpAlreadySubmitted,
    FollowUpFormError,
    FollowUpFormService,
)
from app.services.forms_service import FormsService
from app.services.membership_pipeline_service import MembershipPipelineService

pytestmark = [pytest.mark.integration]

SECRET = "Convicted of DUI in 2019"


class _Seed:
    org_id: str
    form_id: str
    fields: dict
    step_ids: list
    prospect_id: str
    old_email: str


async def _seed(db, *, auto_advance=True) -> _Seed:
    seed = _Seed()
    slug = f"follow-up-{uuid.uuid4().hex[:10]}"
    org = Organization(name="Follow-up VFD", slug=slug)
    db.add(org)
    await db.flush()
    seed.org_id = str(org.id)

    form = Form(
        organization_id=seed.org_id,
        name="Background Questionnaire",
        status=FormStatus.PUBLISHED,
    )
    db.add(form)
    await db.flush()
    seed.form_id = str(form.id)
    specs = [
        ("Last Name", "text", "last_name", False, False),
        ("Email", "email", "email", False, False),
        ("Street Address", "text", "address_street", False, False),
        ("Phone", "phone", "phone", False, False),
        ("Criminal history", "textarea", None, True, False),
        ("Why now?", "textarea", None, False, True),
    ]
    seed.fields = {}
    for order, (label, ftype, applicant_field, sensitive, required) in enumerate(specs):
        field = FormField(
            form_id=seed.form_id,
            label=label,
            field_type=ftype,
            applicant_field=applicant_field,
            is_sensitive=sensitive,
            required=required,
            sort_order=order,
        )
        db.add(field)
        await db.flush()
        seed.fields[label] = str(field.id)

    svc = MembershipPipelineService(db)
    pipeline = await svc.create_pipeline(organization_id=seed.org_id, name="Pipeline")
    pipeline_id = str(pipeline.id)
    seed.step_ids = []
    for i, (step_type, config) in enumerate(
        [
            ("checkbox", {}),
            (
                "follow_up_form",
                (
                    {"follow_up_form_id": seed.form_id}
                    if auto_advance
                    else {"follow_up_form_id": seed.form_id, "auto_advance": False}
                ),
            ),
            ("checkbox", {}),
        ]
    ):
        step = await svc.add_step(
            pipeline_id,
            seed.org_id,
            {
                "name": f"Stage {i + 1}",
                "step_type": step_type,
                "required": False,
                "config": config,
            },
        )
        seed.step_ids.append(str(step.id))

    seed.old_email = f"{slug}@example.com"
    prospect = ProspectiveMember(
        organization_id=seed.org_id,
        pipeline_id=pipeline_id,
        current_step_id=seed.step_ids[0],
        first_name="Pat",
        # Stored escaped, as the interest form leaves it (FormsService escapes
        # every answer before it reaches the applicant record).
        last_name="O&#x27;Brien",
        email=seed.old_email,
        phone="555-0100",
        address_street="12 Old Road",
        status=ProspectStatus.ACTIVE,
    )
    db.add(prospect)
    await db.flush()
    seed.prospect_id = str(prospect.id)
    for i, step_id in enumerate(seed.step_ids):
        db.add(
            ProspectStepProgress(
                prospect_id=seed.prospect_id,
                step_id=step_id,
                status=(
                    StepProgressStatus.IN_PROGRESS
                    if i == 0
                    else StepProgressStatus.PENDING
                ),
            )
        )
    await db.commit()
    return seed


@pytest.fixture
def mail():
    """Both follow-up senders, recorded; every send succeeds."""
    link = AsyncMock(return_value=True)
    notice = AsyncMock(return_value=True)
    with patch.object(EmailService, "send_follow_up_form_email", link), patch.object(
        EmailService, "send_contact_changed_email", notice
    ):
        yield link, notice


def _token_from(link_mock) -> str:
    url = link_mock.await_args.kwargs["form_url"]
    return url.rsplit("/", 1)[-1]


async def _arrive(db, seed: _Seed) -> None:
    await MembershipPipelineService(db).advance_prospect(
        seed.prospect_id, seed.org_id, None
    )


async def _request(db, seed: _Seed) -> ProspectFormRequest:
    db.expire_all()
    return (
        await db.execute(
            select(ProspectFormRequest).where(
                ProspectFormRequest.prospect_id == seed.prospect_id
            )
        )
    ).scalar_one()


async def _prospect(db, seed: _Seed) -> ProspectiveMember:
    db.expire_all()
    return await db.get(ProspectiveMember, seed.prospect_id)


def _answers(seed: _Seed, **overrides) -> dict:
    answers = {
        seed.fields["Last Name"]: "O'Brien",
        seed.fields["Email"]: seed.old_email,
        seed.fields["Street Address"]: "12 Old Road",
        seed.fields["Phone"]: "555-0100",
        seed.fields["Criminal history"]: SECRET,
        seed.fields["Why now?"]: "I moved to the district.",
    }
    for label, value in overrides.items():
        answers[seed.fields[label.replace("_", " ")]] = value
    return answers


class TestSending:
    async def test_arriving_on_the_stage_emails_one_link(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)

        await _arrive(db_session, seed)

        link.assert_awaited_once()
        kwargs = link.await_args.kwargs
        assert kwargs["to_email"] == seed.old_email
        assert kwargs["form_name"] == "Background Questionnaire"
        assert "/application-form/" in kwargs["form_url"]
        request = await _request(db_session, seed)
        assert request.step_id == seed.step_ids[1]
        assert request.last_sent_at is not None
        assert request.token_hash == ProspectiveMember.hash_status_token(
            _token_from(link)
        )

    async def test_the_stored_token_is_encrypted(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)

        await _arrive(db_session, seed)

        raw = (
            await db_session.execute(
                text("SELECT token FROM prospect_form_requests WHERE prospect_id = :p"),
                {"p": seed.prospect_id},
            )
        ).scalar_one()
        assert _token_from(link) not in raw

    async def test_arriving_again_does_not_send_a_second_link(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        svc = MembershipPipelineService(db_session)
        await _arrive(db_session, seed)

        await svc.regress_prospect(seed.prospect_id, seed.org_id, None)
        await svc.advance_prospect(seed.prospect_id, seed.org_id, None)

        link.assert_awaited_once()
        rows = (
            await db_session.execute(
                select(ProspectFormRequest).where(
                    ProspectFormRequest.prospect_id == seed.prospect_id
                )
            )
        ).all()
        assert len(rows) == 1

    async def test_send_now_repeats_the_same_link(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        first = _token_from(link)

        await FollowUpFormService(db_session).send_now(
            seed.prospect_id, seed.step_ids[1], seed.org_id
        )

        assert link.await_count == 2
        assert _token_from(link) == first

    async def test_send_now_refuses_a_stage_that_is_not_a_follow_up(
        self, db_session, mail
    ):
        seed = await _seed(db_session)

        with pytest.raises(ValueError, match="not a Follow-up Form stage"):
            await FollowUpFormService(db_session).send_now(
                seed.prospect_id, seed.step_ids[0], seed.org_id
            )

    async def test_a_failed_send_leaves_the_request_not_sent(self, db_session, mail):
        link, _ = mail
        link.return_value = False
        seed = await _seed(db_session)

        await _arrive(db_session, seed)

        request = await _request(db_session, seed)
        assert request.last_sent_at is None
        listed = await FollowUpFormService(db_session).list_for_prospect(
            seed.prospect_id, seed.org_id
        )
        assert listed[0]["status"] == "not_sent"

    async def test_a_new_stage_advances_on_submission_by_default(self, db_session):
        seed = await _seed(db_session)

        svc = MembershipPipelineService(db_session)
        pipeline = await svc.get_pipeline(
            (await _prospect(db_session, seed)).pipeline_id, seed.org_id
        )
        step = next(s for s in pipeline.steps if str(s.id) == seed.step_ids[1])
        assert step.config["auto_advance"] is True

    async def test_a_form_from_another_department_is_refused(self, db_session):
        seed = await _seed(db_session)
        other = await _seed(db_session)
        svc = MembershipPipelineService(db_session)
        pipeline_id = (await _prospect(db_session, seed)).pipeline_id

        with pytest.raises(ValueError, match="Invalid follow-up form"):
            await svc.add_step(
                pipeline_id,
                seed.org_id,
                {
                    "name": "Stolen form",
                    "step_type": "follow_up_form",
                    "config": {"follow_up_form_id": other.form_id},
                },
            )


class TestTheLink:
    async def test_the_form_opens_filled_with_the_record(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        view = await FollowUpFormService(db_session).public_view(_token_from(link))

        values = view["values"]
        # Unescaped: the applicant sees their name, not "O&#x27;Brien".
        assert values[seed.fields["Last Name"]] == "O'Brien"
        assert values[seed.fields["Street Address"]] == "12 Old Road"
        assert seed.fields["Criminal history"] not in values
        assert view["applicant_first_name"] == "Pat"
        sensitive = next(f for f in view["fields"] if f.label == "Criminal history")
        assert sensitive.is_sensitive is True

    async def test_a_saved_draft_reopens_over_the_record(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        service = FollowUpFormService(db_session)
        token = _token_from(link)

        await service.save_draft(
            token,
            {
                seed.fields["Street Address"]: "9 New Lane",
                seed.fields["Criminal history"]: SECRET,
                "not-a-field": "dropped",
            },
        )
        view = await service.public_view(token)

        assert view["values"][seed.fields["Street Address"]] == "9 New Lane"
        assert view["values"][seed.fields["Criminal history"]] == SECRET
        assert "not-a-field" not in view["values"]
        raw = (
            await db_session.execute(
                text(
                    "SELECT draft_data FROM prospect_form_requests "
                    "WHERE prospect_id = :p"
                ),
                {"p": seed.prospect_id},
            )
        ).scalar_one()
        assert SECRET not in raw

    @pytest.mark.parametrize(
        "status",
        [
            ProspectStatus.REJECTED,
            ProspectStatus.WITHDRAWN,
            ProspectStatus.INACTIVE,
            ProspectStatus.TRANSFERRED,
        ],
    )
    async def test_the_link_closes_with_the_application(self, db_session, mail, status):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        token = _token_from(link)

        prospect = await _prospect(db_session, seed)
        prospect.status = status
        await db_session.commit()
        closed = await FollowUpFormService(db_session).public_view(token)
        prospect = await _prospect(db_session, seed)
        prospect.status = ProspectStatus.ACTIVE
        await db_session.commit()
        reopened = await FollowUpFormService(db_session).public_view(token)

        assert closed is None
        assert reopened is not None

    async def test_an_application_on_hold_keeps_its_link(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        prospect = await _prospect(db_session, seed)
        prospect.status = ProspectStatus.ON_HOLD
        await db_session.commit()

        view = await FollowUpFormService(db_session).public_view(_token_from(link))

        assert view is not None

    async def test_an_unknown_token_opens_nothing(self, db_session):
        assert await FollowUpFormService(db_session).public_view("x" * 43) is None


class TestSubmitting:
    async def test_submission_updates_the_record_and_completes_the_stage(
        self, db_session, mail
    ):
        link, notice = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        service = FollowUpFormService(db_session)
        token = _token_from(link)
        await service.save_draft(token, {seed.fields["Phone"]: "555-0123"})

        await service.submit(token, _answers(seed, Street_Address="9 New Lane"))

        prospect = await _prospect(db_session, seed)
        assert prospect.address_street == "9 New Lane"
        assert str(prospect.current_step_id) == seed.step_ids[2]
        request = await _request(db_session, seed)
        assert request.submitted_at is not None
        assert request.draft_data is None
        # The unchanged last name is not a change, though the record held it
        # escaped and the answer arrived unescaped.
        assert request.changes == [
            {
                "field": "address_street",
                "old": "12 Old Road",
                "new": "9 New Lane",
                "applied": True,
            }
        ]
        assert request.contact_changed is False
        notice.assert_not_awaited()

    async def test_the_sensitive_answer_stays_encrypted_and_off_the_record(
        self, db_session, mail
    ):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(_token_from(link), _answers(seed))

        request = await _request(db_session, seed)
        raw = (
            await db_session.execute(
                text(
                    "SELECT CAST(data AS CHAR), sensitive_data FROM form_submissions "
                    "WHERE id = :i"
                ),
                {"i": request.submission_id},
            )
        ).one()
        assert SECRET not in raw[0]
        assert raw[1] is not None
        assert SECRET not in raw[1]
        submission = await db_session.get(FormSubmission, request.submission_id)
        assert submission.sensitive_data == {seed.fields["Criminal history"]: SECRET}

    async def test_the_activity_log_carries_no_values(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Street_Address="9 New Lane")
        )

        logs = (
            await db_session.execute(
                select(ProspectActivityLog).where(
                    ProspectActivityLog.prospect_id == seed.prospect_id,
                    ProspectActivityLog.action == "follow_up_form_submitted",
                )
            )
        ).scalars()
        (entry,) = list(logs)
        dumped = json.dumps(entry.details)
        assert entry.details["changed_fields"] == ["address_street"]
        assert "9 New Lane" not in dumped
        assert SECRET not in dumped

    async def test_a_second_submission_is_refused(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        service = FollowUpFormService(db_session)
        token = _token_from(link)
        await service.submit(token, _answers(seed))

        with pytest.raises(FollowUpAlreadySubmitted):
            await service.submit(token, _answers(seed))
        with pytest.raises(FollowUpAlreadySubmitted):
            await service.public_view(token)
        submissions = (
            await db_session.execute(
                select(FormSubmission.id).where(FormSubmission.form_id == seed.form_id)
            )
        ).all()
        assert len(submissions) == 1

    async def test_a_missing_required_answer_stores_nothing(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        answers = _answers(seed, Street_Address="9 New Lane")
        answers[seed.fields["Why now?"]] = "  "

        with pytest.raises(FollowUpFormError, match="Why now"):
            await FollowUpFormService(db_session).submit(_token_from(link), answers)
        await db_session.rollback()

        prospect = await _prospect(db_session, seed)
        assert prospect.address_street == "12 Old Road"
        assert (await _request(db_session, seed)).submitted_at is None

    async def test_with_auto_advance_off_the_stage_stays_open(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session, auto_advance=False)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(_token_from(link), _answers(seed))

        prospect = await _prospect(db_session, seed)
        assert str(prospect.current_step_id) == seed.step_ids[1]
        assert (await _request(db_session, seed)).submitted_at is not None

    async def test_send_now_refuses_a_submitted_form(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session, auto_advance=False)
        await _arrive(db_session, seed)
        await FollowUpFormService(db_session).submit(_token_from(link), _answers(seed))

        with pytest.raises(ValueError, match="already submitted"):
            await FollowUpFormService(db_session).send_now(
                seed.prospect_id, seed.step_ids[1], seed.org_id
            )


class TestContactChanges:
    async def test_an_email_change_is_applied_flagged_and_told_to_the_old_address(
        self, db_session, mail
    ):
        link, notice = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Email="Pat.New@Example.org")
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.email == "pat.new@example.org"
        request = await _request(db_session, seed)
        assert request.contact_changed is True
        notice.assert_awaited_once()
        kwargs = notice.await_args.kwargs
        assert kwargs["to_email"] == seed.old_email
        assert "pat.new@example.org" not in json.dumps(kwargs, default=str)

    async def test_a_phone_change_is_flagged_without_a_notice(self, db_session, mail):
        link, notice = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Phone="555-0199")
        )

        request = await _request(db_session, seed)
        assert request.contact_changed is True
        notice.assert_not_awaited()

    async def test_an_address_another_open_application_uses_is_not_applied(
        self, db_session, mail
    ):
        link, notice = mail
        seed = await _seed(db_session)
        db_session.add(
            ProspectiveMember(
                organization_id=seed.org_id,
                first_name="Other",
                last_name="Applicant",
                email="taken@example.org",
                status=ProspectStatus.ACTIVE,
            )
        )
        await db_session.commit()
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Email="taken@example.org")
        )

        prospect = await _prospect(db_session, seed)
        assert prospect.email == seed.old_email
        request = await _request(db_session, seed)
        (change,) = request.changes
        assert change["field"] == "email"
        assert change["applied"] is False
        assert request.contact_changed is True
        notice.assert_not_awaited()

    async def test_a_coordinator_review_clears_the_flag(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Phone="555-0199")
        )
        request = await _request(db_session, seed)
        reviewer = str(uuid.uuid4())
        await db_session.execute(
            text(
                "INSERT INTO users (id, organization_id, username, first_name, "
                "last_name, email, password_hash, status) VALUES "
                "(:id, :org, :un, 'Rev', 'Iewer', :em, 'x', 'active')"
            ),
            {
                "id": reviewer,
                "org": seed.org_id,
                "un": f"rev-{reviewer[:8]}",
                "em": f"rev-{reviewer[:8]}@example.org",
            },
        )
        await db_session.commit()

        service = FollowUpFormService(db_session)
        await service.mark_contact_change_reviewed(
            seed.prospect_id, request.id, seed.org_id, reviewer
        )
        (listed,) = await service.list_for_prospect(seed.prospect_id, seed.org_id)

        assert listed["contact_change_reviewed_at"] is not None
        assert listed["contact_change_reviewed_by_name"]
        assert listed["changes"][0]["label"] == "Phone"

    async def test_another_department_cannot_review_it(self, db_session, mail):
        link, _ = mail
        seed = await _seed(db_session)
        other = await _seed(db_session)
        await _arrive(db_session, seed)
        await FollowUpFormService(db_session).submit(
            _token_from(link), _answers(seed, Phone="555-0199")
        )
        request = await _request(db_session, seed)

        result = await FollowUpFormService(db_session).mark_contact_change_reviewed(
            seed.prospect_id, request.id, other.org_id, str(uuid.uuid4())
        )

        assert result is None


class TestFormBuilderRule:
    async def test_a_sensitive_field_cannot_also_pre_fill(self, db_session):
        seed = await _seed(db_session)
        service = FormsService(db_session)

        field, error = await service.add_field(
            uuid.UUID(seed.form_id),
            seed.org_id,
            {
                "label": "Date of birth",
                "field_type": "date",
                "is_sensitive": True,
                "applicant_field": "date_of_birth",
            },
        )

        assert field is None
        assert error == FormsService.SENSITIVE_PREFILL_REFUSED_ERROR

    async def test_marking_a_pre_filled_field_sensitive_is_refused(self, db_session):
        seed = await _seed(db_session)

        field, error = await FormsService(db_session).update_field(
            uuid.UUID(seed.fields["Street Address"]),
            uuid.UUID(seed.form_id),
            seed.org_id,
            {"is_sensitive": True},
        )

        assert field is None
        assert error == FormsService.SENSITIVE_PREFILL_REFUSED_ERROR


class TestPublicEndpoints:
    @pytest.fixture
    async def client(self, db_session):
        app = FastAPI()
        app.include_router(public_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: db_session
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            yield client

    async def test_open_draft_submit_and_the_answer_after(
        self, db_session, mail, client
    ):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        base = f"/api/public/v1/follow-up-forms/{_token_from(link)}"

        opened = await client.get(base)
        drafted = await client.put(
            f"{base}/draft", json={"data": {seed.fields["Phone"]: "555-0123"}}
        )
        submitted = await client.post(f"{base}/submit", json={"data": _answers(seed)})
        again = await client.get(base)

        assert opened.status_code == 200, opened.text
        assert opened.headers["cache-control"] == "no-store, private"
        assert opened.headers["referrer-policy"] == "no-referrer"
        assert drafted.status_code == 200, drafted.text
        assert submitted.status_code == 200, submitted.text
        assert again.status_code == 409

    async def test_an_unknown_link_is_404(self, client):
        response = await client.get(f"/api/public/v1/follow-up-forms/{'a' * 43}")

        assert response.status_code == 404
        assert response.json()["detail"] == "This form is not available."

    async def test_a_correctable_answer_is_400(self, db_session, mail, client):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        answers = _answers(seed, Email="not-an-address")

        response = await client.post(
            f"/api/public/v1/follow-up-forms/{_token_from(link)}/submit",
            json={"data": answers},
        )

        assert response.status_code == 400
        assert "valid email" in response.json()["detail"]


class TestPurge:
    async def test_purging_the_application_deletes_its_follow_up_answers(
        self, db_session, mail
    ):
        link, _ = mail
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        await FollowUpFormService(db_session).submit(_token_from(link), _answers(seed))
        submission_id = (await _request(db_session, seed)).submission_id
        prospect = await _prospect(db_session, seed)
        prospect.status = ProspectStatus.INACTIVE
        pipeline_id = str(prospect.pipeline_id)
        await db_session.commit()

        await MembershipPipelineService(db_session).purge_inactive_prospects(
            pipeline_id, seed.org_id, [seed.prospect_id]
        )

        db_session.expire_all()
        assert await db_session.get(FormSubmission, submission_id) is None
        assert await db_session.get(ProspectiveMember, seed.prospect_id) is None
