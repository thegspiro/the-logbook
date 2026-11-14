"""
Preceptor links for outside-shift evaluations

A shift a member logged on an outside agency's unit is evaluated by that
agency's preceptor, who has no account here. The member, or a training
officer, creates a link for one of the shift's evaluations and shows it as a
QR code, copies it, or emails it. The preceptor opens it without signing in,
sees the member's name, the shift's date and unit and the form, and submits it
once. The member sees it, and program credit lands, at once, as for an
evaluation a training officer enters.

A link:

- is a bearer credential: stored as a SHA-256 hash for lookup, and encrypted
  only so the same link can be shown again (the follow-up form's scheme);
- works until the department's link window after the shift has passed
  (``TrainingModuleConfig.shift_evaluation_link_days``, default 7);
- works once: submitting it marks it used in the same transaction that saves
  the evaluation, so two submissions cannot both land (Pitfall #36);
- is replaced, not added to: creating another revokes the open one.

The evaluated member may make a link themselves, and nothing stops them
opening it. That is recorded (``created_by_member``) and shown on the
evaluation so the training officer reading it knows how it arrived.
"""

import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from loguru import logger
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.external_shift_hours import ExternalShiftHours
from app.models.shift_evaluation import (
    DEFAULT_PRECEPTOR_LINK_DAYS,
    ShiftEvaluation,
    ShiftEvaluationLink,
)
from app.models.training import TrainingModuleConfig
from app.models.user import Organization, User
from app.schemas.shift_evaluation import (
    PreceptorEvaluationSubmit,
    PreceptorLinkResponse,
    PublicShiftEvaluationView,
    ShiftEvaluationSave,
)
from app.services.shift_evaluation_service import ShiftEvaluationService
from app.utils.org_timezone import (
    format_in_org_timezone,
    local_day_start_utc,
    resolve_scheduling_timezone,
)

#: The page a link opens on the frontend.
LINK_PATH = "/shift-evaluation/"


_TOKEN_SHAPE = re.compile(r"[A-Za-z0-9_-]{32,64}")


def link_url(token: str) -> str:
    frontend_url = getattr(settings, "FRONTEND_URL", "") or ""
    return f"{frontend_url}{LINK_PATH}{token}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    # MySQL hands some timestamps back naive; they are stored as UTC.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class LinkAlreadyUsed(Exception):
    """The link's evaluation was submitted; the preceptor is told so."""


@dataclass
class ResolvedLink:
    link: ShiftEvaluationLink
    entry: ExternalShiftHours
    member: User


