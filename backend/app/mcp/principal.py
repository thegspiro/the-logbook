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
from typing import Iterator, Literal, Optional

AccessMode = Literal["read_only", "read_write"]


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

    @property
    def can_write(self) -> bool:
        return self.access_mode == "read_write"

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
