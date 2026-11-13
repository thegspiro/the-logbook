"""
Public preceptor shift evaluation API

The outside preceptor's side of a preceptor link: open the evaluation from the
QR code or emailed link, and submit it once. The link's token is the only
credential and names exactly one evaluation of one logged outside shift, so it,
never the request body, decides whose record is written
(ShiftEvaluationLinkService.resolve).

Every response carries no-store, no-referrer and noindex headers: the URL is a
bearer credential and the body names the member, so neither may be kept by a
browser cache, a shared proxy or a search engine, or leak through a Referer
header.
"""

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.public_portal_security import validate_ip_rate_limit
from app.core.security_middleware import get_client_ip
from app.schemas.shift_evaluation import (
    PreceptorEvaluationSubmit,
    PublicShiftEvaluationSubmitted,
    PublicShiftEvaluationView,
)
from app.services.shift_evaluation_link_service import (
    LinkAlreadyUsed,
    ShiftEvaluationLinkService,
)

router = APIRouter(
    prefix="/public/v1/shift-evaluations", tags=["public-shift-evaluations"]
)

# secrets.token_urlsafe(32): 43 base64url characters. Declared so the schema
# states the shape; the service answers anything else with the same 404.
LinkToken = Path(
    ...,
    min_length=43,
    max_length=43,
    pattern=r"^[A-Za-z0-9_-]+$",
    description="The preceptor link token.",
)

_NOT_AVAILABLE = "This evaluation link is not available. It may have expired."
_ALREADY_SUBMITTED = "This evaluation has already been submitted. Thank you."


def _private(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"


@router.get("/{token}", response_model=PublicShiftEvaluationView)
async def get_preceptor_evaluation(
    request: Request,
    response: Response,
    token: str = LinkToken,
    db: AsyncSession = Depends(get_db),
):
    """The member, the shift and the form to fill out.

    404 for a link that is unknown, revoked, expired, or whose evaluation is
    no longer called for; 409 once it has been submitted.
    """
    await validate_ip_rate_limit(request)
    _private(response)
    try:
        view = await ShiftEvaluationLinkService(db).public_view(token)
    except LinkAlreadyUsed:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_ALREADY_SUBMITTED)
    if view is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    return view


@router.post("/{token}/submit", response_model=PublicShiftEvaluationSubmitted)
async def submit_preceptor_evaluation(
    request: Request,
    response: Response,
    body: PreceptorEvaluationSubmit,
    token: str = LinkToken,
    db: AsyncSession = Depends(get_db),
):
    """Submit the evaluation. 400 names an answer the preceptor must correct."""
    await validate_ip_rate_limit(request)
    _private(response)
    service = ShiftEvaluationLinkService(db)
    try:
        evaluation = await service.submit(
            token,
            body,
            ip_address=get_client_ip(request),
            user_agent=request.headers.get("user-agent", ""),
        )
    except LinkAlreadyUsed:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_ALREADY_SUBMITTED)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))
    if evaluation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=_NOT_AVAILABLE)
    await log_audit_event(
        db=db,
        event_type="shift_evaluation_submitted",
        event_category="training",
        severity="INFO",
        event_data={
            "organization_id": str(evaluation.organization_id),
            "evaluation_id": evaluation.id,
            "external_shift_id": evaluation.external_shift_id,
            "member_id": str(evaluation.member_id),
            "via": "preceptor_link",
        },
    )
    return PublicShiftEvaluationSubmitted(
        submitted_at=evaluation.submitted_at or evaluation.updated_at
    )
