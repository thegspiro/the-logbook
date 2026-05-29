"""
Google OAuth Service

Implements "Sign in with Google" using the OpenID Connect authorization-code
flow. Self-contained (httpx for the token exchange + google-auth for ID-token
verification) so it does not require Starlette SessionMiddleware: CSRF state is
carried in a short-lived cookie set by the endpoint layer.

Account policy (configured for this deployment):
- Link to EXISTING users only — a Google login never auto-creates an account.
  The Google email must match an existing, active local user.
- Domain-restricted — if GOOGLE_ALLOWED_DOMAINS is set, the email's domain must
  be in the allowlist.
"""

from typing import Optional, Tuple
from urllib.parse import urlencode

import httpx
from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import Organization, User

GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"  # nosec B105
GOOGLE_SCOPES = "openid email profile"


class GoogleOAuthError(Exception):
    """Raised for recoverable OAuth failures; message is a short error code."""


class GoogleOAuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def is_configured() -> bool:
        """True only when Google OAuth is enabled and fully configured."""
        return bool(
            settings.GOOGLE_OAUTH_ENABLED
            and settings.GOOGLE_CLIENT_ID
            and settings.GOOGLE_CLIENT_SECRET
            and settings.GOOGLE_REDIRECT_URI
        )

    @staticmethod
    def build_authorization_url(state: str) -> str:
        """Build the Google consent URL to redirect the user to."""
        params = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "response_type": "code",
            "scope": GOOGLE_SCOPES,
            "state": state,
            "access_type": "online",
            # Restrict the Google account chooser to allowed Workspace domains
            # when exactly one is configured (UX hint; re-validated server-side).
            "include_granted_scopes": "true",
            "prompt": "select_account",
        }
        allowed = settings.get_google_allowed_domains()
        if len(allowed) == 1:
            params["hd"] = next(iter(allowed))
        return f"{GOOGLE_AUTH_ENDPOINT}?{urlencode(params)}"

    async def exchange_code_for_idinfo(self, code: str) -> dict:
        """Exchange an authorization code for a verified ID-token claim set."""
        data = {
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(GOOGLE_TOKEN_ENDPOINT, data=data)
        except httpx.HTTPError as exc:
            logger.error(f"Google token exchange request failed: {exc}")
            raise GoogleOAuthError("token_exchange_failed")

        if resp.status_code != 200:
            logger.warning(
                f"Google token exchange rejected (status {resp.status_code})"
            )
            raise GoogleOAuthError("token_exchange_failed")

        id_token_str = resp.json().get("id_token")
        if not id_token_str:
            raise GoogleOAuthError("missing_id_token")

        return self._verify_id_token(id_token_str)

    @staticmethod
    def _verify_id_token(id_token_str: str) -> dict:
        """Cryptographically verify the ID token and return its claims."""
        # Imported lazily so the module loads even if google-auth is absent in
        # environments that never use Google login.
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token as google_id_token

        try:
            idinfo = google_id_token.verify_oauth2_token(
                id_token_str,
                google_requests.Request(),
                settings.GOOGLE_CLIENT_ID,
            )
        except ValueError as exc:
            # Covers bad signature, wrong audience, expired token, etc.
            logger.warning(f"Google ID token verification failed: {exc}")
            raise GoogleOAuthError("invalid_id_token")

        if idinfo.get("iss") not in (
            "accounts.google.com",
            "https://accounts.google.com",
        ):
            raise GoogleOAuthError("invalid_issuer")
        return idinfo

    async def resolve_user(self, idinfo: dict) -> Tuple[Optional[User], Optional[str]]:
        """
        Map verified Google claims to an existing local user.

        Returns (User, None) on success, or (None, error_code) otherwise.
        Never creates a user (link-existing-only policy).
        """
        email = (idinfo.get("email") or "").strip().lower()
        if not email or not idinfo.get("email_verified"):
            return None, "unverified_email"

        # Domain allowlist enforcement (defense-in-depth; also hinted via `hd`).
        allowed_domains = settings.get_google_allowed_domains()
        if allowed_domains:
            domain = email.rsplit("@", 1)[-1]
            if domain not in allowed_domains:
                logger.warning(f"Google login blocked: domain '{domain}' not allowed")
                return None, "domain_not_allowed"

        # Single-org system: scope the lookup to the active organization.
        org_result = await self.db.execute(select(Organization).limit(1))
        org = org_result.scalar_one_or_none()

        query = select(User).where(User.email == email).where(User.deleted_at.is_(None))
        if org:
            query = query.where(User.organization_id == str(org.id))
        result = await self.db.execute(query)
        user = result.scalar_one_or_none()

        if not user:
            logger.warning("Google login: no local account for verified email")
            return None, "no_account"
        if not user.is_active:
            return None, "inactive"

        subject = idinfo.get("sub")
        # Bind the Google subject on first use; reject if a different Google
        # account later claims the same local user (identity takeover guard).
        if subject:
            if user.oauth_subject and user.oauth_subject != subject:
                logger.warning("Google login: subject mismatch for existing user")
                return None, "account_conflict"
            if not user.oauth_subject:
                user.oauth_provider = "google"
                user.oauth_subject = subject
                await self.db.commit()

        return user, None
