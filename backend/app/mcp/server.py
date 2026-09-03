"""
The MCP server object and its tools.

One ``LogbookMcpServer`` instance serves every organization: the SDK's
stateless streamable-HTTP mode creates a fresh transport per request, and the
organization comes from the bearer key the endpoint authenticated, not from
any server state. What differs per organization is which tools are *listed*,
which ``list_tools`` filters against the bound principal's switches; calling
a hidden tool anyway is refused by the registry wrapper.
"""

from mcp.server.mcpserver import MCPServer
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from mcp.server.transport_security import TransportSecuritySettings
from mcp_types import Tool as MCPTool

from app.core.config import settings
from app.mcp.principal import peek_principal
from app.mcp.registry import META_GATE, META_MODULE, gate_allows

SERVER_NAME = "The Logbook"

INSTRUCTIONS = """\
You are connected to a fire or emergency-services department's Logbook.
Tools answer from the department's own records: roster, events, shifts,
training and certifications, inventory, apparatus, facilities, meetings,
published minutes and documents, and elections.

Personal information is never available through this connection — no phone
numbers, email addresses, home addresses, dates of birth, emergency contacts
or medical results — so do not ask for it or try to infer it. Members are
identified by name, rank, station and position.

Dates and times are UTC ISO-8601 unless a tool says otherwise; the
department's timezone is in get_department_profile. Write tools, when the
department has enabled them, create drafts and requests for a person to
review — they never publish or approve anything on their own.
"""


class LogbookMcpServer(MCPServer):
    async def list_tools(self) -> list[MCPTool]:
        tools = await super().list_tools()
        principal = peek_principal()
        if principal is None:
            return tools
        return [
            tool
            for tool in tools
            if gate_allows(
                principal,
                (tool.meta or {}).get(META_GATE),
                (tool.meta or {}).get(META_MODULE),
            )
        ]


def build_server() -> LogbookMcpServer:
    server = LogbookMcpServer(
        name=SERVER_NAME,
        instructions=INSTRUCTIONS,
        version=settings.VERSION,
    )
    # Imported here rather than at module top so the tool modules can import
    # ``logbook_tool`` from the registry without a cycle through this module.
    from app.mcp.tools import register_all

    register_all(server)
    return server


def create_session_manager(server: LogbookMcpServer) -> StreamableHTTPSessionManager:
    """A session manager for the app lifespan to ``run()``.

    * stateless — no session ids to track across workers, so any Uvicorn
      worker or container replica can answer any request;
    * JSON responses — no server-sent events, so a reverse proxy needs no
      buffering or timeout changes for this path;
    * DNS-rebinding protection off — ``TrustedHostMiddleware`` already
      validates the Host header for the whole application, and the SDK's
      own check would reject every request arriving through a proxy with a
      public hostname it was never told about.
    """
    return StreamableHTTPSessionManager(
        app=server._lowlevel_server,
        json_response=True,
        stateless=True,
        security_settings=TransportSecuritySettings(
            enable_dns_rebinding_protection=False
        ),
    )


def tool_names(server: LogbookMcpServer) -> list[str]:
    return [t.name for t in server._tool_manager.list_tools()]
