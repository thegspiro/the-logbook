"""
The decorator every MCP tool goes through.

A tool handler is written as ``async def name(db, principal, **args)`` and
registered with ``logbook_tool``. The wrapper the SDK actually sees:

1. reads the bound principal and refuses if the tool needs a switch the
   department has not turned on (write access, finance, medical screening);
2. bounds the size of every string argument;
3. opens a database session for the handler;
4. passes the result through the personal-information boundary;
5. records an audit entry naming the tool, its (bounded) arguments, the key
   and the outcome — a refused, failed or rejected call is recorded too, so
   probing leaves a trail.

Doing all five here rather than in each tool is what lets the test-suite
prove the boundary holds for every tool at once.
"""

import functools
import inspect
from typing import Any, Awaitable, Callable, Literal, Optional

from loguru import logger
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.utils import safe_error_detail
from app.mcp.constants import (
    AUDIT_ARGUMENT_CHARS,
    AUDIT_ARGUMENT_ITEMS,
    MAX_ARGUMENT_CHARS,
)
from app.mcp.db import open_session
from app.mcp.principal import McpPrincipal, current_principal
from app.mcp.redaction import redact

Gate = Literal["write", "finance", "medical_screening"]

# What the model is told when a switch is off. Naming the screen matters: an
# operator reading the transcript should know where to turn it on rather
# than read it as a broken tool.
GATE_MESSAGES: dict[str, str] = {
    "write": (
        "This connection is read-only. An administrator can grant read/write "
        "access to Claude under Settings → Integrations → Claude (MCP)."
    ),
    "finance": (
        "Finance data is not shared with Claude. An administrator can enable "
        "it under Settings → Integrations → Claude (MCP)."
    ),
    "medical_screening": (
        "Medical screening status is not shared with Claude. An administrator "
        "can enable it under Settings → Integrations → Claude (MCP)."
    ),
}

# The tool metadata keys the server's list filter reads.
META_GATE = "logbook_gate"
META_MODULE = "logbook_module"

ToolHandler = Callable[..., Awaitable[Any]]


def module_message(module: str) -> str:
    name = module.replace("_", " ").title()
    return (
        f"The {name} module is not enabled for this organization. An "
        "administrator can turn it on under Settings → Modules."
    )


def gate_allows(
    principal: McpPrincipal, gate: Optional[str], module: Optional[str] = None
) -> bool:
    """Whether ``principal`` may see and call a tool.

    Two independent switches: the department's module enablement (the same
    flag the module's API router enforces) and the MCP-specific switch the
    tool sits behind. Both have to say yes.
    """
    if not principal.module_enabled(module):
        return False
    if gate is None:
        return True
    if gate == "write":
        return principal.can_write
    if gate == "finance":
        return principal.expose_finance
    if gate == "medical_screening":
        return principal.expose_medical_screening
    return False


def _public_signature(fn: ToolHandler) -> inspect.Signature:
    """The handler's signature minus the ``db`` and ``principal`` it is fed."""
    sig = inspect.signature(fn)
    params = list(sig.parameters.values())
    names = [p.name for p in params[:2]]
    if names != ["db", "principal"]:
        raise TypeError(
            f"MCP tool {fn.__name__} must take (db, principal, ...) — got {names}"
        )
    return sig.replace(parameters=params[2:])


def logbook_tool(
    server: Any,
    *,
    name: Optional[str] = None,
    title: Optional[str] = None,
    gate: Optional[Gate] = None,
    module: Optional[str] = None,
    destructive: bool = False,
) -> Callable[[ToolHandler], ToolHandler]:
    """Register ``fn`` on ``server`` behind gating, redaction and audit.

    ``gate`` names the MCP switch the tool needs; ``None`` is a plain read.
    ``module`` names the Logbook module that owns the data, using the same
    key the module's API router is gated on; ``None`` is an essential module
    (members, events, documents) that cannot be switched off. A ``write``
    tool is also marked non-read-only for the client.
    """

    def decorator(fn: ToolHandler) -> ToolHandler:
        tool_name = name or fn.__name__
        public_sig = _public_signature(fn)

        @functools.wraps(fn)
        async def wrapper(**kwargs: Any) -> Any:
            principal = current_principal()
            try:
                if not principal.module_enabled(module):
                    raise ToolError(module_message(module or ""))
                if not gate_allows(principal, gate):
                    raise ToolError(GATE_MESSAGES[gate or ""])
                check_argument_sizes(kwargs)
            except ToolError as exc:
                await _audit_apart(principal, tool_name, kwargs, "refused", exc)
                raise
            # A write is recorded before it is attempted: the services it
            # calls commit for themselves, so the only way to guarantee that
            # every mutation has an audit row is to refuse the mutation when
            # the row cannot be written. The outcome row follows as usual.
            if gate == "write" and not await _audit_apart(
                principal, tool_name, kwargs, "attempted", None
            ):
                raise ToolError(
                    "The audit log is unavailable, so this change was not made. "
                    "Try again later."
                )
            # A failed call is audited through a session of its own, so
            # whatever the handler wrote before failing is discarded with
            # its session and never committed alongside the audit row.
            try:
                async with open_session() as db:
                    result = await fn(db, principal, **kwargs)
                    result = redact(result)
                    await _audit(db, principal, tool_name, kwargs, "ok", None)
            except ToolError as exc:
                await _audit_apart(principal, tool_name, kwargs, "rejected", exc)
                raise
            except ValueError as exc:
                # Service-layer validation: the message is written for a
                # person and safe to relay (the same path the API takes).
                await _audit_apart(principal, tool_name, kwargs, "rejected", exc)
                raise ToolError(safe_error_detail(exc)) from exc
            except Exception as exc:
                logger.exception("MCP tool {} failed", tool_name)
                await _audit_apart(principal, tool_name, kwargs, "error", exc)
                raise ToolError(safe_error_detail(exc)) from exc
            return result

        # The SDK builds the input schema from ``inspect.signature``, which
        # honours ``__signature__``; without this the model would be asked
        # for a ``db`` argument.
        wrapper.__signature__ = public_sig  # type: ignore[attr-defined]
        annotations = {
            k: v for k, v in fn.__annotations__.items() if k not in ("db", "principal")
        }
        wrapper.__annotations__ = annotations

        server.tool(
            name=tool_name,
            title=title,
            description=inspect.getdoc(fn),
            annotations=ToolAnnotations(
                title=title,
                read_only_hint=gate != "write",
                destructive_hint=destructive,
                idempotent_hint=gate != "write",
                open_world_hint=False,
            ),
            meta=(
                {k: v for k, v in ((META_GATE, gate), (META_MODULE, module)) if v}
                or None
            ),
        )(wrapper)
        return fn

    return decorator


