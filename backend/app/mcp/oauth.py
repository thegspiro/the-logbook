"""
The OAuth 2.1 authorization server behind the Claude MCP endpoint.

A member connects an MCP client with their own account through the
authorization-code grant with PKCE (S256 only). The HTTP surface lives in
``app/api/public/mcp_oauth.py`` (authorize, token, revoke, metadata) and
``app/api/v1/endpoints/mcp_oauth.py`` (the signed-in consent screen, the
member's own connections, administrator client registration). This module
holds every decision those endpoints make, so the rules can be tested
without HTTP and cannot drift between endpoints.

What a token can do is decided *per request*, never at issue time
(``authenticate_access_token``): the intersection of

* the department's switches (the same ones a service key obeys:
  connected, active, Integrations module on, plus ``oauth_enabled``);
* the scopes the member consented to; and
* the member's own current permissions, which the tool registry checks
  against each tool's declared permission.

So revoking a member's position, deactivating their account or turning a
department switch off takes effect on the next call, with no token to chase.

Fail-closed rules worth knowing before changing anything here:

* There is no dynamic client registration. A client exists only because an
  administrator holding ``integrations.mcp_keys`` registered it, and it
  belongs to that administrator's department — the organization is always
  taken from the client, never from the request.
* Redirect URIs are matched byte-for-byte against the registered list. An
  unknown client or a mismatched URI is reported to the browser, never
  redirected to (RFC 6749 §4.1.2.1), so the endpoint cannot be used as an
  open redirector.
* A code is single use. Presenting a used one revokes the grant it minted.
* Refresh tokens rotate on every use. Each grant stores only its *current*
  refresh digest, and the token names its grant, so presenting any older
  refresh token for a live grant is recognisable as a replay and revokes the
  whole grant (OAuth 2.1 §4.3.1, refresh-token rotation).
"""

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Iterable, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.mcp.constants import LAST_USED_THROTTLE_SECONDS, MCP_MOUNT_PATH
from app.mcp.keys import McpAuthError, resolve_department_access
from app.mcp.principal import McpPrincipal
from app.models.mcp_oauth import McpOAuthAuthorization, McpOAuthClient, McpOAuthGrant
from app.models.user import User

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# The authorization server's issuer is the public origin plus this path, so
# every endpoint is under /api/ and reachable through the reverse-proxy rules
# the project already ships (see ``MCP_MOUNT_PATH``).
ISSUER_PATH = "/api/oauth"
AUTHORIZE_PATH = f"{ISSUER_PATH}/authorize"
TOKEN_PATH = f"{ISSUER_PATH}/token"
REVOKE_PATH = f"{ISSUER_PATH}/revoke"
# Where /authorize sends the browser: the SPA's consent screen.
CONSENT_PATH = "/claude/authorize"

# Short-lived access, rotating refresh, bounded connection. An MCP client
# refreshes on its own, so a short access lifetime costs the member nothing
# and bounds a leaked access token to minutes.
ACCESS_TOKEN_TTL = timedelta(minutes=15)
REFRESH_IDLE_TTL = timedelta(days=30)
GRANT_MAX_TTL = timedelta(days=90)
CODE_TTL = timedelta(seconds=60)
PENDING_REQUEST_TTL = timedelta(minutes=10)
# How long a finished authorization row is kept: long enough to recognise a
# replayed code, then pruned so the table cannot grow without bound.
AUTHORIZATION_RETENTION = timedelta(days=1)

ACCESS_TOKEN_PREFIX = "logbook_oat_"
REFRESH_TOKEN_PREFIX = "logbook_ort_"
CLIENT_ID_PREFIX = "lbmcp_"
CLIENT_SECRET_PREFIX = "lbmcs_"

# Bounds on what an administrator or a client can make the server store.
MAX_CLIENTS_PER_ORG = 25
MAX_REDIRECT_URIS = 10
MAX_REDIRECT_URI_CHARS = 2000
MAX_STATE_CHARS = 1024
MAX_PENDING_PER_CLIENT = 100
# Live connections one member may hold through one client. A member who
# connects again past this replaces their oldest connection.
MAX_GRANTS_PER_MEMBER_CLIENT = 5

SCOPE_READ = "mcp:read"
SCOPE_WRITE = "mcp:write"
SCOPE_FINANCE = "mcp:finance"
SCOPE_MEDICAL = "mcp:medical_screening"

# Every scope the server knows, with the text the consent screen shows.
# ``mcp:read`` is always granted: a connection that can call no tool is not
# a connection.
SCOPES: dict[str, str] = {
    SCOPE_READ: (
        "Read your department's records through the tools your own " "permissions reach"
    ),
    SCOPE_WRITE: (
        "Create drafts and requests as you — draft events, meeting action "
        "items, reorder requests — never publish or approve anything"
    ),
    SCOPE_FINANCE: "Read finance totals, if you have finance access yourself",
    SCOPE_MEDICAL: (
        "Read medical-screening status (never results), if you have "
        "medical-screening access yourself"
    ),
}

GRANT_TYPES = ("authorization_code", "refresh_token")
TOKEN_AUTH_METHODS = ("none", "client_secret_basic", "client_secret_post")

