"""Feedback from the public on a completed outreach request.

Once a request is Completed, its status page offers the department's feedback
form: a form from the Forms module, so a department writes its own questions
and branches between them with the Forms builder's rules ("show this when the
rating is at most 3"), and the server checks those rules on submission exactly
as it does for any form. Events settings name the form
(``request_pipeline.feedback_form_id``) and the question whose answer is the
rating (``request_pipeline.feedback_rating_field_id``); the starter form this
module can create comes with both set.

The status link's token is the only credential, so everything a requester can
do is decided from the request row it names, never from the request body:

- the form is offered only while the request is Completed and the named form
  is still a published form of the same department;
- one response per request, final once sent. ``event_request_feedback`` is
  unique on the request, and the submit holds the request row's lock, so a
  second send, whether a double tap or a retried POST, is refused rather than
  filed (pitfall #36);
- every unavailable state answers the same ``None``, so the endpoint cannot be
  used to learn anything about a request the token does not name.

The rating is copied onto the response when it arrives, so the report's
average does not move when the department later edits its form.
"""

import copy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestFeedback,
    EventRequestStatus,
)
from app.models.forms import (
    FieldType,
    Form,
    FormCategory,
    FormField,
    FormStatus,
    FormSubmission,
)
from app.models.user import Organization
from app.schemas.membership_pipeline import PublicFollowUpFormField
from app.services.event_request_service import get_pipeline_settings
from app.services.follow_up_form_service import display_answer
from app.services.forms_service import FormsService, as_plain_number
from app.services.outreach_feedback_notice_service import (
    OutreachFeedbackNoticeService,
)

FORM_SETTING = "feedback_form_id"
RATING_SETTING = "feedback_rating_field_id"

STARTER_FORM_NAME = "Outreach feedback"
STARTER_RATING_LABEL = "How did the visit go?"
# The starter form's "what could we do better" question appears at or below
# this rating: a 3 is a lukewarm answer worth asking about.
STARTER_FOLLOW_UP_AT_MOST = 3

_RATING_CHOICE_TYPES = (FieldType.RADIO.value, FieldType.SELECT.value)


class FeedbackError(ValueError):
    """An answer the requester must correct; its message is safe to show."""


class FeedbackAlreadySent(Exception):
    """This request already has its one response."""


def _type(field: Any) -> str:
    raw = getattr(field, "field_type", None)
    return str(getattr(raw, "value", raw) or "")


def _whole_number(text: Any) -> Optional[int]:
    if text is None:
        return None
    number = as_plain_number(str(text).strip())
    if number is None or number != int(number):
        return None
    return int(number)


def is_rating_field(field: Any) -> bool:
    """Whether a question's answer can be averaged as a rating: a number
    question, or a radio or select question whose every option is a whole
    number."""
    kind = _type(field)
    if kind == FieldType.NUMBER.value:
        return True
    if kind in _RATING_CHOICE_TYPES:
        options = getattr(field, "options", None) or []
        return len(options) >= 2 and all(
            isinstance(o, dict) and _whole_number(o.get("value")) is not None
            for o in options
        )
    return False


def rating_scale_max(field: Any) -> Optional[int]:
    """The highest rating the question accepts, for "out of 5" on the report."""
    if _type(field) == FieldType.NUMBER.value:
        return getattr(field, "max_value", None)
    values = [
        _whole_number(o.get("value"))
        for o in (getattr(field, "options", None) or [])
        if isinstance(o, dict)
    ]
    whole = [v for v in values if v is not None]
    return max(whole) if whole else None


def _now() -> datetime:
    # Whole seconds: the stamp columns are DATETIME(0), and MySQL 8 *rounds* a
    # fraction where MariaDB truncates it, so 12:00:00.7 is stored as 12:00:01
    # — a response received a moment ago would sit after the report's "now"
    # and fall outside its period. Flooring keeps every stamp at or before the
    # clock on both servers.
    return datetime.now(timezone.utc).replace(microsecond=0)