def check_argument_sizes(arguments: dict[str, Any]) -> None:
    """Refuse a call whose string arguments exceed ``MAX_ARGUMENT_CHARS``.

    Every tool gets this for free, so a new free-text input cannot arrive
    without a bound. Strings inside lists are checked too; the SDK has
    already rejected anything the schema does not allow.
    """
    for name, value in arguments.items():
        for text in _strings_in(value):
            if len(text) > MAX_ARGUMENT_CHARS:
                raise ToolError(
                    f"{name} is too long: at most {MAX_ARGUMENT_CHARS} "
                    "characters are accepted"
                )


def _strings_in(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [s for inner in value.values() for s in _strings_in(inner)]
    if isinstance(value, (list, tuple, set, frozenset)):
        return [s for inner in value for s in _strings_in(inner)]
    return []


def bound_for_audit(value: Any) -> Any:
    """Shrink ``value`` to what an audit row should carry.

    Strings are cut to ``AUDIT_ARGUMENT_CHARS`` with a marker, and lists and
    dicts keep their first ``AUDIT_ARGUMENT_ITEMS`` entries, recursively. The
    row then has a size bound independent of what the client sent.
    """
    if isinstance(value, str):
        if len(value) <= AUDIT_ARGUMENT_CHARS:
            return value
        return f"{value[:AUDIT_ARGUMENT_CHARS]}… [{len(value)} chars]"
    if isinstance(value, dict):
        items = list(value.items())
        bounded = {k: bound_for_audit(v) for k, v in items[:AUDIT_ARGUMENT_ITEMS]}
        if len(items) > AUDIT_ARGUMENT_ITEMS:
            bounded["…"] = f"[{len(items)} keys]"
        return bounded
    if isinstance(value, (list, tuple, set, frozenset)):
        items = list(value)
        bounded = [bound_for_audit(v) for v in items[:AUDIT_ARGUMENT_ITEMS]]
        if len(items) > AUDIT_ARGUMENT_ITEMS:
            bounded.append(f"… [{len(items)} items]")
        return bounded
    return value


Outcome = Literal["attempted", "ok", "refused", "rejected", "error"]


async def _audit_apart(
    principal: McpPrincipal,
    tool: str,
    arguments: dict[str, Any],
    outcome: Outcome,
    exc: Optional[BaseException],
) -> bool:
    """Record a call in a session of its own; True if the row was written."""
    try:
        async with open_session() as db:
            return await _audit(db, principal, tool, arguments, outcome, exc)
    except Exception:
        logger.exception("MCP audit entry for {} could not be written", tool)
        return False


def _reason(exc: BaseException) -> str:
    """What the audit row says went wrong.

    A ToolError or ValueError carries a message written for a person and
    already relayed to the client; anything else is sanitised the way the
    API sanitises it.
    """
    if isinstance(exc, (ToolError, ValueError)):
        return str(exc)
    return safe_error_detail(exc)


async def _audit(
    db: AsyncSession,
    principal: McpPrincipal,
    tool: str,
    arguments: dict[str, Any],
    outcome: Outcome,
    exc: Optional[BaseException],
) -> bool:
    """Write one ``mcp.tool_call`` row; True if it was committed.

    Best effort for a read: a failed audit write must not turn a successful
    read into an error for the client, but it must be visible in the logs.
    The outcome and a bounded reason are recorded so a key that keeps
    probing for ids it should not have leaves a trail, not silence.
    """
    try:
        payload: dict[str, Any] = {
            "tool": tool,
            "arguments": bound_for_audit(redact(arguments)),
            "key_id": principal.key_id,
            "key_prefix": principal.key_prefix,
            "access_mode": principal.access_mode,
            "outcome": outcome,
        }
        if exc is not None:
            payload["reason"] = bound_for_audit(_reason(exc))
        entry = await log_audit_event(
            db,
            "mcp.tool_call",
            "integrations",
            "info" if outcome in ("ok", "attempted") else "warning",
            payload,
            organization_id=principal.organization_id,
            user_id=principal.issued_by_user_id,
            ip_address=principal.client_ip,
        )
        if entry is None:
            logger.error("MCP audit entry for {} was not written", tool)
            return False
        await db.commit()
        return True
    except Exception:
        logger.exception("MCP audit entry for {} could not be written", tool)
        return False