_UNRESERVED = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class OAuthError(Exception):
    """An OAuth error response (RFC 6749 §5.2 / §4.1.2.1).

    ``redirect`` says whether /authorize may report it to the client's
    redirect URI. It is False until the client and the redirect URI have
    both been verified, which is what keeps unverified input from steering
    the browser anywhere.
    """

    def __init__(
        self,
        error: str,
        description: str,
        *,
        status: int = 400,
        redirect: bool = False,
    ):
        super().__init__(description)
        self.error = error
        self.description = description
        self.status = status
        self.redirect = redirect


# ---------------------------------------------------------------------------
# Material
# ---------------------------------------------------------------------------


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _same(a: Optional[str], b: Optional[str]) -> bool:
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    # Some MySQL driver configurations hand back naive datetimes for
    # ``DateTime(timezone=True)``; every stored value is UTC.
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _expired(value: Optional[datetime], now: datetime) -> bool:
    stamp = _as_utc(value)
    return stamp is None or stamp <= now


def _mint_token(prefix: str, grant_id: str) -> str:
    return f"{prefix}{grant_id}.{secrets.token_urlsafe(32)}"


def parse_token(presented: str, prefix: str) -> Optional[str]:
    """The grant id a token names, or None if it is not shaped like one.

    Rejects junk before the database is touched, as ``looks_like_key`` does
    for service keys.
    """
    if not presented.startswith(prefix):
        return None
    grant_id, sep, secret = presented[len(prefix) :].partition(".")
    if not sep or not 30 <= len(secret) <= 64:
        return None
    if not all(c.isalnum() or c in "-_" for c in secret):
        return None
    try:
        UUID(grant_id)
    except ValueError:
        return None
    return grant_id


def pkce_challenge(verifier: str) -> str:
    """The S256 code challenge for ``verifier`` (RFC 7636 §4.2)."""
    raw = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def valid_verifier(verifier: Optional[str]) -> bool:
    return (
        verifier is not None
        and 43 <= len(verifier) <= 128
        and all(c in _UNRESERVED for c in verifier)
    )


def valid_challenge(challenge: Optional[str]) -> bool:
    # A base64url SHA-256 digest without padding is exactly 43 characters.
    return (
        challenge is not None
        and len(challenge) == 43
        and all(c.isalnum() or c in "-_" for c in challenge)
    )


# ---------------------------------------------------------------------------
# Deployment-level addresses
# ---------------------------------------------------------------------------


def origin() -> Optional[str]:
    """The public origin, or None when the authorization server is off."""
    return settings.mcp_oauth_origin()


def issuer(base: str) -> str:
    return f"{base}{ISSUER_PATH}"


def resource_url(base: str) -> str:
    """The protected resource tokens are bound to: the MCP endpoint."""
    return f"{base}{MCP_MOUNT_PATH}"


def resource_metadata_url(base: str) -> str:
    """Where the MCP endpoint's 401 points a client (RFC 9728).

    Under /api/ so it is reachable without a reverse-proxy change; the
    ``/.well-known/`` form is served as well.
    """
    return f"{base}{MCP_MOUNT_PATH}/.well-known/oauth-protected-resource"


def authorization_server_metadata(base: str) -> dict[str, Any]:
    """RFC 8414 metadata. No ``registration_endpoint``: clients are
    registered by an administrator, never dynamically."""
    iss = issuer(base)
    return {
        "issuer": iss,
        "authorization_endpoint": f"{base}{AUTHORIZE_PATH}",
        "token_endpoint": f"{base}{TOKEN_PATH}",
        "revocation_endpoint": f"{base}{REVOKE_PATH}",
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": list(GRANT_TYPES),
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": list(TOKEN_AUTH_METHODS),
        "revocation_endpoint_auth_methods_supported": list(TOKEN_AUTH_METHODS),
        "scopes_supported": list(SCOPES),
        "authorization_response_iss_parameter_supported": True,
    }


def protected_resource_metadata(base: str) -> dict[str, Any]:
    """RFC 9728 metadata for the MCP endpoint."""
    return {
        "resource": resource_url(base),
        "authorization_servers": [issuer(base)],
        "scopes_supported": list(SCOPES),
        "bearer_methods_supported": ["header"],
        "resource_name": "The Logbook",
    }


def canonical_resource(requested: Optional[str], base: str) -> str:
    """The resource a request is for, or ``invalid_target``.

    Optional for compatibility with clients that predate RFC 8707; when
    sent it must name this server's MCP endpoint, so a token minted here can
    never be presented as one for somebody else's resource.
    """
    expected = resource_url(base)
    if requested is None or requested == "":
        return expected
    if requested.rstrip("/") != expected:
        raise OAuthError(
            "invalid_target",
            "The requested resource is not this server's MCP endpoint",
            redirect=True,
        )
    return expected


# ---------------------------------------------------------------------------
# Scopes and redirect URIs
# ---------------------------------------------------------------------------


def parse_scope(raw: Optional[str], *, redirect: bool) -> list[str]:
    """Requested scopes, always including ``mcp:read``, or ``invalid_scope``."""
    wanted = (raw or "").split()
    unknown = [s for s in wanted if s not in SCOPES]
    if unknown:
        raise OAuthError(
            "invalid_scope",
            f"Unknown scope: {' '.join(unknown)[:200]}",
            redirect=redirect,
        )
    granted = [SCOPE_READ] + [s for s in SCOPES if s in wanted and s != SCOPE_READ]
    return granted