class OutreachFeedbackService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    async def _form(self, organization_id: str, form_id: Any) -> Optional[Form]:
        if not form_id:
            return None
        return (
            await self.db.execute(
                select(Form)
                .where(
                    Form.id == str(form_id),
                    Form.organization_id == str(organization_id),
                )
                .options(selectinload(Form.fields))
            )
        ).scalar_one_or_none()

    async def configured(
        self, organization: Organization
    ) -> Optional[Tuple[Form, Optional[FormField]]]:
        """The department's feedback form and its rating question, while the
        form is published; None when no form is set or it can no longer be
        offered. The rating question is None when unset or no longer usable,
        and the survey still runs without it."""
        pipeline = get_pipeline_settings(organization)
        form = await self._form(str(organization.id), pipeline.get(FORM_SETTING))
        if form is None or form.status != FormStatus.PUBLISHED:
            return None
        rating_id = pipeline.get(RATING_SETTING)
        rating = next(
            (
                f
                for f in form.fields
                if rating_id and str(f.id) == str(rating_id) and is_rating_field(f)
            ),
            None,
        )
        return form, rating

    async def validate_settings(
        self,
        organization_id: str,
        form_id: Optional[str],
        rating_field_id: Optional[str],
    ) -> None:
        """Refuse a feedback form from another department, an unpublished one,
        or a rating question that is not on it or cannot be averaged."""
        if not form_id:
            if rating_field_id:
                raise ValueError("Choose a feedback form before its rating question")
            return
        form = await self._form(organization_id, form_id)
        if form is None:
            raise ValueError("Feedback form not found")
        if form.status != FormStatus.PUBLISHED:
            raise ValueError("Publish the feedback form before using it")
        if rating_field_id:
            field = next(
                (f for f in form.fields if str(f.id) == str(rating_field_id)), None
            )
            if field is None:
                raise ValueError("The rating question is not on the feedback form")
            if not is_rating_field(field):
                raise ValueError(
                    "The rating question must be a number, or a choice whose "
                    "options are all whole numbers"
                )

    async def create_starter_form(
        self, organization: Organization, created_by: Optional[str]
    ) -> Form:
        """Create the starter feedback form and make it the department's.

        Idempotent: the organization row is locked, and a department whose
        setting already names a form it still has gets that form back, so a
        double click makes one form, not two.
        """
        org = (
            await self.db.execute(
                select(Organization)
                .where(Organization.id == str(organization.id))
                .with_for_update()
            )
        ).scalar_one()
        existing = await self._form(
            str(org.id), get_pipeline_settings(org).get(FORM_SETTING)
        )
        if existing is not None:
            return existing

        stamp = _now()
        form = Form(
            organization_id=str(org.id),
            name=STARTER_FORM_NAME,
            description=(
                "Thank you for inviting us. A few questions about how it went; "
                "your answers go to the department."
            ),
            category=FormCategory.OTHER,
            status=FormStatus.PUBLISHED,
            allow_multiple_submissions=True,
            require_authentication=False,
            # Reached only through a requester's status link, never a slug.
            is_public=False,
            published_at=stamp,
            created_by=created_by,
        )
        self.db.add(form)
        await self.db.flush()
        rating = FormField(
            form_id=form.id,
            label=STARTER_RATING_LABEL,
            field_type=FieldType.NUMBER,
            help_text="1 is poor, 5 is excellent.",
            required=True,
            min_value=1,
            max_value=5,
            sort_order=0,
            width="full",
        )
        self.db.add(rating)
        await self.db.flush()
        self.db.add_all(
            [
                FormField(
                    form_id=form.id,
                    label="What went well?",
                    field_type=FieldType.TEXTAREA,
                    required=False,
                    max_length=2000,
                    sort_order=1,
                    width="full",
                ),
                FormField(
                    form_id=form.id,
                    label="What could we do better?",
                    field_type=FieldType.TEXTAREA,
                    required=False,
                    max_length=2000,
                    sort_order=2,
                    width="full",
                    condition_field_id=str(rating.id),
                    condition_operator="at_most",
                    condition_value=str(STARTER_FOLLOW_UP_AT_MOST),
                ),
            ]
        )

        # A deep copy, so the nested change is seen as one (pitfall #12).
        current = copy.deepcopy(org.settings or {})
        pipeline = current.setdefault("events", {}).setdefault("request_pipeline", {})
        pipeline[FORM_SETTING] = str(form.id)
        pipeline[RATING_SETTING] = str(rating.id)
        org.settings = current
        await self.db.commit()
        return await self._form(str(org.id), form.id) or form

    # ------------------------------------------------------------------
    # The requester's side
    # ------------------------------------------------------------------

    async def _request_for_token(
        self, token: str, *, lock: bool = False
    ) -> Optional[EventRequest]:
        query = select(EventRequest).where(
            EventRequest.status_token_hash == EventRequest.hash_status_token(token)
        )
        if lock:
            query = query.with_for_update()
        return (await self.db.execute(query)).scalar_one_or_none()

    async def _existing(self, request_id: str) -> Optional[EventRequestFeedback]:
        return (
            await self.db.execute(
                select(EventRequestFeedback).where(
                    EventRequestFeedback.request_id == str(request_id)
                )
            )
        ).scalar_one_or_none()

    async def status_flags(
        self, event_request: EventRequest, organization: Optional[Organization]
    ) -> Tuple[bool, bool]:
        """(offered, sent) for the status page: whether this Completed request
        can still be answered, and whether it already has been."""
        if organization is None or event_request.status != EventRequestStatus.COMPLETED:
            return False, False
        if await self._existing(str(event_request.id)) is not None:
            return False, True
        return (await self.configured(organization)) is not None, False

    async def _open(
        self, token: str, *, lock: bool = False
    ) -> Optional[Tuple[EventRequest, Organization, Form, Optional[FormField]]]:
        event_request = await self._request_for_token(token, lock=lock)
        if (
            event_request is None
            or event_request.status != EventRequestStatus.COMPLETED
        ):
            return None
        organization = await self.db.get(Organization, event_request.organization_id)
        if organization is None:
            return None
        found = await self.configured(organization)
        if found is None:
            return None
        if await self._existing(str(event_request.id)) is not None:
            raise FeedbackAlreadySent()
        return event_request, organization, found[0], found[1]

    async def public_view(self, token: str) -> Optional[Dict[str, Any]]:
        opened = await self._open(token)
        if opened is None:
            return None
        event_request, organization, form, _rating = opened
        fields = sorted(form.fields, key=lambda f: f.sort_order)
        return {
            "form_name": form.name,
            "form_description": form.description,
            "organization_name": organization.name,
            "contact_name": event_request.contact_name,
            "fields": [PublicFollowUpFormField.model_validate(f) for f in fields],
        }

    async def submit(
        self,
        token: str,
        data: Dict[str, Any],
        *,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
    ) -> Optional[datetime]:
        """Check and store the response; None when the form is not offered."""
        opened = await self._open(token, lock=True)
        if opened is None:
            return None
        event_request, organization, form, rating_field = opened

        # The Forms module's own rules: a required question counts only where
        # its branch is showing, and every answer is cleaned and bounded.
        visible = FormsService._visible_field_ids(form.fields, data)
        for field in form.fields:
            key = str(field.id)
            if (
                field.required
                and key in visible
                and (key not in data or FormsService._is_empty_value(data[key]))
            ):
                raise FeedbackError(f"'{field.label}' is required")
        sanitized, error = FormsService._sanitize_submission_data(data, form.fields)
        if error:
            raise FeedbackError(error)

        rating: Optional[int] = None
        if rating_field is not None and str(rating_field.id) in visible:
            rating = _whole_number(sanitized.get(str(rating_field.id)))

        plain, sensitive = FormsService._split_sensitive(sanitized, form.fields)
        submission = FormSubmission(
            organization_id=str(organization.id),
            form_id=form.id,
            data=plain,
            sensitive_data=sensitive,
            submitter_name=(event_request.contact_name or "")[:255] or None,
            is_public_submission=True,
            ip_address=ip_address,
            user_agent=user_agent,
            # Nothing in another module acts on it: the response row below is
            # its only consumer.
            integration_processed=True,
        )
        self.db.add(submission)
        await self.db.flush()

        stamp = _now()
        self.db.add(
            EventRequestFeedback(
                organization_id=str(organization.id),
                request_id=str(event_request.id),
                form_id=str(form.id),
                form_submission_id=str(submission.id),
                rating=rating,
                submitted_at=stamp,
            )
        )
        self.db.add(
            EventRequestActivity(
                request_id=str(event_request.id),
                action="feedback_received",
                notes="The requester sent feedback",
                details={"rating": rating, "form_submission_id": str(submission.id)},
            )
        )
        # The bells join this transaction, so they exist exactly when the
        # response does; the emails wait for the commit.
        notices = OutreachFeedbackNoticeService(self.db)
        notice = await notices.prepare(
            event_request,
            organization,
            rating,
            rating_scale_max(rating_field) if rating_field is not None else None,
        )
        try:
            await self.db.commit()
        except IntegrityError:
            # Two sends raced past the check above; the unique constraint kept
            # the first, and rolled this one's bells back with it.
            await self.db.rollback()
            raise FeedbackAlreadySent()
        logger.info(
            "Outreach feedback received for request {} (rating {})",
            event_request.id,
            rating,
        )
        await notices.send_emails(notice)
        return stamp

    # ------------------------------------------------------------------
    # The officers' side
    # ------------------------------------------------------------------

    async def for_request(
        self, organization_id: str, request_id: str
    ) -> Optional[Dict[str, Any]]:
        """A request's response, question by question, or None when it has
        none. The request is resolved in-org (pitfall #14)."""
        found = (
            await self.db.execute(
                select(EventRequestFeedback)
                .join(EventRequest, EventRequest.id == EventRequestFeedback.request_id)
                .where(
                    EventRequestFeedback.request_id == str(request_id),
                    EventRequest.organization_id == str(organization_id),
                    EventRequestFeedback.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if found is None:
            return None
        form = await self._form(organization_id, found.form_id)
        submission = (
            await self.db.get(FormSubmission, found.form_submission_id)
            if found.form_submission_id
            else None
        )
        answers: List[Dict[str, Any]] = []
        sensitive_count = 0
        if form is not None and submission is not None:
            data = submission.data or {}
            for field in sorted(form.fields, key=lambda f: f.sort_order):
                if _type(field) == FieldType.SECTION_HEADER.value:
                    continue
                if field.is_sensitive:
                    # Kept with the submission in Forms, behind its own
                    # access rules; the request page says how many.
                    if (submission.sensitive_data or {}).get(str(field.id)):
                        sensitive_count += 1
                    continue
                raw = data.get(str(field.id))
                if raw in (None, "", []):
                    continue
                answers.append(
                    {"question": field.label, "answer": display_answer(field, raw)}
                )
        return {
            "rating": found.rating,
            "submitted_at": found.submitted_at,
            "form_name": form.name if form else None,
            "answers": answers,
            "sensitive_answers": sensitive_count,
        }

    async def rating_totals(
        self, organization_id: str, start: Optional[datetime], end: datetime
    ) -> Tuple[int, int, int]:
        """(responses, rated responses, sum of ratings) for responses received
        in the period."""
        conditions = [
            EventRequestFeedback.organization_id == str(organization_id),
            EventRequestFeedback.submitted_at < end,
        ]
        if start is not None:
            conditions.append(EventRequestFeedback.submitted_at >= start)
        row = (
            await self.db.execute(
                select(
                    func.count(EventRequestFeedback.id),
                    func.count(EventRequestFeedback.rating),
                    func.coalesce(func.sum(EventRequestFeedback.rating), 0),
                ).where(*conditions)
            )
        ).one()
        return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)
