"""
Follow-up Form Service

A Follow-up Form stage sends an applicant a form from the Forms module through
a personal link that needs no sign-in. The form opens filled with what the
applicant record already holds, saves a draft as the applicant goes, and on
submission writes changed answers back to the record.

The link's token is the only credential, so everything an applicant can do is
decided from the request row it names — never from the request body:

- the link works only while its stage still exists, its form is still
  published in the same organization, the request has not been submitted, and
  the application is in progress or on hold;
- every failure answers the same ``None``, so the public endpoints cannot be
  used to learn whether a token was ever issued.

An unsubmitted form is reminded every seven days, up to three times, by
``send_due_reminders``. A submission emails the membership coordinators a link
to the applicant, never the answers.

Writes to the applicant record follow the form's ``applicant_field`` mapping
only. A field marked Sensitive is never mapped (FormsService refuses the pair),
so a restricted answer is never copied onto a record every pipeline viewer can
read. An email change that another open application already uses is recorded
for a coordinator rather than applied, and the person filling in the form is
not told why: saying so would confirm that the address belongs to an applicant.
"""

import html as html_lib
import re
import secrets
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.forms import FieldType, Form, FormField, FormStatus, FormSubmission
from app.models.membership_pipeline import (
    MembershipPipelineStep,
    PipelineStepType,
    ProspectFormRequest,
    ProspectiveMember,
    ProspectStatus,
)
from app.models.user import Organization, User
from app.schemas.membership_pipeline import PublicFollowUpFormField
from app.services.forms_service import FormsService

# Statuses in which an application is still open. A link to an application
# that was rejected, withdrawn, transferred or made inactive stops working, and
# works again if the application is reactivated — derived, so nothing stored
# can drift from the application's real state.
OPEN_STATUSES = frozenset({ProspectStatus.ACTIVE, ProspectStatus.ON_HOLD})

# The applicant-record fields whose change raises the contact-change flag.
CONTACT_FIELDS = frozenset({"email", "phone", "mobile"})

# Columns with a length limit (the rest are encrypted TEXT).
_COLUMN_LIMITS = {"first_name": 100, "last_name": 100, "referral_source": 255}

# The fields a submission may not clear: the record cannot be without them.
_REQUIRED_COLUMNS = frozenset({"first_name", "last_name", "email"})

FIELD_LABELS = {
    "first_name": "First name",
    "last_name": "Last name",
    "email": "Email",
    "phone": "Phone",
    "mobile": "Mobile",
    "date_of_birth": "Date of birth",
    "address_street": "Street address",
    "address_city": "City",
    "address_state": "State",
    "address_zip": "ZIP code",
    "interest_reason": "Why they are interested",
    "referral_source": "Referral source",
}

# Same address rule FormsService applies to an email-type field. A mapped
# field may be a plain text field, so the rule is applied to the value here.
_EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$"
)

FORM_PATH = "/application-form/"

# Reminder cadence, as the department chose it: every seven days, three at
# most, sent in the department's working day.
REMINDER_INTERVAL_DAYS = 7
MAX_REMINDERS = 3
# Local hours [start, end) in which a reminder may go out. The task runs
# hourly, so a reminder lands soon after 09:00 on the day it falls due; the
# upper bound stops a scheduler that was down all day from emailing applicants
# late at night.
REMINDER_HOURS = (9, 20)


class FollowUpFormError(ValueError):
    """A submission the applicant can correct; the message is shown to them."""


class FollowUpAlreadySubmitted(Exception):
    """The request was submitted already; a second submission is refused."""


@dataclass
class ResolvedRequest:
    request: ProspectFormRequest
    prospect: ProspectiveMember
    step: MembershipPipelineStep
    form: Form


def form_url(token: str) -> str:
    frontend_url = getattr(settings, "FRONTEND_URL", "") or ""
    return f"{frontend_url}{FORM_PATH}{token}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def display_answer(field: FormField, raw: Any) -> str:
    """A stored answer as a person reads it.

    Answers are stored HTML-escaped (FormsService escapes every value), so they
    are unescaped for a screen that escapes on its own. A choice is shown by
    its option label rather than its stored value, and a signature as "Signed"
    rather than as the image data it is stored as.
    """
    text = html_lib.unescape(str(raw)) if raw is not None else ""
    field_type = getattr(field.field_type, "value", field.field_type)
    if field_type == FieldType.SIGNATURE.value:
        return "Signed" if text else ""
    labels = {
        str(option.get("value")): str(option.get("label") or option.get("value"))
        for option in (field.options or [])
        if isinstance(option, dict)
    }
    if not labels:
        return text
    if field_type in (FieldType.MULTISELECT.value, FieldType.CHECKBOX.value):
        return ", ".join(labels.get(value, value) for value in text.split(",") if value)
    if field_type in (FieldType.SELECT.value, FieldType.RADIO.value):
        return labels.get(text, text)
    return text


