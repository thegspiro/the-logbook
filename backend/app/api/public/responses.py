"""
Declared error responses for the public API.

FastAPI only documents the status codes a route *declares*. Every public
route declared 200 (and, where it takes input, 422) while actually returning
401 for a missing API key, 404 for an unknown token/slug/code, 400 for a
malformed one, and 429 when rate limited. Anyone generating a client from
/openapi.json therefore got a client that treated all four as protocol
violations — which is exactly what the schemathesis contract suite reported.

These blocks are attached at `include_router(...)` rather than on ~15
individual decorators, so a new route in an existing public router inherits
the right set instead of silently reintroducing the gap.

Only codes a router can genuinely emit are listed: over-declaring is its own
form of wrong documentation.
"""

from pydantic import BaseModel, Field


class PublicErrorResponse(BaseModel):
    """Body of an HTTPException raised by a public route."""

    detail: str = Field(..., description="Human-readable reason for the failure.")


def _response(description: str) -> dict:
    return {"model": PublicErrorResponse, "description": description}


# Every public router is rate limited.
RATE_LIMITED = {
    429: _response("Rate limit exceeded for this caller."),
}

NOT_FOUND = {
    404: _response("The referenced record does not exist, or is not public."),
}

BAD_REQUEST = {
    400: _response("The request was malformed, expired, or already acted on."),
}

UNAUTHORIZED = {
    401: _response("Missing or invalid API key."),
}

# Token-addressed routes: an unknown or expired token is the normal failure.
TOKEN_ADDRESSED = {**RATE_LIMITED, **NOT_FOUND}

# Webhook receivers: an unknown integration id, a bad signature, or an
# unparseable payload.
WEBHOOK = {**RATE_LIMITED, **NOT_FOUND, **BAD_REQUEST, **UNAUTHORIZED}

# API-key authenticated portal routes.
PORTAL = {**RATE_LIMITED, **NOT_FOUND, **BAD_REQUEST, **UNAUTHORIZED}
