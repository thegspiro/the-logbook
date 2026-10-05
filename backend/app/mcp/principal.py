"""
Who is calling, and what the department has allowed them.

The endpoint authenticates the bearer key once per HTTP request and binds the
resulting ``McpPrincipal`` to a context variable. Tool handlers read it back
through ``current_principal()``. A context variable rather than a request
object because the SDK runs handlers in tasks it spawns itself and, on its
stateless path, attaches no request to the handler context; a task inherits
the context of the task that started it, which is the request handler that
bound the principal. ``tests/test_mcp_transport.py`` asserts this holds on
both of the SDK's dispatch paths.
"""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Iterable, Iterator, Literal, Optional

from app.core.permissions import permission_matches_any

AccessMode = Literal["read_only", "read_write"]
# How the caller authenticated: the department's service key, or a member's
# OAuth access token.
AuthMethod = Literal["service_key", "oauth"]


@dataclass(frozen=True)
class McpPrincipal:
    organization_id: str
    key_id: str
    key_prefix: str
    # The administrator who issued the key. Write tools attribute the rows
    # they create to this member, since a service key has no member of its
    # own; NULL once that account is deleted, at which point writes refuse.
    issued_by_user_id: Optional[str]
    access_mode: AccessMode
    expose_finance: bool
    expose_medical_screening: bool
    client_ip: Optional[str] = None
    # Whether the shift tools show the whole roster. Off, they show only
    # shifts open to all members — the one set every eligible member can
    # see, since a service key has no rank or qualifications to be
    # eligible with.
    expose_full_schedule: bool = False
    # The department's enabled module keys, resolved when the key was
    # authenticated. A tool owned by a module not in this set is hidden and
    # refused, exactly as the module's API router answers 403 — switching a
    # module off must switch it off for Claude too. ``None`` means the set
    # was not resolved (tests); ``require_module`` treats that the same way.
    enabled_modules: Optional[frozenset[str]] = None
    auth_method: AuthMethod = "service_key"
    # OAuth only: the consenting member's permissions, re-read from their
    # positions and rank on every request, so a connection can never do more
    # than the member can do in the app right now. ``None`` on a service
    # key, which has no member behind it and is gated by the department's
    # switches alone.
    member_permissions: Optional[frozenset[str]] = None
    # OAuth only: the registered client the member connected.
    oauth_client_id: Optional[str] = None

    @property
    def can_write(self) -> bool:
        return self.access_mode == "read_write"

    @property
    def is_oauth(self) -> bool:
        return self.auth_method == "oauth"

    @property
    def rate_limit_bucket(self) -> str:
        """Whose request budget a call spends.

        Per member for OAuth rather than per grant, so connecting the same
        account several times does not multiply the budget.
        """
        if self.is_oauth and self.issued_by_user_id:
            return f"user:{self.issued_by_user_id}"
        return self.key_id

    def member_allows(self, permissions: Optional[Iterable[str]]) -> bool:
        """Whether the member behind an OAuth token holds one of
        ``permissions`` (OR, wildcards honoured, as ``require_permission``).

        Always true for a service key. For an OAuth principal it fails
        closed: a tool that declares no permission, or a principal whose
        permissions were never resolved, is refused.
        """
        if not self.is_oauth:
            return True
        wanted = tuple(permissions or ())
        if not wanted or self.member_permissions is None:
            return False
        return permission_matches_any(wanted, set(self.member_permissions))

    def module_enabled(self, module: Optional[str]) -> bool:
        if module is None or self.enabled_modules is None:
            return True
        return module in self.enabled_modules


_current: ContextVar[Optional[McpPrincipal]] = ContextVar("mcp_principal", default=None)


class NoPrincipalError(RuntimeError):
    """A tool ran outside an authenticated MCP request."""


def peek_principal() -> Optional[McpPrincipal]:
    """The bound principal, or None outside an authenticated request."""
    return _current.get()


def current_principal() -> McpPrincipal:
    principal = _current.get()
    if principal is None:
        raise NoPrincipalError("No MCP principal is bound to this request")
    return principal


@contextmanager
def bind_principal(principal: McpPrincipal) -> Iterator[None]:
    token = _current.set(principal)
    try:
        yield
    finally:
        _current.reset(token)