class ShiftEvaluationLinkService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.evaluations = ShiftEvaluationService(db)

    # -- Creating ----------------------------------------------------------

    async def _link_days(self, organization_id: str) -> int:
        days = (
            await self.db.execute(
                select(TrainingModuleConfig.shift_evaluation_link_days).where(
                    TrainingModuleConfig.organization_id == organization_id
                )
            )
        ).scalar_one_or_none()
        return int(days or DEFAULT_PRECEPTOR_LINK_DAYS)

    async def expires_at(
        self, entry: ExternalShiftHours, organization_id: str
    ) -> datetime:
        """The link window's end: the department's days after the shift ends.

        An entry logged as a date and hours has no end time; its shift is
        taken to end with that day where the department is.
        """
        if entry.end_at is not None:
            shift_end = _aware(entry.end_at)
        else:
            tz = await resolve_scheduling_timezone(self.db, organization_id)
            shift_end = local_day_start_utc(entry.shift_date + timedelta(days=1), tz)
        return shift_end + timedelta(days=await self._link_days(organization_id))

    async def open_scope(
        self, entry: ExternalShiftHours, organization_id: str, scope_key: Optional[str]
    ) -> str:
        """The evaluation a new link is for: the one asked for, or the first
        the shift still needs. Raises ValueError when there is none."""
        requirements = await self.evaluations.entry_requirements(entry, organization_id)
        open_scopes = [
            r.scope_key
            for r in requirements
            if r.required and not (r.evaluation and r.evaluation.status == "submitted")
        ]
        if scope_key is None:
            if not open_scopes:
                raise ValueError("This shift has no evaluation waiting")
            return open_scopes[0]
        if scope_key not in open_scopes:
            raise ValueError("That evaluation is not waiting on this shift")
        return scope_key

    async def active_link(
        self, entry_id: str, scope_key: str, organization_id: str
    ) -> Optional[ShiftEvaluationLink]:
        return (
            (
                await self.db.execute(
                    select(ShiftEvaluationLink)
                    .where(
                        ShiftEvaluationLink.organization_id == organization_id,
                        ShiftEvaluationLink.external_shift_id == entry_id,
                        ShiftEvaluationLink.scope_key == scope_key,
                        ShiftEvaluationLink.revoked_at.is_(None),
                        ShiftEvaluationLink.used_at.is_(None),
                        ShiftEvaluationLink.expires_at > _now(),
                    )
                    .order_by(ShiftEvaluationLink.created_at.desc())
                )
            )
            .scalars()
            .first()
        )

    async def create(
        self,
        entry: ExternalShiftHours,
        organization_id: UUID | str,
        creator: User,
        *,
        scope_key: Optional[str] = None,
        preceptor_email: Optional[str] = None,
    ) -> tuple[ShiftEvaluationLink, bool]:
        """Make a new link, revoking any open one; email it when asked.

        Returns the link and whether the email went out. Raises ValueError
        when the shift has no evaluation waiting or its window has passed.
        """
        org = str(organization_id)
        scope = await self.open_scope(entry, org, scope_key)
        expires = await self.expires_at(entry, org)
        if expires <= _now():
            raise ValueError(
                "The preceptor link window for this shift has passed. A "
                "training officer can enter the preceptor's paper form instead."
            )
        # Serialize link-making for this shift: without the lock, two creates
        # at once (a double tap, or the member and an officer together) each
        # revoke before the other's insert commits, and both links stay open.
        await self.db.execute(
            select(ExternalShiftHours.id)
            .where(
                ExternalShiftHours.id == entry.id,
                ExternalShiftHours.organization_id == org,
            )
            .with_for_update()
        )
        now = _now()
        await self.db.execute(
            update(ShiftEvaluationLink)
            .where(
                ShiftEvaluationLink.organization_id == org,
                ShiftEvaluationLink.external_shift_id == entry.id,
                ShiftEvaluationLink.scope_key == scope,
                ShiftEvaluationLink.revoked_at.is_(None),
                ShiftEvaluationLink.used_at.is_(None),
            )
            .values(revoked_at=now)
        )
        token = secrets.token_urlsafe(32)
        link = ShiftEvaluationLink(
            organization_id=org,
            external_shift_id=entry.id,
            member_id=entry.user_id,
            scope_key=scope,
            token=token,
            token_hash=ShiftEvaluationLink.hash_token(token),
            created_by=str(creator.id),
            created_by_member=str(creator.id) == str(entry.user_id),
            expires_at=expires,
        )
        self.db.add(link)
        await self.db.commit()
        await self.db.refresh(link)
        sent = False
        if preceptor_email:
            sent = await self.send(link, entry, preceptor_email)
        return link, sent

    async def send(
        self,
        link: ShiftEvaluationLink,
        entry: ExternalShiftHours,
        preceptor_email: str,
    ) -> bool:
        """Email the link to the preceptor. Best effort: the link still works
        to show or copy if the email does not go out."""
        org = await self.db.get(Organization, link.organization_id)
        member = await self.db.get(User, link.member_id)
        if org is None or member is None or not link.token:
            return False
        try:
            from app.services.email_service import EmailService

            sent = await EmailService(org).send_shift_evaluation_preceptor_link_email(
                to_email=preceptor_email,
                member_name=member.full_name or member.display_name or "A member",
                shift_date=entry.shift_date.strftime("%B %d, %Y"),
                unit_label=f"{entry.agency_name} {entry.apparatus_name}".strip(),
                evaluation_url=link_url(link.token),
                expires_on=format_in_org_timezone(
                    _aware(link.expires_at), org, "%B %d, %Y at %I:%M %p"
                ),
                db=self.db,
                organization_id=str(org.id),
            )
        except Exception as e:
            logger.error("Failed to email preceptor link {}: {}", link.id, e)
            return False
        if sent:
            link.preceptor_email = preceptor_email
            link.last_sent_at = _now()
            await self.db.commit()
            await self.db.refresh(link)
        return sent

    async def revoke(self, link: ShiftEvaluationLink) -> None:
        if link.revoked_at is None and link.used_at is None:
            link.revoked_at = _now()
            await self.db.commit()

    async def revoke_open(
        self,
        entry_id: str,
        organization_id: UUID | str,
        scope_key: Optional[str] = None,
    ) -> list[ShiftEvaluationLink]:
        """Turn off every open link on the shift (or on one evaluation of it).

        Whether or not an evaluation is waiting now: a link left open on a
        rejected shift, or on an agency switched off, would otherwise work
        again the moment the shift was restored or the switch turned back on.
        """
        query = select(ShiftEvaluationLink).where(
            ShiftEvaluationLink.organization_id == str(organization_id),
            ShiftEvaluationLink.external_shift_id == str(entry_id),
            ShiftEvaluationLink.revoked_at.is_(None),
            ShiftEvaluationLink.used_at.is_(None),
        )
        if scope_key is not None:
            query = query.where(ShiftEvaluationLink.scope_key == scope_key)
        links = list((await self.db.execute(query.with_for_update())).scalars())
        if not links:
            return []
        now = _now()
        for link in links:
            link.revoked_at = now
        await self.db.commit()
        return links

    # -- The preceptor's side ----------------------------------------------

    async def resolve(
        self, token: str, *, lock: bool = False
    ) -> Optional[ResolvedLink]:
        """The link a token names, if it may be used now.

        None for every unusable state alike (unknown, revoked, expired, the
        shift gone or rejected, the evaluation no longer called for), so a
        guessed token learns nothing. A used link raises LinkAlreadyUsed, so
        the preceptor who comes back is told their evaluation arrived.
        """
        # secrets.token_urlsafe(32) is 43 base64url characters; the route no
        # longer checks the shape, so anything else gets the same 404 here.
        if not token or not _TOKEN_SHAPE.fullmatch(token):
            return None
        query = select(ShiftEvaluationLink).where(
            ShiftEvaluationLink.token_hash == ShiftEvaluationLink.hash_token(token)
        )
        if lock:
            query = query.with_for_update()
        link = (await self.db.execute(query)).scalar_one_or_none()
        if link is None or link.revoked_at is not None:
            return None
        if link.used_at is not None:
            raise LinkAlreadyUsed()
        if _aware(link.expires_at) <= _now():
            return None
        entry = await self.evaluations.get_entry(
            link.external_shift_id, link.organization_id
        )
        member = await self.db.get(User, link.member_id)
        # A member who has left (Pitfall #32: not a current account) is not
        # evaluated, however long the link had left to run.
        if entry is None or member is None or not member.is_active:
            return None
        requirements = await self.evaluations.entry_requirements(
            entry, link.organization_id
        )
        waiting = any(
            r.scope_key == link.scope_key
            and r.required
            and not (r.evaluation and r.evaluation.status == "submitted")
            for r in requirements
        )
        if not waiting:
            return None
        return ResolvedLink(link=link, entry=entry, member=member)

    async def public_view(self, token: str) -> Optional[PublicShiftEvaluationView]:
        """The member, the shift and the blank form; nothing else of theirs.

        An evaluation a training officer started is not shown: the preceptor
        fills the form out from the start, and their submission replaces it.
        """
        resolved = await self.resolve(token)
        if resolved is None:
            return None
        link, entry = resolved.link, resolved.entry
        form = await self.evaluations.entry_form(
            entry, link.scope_key, link.organization_id
        )
        org = await self.db.get(Organization, link.organization_id)
        return PublicShiftEvaluationView(
            organization_name=org.name if org else "",
            member_name=(
                resolved.member.full_name or resolved.member.display_name or "A member"
            ),
            shift_date=entry.shift_date,
            shift_start=entry.start_at,
            shift_end=entry.end_at,
            unit_label=form.unit_label,
            template=form.template,
            expires_at=link.expires_at,
        )

    async def submit(
        self,
        token: str,
        body: PreceptorEvaluationSubmit,
        *,
        ip_address: Optional[str],
        user_agent: Optional[str],
    ) -> Optional[ShiftEvaluation]:
        """Submit the preceptor's evaluation. None when the link is unusable.

        Raises LinkAlreadyUsed after a submission, and ValueError for an
        answer the preceptor must correct (nothing is saved then).
        """
        # The link is judged before the answers, so an unusable link reads as
        # not found (or used) whatever the body holds.
        resolved = await self.resolve(token, lock=True)
        if resolved is None:
            return None
        # The form is the one the page showed; a template choice is not the
        # preceptor's to make.
        try:
            submission = ShiftEvaluationSave.model_validate(
                {**body.model_dump(), "submit": True}
            )
        except ValidationError as exc:
            await self.db.rollback()
            raise ValueError(_first_problem(exc)) from None
        if not submission.preceptor_name:
            await self.db.rollback()
            raise ValueError("Enter your name")
        link = resolved.link
        # Marked used in the transaction that saves the evaluation, while the
        # row lock is held: a second submission waits on the lock and then
        # finds the link used (Pitfall #36). A refused submission rolls back,
        # so the link stays open for the preceptor to correct and resend.
        link.used_at = _now()
        link.submitted_ip = (ip_address or "")[:64] or None
        link.submitted_user_agent = (user_agent or "")[:500] or None
        try:
            evaluation = await self.evaluations.save_for_entry(
                resolved.entry,
                link.scope_key,
                link.organization_id,
                submission,
                None,
            )
        except ValueError:
            await self.db.rollback()
            raise
        link = await self.db.get(ShiftEvaluationLink, link.id) or link
        link.evaluation_id = evaluation.id
        if link.used_at is None:
            link.used_at = _now()
        await self.db.commit()
        return evaluation


def _first_problem(exc: ValidationError) -> str:
    """The message of the first rule an answer broke, as the page shows it."""
    for error in exc.errors():
        cause = (error.get("ctx") or {}).get("error")
        if cause is not None:
            return str(cause)
        return str(error.get("msg") or "Check your answers")
    return "Check your answers"


def link_response(
    link: ShiftEvaluationLink, *, email_sent: bool = False
) -> PreceptorLinkResponse:
    return PreceptorLinkResponse(
        id=link.id,
        scope_key=link.scope_key,
        url=link_url(link.token or ""),
        expires_at=link.expires_at,
        created_at=link.created_at,
        created_by_member=bool(link.created_by_member),
        preceptor_email=link.preceptor_email,
        last_sent_at=link.last_sent_at,
        email_sent=email_sent,
    )
