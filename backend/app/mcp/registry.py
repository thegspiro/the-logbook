"""
The decorator every MCP tool goes through.

A tool handler is written as ``async def name(db, principal, **args)`` and
registered with ``logbook_tool``. The wrapper the SDK actually sees:

1. reads the bound principal and refuses if the tool needs a switch the
   department has not turned on (write access, finance, medical screening);
2. opens a database session for the handler;
3. passes the result through the personal-information boundary;
4. records an audit entry naming the tool, its arguments and the key.

Doing all four here rather than in each tool is what lets the test-suite
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

# The tool metadata key the server's list filter reads.
META_GATE = "logbook_gate"

ToolHandler = Callable[..., Awaitable[Any]]


def gate_allows(principal: McpPrincipal, gate: Optional[str]) -> bool:
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
    destructive: bool = False,
) -> Callable[[ToolHandler], ToolHandler]:
    """Register ``fn`` on ``server`` behind gating, redaction and audit.

    ``gate`` names the department switch the tool needs; ``None`` is a plain
    read. A ``write`` tool is also marked non-read-only for the client.
    """

    def decorator(fn: ToolHandler) -> ToolHandler:
        tool_name = name or fn.__name__
        public_sig = _public_signature(fn)

        @functools.wraps(fn)
        async def wrapper(**kwargs: Any) -> Any:
            principal = current_principal()
            if not gate_allows(principal, gate):
                raise ToolError(GATE_MESSAGES[gate or ""])
            try:
                async with open_session() as db:
                    result = await fn(db, principal, **kwargs)
                    result = redact(result)
                    await _audit(db, principal, tool_name, kwargs)
            except ToolError:
                raise
            except ValueError as exc:
                # Service-layer validation: the message is written for a
                # person and safe to relay (the same path the API takes).
                raise ToolError(safe_error_detail(exc)) from exc
            except Exception as exc:
                logger.exception("MCP tool {} failed", tool_name)
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
            meta={META_GATE: gate} if gate else None,
        )(wrapper)
        return fn

    return decorator


async def _audit(
    db: AsyncSession, principal: McpPrincipal, tool: str, arguments: dict[str, Any]
) -> None:
    # Best effort: a failed audit write must not turn a successful read into
    # an error for the client, but it must be visible in the logs.
    try:
        await log_audit_event(
            db,
            "mcp.tool_call",
            "integrations",
            "info",
            {
                "tool": tool,
                "arguments": redact(arguments),
                "key_id": principal.key_id,
                "key_prefix": principal.key_prefix,
                "access_mode": principal.access_mode,
            },
            organization_id=principal.organization_id,
            user_id=principal.issued_by_user_id,
            ip_address=principal.client_ip,
        )
        await db.commit()
    except Exception:
        logger.exception("MCP audit entry for {} could not be written", tool)
