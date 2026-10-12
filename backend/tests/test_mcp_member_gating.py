"""Member-permission gating on MCP tools.

A service key acts for the department and is gated by the department's
switches alone. A member's OAuth connection is additionally gated by the
member's own permissions, re-read per request, so the connection can never
reach a tool the member could not reach through the app. These tests pin the
two halves of that: every tool declares the permissions it needs, and the
registry refuses — fails closed — whenever an OAuth principal does not hold
one of them.
"""

from typing import Any, Optional
from unittest.mock import AsyncMock, patch

import pytest
from mcp.server.mcpserver.exceptions import ToolError

from app.core.permissions import get_all_permissions
from app.mcp.principal import AccessMode, McpPrincipal, bind_principal
from app.mcp.registry import (
    MEMBER_PERMISSION_MESSAGE,
    META_PERMISSIONS,
    gate_allows,
    logbook_tool,
)
from app.mcp.server import LogbookMcpServer, build_server

pytestmark = [pytest.mark.unit]


def _principal(
    *,
    oauth: bool,
    permissions: Optional[frozenset[str]] = None,
    access_mode: AccessMode = "read_write",
) -> McpPrincipal:
    return McpPrincipal(
        organization_id="org-a",
        key_id="grant-1" if oauth else "key-1",
        key_prefix="oauth" if oauth else "logbook_mcp_",
        issued_by_user_id="user-1",
        access_mode=access_mode,
        expose_finance=True,
        expose_medical_screening=True,
        auth_method="oauth" if oauth else "service_key",
        member_permissions=permissions,
        enabled_modules=None,
    )


class TestEveryToolDeclaresPermissions:
    def test_each_tool_names_known_permissions(self):
        known = set(get_all_permissions())
        server = build_server()
        tools = server._tool_manager.list_tools()
        assert tools, "no tools registered"
        for tool in tools:
            declared = (tool.meta or {}).get(META_PERMISSIONS)
            assert declared, f"{tool.name} declares no member permission"
            unknown = [p for p in declared if p not in known]
            assert not unknown, f"{tool.name} names unknown permissions {unknown}"

    def test_write_tools_need_a_manage_permission(self):
        server = build_server()
        for tool in server._tool_manager.list_tools():
            meta = tool.meta or {}
            if meta.get("logbook_gate") != "write":
                continue
            for perm in meta[META_PERMISSIONS]:
                assert perm.endswith(".manage"), (
                    f"write tool {tool.name} is reachable with {perm}, "
                    "which is not a manage permission"
                )

    def test_permissions_argument_is_required(self):
        server = LogbookMcpServer(name="t")
        # Spread from a dict so the omission is exercised at runtime rather
        # than rejected by the type checker first.
        without_permissions: dict[str, Any] = {"title": "t"}
        with pytest.raises(TypeError):
            logbook_tool(server, **without_permissions)


class TestGateAllows:
    def test_service_key_ignores_member_permissions(self):
        p = _principal(oauth=False)
        assert gate_allows(p, None, None, ("finance.manage",))
        assert gate_allows(p, None, None, ())

    def test_oauth_needs_one_of_the_permissions(self):
        p = _principal(oauth=True, permissions=frozenset({"events.view"}))
        assert gate_allows(p, None, None, ("events.view", "events.manage"))
        assert not gate_allows(p, None, None, ("members.view",))

    def test_oauth_honours_wildcards(self):
        assert gate_allows(
            _principal(oauth=True, permissions=frozenset({"*"})),
            None,
            None,
            ("finance.view",),
        )
        assert gate_allows(
            _principal(oauth=True, permissions=frozenset({"finance.*"})),
            None,
            None,
            ("finance.view",),
        )

    def test_oauth_fails_closed(self):
        unresolved = _principal(oauth=True, permissions=None)
        assert not gate_allows(unresolved, None, None, ("events.view",))
        holder = _principal(oauth=True, permissions=frozenset({"*"}))
        assert not gate_allows(holder, None, None, ())
        assert not gate_allows(holder, None, None, None)

    def test_department_switch_still_applies_to_oauth(self):
        p = _principal(
            oauth=True,
            permissions=frozenset({"*"}),
            access_mode="read_only",
        )
        assert not gate_allows(p, "write", None, ("events.manage",))

    def test_rate_bucket_is_per_member_for_oauth(self):
        assert _principal(oauth=True).rate_limit_bucket == "user:user-1"
        assert _principal(oauth=False).rate_limit_bucket == "key-1"


class TestListAndCall:
    async def test_list_hides_tools_the_member_cannot_reach(self):
        server = build_server()
        member = _principal(oauth=True, permissions=frozenset({"events.view"}))
        with bind_principal(member):
            names = {t.name for t in await server.list_tools()}
        assert "list_events" in names
        assert "list_members" not in names
        assert "list_budgets" not in names
        # events.view does not reach the write tool that needs events.manage.
        assert "create_event_draft" not in names

    async def test_service_key_still_sees_every_enabled_tool(self):
        server = build_server()
        with bind_principal(_principal(oauth=False)):
            names = {t.name for t in await server.list_tools()}
        assert {"list_events", "list_members", "create_event_draft"} <= names

    async def test_call_without_the_permission_is_refused_and_audited(self):
        server = LogbookMcpServer(name="t")
        handler = AsyncMock(return_value={"ok": True})

        @logbook_tool(server, permissions=("members.view",))
        async def probe(db, principal) -> dict:
            return await handler()

        audit = AsyncMock(return_value=True)
        member = _principal(oauth=True, permissions=frozenset({"events.view"}))
        with patch("app.mcp.registry._audit_apart", audit):
            with bind_principal(member):
                with pytest.raises(ToolError) as excinfo:
                    await server.call_tool("probe", {})
        assert MEMBER_PERMISSION_MESSAGE in str(excinfo.value)
        handler.assert_not_called()
        assert audit.await_args is not None
        assert audit.await_args.args[3] == "refused"