def join_scope(scopes: Iterable[str]) -> str:
    # Stable order: the catalog's.
    chosen = set(scopes)
    return " ".join(s for s in SCOPES if s in chosen)


def normalize_redirect_uris(values: Iterable[Any]) -> list[str]:
    """Validate an administrator's redirect URIs into the stored shape.

    ``https://`` for anything public; ``http://`` only on a loopback host
    (a native client such as Claude Code listens there). No fragment, no
    credentials, no wildcard — matching is exact, so what is stored is
    exactly what a request must present.
    """
    uris: list[str] = []
    for value in values:
        if not isinstance(value, str):
            raise ValueError("Each redirect URI must be text")
        uri = value.strip()
        if not uri:
            continue
        if len(uri) > MAX_REDIRECT_URI_CHARS:
            raise ValueError("A redirect URI is too long")
        parts = urlsplit(uri)
        host = parts.hostname or ""
        if parts.scheme == "https" and host:
            pass
        elif parts.scheme == "http" and host in ("localhost", "127.0.0.1", "::1"):
            pass
        else:
            raise ValueError(
                f"{uri[:100]} is not allowed: use https://, or http:// on "
                "localhost for a desktop client"
            )
        if parts.fragment or "#" in uri:
            raise ValueError("A redirect URI cannot contain a fragment (#)")
        if parts.username or parts.password:
            raise ValueError("A redirect URI cannot contain credentials")
        if "*" in uri:
            raise ValueError("Wildcards are not allowed in a redirect URI")
        if uri not in uris:
            uris.append(uri)
    if not uris:
        raise ValueError("Register at least one redirect URI")
    if len(uris) > MAX_REDIRECT_URIS:
        raise ValueError(f"At most {MAX_REDIRECT_URIS} redirect URIs are allowed")
    return uris


def stored_redirect_uris(client: McpOAuthClient) -> list[str]:
    """The client's redirect URIs, read defensively (pitfall 19): anything
    but a list of strings counts as none registered, which refuses."""
    raw = client.redirect_uris
    if not isinstance(raw, list):
        return []
    return [u for u in raw if isinstance(u, str)]


def redirect_with(uri: str, params: dict[str, Optional[str]]) -> str:
    """``uri`` with ``params`` added to its query, keeping what it had."""
    parts = urlsplit(uri)
    query = parse_qsl(parts.query, keep_blank_values=True)
    query.extend((k, v) for k, v in params.items() if v is not None)
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


# ---------------------------------------------------------------------------
# What a consent would actually reach
# ---------------------------------------------------------------------------

# The gate each scope unlocks in the tool registry; ``None`` is the plain
# reads ``mcp:read`` covers.
_SCOPE_GATES: dict[str, Optional[str]] = {
    SCOPE_READ: None,
    SCOPE_WRITE: "write",
    SCOPE_FINANCE: "finance",
    SCOPE_MEDICAL: "medical_screening",
}


@lru_cache(maxsize=1)
def _tool_catalog() -> tuple[tuple[Optional[str], Optional[str], tuple[str, ...]], ...]:
    """``(gate, module, permissions)`` for every registered tool.

    Read from the registry itself rather than restated here, so the consent
    screen describes exactly what the tool gate will enforce (pitfall 29).
    """
    from app.mcp.registry import META_GATE, META_MODULE, META_PERMISSIONS
    from app.mcp.server import build_server

    catalog = []
    for tool in build_server()._tool_manager.list_tools():
        meta = tool.meta or {}
        perms = meta.get(META_PERMISSIONS)
        catalog.append(
            (
                meta.get(META_GATE),
                meta.get(META_MODULE),
                tuple(perms) if isinstance(perms, list) else (),
            )
        )
    return tuple(catalog)


def scope_reach(
    config: Any,
    enabled_modules: frozenset[str],
    permissions: frozenset[str],
    scopes: Iterable[str],
) -> dict[str, int]:
    """How many tools each scope would let this member use right now.

    The same ``gate_allows`` check every call goes through, applied to a
    principal built as ``authenticate_access_token`` would build it. A 0 is
    what the consent screen shows as "would not reach anything": the
    department has the switch off, or the member lacks the permission.
    """
    from app.mcp.registry import gate_allows

    granted = set(scopes)
    principal = McpPrincipal(
        organization_id="",
        key_id="",
        key_prefix="",
        issued_by_user_id=None,
        access_mode=(
            "read_write"
            if config.access_mode == "read_write" and SCOPE_WRITE in granted
            else "read_only"
        ),
        expose_finance=config.expose_finance and SCOPE_FINANCE in granted,
        expose_medical_screening=(
            config.expose_medical_screening and SCOPE_MEDICAL in granted
        ),
        expose_full_schedule=config.expose_full_schedule,
        enabled_modules=enabled_modules,
        auth_method="oauth",
        member_permissions=permissions,
    )
    reach: dict[str, int] = {}
    for scope in granted:
        if scope not in _SCOPE_GATES:
            continue
        gate = _SCOPE_GATES[scope]
        reach[scope] = sum(
            1
            for tool_gate, module, perms in _tool_catalog()
            if tool_gate == gate and gate_allows(principal, tool_gate, module, perms)
        )
    return reach


# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RegisteredClient:
    client: McpOAuthClient
    # Shown once, at registration; only its digest is stored.
    client_secret: Optional[str]