def _record_value(prospect: ProspectiveMember, field: str) -> Optional[str]:
    """What the applicant record holds for ``field``, as the form shows it.

    Values copied from an interest form were stored HTML-escaped (FormsService
    escapes every answer), so they are unescaped here: the form must show the
    applicant "O'Brien", and comparing against the escaped text would report
    every apostrophe as a change.
    """
    value = getattr(prospect, field, None)
    if value is None:
        return None
    if isinstance(value, date):
        return value.isoformat()
    return html_lib.unescape(str(value))


class FollowUpFormService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Sending
    # ------------------------------------------------------------------

    async def _get_or_create_request(
        self, prospect: ProspectiveMember, step: MembershipPipelineStep
    ) -> ProspectFormRequest:
        """The applicant's request for ``step``, created on first use.

        Two sends racing to create it meet the unique index on
        (prospect_id, step_id); the loser re-reads the winner's row, so both
        email the same link.
        """
        existing = await self._request_for(prospect.id, step.id, lock=True)
        if existing is not None:
            return existing

        request = ProspectFormRequest(
            organization_id=prospect.organization_id,
            prospect_id=prospect.id,
            step_id=step.id,
            form_id=(step.config or {}).get("follow_up_form_id"),
            token=secrets.token_urlsafe(32),
        )
        try:
            async with self.db.begin_nested():
                self.db.add(request)
        except IntegrityError:
            raced = await self._request_for(prospect.id, step.id, lock=True)
            if raced is None:
                raise
            return raced
        return request

    async def _request_for(
        self, prospect_id: str, step_id: str, *, lock: bool = False
    ) -> Optional[ProspectFormRequest]:
        query = select(ProspectFormRequest).where(
            ProspectFormRequest.prospect_id == str(prospect_id),
            ProspectFormRequest.step_id == str(step_id),
        )
        if lock:
            query = query.with_for_update()
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def send_for_stage(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
        *,
        only_if_unsent: bool = False,
    ) -> Tuple[Optional[ProspectFormRequest], bool]:
        """Email the applicant their link to ``step``'s form.

        Runs inside the caller's transaction and does not commit. Returns the
        request and whether the email went out. A submitted request is not
        sent again. A stage whose form is missing, unpublished or in another
        organization sends nothing and leaves a warning, so a misconfigured
        stage is visible rather than silently skipped.

        ``only_if_unsent`` is for arriving on the stage: an applicant moved
        back onto it, or placed on it again, already has the link and is not
        emailed a second time. A coordinator's Send now passes False.
        """
        form = await self._stage_form(step, prospect.organization_id)
        if form is None:
            logger.warning(
                "Follow-up stage {} has no usable form; nothing sent to prospect {}",
                step.id,
                prospect.id,
            )
            return None, False

        request = await self._get_or_create_request(prospect, step)
        if request.is_submitted:
            return request, False
        if only_if_unsent and request.last_sent_at is not None:
            return request, False
        if not request.token:
            # A request scrubbed by anonymization has no link to repeat.
            return request, False
        if str(request.form_id or "") != str(form.id):
            # The stage was pointed at another form after this request was
            # made. The link should open the form the stage asks for now; an
            # unsubmitted draft belongs to the old one and is dropped.
            request.form_id = form.id
            request.draft_data = None
            request.draft_saved_at = None

        sent = await self._send_link_email(prospect, step, form, request.token)
        if sent:
            stamp = _now()
            request.first_sent_at = request.first_sent_at or stamp
            request.last_sent_at = stamp
        await self.db.flush()
        return request, sent

    async def _stage_form(
        self, step: MembershipPipelineStep, organization_id: str
    ) -> Optional[Form]:
        form_id = (step.config or {}).get("follow_up_form_id")
        if not form_id:
            return None
        result = await self.db.execute(
            select(Form)
            .where(
                Form.id == str(form_id),
                Form.organization_id == str(organization_id),
                Form.status == FormStatus.PUBLISHED,
            )
            .options(selectinload(Form.fields))
        )
        return result.scalar_one_or_none()

    async def _send_link_email(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
        form: Form,
        token: str,
    ) -> bool:
        try:
            from app.services.email_service import EmailService

            org = await self.db.get(Organization, prospect.organization_id)
            if org is None:
                return False
            return await EmailService(org).send_follow_up_form_email(
                to_email=prospect.email,
                first_name=_record_value(prospect, "first_name") or "",
                applicant_name=prospect.full_name,
                form_name=form.name,
                form_url=form_url(token),
                custom_message=(step.config or {}).get("custom_message") or "",
                db=self.db,
                organization_id=str(org.id),
            )
        except Exception as e:
            logger.error(
                "Failed to send follow-up form link to prospect {}: {}",
                prospect.id,
                e,
            )
            return False

    async def send_now(
        self, prospect_id: str, step_id: str, organization_id: str
    ) -> Tuple[ProspectFormRequest, bool]:
        """A coordinator's Send now / Resend for one stage.

        Raises ValueError when the stage is not a Follow-up Form stage of the
        applicant's pipeline, the form was already submitted, or the stage's
        form is not usable.
        """
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
            effective_step_type,
        )

        prospect = await MembershipPipelineService(self.db).get_prospect(
            prospect_id, organization_id
        )
        if prospect is None:
            raise LookupError("Prospect not found")
        if prospect.status not in OPEN_STATUSES:
            raise ValueError("A form can only be sent while the application is open")
        steps = prospect.pipeline.steps if prospect.pipeline else []
        step = next((s for s in steps if str(s.id) == str(step_id)), None)
        if step is None or effective_step_type(step) != PipelineStepType.FOLLOW_UP_FORM:
            raise ValueError(
                "That stage is not a Follow-up Form stage of this pipeline"
            )

        existing = await self._request_for(prospect.id, step.id)
        if existing is not None and existing.is_submitted:
            raise ValueError("The applicant has already submitted this form")

        request, sent = await self.send_for_stage(prospect, step)
        if request is None:
            raise ValueError(
                "The stage's form is missing or not published, so nothing was sent"
            )
        await self.db.commit()
        await self.db.refresh(request)
        return request, sent

    # ------------------------------------------------------------------
    # Pipeline screens
    # ------------------------------------------------------------------

    async def list_for_prospect(
        self, prospect_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        result = await self.db.execute(
            select(ProspectFormRequest, MembershipPipelineStep.name, Form.name)
            .outerjoin(
                MembershipPipelineStep,
                MembershipPipelineStep.id == ProspectFormRequest.step_id,
            )
            .outerjoin(Form, Form.id == ProspectFormRequest.form_id)
            .where(
                ProspectFormRequest.prospect_id == str(prospect_id),
                ProspectFormRequest.organization_id == str(organization_id),
            )
            .order_by(ProspectFormRequest.created_at)
        )
        rows = result.all()
        reviewer_ids = {
            r.contact_change_reviewed_by
            for r, _, _ in rows
            if r.contact_change_reviewed_by
        }
        reviewers: Dict[str, str] = {}
        if reviewer_ids:
            users = await self.db.execute(
                select(User).where(
                    User.id.in_(reviewer_ids),
                    User.organization_id == str(organization_id),
                )
            )
            reviewers = {
                str(u.id): (u.display_name or u.username) for u in users.scalars()
            }
        return [
            self.describe(request, step_name, form_name, reviewers)
            for request, step_name, form_name in rows
        ]

    @staticmethod
    def describe(
        request: ProspectFormRequest,
        step_name: Optional[str],
        form_name: Optional[str],
        reviewers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        if request.submitted_at is not None:
            status = "submitted"
        elif request.draft_saved_at is not None:
            status = "draft"
        elif request.last_sent_at is not None:
            status = "sent"
        else:
            status = "not_sent"
        changes = [
            {
                "field": c.get("field", ""),
                "label": FIELD_LABELS.get(c.get("field", ""), c.get("field", "")),
                "old": c.get("old"),
                "new": c.get("new"),
                "applied": c.get("applied", True),
            }
            for c in (request.changes or [])
            if isinstance(c, dict)
        ]
        reviewed_by = request.contact_change_reviewed_by
        return {
            "id": request.id,
            "prospect_id": request.prospect_id,
            "step_id": request.step_id,
            "step_name": step_name,
            "form_id": request.form_id,
            "form_name": form_name,
            "status": status,
            "first_sent_at": request.first_sent_at,
            "last_sent_at": request.last_sent_at,
            "draft_saved_at": request.draft_saved_at,
            "submitted_at": request.submitted_at,
            "submission_id": request.submission_id,
            "reminder_count": request.reminder_count or 0,
            "last_reminder_at": request.last_reminder_at,
            "changes": changes,
            "contact_changed": request.contact_changed,
            "contact_change_reviewed_at": request.contact_change_reviewed_at,
            "contact_change_reviewed_by_name": (
                (reviewers or {}).get(str(reviewed_by)) if reviewed_by else None
            ),
        }

    async def submitted_answers(
        self, prospect_id: str, request_id: str, organization_id: str
    ) -> Optional[Dict[str, Any]]:
        """A submitted follow-up form's answers, question by question.

        Every answer is returned with ``is_sensitive`` set where it applies;
        the caller decides whether a sensitive answer may be shown (the
        endpoint withholds it from anyone without ``sensitive_answers.view``).
        None when the request is not this applicant's in this organization.
        Raises ValueError while the form is unsubmitted.
        """
        request = (
            await self.db.execute(
                select(ProspectFormRequest).where(
                    ProspectFormRequest.id == str(request_id),
                    ProspectFormRequest.prospect_id == str(prospect_id),
                    ProspectFormRequest.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if request is None:
            return None
        if not request.submission_id:
            raise ValueError("The applicant has not submitted this form")
        answers = await self._answers_for(request, organization_id)
        step_name = None
        if request.step_id:
            step = await self.db.get(MembershipPipelineStep, request.step_id)
            step_name = step.name if step else None
        return {
            "request_id": request.id,
            "step_name": step_name,
            "form_id": answers["form_id"],
            "form_name": answers["form_name"],
            "submitted_at": request.submitted_at,
            "answers": answers["answers"],
        }

    async def _answers_for(
        self, request: ProspectFormRequest, organization_id: str
    ) -> Dict[str, Any]:
        submission = (
            await self.db.execute(
                select(FormSubmission).where(
                    FormSubmission.id == request.submission_id,
                    FormSubmission.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if submission is None:
            return {"form_id": request.form_id, "form_name": None, "answers": []}
        form = (
            await self.db.execute(
                select(Form)
                .where(
                    Form.id == submission.form_id,
                    Form.organization_id == str(organization_id),
                )
                .options(selectinload(Form.fields))
            )
        ).scalar_one_or_none()
        fields = sorted(form.fields, key=lambda f: f.sort_order) if form else []
        sensitive_ids = {str(f.id) for f in fields if f.is_sensitive}
        plain, sensitive = FormsService.partition_answers(submission, sensitive_ids)

        answers: List[Dict[str, Any]] = []
        for field in fields:
            fid = str(field.id)
            if field.field_type == FieldType.SECTION_HEADER:
                continue
            if fid in sensitive:
                raw, is_sensitive = sensitive[fid], True
            elif fid in plain:
                raw, is_sensitive = plain[fid], False
            else:
                continue
            answers.append(
                {
                    "field_id": fid,
                    "label": field.label,
                    "answer": display_answer(field, raw),
                    "is_sensitive": is_sensitive,
                }
            )
        return {
            "form_id": submission.form_id,
            "form_name": form.name if form else None,
            "answers": answers,
        }

    async def package_answers(
        self, prospect_id: str, organization_id: str
    ) -> List[Dict[str, Any]]:
        """Every submitted follow-up form, for an election package snapshot.

        Sensitive answers are left out whatever the caller's permissions: the
        snapshot is stored unencrypted and read by everyone the package is
        shown to.
        """
        result = await self.db.execute(
            select(ProspectFormRequest, MembershipPipelineStep.name)
            .outerjoin(
                MembershipPipelineStep,
                MembershipPipelineStep.id == ProspectFormRequest.step_id,
            )
            .where(
                ProspectFormRequest.prospect_id == str(prospect_id),
                ProspectFormRequest.organization_id == str(organization_id),
                ProspectFormRequest.submission_id.isnot(None),
            )
            .order_by(ProspectFormRequest.submitted_at)
        )
        forms: List[Dict[str, Any]] = []
        for request, step_name in result.all():
            answers = await self._answers_for(request, organization_id)
            forms.append(
                {
                    "form_name": answers["form_name"],
                    "stage_name": step_name,
                    "submitted_at": (
                        request.submitted_at.isoformat()
                        if request.submitted_at
                        else None
                    ),
                    "answers": [
                        {"label": a["label"], "answer": a["answer"]}
                        for a in answers["answers"]
                        if not a["is_sensitive"]
                    ],
                }
            )
        return forms

    async def pending_contact_changes(
        self, prospect_ids: List[str], organization_id: str
    ) -> set[str]:
        """Of ``prospect_ids``, those with a contact change nobody has reviewed.

        One query for a whole board or page, rather than one per card.
        """
        if not prospect_ids:
            return set()
        result = await self.db.execute(
            select(ProspectFormRequest.prospect_id)
            .where(
                ProspectFormRequest.organization_id == str(organization_id),
                ProspectFormRequest.prospect_id.in_(prospect_ids),
                ProspectFormRequest.contact_changed.is_(True),
                ProspectFormRequest.contact_change_reviewed_at.is_(None),
            )
            .distinct()
        )
        return {str(pid) for pid in result.scalars().all()}

    async def mark_contact_change_reviewed(
        self, prospect_id: str, request_id: str, organization_id: str, user_id: str
    ) -> Optional[ProspectFormRequest]:
        result = await self.db.execute(
            select(ProspectFormRequest)
            .where(
                ProspectFormRequest.id == str(request_id),
                ProspectFormRequest.prospect_id == str(prospect_id),
                ProspectFormRequest.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        request = result.scalar_one_or_none()
        if request is None:
            return None
        if not request.contact_changed:
            raise ValueError("This form did not change the applicant's contact details")
        if request.contact_change_reviewed_at is None:
            request.contact_change_reviewed_at = _now()
            request.contact_change_reviewed_by = str(user_id)
            from app.services.membership_pipeline_service import (
                MembershipPipelineService,
            )

            await MembershipPipelineService(self.db)._log_activity(
                prospect_id=str(prospect_id),
                action="follow_up_contact_change_reviewed",
                details={"request_id": str(request.id)},
                performed_by=str(user_id),
            )
            await self.db.commit()
            await self.db.refresh(request)
        return request

    # ------------------------------------------------------------------
    # The applicant's link
    # ------------------------------------------------------------------

    async def resolve(
        self, token: str, *, lock: bool = False
    ) -> Optional[ResolvedRequest]:
        """The request a link names, if the link may be used now.

        Answers None for every unusable state alike. A submitted request is
        the one state reported separately (FollowUpAlreadySubmitted), so the
        applicant who comes back to the link is told their answers arrived
        rather than that the link does not exist.
        """
        from app.services.membership_pipeline_service import effective_step_type

        if not token or len(token) < 10 or len(token) > 64:
            return None
        query = select(ProspectFormRequest).where(
            ProspectFormRequest.token_hash == ProspectiveMember.hash_status_token(token)
        )
        if lock:
            query = query.with_for_update()
        request = (await self.db.execute(query)).scalar_one_or_none()
        if request is None or not request.step_id or not request.form_id:
            return None

        prospect_query = (
            select(ProspectiveMember)
            .where(
                and_(
                    ProspectiveMember.id == request.prospect_id,
                    ProspectiveMember.organization_id == request.organization_id,
                )
            )
            .options(selectinload(ProspectiveMember.pipeline))
        )
        if lock:
            prospect_query = prospect_query.with_for_update()
        prospect = (await self.db.execute(prospect_query)).scalar_one_or_none()
        if prospect is None or prospect.status not in OPEN_STATUSES:
            return None

        step = await self.db.get(MembershipPipelineStep, request.step_id)
        if (
            step is None
            or str(step.pipeline_id) != str(prospect.pipeline_id or "")
            or effective_step_type(step) != PipelineStepType.FOLLOW_UP_FORM
        ):
            return None

        form = (
            await self.db.execute(
                select(Form)
                .where(
                    Form.id == request.form_id,
                    Form.organization_id == request.organization_id,
                    Form.status == FormStatus.PUBLISHED,
                )
                .options(selectinload(Form.fields))
            )
        ).scalar_one_or_none()
        if form is None:
            return None

        if request.is_submitted:
            raise FollowUpAlreadySubmitted()
        return ResolvedRequest(request=request, prospect=prospect, step=step, form=form)

    async def status_page_action(
        self, prospect: ProspectiveMember
    ) -> Optional[Dict[str, Any]]:
        """The status-page card for an applicant on a Follow-up Form stage.

        Shown while their form for the current stage is sent and unsubmitted,
        and only when the link would open: the same checks ``resolve`` makes,
        so the button never leads to "this form is not available".
        """
        from app.services.membership_pipeline_service import effective_step_type

        step = prospect.current_step
        if (
            step is None
            or prospect.status not in OPEN_STATUSES
            or effective_step_type(step) != PipelineStepType.FOLLOW_UP_FORM
        ):
            return None
        request = await self._request_for(prospect.id, step.id)
        if (
            request is None
            or request.is_submitted
            or not request.token
            or request.last_sent_at is None
        ):
            return None
        form = await self._stage_form(step, prospect.organization_id)
        if form is None or str(form.id) != str(request.form_id or ""):
            return None
        return {
            "type": "follow_up_form",
            "label": f"Complete your form: {form.name}",
            "url": form_url(request.token),
            "message": (
                "Your answers so far are saved. Pick up where you left off."
                if request.draft_saved_at is not None
                else "The department needs a few more details from you."
            ),
        }

    async def public_view(self, token: str) -> Optional[Dict[str, Any]]:
        resolved = await self.resolve(token)
        if resolved is None:
            return None
        org = await self.db.get(Organization, resolved.prospect.organization_id)
        fields = sorted(resolved.form.fields, key=lambda f: f.sort_order)

        values: Dict[str, Any] = {}
        for field in fields:
            if field.applicant_field and not field.is_sensitive:
                known = _record_value(resolved.prospect, field.applicant_field)
                if known is not None:
                    values[str(field.id)] = known
        draft = resolved.request.draft_data
        if isinstance(draft, dict):
            values.update(draft)

        return {
            "form_name": resolved.form.name,
            "form_description": resolved.form.description,
            "organization_name": org.name if org else None,
            "applicant_first_name": _record_value(resolved.prospect, "first_name")
            or "",
            "fields": [PublicFollowUpFormField.model_validate(f) for f in fields],
            "values": values,
            "draft_saved_at": resolved.request.draft_saved_at,
        }

    async def save_draft(self, token: str, data: Dict[str, Any]) -> Optional[datetime]:
        """Store the applicant's answers so far, without validating them.

        Only answers to the form's own fields are kept, each as text and cut
        to the longest answer the form accepts, so a draft cannot grow past
        what a submission could hold.
        """
        resolved = await self.resolve(token, lock=True)
        if resolved is None:
            return None
        known = {str(f.id): f for f in resolved.form.fields}
        draft: Dict[str, str] = {}
        for field_id, value in data.items():
            if field_id not in known or value is None:
                continue
            text = (value if isinstance(value, str) else str(value)).replace("\x00", "")
            draft[field_id] = text[: FormsService.MAX_TEXTAREA_LENGTH]
        stamp = _now()
        resolved.request.draft_data = draft
        resolved.request.draft_saved_at = stamp
        await self.db.commit()
        return stamp

    async def submit(
        self,
        token: str,
        data: Dict[str, Any],
        *,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Optional[datetime]:
        """Validate and store the answers, update the applicant record, and
        complete the stage.

        The request and the applicant are row-locked, so a double submit is
        refused by the second request finding the first one's stamp
        (FollowUpAlreadySubmitted) rather than filing two submissions.
        """
        from app.services.membership_pipeline_service import MembershipPipelineService

        resolved = await self.resolve(token, lock=True)
        if resolved is None:
            return None
        request, prospect, step, form = (
            resolved.request,
            resolved.prospect,
            resolved.step,
            resolved.form,
        )

        visible_ids = FormsService._visible_field_ids(form.fields, data)
        for field in form.fields:
            if (
                field.required
                and str(field.id) in visible_ids
                and (
                    str(field.id) not in data
                    or FormsService._is_empty_value(data[str(field.id)])
                )
            ):
                raise FollowUpFormError(f"'{field.label}' is required")

        sanitized, error = FormsService._sanitize_submission_data(data, form.fields)
        if error:
            raise FollowUpFormError(error)

        updates, changes = self._record_updates(prospect, form.fields, sanitized)
        email_change = next((c for c in changes if c["field"] == "email"), None)
        if email_change is not None and email_change["applied"]:
            if await self._email_taken(prospect, str(email_change["new"])):
                email_change["applied"] = False
                email_change["reason"] = "another open application uses this address"
                updates.pop("email", None)

        old_email = prospect.email
        for column, value in updates.items():
            setattr(prospect, column, value)

        plain, sensitive = FormsService._split_sensitive(sanitized, form.fields)
        submission = FormSubmission(
            organization_id=prospect.organization_id,
            form_id=form.id,
            data=plain,
            sensitive_data=sensitive,
            submitter_name=prospect.full_name[:255],
            is_public_submission=True,
            ip_address=ip_address,
            user_agent=user_agent,
            # Nothing in another module acts on this submission: it reached
            # the applicant record above, through the form's own mapping.
            integration_processed=True,
        )
        self.db.add(submission)
        await self.db.flush()

        contact_fields = sorted(
            c["field"] for c in changes if c["field"] in CONTACT_FIELDS
        )
        stamp = _now()
        request.submission_id = submission.id
        request.submitted_at = stamp
        request.changes = changes or None
        request.contact_changed = bool(contact_fields)
        # The answers now live on the submission; the draft has no further use.
        request.draft_data = None

        pipeline = MembershipPipelineService(self.db)
        await pipeline._log_activity(
            prospect_id=str(prospect.id),
            action="follow_up_form_submitted",
            # Field names only: the activity log is plain JSON, and the old
            # and new values are kept encrypted on the request.
            details={
                "request_id": str(request.id),
                "step_id": str(step.id),
                "step_name": step.name,
                "form_id": str(form.id),
                "form_name": form.name,
                "submission_id": str(submission.id),
                "changed_fields": [c["field"] for c in changes if c["applied"]],
                "unapplied_fields": [c["field"] for c in changes if not c["applied"]],
            },
        )
        await self.db.commit()

        if email_change is not None and email_change["applied"]:
            await self._notify_previous_address(prospect, old_email)
        await self._notify_coordinators_of_submission(
            prospect, step, form, request, bool(contact_fields)
        )

        await pipeline.try_auto_advance_step(
            prospect_id=str(prospect.id),
            organization_id=str(prospect.organization_id),
            step_id=str(step.id),
            step_type=PipelineStepType.FOLLOW_UP_FORM,
            trigger="follow_up_form_submitted",
            action_result={
                "form_submission_id": str(submission.id),
                "follow_up_request_id": str(request.id),
            },
        )
        return stamp

    def _record_updates(
        self,
        prospect: ProspectiveMember,
        fields: List[FormField],
        sanitized: Dict[str, Any],
    ) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
        """The applicant-record writes a submission makes, and the change log.

        Only visible, mapped, non-sensitive fields count, and only when the
        answer differs from the record. Raises FollowUpFormError for a value
        the record cannot hold.
        """
        updates: Dict[str, Any] = {}
        changes: List[Dict[str, Any]] = []
        for field in fields:
            column = field.applicant_field
            fid = str(field.id)
            if not column or field.is_sensitive or fid not in sanitized:
                continue
            new_text = html_lib.unescape(str(sanitized[fid])).strip()
            old_text = _record_value(prospect, column)
            if new_text == (old_text or "").strip():
                continue
            if not new_text and column in _REQUIRED_COLUMNS:
                continue

            value: Any = new_text or None
            if column == "email":
                value = new_text.lower()
                if not _EMAIL_PATTERN.match(value):
                    raise FollowUpFormError(
                        f"Enter a valid email address for '{field.label}'"
                    )
                if value == (old_text or "").strip().lower():
                    continue
            elif column == "date_of_birth" and new_text:
                try:
                    value = date.fromisoformat(new_text)
                except ValueError:
                    raise FollowUpFormError(
                        f"Enter a date as YYYY-MM-DD for '{field.label}'"
                    )
            limit = _COLUMN_LIMITS.get(column)
            if limit and new_text and len(new_text) > limit:
                raise FollowUpFormError(
                    f"'{field.label}' must be at most {limit} characters"
                )

            updates[column] = value
            changes.append(
                {
                    "field": column,
                    "old": old_text,
                    "new": value.isoformat() if isinstance(value, date) else value,
                    "applied": True,
                }
            )
        return updates, changes

    async def _email_taken(self, prospect: ProspectiveMember, email: str) -> bool:
        from app.core.security import email_fingerprint

        result = await self.db.execute(
            select(ProspectiveMember.id).where(
                ProspectiveMember.organization_id == prospect.organization_id,
                ProspectiveMember.id != prospect.id,
                ProspectiveMember.email_hash == email_fingerprint(email),
                ProspectiveMember.status.in_(list(OPEN_STATUSES)),
            )
        )
        return result.first() is not None

    async def _notify_previous_address(
        self, prospect: ProspectiveMember, old_email: Optional[str]
    ) -> None:
        """Tell the old address its application's email was changed.

        After the commit and best-effort: the change stands whether or not
        this goes out. The notice names what changed and never the new value.
        """
        if not old_email:
            return
        try:
            from app.services.email_service import EmailService

            org = await self.db.get(Organization, prospect.organization_id)
            if org is None:
                return
            sent = await EmailService(org).send_contact_changed_email(
                to_email=old_email,
                first_name=_record_value(prospect, "first_name") or "",
                applicant_name=prospect.full_name,
                changed_details="email address",
                db=self.db,
                organization_id=str(org.id),
            )
            if not sent:
                logger.warning(
                    "Contact-change notice to prospect {}'s previous address was "
                    "not sent",
                    prospect.id,
                )
        except Exception as e:
            logger.error(
                "Failed to send contact-change notice for prospect {}: {}",
                prospect.id,
                e,
            )

    async def _notify_coordinators_of_submission(
        self,
        prospect: ProspectiveMember,
        step: MembershipPipelineStep,
        form: Form,
        request: ProspectFormRequest,
        contact_changed: bool,
    ) -> None:
        """Email the membership coordinators that a form came in.

        The same people the withdrawal notice reaches. After the commit and
        best-effort, like the old-address notice: the submission stands
        whether or not this goes out. The email links to the applicant and
        never carries an answer.
        """
        from app.services.email_policy import (
            EmailKind,
            department_required_kinds,
            recipients_for,
        )
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
        )

        try:
            from app.services.email_service import EmailService

            org = await self.db.get(Organization, prospect.organization_id)
            if org is None:
                return
            pipeline = MembershipPipelineService(self.db)
            recipients = recipients_for(
                await pipeline._withdrawal_notice_recipients(str(org.id)),
                EmailKind.MEMBERSHIP_ADMIN,
                department_required_kinds(org),
            )
            if not recipients:
                logger.warning(
                    "No coordinator to notify of follow-up form {} for prospect {}",
                    request.id,
                    prospect.id,
                )
                return

            frontend_url = getattr(settings, "FRONTEND_URL", "") or ""
            applicant_url = (
                f"{frontend_url}/prospective-members/{prospect.id}/interview"
            )
            email_service = EmailService(org)
            delivered = 0
            for user in recipients:
                if await email_service.send_follow_up_submitted_email(
                    to_email=user.email,
                    recipient_name=user.full_name,
                    applicant_name=prospect.full_name,
                    form_name=form.name,
                    stage_name=step.name,
                    applicant_url=applicant_url,
                    contact_changed=contact_changed,
                    db=self.db,
                    organization_id=str(org.id),
                ):
                    delivered += 1

            await pipeline._log_activity(
                prospect_id=str(prospect.id),
                action="follow_up_submitted_notice_sent",
                details={
                    "request_id": str(request.id),
                    "recipient_count": len(recipients),
                    "delivered": delivered,
                },
            )
            await self.db.commit()
        except Exception as e:
            logger.error(
                "Failed to notify coordinators of follow-up form {} for prospect "
                "{}: {}",
                request.id,
                prospect.id,
                e,
            )

    # ------------------------------------------------------------------
    # Reminders
    # ------------------------------------------------------------------

    @staticmethod
    def _last_contact(request: ProspectFormRequest) -> Optional[datetime]:
        """The latest of the link email, a reminder and a saved draft.

        A draft counts: an applicant who saved one this week is working on the
        form and is not reminded about it.
        """
        stamps = [
            stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)
            for stamp in (
                request.last_sent_at,
                request.last_reminder_at,
                request.draft_saved_at,
            )
            if stamp is not None
        ]
        return max(stamps) if stamps else None

    @staticmethod
    def reminder_due(request: ProspectFormRequest, local_now: datetime) -> bool:
        """Whether a reminder is due at ``local_now``, the department's time.

        Counted in the department's calendar days, so every reminder goes out
        in the first run after 09:00 on its day rather than creeping an hour
        later each week.
        """
        if request.reminder_count >= MAX_REMINDERS or request.is_submitted:
            return False
        start, end = REMINDER_HOURS
        if not start <= local_now.hour < end:
            return False
        last = FollowUpFormService._last_contact(request)
        if last is None or request.last_sent_at is None:
            return False
        last_day = last.astimezone(local_now.tzinfo).date()
        return (local_now.date() - last_day).days >= REMINDER_INTERVAL_DAYS

    async def send_due_reminders(
        self, now: Optional[datetime] = None
    ) -> Dict[str, int]:
        """Remind every applicant whose follow-up form is due a reminder.

        A request is reminded only while the applicant is still on its stage
        and the application is open: a coordinator who moved them on has
        decided the form is no longer needed.

        Send, then stamp and commit (CLAUDE.md pitfall #36): a crash between
        the two sends that reminder again on the next run. A duplicate reminder
        is a nuisance, a missing one is a stalled application, so this errs on
        the side of sending. Each row is locked and re-checked before sending,
        so two runs cannot both remind for the same day.
        """
        from app.utils.org_timezone import scheduling_timezone

        now = now or _now()
        # Calendar days are compared below, so a reminder can fall due as
        # little as six days and a few hours after the last contact. This
        # bound only narrows the query.
        bound = now - timedelta(days=REMINDER_INTERVAL_DAYS - 1)
        result = await self.db.execute(
            select(ProspectFormRequest.id, ProspectFormRequest.organization_id)
            .join(
                ProspectiveMember,
                and_(
                    ProspectiveMember.id == ProspectFormRequest.prospect_id,
                    ProspectiveMember.organization_id
                    == ProspectFormRequest.organization_id,
                ),
            )
            .join(Organization, Organization.id == ProspectFormRequest.organization_id)
            .where(
                Organization.active.isnot(False),
                ProspectFormRequest.submitted_at.is_(None),
                ProspectFormRequest.token.isnot(None),
                ProspectFormRequest.last_sent_at.isnot(None),
                ProspectFormRequest.last_sent_at <= bound,
                ProspectFormRequest.reminder_count < MAX_REMINDERS,
                ProspectiveMember.status.in_(list(OPEN_STATUSES)),
                ProspectiveMember.current_step_id == ProspectFormRequest.step_id,
            )
        )
        candidates = [(str(rid), str(oid)) for rid, oid in result.all()]

        counts = {"considered": len(candidates), "sent": 0, "failed": 0}
        zones: Dict[str, Any] = {}
        for request_id, organization_id in candidates:
            if organization_id not in zones:
                zones[organization_id] = scheduling_timezone(
                    await self.db.get(Organization, organization_id)
                )
            local_now = now.astimezone(zones[organization_id])
            outcome = await self._remind_one(
                request_id, organization_id, local_now, now
            )
            if outcome is not None:
                counts["sent" if outcome else "failed"] += 1
        return counts

    async def _remind_one(
        self, request_id: str, organization_id: str, local_now: datetime, now: datetime
    ) -> Optional[bool]:
        """Remind for one request. None when nothing was due, else whether the
        email went out. Commits or rolls back, so each row stands alone."""
        from app.services.membership_pipeline_service import (
            MembershipPipelineService,
            effective_step_type,
        )

        try:
            request = (
                await self.db.execute(
                    select(ProspectFormRequest)
                    .where(
                        ProspectFormRequest.id == request_id,
                        ProspectFormRequest.organization_id == organization_id,
                    )
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if request is None or not request.token or not request.step_id:
                await self.db.rollback()
                return None
            prospect = (
                await self.db.execute(
                    select(ProspectiveMember).where(
                        ProspectiveMember.id == request.prospect_id,
                        ProspectiveMember.organization_id == request.organization_id,
                    )
                )
            ).scalar_one_or_none()
            if (
                prospect is None
                or prospect.status not in OPEN_STATUSES
                or str(prospect.current_step_id or "") != str(request.step_id)
                or not self.reminder_due(request, local_now)
            ):
                await self.db.rollback()
                return None
            step = await self.db.get(MembershipPipelineStep, request.step_id)
            if (
                step is None
                or effective_step_type(step) != PipelineStepType.FOLLOW_UP_FORM
            ):
                await self.db.rollback()
                return None
            form = await self._stage_form(step, prospect.organization_id)
            if form is None or str(form.id) != str(request.form_id or ""):
                await self.db.rollback()
                return None

            from app.services.email_service import EmailService

            org = await self.db.get(Organization, prospect.organization_id)
            number = request.reminder_count + 1
            sent = org is not None and await EmailService(
                org
            ).send_follow_up_reminder_email(
                to_email=prospect.email,
                first_name=_record_value(prospect, "first_name") or "",
                applicant_name=prospect.full_name,
                form_name=form.name,
                form_url=form_url(request.token),
                reminder_number=number,
                has_draft=request.draft_saved_at is not None,
                db=self.db,
                organization_id=str(prospect.organization_id),
            )
            if not sent:
                logger.warning(
                    "Follow-up form reminder for request {} was not sent", request_id
                )
                await self.db.rollback()
                return False

            request.reminder_count = number
            request.last_reminder_at = now
            await MembershipPipelineService(self.db)._log_activity(
                prospect_id=str(prospect.id),
                action="follow_up_form_reminder_sent",
                details={
                    "request_id": str(request.id),
                    "step_name": step.name,
                    "form_name": form.name,
                    "reminder_number": number,
                },
            )
            await self.db.commit()
            return True
        except Exception as e:
            await self.db.rollback()
            logger.error(
                "Failed to send follow-up form reminder for request {}: {}",
                request_id,
                e,
            )
            return False
