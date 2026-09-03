"""Tool registrations, one module per Logbook domain.

``register_all`` is the single place a new tool module is added. Order is
the order tools are listed to the client, so the modules a model reaches
for first (profile, roster, calendar) come first.
"""

from typing import Any

from app.mcp.tools import (
    apparatus,
    documents,
    elections,
    events,
    facilities,
    finance,
    inventory,
    medical,
    meetings,
    members,
    organization,
    scheduling,
    training,
    writes,
)

TOOL_MODULES = (
    organization,
    members,
    events,
    scheduling,
    training,
    inventory,
    apparatus,
    facilities,
    meetings,
    documents,
    elections,
    finance,
    medical,
    writes,
)


def register_all(server: Any) -> None:
    for module in TOOL_MODULES:
        module.register(server)
