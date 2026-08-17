"""
Challenge-response (CAPTCHA) verification for exposed public forms.

Closes the residual named in the 2026-08-16 red-team review: the public form
and password-reset endpoints are reachable by anyone on the internet and are
defended only by rate limiting, a honeypot field, and a daily cap. Those raise
the cost of automated abuse but do not require a human, so a bot that paces
itself under the limit still gets through.

Three providers are supported because operators do not all have the same
constraints — Cloudflare Turnstile and hCaptcha both offer accessible
challenges without Google dependencies, and reCAPTCHA is included for
deployments already standardized on it. They share one verification shape
(POST secret + token, get a JSON verdict), so the differences collapse to an
endpoint URL and, for reCAPTCHA v3, a score threshold instead of a boolean.

**This control fails closed.** If the provider is unreachable the submission is
rejected. That is the opposite of the breached-password check, which fails open,
and the asymmetry is deliberate: there, complexity rules and password history
still protect the account when the lookup is skipped, so failing open costs a
supplementary signal. Here there is no fallback — accepting unverified traffic
during an outage is exactly the state an attacker wants, and one they can bring
about by attacking the provider or simply by waiting for a bad day. Since the
whole control is opt-in, an operator who cannot accept that availability
tradeoff should leave it disabled rather than run it in a bypassable mode.

The token is read from the ``X-Captcha-Token`` header rather than a body field
so the check is a pure dependency: no request schema changes, and the same
dependency drops onto any endpoint regardless of its body shape.
"""

from typing import Any

import httpx
from fastapi import HTTPException, Request, status
from loguru import logger

from app.core.config import settings
from app.core.security_middleware import get_client_ip

CAPTCHA_HEADER = "X-Captcha-Token"

_VERIFY_URLS = {
    "turnstile": "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    "hcaptcha": "https://api.hcaptcha.com/siteverify",
    "recaptcha": "https://www.google.com/recaptcha/api/siteverify",
}

# Origins each provider's browser widget needs. Exposed so the CSP builder in
# security_middleware can widen script-src/frame-src/connect-src for exactly
# the configured provider — a hardcoded 'self' CSP silently blocks every widget,
# which presents as "the CAPTCHA never appears" rather than as a CSP error.
_WIDGET_ORIGINS = {
    "turnstile": ["https://challenges.cloudflare.com"],
    "hcaptcha": ["https://hcaptcha.com", "https://*.hcaptcha.com"],
    "recaptcha": ["https://www.google.com", "https://www.gstatic.com"],
}


def is_captcha_configured() -> bool:
    """True when CAPTCHA is enabled *and* usable.

    An operator who flips CAPTCHA_ENABLED without setting a secret would
    otherwise reject every public submission with no route to diagnosis. Treat
    that as "not configured" and log it, rather than failing every request.
    """
    if not settings.CAPTCHA_ENABLED:
        return False
    if settings.CAPTCHA_PROVIDER not in _VERIFY_URLS:
        logger.error(
            f"CAPTCHA_ENABLED but CAPTCHA_PROVIDER={settings.CAPTCHA_PROVIDER!r} "
            f"is not one of {sorted(_VERIFY_URLS)} — challenge not enforced"
        )
        return False
    if not settings.CAPTCHA_SECRET_KEY:
        logger.error(
            "CAPTCHA_ENABLED but CAPTCHA_SECRET_KEY is empty — challenge not enforced"
        )
        return False
    return True


def get_widget_origins() -> list[str]:
    """Origins the configured provider's widget loads from ('' when disabled)."""
    if not is_captcha_configured():
        return []
    return _WIDGET_ORIGINS.get(settings.CAPTCHA_PROVIDER, [])


def _verdict_from_payload(payload: dict[str, Any]) -> tuple[bool, str | None]:
    """Interpret a provider's siteverify JSON."""
    if not payload.get("success"):
        codes = payload.get("error-codes") or payload.get("error_codes") or []
        return False, f"provider rejected token: {codes}"

    # reCAPTCHA v3 always reports success=True and expresses confidence as a
    # score, so a boolean-only reading would accept every bot it detected.
    # Turnstile and hCaptcha omit the field entirely.
    if settings.CAPTCHA_PROVIDER == "recaptcha" and "score" in payload:
        try:
            score = float(payload["score"])
        except (TypeError, ValueError):
            return False, "provider returned a non-numeric score"
        if score < settings.CAPTCHA_MIN_SCORE:
            return False, f"score {score} below threshold {settings.CAPTCHA_MIN_SCORE}"

    return True, None


async def verify_captcha_token(token: str, remote_ip: str | None) -> tuple[bool, str]:
    """Verify *token* with the configured provider.

    Returns ``(is_valid, reason)``. ``reason`` is for logs only — it can name the
    provider's error codes, which must not be echoed to the client.
    """
    if not token:
        return False, "no token supplied"

    url = _VERIFY_URLS[settings.CAPTCHA_PROVIDER]
    form: dict[str, str] = {
        "secret": settings.CAPTCHA_SECRET_KEY,
        "response": token,
    }
    if remote_ip:
        form["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(
            timeout=settings.CAPTCHA_TIMEOUT_SECONDS
        ) as client:
            response = await client.post(url, data=form)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        # Fail closed (see module docstring), but log loudly: from the client's
        # side an outage and a genuine rejection look identical, so this log is
        # the only signal that enforcement is degraded rather than working.
        logger.error(f"CAPTCHA verification unavailable, rejecting: {exc}")
        return False, f"verification unavailable: {exc}"

    if not isinstance(payload, dict):
        return False, "provider returned a non-object response"

    return _verdict_from_payload(payload)


async def require_captcha(request: Request) -> None:
    """FastAPI dependency: require a valid challenge token on this request.

    No-op when CAPTCHA is disabled or misconfigured, so adding it to an endpoint
    is safe for every deployment that has not turned it on.

    Usage:
        @router.post("/submit", dependencies=[Depends(require_captcha)])
    """
    if not is_captcha_configured():
        return

    token = request.headers.get(CAPTCHA_HEADER, "")
    is_valid, reason = await verify_captcha_token(token, get_client_ip(request))
    if is_valid:
        return

    logger.warning(
        f"CAPTCHA challenge failed for {get_client_ip(request)} "
        f"on {request.url.path}: {reason}"
    )
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        # Generic on purpose: the provider's error codes distinguish "bad
        # secret" from "token already redeemed" from "token forged", which
        # tells an attacker which part of the setup to probe next.
        detail="Challenge verification failed. Please try again.",
    )