@dataclass(frozen=True)
class TokenSet:
    grant: McpOAuthGrant
    access_token: str
    refresh_token: str
    expires_in: int
    scope: str

    def as_response(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "token_type": "Bearer",
            "expires_in": self.expires_in,
            "refresh_token": self.refresh_token,
            "scope": self.scope,
        }


@dataclass(frozen=True)
class Decision:
    authorization: McpOAuthAuthorization
    redirect_to: str


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class McpOAuthService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -- clients -----------------------------------------------------------

    async def list_clients(self, organization_id: str) -> list[McpOAuthClient]:
        result = await self.db.execute(
            select(McpOAuthClient)
            .where(McpOAuthClient.organization_id == organization_id)
            .order_by(McpOAuthClient.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_client(
        self, organization_id: str, client_pk: str
    ) -> Optional[McpOAuthClient]:
        result = await self.db.execute(
            select(McpOAuthClient).where(
                McpOAuthClient.id == client_pk,
                McpOAuthClient.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def register_client(
        self,
        organization_id: str,
        *,
        name: str,
        redirect_uris: Iterable[Any],
        confidential: bool,
        created_by: Optional[str],
    ) -> RegisteredClient:
        """Register a client for the department. Flushes, does not commit:
        the caller commits it together with its audit entry."""
        name = (name or "").strip()
        if not name:
            raise ValueError("A client needs a name")
        uris = normalize_redirect_uris(redirect_uris)
        live = (
            await self.db.execute(
                select(func.count())
                .select_from(McpOAuthClient)
                .where(
                    McpOAuthClient.organization_id == organization_id,
                    McpOAuthClient.revoked_at.is_(None),
                )
            )
        ).scalar_one()
        if live >= MAX_CLIENTS_PER_ORG:
            raise ValueError(
                f"A department can register at most {MAX_CLIENTS_PER_ORG} "
                "clients; revoke one first"
            )
        secret = (
            f"{CLIENT_SECRET_PREFIX}{secrets.token_urlsafe(32)}"
            if confidential
            else None
        )
        client = McpOAuthClient(
            organization_id=organization_id,
            client_id=f"{CLIENT_ID_PREFIX}{secrets.token_urlsafe(18)}",
            client_secret_hash=digest(secret) if secret else None,
            name=name[:100],
            redirect_uris=uris,
            created_by=created_by,
        )
        self.db.add(client)
        await self.db.flush()
        await self.db.refresh(client)
        return RegisteredClient(client=client, client_secret=secret)

    async def revoke_client(
        self, organization_id: str, client_pk: str, *, revoked_by: Optional[str]
    ) -> tuple[Optional[McpOAuthClient], int]:
        """Revoke a client and every connection made through it.

        Returns the client (None if not in this org) and how many live
        grants were ended. Idempotent. Flushes, does not commit.
        """
        client = await self.get_client(organization_id, client_pk)
        if client is None:
            return None, 0
        now = _now()
        if client.revoked_at is None:
            client.revoked_at = now
            client.revoked_by = revoked_by
        ended = await self._revoke_where(
            McpOAuthGrant.organization_id == organization_id,
            McpOAuthGrant.client_pk == client.id,
            reason="client_revoked",
            revoked_by=revoked_by,
        )
        # A pending request or an unexchanged code for this client must not
        # outlive it either.
        await self.db.execute(
            delete(McpOAuthAuthorization).where(
                McpOAuthAuthorization.client_pk == client.id,
                McpOAuthAuthorization.status.in_(("pending", "approved")),
            )
        )
        await self.db.flush()
        return client, ended

    async def authenticate_client(
        self,
        client_id: Optional[str],
        client_secret: Optional[str],
    ) -> McpOAuthClient:
        """The client making a token or revocation request, or
        ``invalid_client``. A confidential client must present its secret; a
        public one must not present one."""
        if not client_id or len(client_id) > 64:
            raise OAuthError("invalid_client", "Unknown client", status=401)
        result = await self.db.execute(
            select(McpOAuthClient).where(McpOAuthClient.client_id == client_id)
        )
        client = result.scalar_one_or_none()
        if client is None or client.revoked_at is not None:
            raise OAuthError("invalid_client", "Unknown client", status=401)
        if client.client_secret_hash:
            if not client_secret or not _same(
                digest(client_secret), client.client_secret_hash
            ):
                raise OAuthError(
                    "invalid_client", "Client authentication failed", status=401
                )
        elif client_secret:
            raise OAuthError(
                "invalid_client",
                "This client is registered as public and has no secret",
                status=401,
            )
        return client

    # -- department --------------------------------------------------------

    async def department_allows_oauth(self, organization_id: str) -> None:
        """Raise ``McpAuthError`` unless the department lets members connect.

        Everything a service key needs, plus the department's own
        ``oauth_enabled`` switch.
        """
        config, _ = await resolve_department_access(self.db, organization_id)
        if not config.oauth_enabled:
            raise McpAuthError(
                "Connecting Claude with a member account is not enabled for this "
                "organization. An administrator can turn it on under Settings → "
                "Integrations → Claude (MCP).",
                status=403,
            )

    # -- authorization request --------------------------------------------

    async def start_authorization(
        self,
        *,
        base: str,
        client_id: Optional[str],
        redirect_uri: Optional[str],
        response_type: Optional[str],
        scope: Optional[str],
        state: Optional[str],
        code_challenge: Optional[str],
        code_challenge_method: Optional[str],
        resource: Optional[str],
    ) -> McpOAuthAuthorization:
        """Validate an /authorize request and store it for the consent screen.

        Raises ``OAuthError``; its ``redirect`` flag is False for anything
        found before the client and redirect URI are verified.
        """
        if not client_id or len(client_id) > 64:
            raise OAuthError("invalid_request", "Unknown client")
        client = (
            await self.db.execute(
                select(McpOAuthClient).where(McpOAuthClient.client_id == client_id)
            )
        ).scalar_one_or_none()
        if client is None or client.revoked_at is not None:
            raise OAuthError("invalid_request", "Unknown client")
        if not redirect_uri or redirect_uri not in stored_redirect_uris(client):
            # Exact string comparison against the registered list. Never
            # redirected to: that is the open-redirect this check prevents.
            raise OAuthError(
                "invalid_request",
                "The redirect URI is not registered for this client",
            )

        # From here an error goes back to the client's verified redirect URI.
        if state is not None and len(state) > MAX_STATE_CHARS:
            raise OAuthError("invalid_request", "state is too long", redirect=True)
        if response_type != "code":
            raise OAuthError(
                "unsupported_response_type",
                "Only the authorization code flow is supported",
                redirect=True,
            )
        if code_challenge_method != "S256":
            raise OAuthError(
                "invalid_request",
                "PKCE with code_challenge_method=S256 is required",
                redirect=True,
            )
        if not valid_challenge(code_challenge):
            raise OAuthError(
                "invalid_request", "code_challenge is malformed", redirect=True
            )
        scopes = parse_scope(scope, redirect=True)
        target = canonical_resource(resource, base)
        try:
            await self.department_allows_oauth(client.organization_id)
        except McpAuthError as exc:
            raise OAuthError("access_denied", str(exc), redirect=True)

        now = _now()
        # Bound what an unauthenticated caller can make the server store:
        # prune finished rows, then cap live requests per client.
        await self._prune_authorizations(now)
        pending = (
            await self.db.execute(
                select(func.count())
                .select_from(McpOAuthAuthorization)
                .where(
                    McpOAuthAuthorization.client_pk == client.id,
                    McpOAuthAuthorization.status == "pending",
                    McpOAuthAuthorization.expires_at > now,
                )
            )
        ).scalar_one()
        if pending >= MAX_PENDING_PER_CLIENT:
            raise OAuthError(
                "temporarily_unavailable",
                "Too many authorization requests are waiting for this client",
                redirect=True,
            )

        row = McpOAuthAuthorization(
            organization_id=client.organization_id,
            client_pk=client.id,
            redirect_uri=redirect_uri,
            scope=join_scope(scopes),
            state=state,
            code_challenge=code_challenge,
            resource=target,
            status="pending",
            expires_at=now + PENDING_REQUEST_TTL,
        )
        self.db.add(row)
        await self.db.flush()
        await self.db.refresh(row)
        return row

    async def _prune_authorizations(self, now: datetime) -> None:
        await self.db.execute(
            delete(McpOAuthAuthorization).where(
                McpOAuthAuthorization.expires_at < now - AUTHORIZATION_RETENTION
            )
        )

    async def get_pending(
        self, request_id: str, user: User, *, for_update: bool = False
    ) -> tuple[McpOAuthAuthorization, McpOAuthClient]:
        """The pending request a signed-in member is looking at.

        Org-scoped (CLAUDE.md pitfall 14): a member of another department
        gets the same ``LookupError`` as a request that does not exist.
        """
        query = select(McpOAuthAuthorization).where(
            McpOAuthAuthorization.id == request_id,
            McpOAuthAuthorization.organization_id == str(user.organization_id),
        )
        if for_update:
            query = query.with_for_update()
        row = (await self.db.execute(query)).scalar_one_or_none()
        if row is None:
            raise LookupError("This authorization request was not found")
        if row.status != "pending":
            raise ValueError("This authorization request has already been answered")
        if _expired(row.expires_at, _now()):
            raise ValueError(
                "This authorization request has expired. Start connecting again "
                "from your client."
            )
        client = await self.get_client(row.organization_id, row.client_pk)
        if client is None or client.revoked_at is not None:
            raise ValueError("This client is no longer registered")
        return row, client

    async def decide(
        self,
        request_id: str,
        user: User,
        *,
        base: str,
        approve: bool,
        scopes: Optional[Iterable[str]] = None,
    ) -> tuple[Decision, Optional[str]]:
        """Record the member's answer. Returns the decision and, on
        approval, the plaintext code (already folded into ``redirect_to``).

        ``scopes`` may only narrow what the client requested; ``mcp:read``
        is always kept. Flushes, does not commit.
        """
        # Locked so a double submit cannot mint two codes for one request.
        row, client = await self.get_pending(request_id, user, for_update=True)
        await self.department_allows_oauth(row.organization_id)
        now = _now()
        row.decided_at = now
        row.user_id = str(user.id)
        params: dict[str, Optional[str]] = {"state": row.state, "iss": issuer(base)}
        code: Optional[str] = None
        if not approve:
            row.status = "denied"
            row.expires_at = now
            params = {
                "error": "access_denied",
                "error_description": "The member declined the request",
                **params,
            }
        else:
            requested = set(row.scope.split())
            chosen = requested if scopes is None else set(scopes)
            if not chosen <= requested | {SCOPE_READ}:
                raise ValueError("You can only grant scopes the client asked for")
            chosen.add(SCOPE_READ)
            code = secrets.token_urlsafe(32)
            row.scope = join_scope(chosen)
            row.status = "approved"
            row.code_hash = digest(code)
            row.expires_at = now + CODE_TTL
            params = {"code": code, **params}
        await self.db.flush()
        return (
            Decision(
                authorization=row,
                redirect_to=redirect_with(row.redirect_uri, params),
            ),
            code,
        )

    # -- token endpoint ----------------------------------------------------

    async def exchange_code(
        self,
        client: McpOAuthClient,
        *,
        base: str,
        code: Optional[str],
        redirect_uri: Optional[str],
        code_verifier: Optional[str],
        resource: Optional[str],
    ) -> TokenSet:
        """Redeem an authorization code (RFC 6749 §4.1.3 + RFC 7636 §4.6).

        Every failure after the code is found burns it, so a code cannot be
        probed with one verifier after another. A code that was already
        redeemed revokes the grant it minted. Flushes, does not commit —
        except that a detected replay is committed by the caller even
        though the response is an error.
        """
        if not code or len(code) > 128:
            raise OAuthError("invalid_grant", "The authorization code is invalid")
        row = (
            await self.db.execute(
                select(McpOAuthAuthorization)
                .where(McpOAuthAuthorization.code_hash == digest(code))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if row is None:
            raise OAuthError("invalid_grant", "The authorization code is invalid")
        now = _now()
        if row.status in ("consumed", "failed"):
            if row.grant_id:
                await self._revoke_where(
                    McpOAuthGrant.id == row.grant_id,
                    reason="code_reuse",
                    revoked_by=None,
                )
            raise CodeReplayed(
                "invalid_grant", "The authorization code has already been used"
            )
        if row.status != "approved":
            raise OAuthError("invalid_grant", "The authorization code is invalid")

        def burn(description: str) -> OAuthError:
            row.status = "failed"
            row.consumed_at = now
            return CodeBurned("invalid_grant", description)

        if row.client_pk != client.id:
            raise burn("The code was issued to a different client")
        if _expired(row.expires_at, now):
            raise burn("The authorization code has expired")
        if redirect_uri is None or redirect_uri != row.redirect_uri:
            raise burn("redirect_uri does not match the authorization request")
        if not valid_verifier(code_verifier) or not _same(
            pkce_challenge(code_verifier or ""), row.code_challenge
        ):
            raise burn("PKCE verification failed")
        try:
            target = canonical_resource(resource, base)
        except OAuthError:
            raise burn("The requested resource is not this server's MCP endpoint")
        if target != row.resource:
            raise burn("The requested resource does not match the authorization")
        if row.user_id is None:
            raise burn("The authorization code is invalid")

        try:
            await self.department_allows_oauth(row.organization_id)
            await self._member(row.user_id, row.organization_id)
        except McpAuthError as exc:
            raise burn(str(exc))

        row.status = "consumed"
        row.consumed_at = now
        grant = McpOAuthGrant(
            organization_id=row.organization_id,
            client_pk=client.id,
            user_id=row.user_id,
            scope=row.scope,
            resource=row.resource,
            expires_at=now + GRANT_MAX_TTL,
        )
        self.db.add(grant)
        await self.db.flush()
        row.grant_id = grant.id
        tokens = self._rotate(grant, now)
        await self._cap_member_grants(grant)
        await self.db.flush()
        return tokens

    async def refresh(
        self,
        client: McpOAuthClient,
        *,
        base: str,
        refresh_token: Optional[str],
        scope: Optional[str],
    ) -> TokenSet:
        """Rotate a refresh token (OAuth 2.1 §4.3).

        A token that names a live grant but is not its current refresh token
        is a replay: the grant is revoked, so whichever party holds the
        rotated token is cut off too. ``CodeReplayed``/``RefreshReplayed``
        tell the endpoint to commit the revocation despite the error.
        """
        grant_id = parse_token(refresh_token or "", REFRESH_TOKEN_PREFIX)
        if grant_id is None:
            raise OAuthError("invalid_grant", "The refresh token is invalid")
        grant = (
            await self.db.execute(
                select(McpOAuthGrant)
                .where(McpOAuthGrant.id == grant_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if grant is None or grant.client_pk != client.id:
            raise OAuthError("invalid_grant", "The refresh token is invalid")
        if grant.revoked_at is not None:
            raise OAuthError("invalid_grant", "This connection has been revoked")
        if not _same(digest(refresh_token or ""), grant.refresh_token_hash):
            await self._revoke_where(
                McpOAuthGrant.id == grant.id,
                reason="refresh_reuse",
                revoked_by=None,
            )
            raise RefreshReplayed(
                "invalid_grant",
                "The refresh token has already been used; the connection has "
                "been revoked",
            )
        now = _now()
        if _expired(grant.refresh_expires_at, now) or _expired(grant.expires_at, now):
            raise OAuthError("invalid_grant", "The refresh token has expired")
        if grant.resource != resource_url(base):
            raise OAuthError("invalid_grant", "The refresh token is invalid")
        if scope:
            wanted = set(parse_scope(scope, redirect=False))
            held = set(grant.scope.split())
            if not wanted <= held:
                raise OAuthError(
                    "invalid_scope",
                    "A refresh cannot add scopes the member did not grant",
                )
            # Narrowing is permanent: a later refresh cannot widen it back.
            grant.scope = join_scope(wanted)
        try:
            await self.department_allows_oauth(grant.organization_id)
            await self._member(grant.user_id, grant.organization_id)
        except McpAuthError as exc:
            raise OAuthError("invalid_grant", str(exc))
        tokens = self._rotate(grant, now)
        await self.db.flush()
        return tokens

    def _rotate(self, grant: McpOAuthGrant, now: datetime) -> TokenSet:
        access = _mint_token(ACCESS_TOKEN_PREFIX, grant.id)
        refresh = _mint_token(REFRESH_TOKEN_PREFIX, grant.id)
        grant_end = _as_utc(grant.expires_at) or now
        grant.access_token_hash = digest(access)
        grant.access_expires_at = min(now + ACCESS_TOKEN_TTL, grant_end)
        grant.refresh_token_hash = digest(refresh)
        grant.refresh_expires_at = min(now + REFRESH_IDLE_TTL, grant_end)
        expires_in = int((grant.access_expires_at - now).total_seconds())
        return TokenSet(
            grant=grant,
            access_token=access,
            refresh_token=refresh,
            expires_in=max(expires_in, 0),
            scope=grant.scope,
        )

    async def _cap_member_grants(self, newest: McpOAuthGrant) -> None:
        live = (
            (
                await self.db.execute(
                    select(McpOAuthGrant)
                    .where(
                        McpOAuthGrant.user_id == newest.user_id,
                        McpOAuthGrant.client_pk == newest.client_pk,
                        McpOAuthGrant.revoked_at.is_(None),
                        McpOAuthGrant.id != newest.id,
                    )
                    .order_by(McpOAuthGrant.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        for old in live[MAX_GRANTS_PER_MEMBER_CLIENT - 1 :]:
            self._end(old, reason="superseded", revoked_by=None)

    async def revoke_token(
        self, client: McpOAuthClient, token: Optional[str]
    ) -> Optional[McpOAuthGrant]:
        """RFC 7009 revocation: either token ends the whole connection.

        Only the client the grant belongs to may revoke it; anything else is
        silently ignored, as the RFC requires for an unknown token.
        """
        presented = token or ""
        grant_id = parse_token(presented, ACCESS_TOKEN_PREFIX) or parse_token(
            presented, REFRESH_TOKEN_PREFIX
        )
        if grant_id is None:
            return None
        grant = (
            await self.db.execute(
                select(McpOAuthGrant)
                .where(McpOAuthGrant.id == grant_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if grant is None or grant.client_pk != client.id:
            return None
        hashed = digest(presented)
        if not (
            _same(hashed, grant.access_token_hash)
            or _same(hashed, grant.refresh_token_hash)
        ):
            return None
        if grant.revoked_at is None:
            self._end(grant, reason="client", revoked_by=None)
            await self.db.flush()
        return grant

    # -- grants ------------------------------------------------------------

    def _end(
        self, grant: McpOAuthGrant, *, reason: str, revoked_by: Optional[str]
    ) -> None:
        grant.revoked_at = _now()
        grant.revoked_by = revoked_by
        grant.revoked_reason = reason
        grant.access_token_hash = None
        grant.refresh_token_hash = None

    async def _revoke_where(
        self, *conditions: Any, reason: str, revoked_by: Optional[str]
    ) -> int:
        result = await self.db.execute(
            update(McpOAuthGrant)
            .where(McpOAuthGrant.revoked_at.is_(None), *conditions)
            .values(
                revoked_at=_now(),
                revoked_by=revoked_by,
                revoked_reason=reason,
                access_token_hash=None,
                refresh_token_hash=None,
            )
            .execution_options(synchronize_session="fetch")
        )
        return int(result.rowcount or 0)

    async def list_grants(
        self, organization_id: str, *, user_id: Optional[str] = None
    ) -> list[tuple[McpOAuthGrant, McpOAuthClient]]:
        """Live connections in the department, or one member's."""
        now = _now()
        query = (
            select(McpOAuthGrant, McpOAuthClient)
            .join(McpOAuthClient, McpOAuthClient.id == McpOAuthGrant.client_pk)
            .where(
                McpOAuthGrant.organization_id == organization_id,
                McpOAuthClient.organization_id == organization_id,
                McpOAuthGrant.revoked_at.is_(None),
                McpOAuthGrant.expires_at > now,
            )
            .order_by(McpOAuthGrant.created_at.desc())
        )
        if user_id is not None:
            query = query.where(McpOAuthGrant.user_id == user_id)
        rows = (await self.db.execute(query)).all()
        return [(g, c) for g, c in rows]

    async def revoke_grant(
        self,
        organization_id: str,
        grant_id: str,
        *,
        revoked_by: Optional[str],
        reason: str,
        user_id: Optional[str] = None,
    ) -> Optional[McpOAuthGrant]:
        """End one connection. Org-scoped, and member-scoped when
        ``user_id`` is given (a member revoking their own). Idempotent."""
        query = select(McpOAuthGrant).where(
            McpOAuthGrant.id == grant_id,
            McpOAuthGrant.organization_id == organization_id,
        )
        if user_id is not None:
            query = query.where(McpOAuthGrant.user_id == user_id)
        grant = (await self.db.execute(query.with_for_update())).scalar_one_or_none()
        if grant is None:
            return None
        if grant.revoked_at is None:
            self._end(grant, reason=reason, revoked_by=revoked_by)
            await self.db.flush()
        return grant

    async def revoke_all_for_user(self, user_id: str, *, reason: str) -> int:
        """End every connection a member holds (password change, account
        deactivation). Flushes, does not commit."""
        count = await self._revoke_where(
            McpOAuthGrant.user_id == str(user_id), reason=reason, revoked_by=None
        )
        if count:
            await self.db.flush()
        return count

    async def revoke_all_for_org(
        self, organization_id: str, *, revoked_by: Optional[str]
    ) -> int:
        """End every connection in the department (the integration was
        disconnected). Flushes, does not commit."""
        count = await self._revoke_where(
            McpOAuthGrant.organization_id == organization_id,
            reason="disconnected",
            revoked_by=revoked_by,
        )
        await self.db.execute(
            delete(McpOAuthAuthorization).where(
                McpOAuthAuthorization.organization_id == organization_id,
                McpOAuthAuthorization.status.in_(("pending", "approved")),
            )
        )
        await self.db.flush()
        return count

    # -- resource server ---------------------------------------------------

    async def _member(self, user_id: str, organization_id: str) -> User:
        """The consenting member, still active and still in the department."""
        user = (
            await self.db.execute(
                select(User)
                .where(
                    User.id == user_id,
                    User.organization_id == organization_id,
                    User.deleted_at.is_(None),
                )
                .options(selectinload(User.positions))
            )
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            raise McpAuthError(
                "The member account behind this connection is no longer active",
                status=401,
            )
        return user

    async def authenticate_access_token(
        self, presented: str, *, base: str, client_ip: Optional[str] = None
    ) -> McpPrincipal:
        """Resolve an OAuth access token to a principal, or ``McpAuthError``.

        The principal is rebuilt from current state on every call: the
        department's switches, the grant's scopes and the member's current
        permissions.
        """
        grant_id = parse_token(presented, ACCESS_TOKEN_PREFIX)
        if grant_id is None:
            raise McpAuthError("Invalid access token")
        grant = (
            await self.db.execute(
                select(McpOAuthGrant).where(McpOAuthGrant.id == grant_id)
            )
        ).scalar_one_or_none()
        if grant is None or not _same(digest(presented), grant.access_token_hash):
            raise McpAuthError("Invalid access token")
        now = _now()
        if grant.revoked_at is not None:
            raise McpAuthError("This connection has been revoked")
        if _expired(grant.access_expires_at, now) or _expired(grant.expires_at, now):
            raise McpAuthError("The access token has expired")
        if grant.resource != resource_url(base):
            # Audience check (RFC 8707): minted for a different address.
            raise McpAuthError("The access token was not issued for this server")
        client = (
            await self.db.execute(
                select(McpOAuthClient).where(
                    McpOAuthClient.id == grant.client_pk,
                    McpOAuthClient.organization_id == grant.organization_id,
                )
            )
        ).scalar_one_or_none()
        if client is None or client.revoked_at is not None:
            raise McpAuthError("The client behind this connection has been revoked")

        config, enabled_modules = await resolve_department_access(
            self.db, grant.organization_id
        )
        if not config.oauth_enabled:
            raise McpAuthError(
                "Connecting Claude with a member account is not enabled for this "
                "organization.",
                status=403,
            )
        user = await self._member(grant.user_id, grant.organization_id)
        from app.api.dependencies import collect_user_permissions

        permissions = frozenset(collect_user_permissions(user))
        scopes = set(grant.scope.split())
        if SCOPE_READ not in scopes:
            raise McpAuthError("The access token lacks the mcp:read scope", status=403)

        stale = (
            grant.last_used_at is None
            or (now - (_as_utc(grant.last_used_at) or now)).total_seconds()
            >= LAST_USED_THROTTLE_SECONDS
        )
        if stale:
            grant.last_used_at = now
            await self.db.commit()

        return McpPrincipal(
            organization_id=grant.organization_id,
            key_id=grant.id,
            key_prefix=f"oauth:{client.client_id[:20]}",
            issued_by_user_id=grant.user_id,
            access_mode=(
                "read_write"
                if config.access_mode == "read_write" and SCOPE_WRITE in scopes
                else "read_only"
            ),
            expose_finance=config.expose_finance and SCOPE_FINANCE in scopes,
            expose_medical_screening=(
                config.expose_medical_screening and SCOPE_MEDICAL in scopes
            ),
            expose_full_schedule=config.expose_full_schedule,
            client_ip=client_ip,
            enabled_modules=enabled_modules,
            auth_method="oauth",
            member_permissions=permissions,
            oauth_client_id=client.client_id,
        )


class CodeBurned(OAuthError):
    """A failed exchange that consumed the code; the caller commits it."""


class CodeReplayed(OAuthError):
    """A used code was presented again; the caller commits the revocation."""


class RefreshReplayed(OAuthError):
    """A rotated refresh token was presented; the caller commits the
    revocation of its grant."""
