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
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.forms import Form, FormField, FormStatus, FormSubmission
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
            "changes": changes,
            "contact_changed": request.contact_changed,
            "contact_change_reviewed_at": request.contact_change_reviewed_at,
            "contact_change_reviewed_by_name": (
                (reviewers or {}).get(str(reviewed_by)) if reviewed_by else None
            ),
        }

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
