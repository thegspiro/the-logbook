"""
Public Follow-up Form API Endpoints

The applicant's side of a Follow-up Form stage: open the form from the emailed
link, save a draft, submit. The link's token is the only credential and names
exactly one applicant's request for one stage, so it — never the request body —
decides whose record is read and written (FollowUpFormService.resolve).

Every response carries no-store, no-referrer and noindex headers: the URL is a
bearer credential and the body holds the applicant's own details, so neither may
be kept by a browser cache, a shared proxy or a search engine, or leak through
a Referer header.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.public_portal_security import validate_ip_rate_limit
from app.core.security_middleware import get_client_ip
from app.schemas.membership_pipeline import (
    PublicFollowUpAnswers,
    PublicFollowUpDraftResponse,
    PublicFollowUpFormResponse,
    PublicFollowUpSubmitResponse,
)
from app.services.follow_up_form_service import (
    FollowUpAlreadySubmitted,
    FollowUpFormError,
    FollowUpFormService,
)

router = APIRouter(prefix="/public/v1/follow-up-forms", tags=["public-follow-up-forms"])

# secrets.token_urlsafe(32): 43 base64url characters. Declared so the schema
# states the shape; the service answers anything else with the same 404.
FormToken = Path(
    ...,
    min_length=43,
    max_length=43,
    pattern=r"^[A-Za-z0-9_-]+$",
    description="The personal form link token emailed to the applicant.",
)

_NOT_AVAILABLE = "This form is not available."
_ALREADY_SUBMITTED = "This form has already been submitted. Thank you."


def _private(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"


@router.get("/{token}", response_model=PublicFollowUpFormResponse)
async def get_follow_up_form(
    request: Request,
    response: Response,
    token: str = FormToken,
    db: AsyncSession = Depends(get_db),
):
    """The form, filled with the saved draft or what the applicant record holds.

    404 for a link that is unknown, or whose application, stage or form is no
    longer open; 409 once the form has been submitted.
    """
    await validate_ip_rate_limit(request)
    _private(response)
    try:
        view = await FollowUpFormService(db).public_view(token)
    except FollowUpAlreadySubmitted:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_ALREADY_SUBMITTED)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    return view


@router.put("/{token}/draft", response_model=PublicFollowUpDraftResponse)
async def save_follow_up_draft(
    request: Request,
    response: Response,
    body: PublicFollowUpAnswers,
    token: str = FormToken,
    db: AsyncSession = Depends(get_db),
):
    """Save the answers so far. Not validated: a draft may be incomplete."""
    await validate_ip_rate_limit(request)
    _private(response)
    try:
        saved_at = await FollowUpFormService(db).save_draft(token, body.data)
    except FollowUpAlreadySubmitted:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_ALREADY_SUBMITTED)
    if saved_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    return PublicFollowUpDraftResponse(draft_saved_at=saved_at)


@router.post("/{token}/submit", response_model=PublicFollowUpSubmitResponse)
async def submit_follow_up_form(
    request: Request,
    response: Response,
    body: PublicFollowUpAnswers,
    token: str = FormToken,
    db: AsyncSession = Depends(get_db),
):
    """Submit the form. 400 names an answer the applicant must correct."""
    await validate_ip_rate_limit(request)
    _private(response)
    service = FollowUpFormService(db)
    try:
        submitted_at = await service.submit(
            token,
            body.data,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent", "")[:500],
        )
    except FollowUpAlreadySubmitted:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_ALREADY_SUBMITTED)
    except FollowUpFormError as e:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))
    if submitted_at is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    return PublicFollowUpSubmitResponse(submitted_at=submitted_at)
