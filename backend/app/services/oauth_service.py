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


async def _link_existing_user(
    db: AsyncSession,
    email: str,
    subject: Optional[str],
    provider: str,
) -> Tuple[Optional[User], Optional[str]]:
    """
    Map a verified external email to an existing local user (no auto-creation).

    Shared by every OAuth provider. Returns (User, None) on success or
    (None, error_code). Binds the provider/subject on first link and rejects a
    mismatch on later logins (identity-takeover guard), including an attempt to
    sign in with a different provider than the one already linked.
    """
    # Single-org system: scope the lookup to the active organization.
    org_result = await db.execute(select(Organization).limit(1))
    org = org_result.scalar_one_or_none()

    query = select(User).where(User.email == email).where(User.deleted_at.is_(None))
    if org:
        query = query.where(User.organization_id == str(org.id))
    result = await db.execute(query)
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"{provider} login: no local account for email")
        return None, "no_account"
    if not user.is_active:
        return None, "inactive"

    if user.oauth_subject and subject and user.oauth_subject != subject:
        logger.warning(f"{provider} login: subject mismatch for existing user")
        return None, "account_conflict"
    if user.oauth_provider and user.oauth_provider != provider:
        logger.warning(f"{provider} login: account already linked to another IdP")
        return None, "account_conflict"
    if subject and not user.oauth_subject:
        user.oauth_provider = provider
        user.oauth_subject = subject
        await db.commit()

    return user, None


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

        return await _link_existing_user(self.db, email, idinfo.get("sub"), "google")


class MicrosoftOAuthError(Exception):
    """Raised for recoverable OAuth failures; message is a short error code."""


def _ms_authority() -> str:
    """Tenant-scoped Azure AD v2.0 authority (single-tenant)."""
    return f"https://login.microsoftonline.com/{settings.AZURE_AD_TENANT_ID}"


class MicrosoftOAuthService:
    """
    "Sign in with Microsoft" via Azure AD using the OpenID Connect
    authorization-code flow (single-tenant). Same account policy as Google:
    link to existing users only, optionally restricted by email domain. The
    tenant GUID is enforced both in the authority URL and against the ID token's
    ``tid`` claim, so only accounts in the configured directory can sign in.
    """

    SCOPES = "openid email profile"

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def is_configured() -> bool:
        """True only when Microsoft login is enabled and fully configured."""
        return bool(
            settings.AZURE_AD_ENABLED
            and settings.AZURE_AD_TENANT_ID
            and settings.AZURE_AD_CLIENT_ID
            and settings.AZURE_AD_CLIENT_SECRET
            and settings.AZURE_AD_REDIRECT_URI
        )

    @staticmethod
    def build_authorization_url(state: str) -> str:
        """Build the Microsoft consent URL to redirect the user to."""
        params = {
            "client_id": settings.AZURE_AD_CLIENT_ID,
            "redirect_uri": settings.AZURE_AD_REDIRECT_URI,
            "response_type": "code",
            "response_mode": "query",
            "scope": MicrosoftOAuthService.SCOPES,
            "state": state,
            "prompt": "select_account",
        }
        return f"{_ms_authority()}/oauth2/v2.0/authorize?{urlencode(params)}"

    async def exchange_code_for_idinfo(self, code: str) -> dict:
        """Exchange an authorization code for a verified ID-token claim set."""
        data = {
            "code": code,
            "client_id": settings.AZURE_AD_CLIENT_ID,
            "client_secret": settings.AZURE_AD_CLIENT_SECRET,
            "redirect_uri": settings.AZURE_AD_REDIRECT_URI,
            "grant_type": "authorization_code",
            "scope": MicrosoftOAuthService.SCOPES,
        }
        token_url = f"{_ms_authority()}/oauth2/v2.0/token"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(token_url, data=data)
        except httpx.HTTPError as exc:
            logger.error(f"Microsoft token exchange request failed: {exc}")
            raise MicrosoftOAuthError("token_exchange_failed")

        if resp.status_code != 200:
            logger.warning(
                f"Microsoft token exchange rejected (status {resp.status_code})"
            )
            raise MicrosoftOAuthError("token_exchange_failed")

        id_token_str = resp.json().get("id_token")
        if not id_token_str:
            raise MicrosoftOAuthError("missing_id_token")

        return self._verify_id_token(id_token_str)

    @staticmethod
    def _verify_id_token(id_token_str: str) -> dict:
        """Verify the Azure AD ID token (RS256 via tenant JWKS) and return claims."""
        import jwt
        from jwt import PyJWKClient

        jwks_url = f"{_ms_authority()}/discovery/v2.0/keys"
        try:
            signing_key = PyJWKClient(jwks_url).get_signing_key_from_jwt(id_token_str)
            claims = jwt.decode(
                id_token_str,
                signing_key.key,
                algorithms=["RS256"],
                audience=settings.AZURE_AD_CLIENT_ID,
                issuer=f"{_ms_authority()}/v2.0",
            )
        except jwt.PyJWTError as exc:
            # Bad signature, wrong audience/issuer, expired, etc.
            logger.warning(f"Microsoft ID token verification failed: {exc}")
            raise MicrosoftOAuthError("invalid_id_token")

        # Defense-in-depth: the directory must be exactly our configured tenant.
        if claims.get("tid") != settings.AZURE_AD_TENANT_ID:
            logger.warning("Microsoft login: token tenant does not match")
            raise MicrosoftOAuthError("invalid_tenant")
        return claims

    async def resolve_user(self, claims: dict) -> Tuple[Optional[User], Optional[str]]:
        """Map verified Azure AD claims to an existing local user."""
        # Azure AD v2.0 tokens have no email_verified claim. The email lives in
        # `email`, or falls back to `preferred_username` (typically the UPN).
        email = (claims.get("email") or "").strip().lower()
        if not email:
            upn = (claims.get("preferred_username") or "").strip().lower()
            if "@" in upn:
                email = upn
        if not email:
            return None, "no_email"

        allowed_domains = settings.get_azure_ad_allowed_domains()
        if allowed_domains:
            domain = email.rsplit("@", 1)[-1]
            if domain not in allowed_domains:
                logger.warning(
                    f"Microsoft login blocked: domain '{domain}' not allowed"
                )
                return None, "domain_not_allowed"

        return await _link_existing_user(self.db, email, claims.get("sub"), "microsoft")
