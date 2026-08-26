"""A disabled module must not serve its API, and must not break public routes.

Hiding a module's screens is not the same as switching the module off. Before
this gate, disabling Finance removed the navigation and the dashboard cards
while ``/api/v1/finance/*`` kept answering — so a bookmarked call, a stale
browser tab or a mobile client still read and wrote finance data on a
department that had retired the feature. The route gate is client-side; only
the server can actually decline.

The second half of this file is the more valuable half. ``require_module``
resolves the organization from the caller's session, and five routes inside
gated routers have no session by design: the ballot a member votes from an
emailed link, and the Salesforce OAuth callback. Hanging the gate off the
mandatory current-user dependency turns those into 401s — a public voting
link that silently stops working. That regression is invisible in review and
would only surface as "the ballot link is broken", so it is pinned here.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from app.api.dependencies import (
    get_optional_current_user,
    require_module,
)
from app.core.database import get_db
from app.core.error_codes import CodedHTTPException, ErrorCode

ORG = "org-a"


def _app(*, user, enabled):
    """A one-route app behind the same gate the real routers mount."""
    api = FastAPI()

    @api.get("/thing", dependencies=[Depends(require_module("finance", "Finance"))])
    async def read_thing():
        return {"ok": True}

    api.dependency_overrides[get_optional_current_user] = lambda: user
    api.dependency_overrides[get_db] = lambda: SimpleNamespace()
    modules = SimpleNamespace(enabled_modules=enabled)
    return api, patch(
        "app.services.organization_service.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=modules),
    )


async def _get(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.get("/thing")


async def test_a_disabled_module_refuses_the_request():
    user = SimpleNamespace(id="u1", organization_id=ORG)
    app, modules = _app(user=user, enabled=["members", "events"])
    with modules:
        response = await _get(app)

    assert response.status_code == 403
    assert "Finance module is not enabled" in str(response.json())


async def test_the_refusal_carries_its_own_error_code():
    """Asserted on the exception, because the JSON field is added app-wide.

    ``main.py``'s StarletteHTTPException handler is what renders ``code`` into
    the body; a bare test app has no such handler, so checking the response
    here would only prove the handler was absent. What matters is that the
    raise site attaches ORG_MODULE_DISABLED rather than a bare 403 — that code
    is the whole reason a client can tell "your department switched this off"
    apart from "you lack the permission".
    """
    gate = require_module("finance", "Finance")
    with pytest.raises(CodedHTTPException) as raised:
        await gate(enabled=frozenset({"members"}))

    assert raised.value.status_code == 403
    assert raised.value.error_code is ErrorCode.ORG_MODULE_DISABLED


async def test_an_enabled_module_is_served_normally():
    """The gate has to let the enabled case through, or it is just a removal."""
    user = SimpleNamespace(id="u1", organization_id=ORG)
    app, modules = _app(user=user, enabled=["members", "finance"])
    with modules:
        response = await _get(app)

    assert response.status_code == 200
    assert response.json() == {"ok": True}


async def test_the_error_names_the_module_not_the_internal_key():
    """An officer reads this, so it says "Finance", not "finance"."""
    user = SimpleNamespace(id="u1", organization_id=ORG)
    app, modules = _app(user=user, enabled=[])
    with modules:
        body = str((await _get(app)).json())

    assert "Finance module" in body
    assert "Settings > Modules" in body


async def test_a_request_with_no_session_is_not_turned_into_a_401():
    """Public token routes live inside gated routers and must still answer.

    ``/elections/ballot/vote`` and the Salesforce OAuth callback carry no
    session — the token authorizes them. A gate built on the mandatory
    current-user dependency would reject them before their own handler ran.
    """
    app, modules = _app(user=None, enabled=[])
    # No organization lookup should even be attempted for an anonymous caller.
    with modules as mocked:
        response = await _get(app)

    assert response.status_code == 200
    mocked.assert_not_awaited()


async def test_the_module_lookup_happens_once_per_request():
    """Two gates on one request must not cost two organization reads."""
    api = FastAPI()
    gate = require_module("finance", "Finance")

    @api.get("/twice", dependencies=[Depends(gate), Depends(require_module("finance"))])
    async def twice():
        return {"ok": True}

    user = SimpleNamespace(id="u1", organization_id=ORG)
    api.dependency_overrides[get_optional_current_user] = lambda: user
    api.dependency_overrides[get_db] = lambda: SimpleNamespace()
    modules = SimpleNamespace(enabled_modules=["finance"])
    with patch(
        "app.services.organization_service.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=modules),
    ) as mocked:
        transport = ASGITransport(app=api)
        async with AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.get("/twice")

    assert response.status_code == 200
    assert mocked.await_count == 1


# ── The map itself ──────────────────────────────────────────────────────────
#
# Which API roots the module switch actually governs. Pinned rather than
# derived, because both directions of drift are silent: a new module router
# mounted without a gate serves a retired feature's data, and a gate added to
# shared infrastructure takes a working screen away from every department that
# turned one unrelated module off.

EXPECTED_GATES = {
    "/api/v1/apparatus": "apparatus",
    "/api/v1/elections": "elections",
    "/api/v1/equipment-checks": "scheduling",
    "/api/v1/facilities": "facilities",
    "/api/v1/finance": "finance",
    "/api/v1/grants": "grants",
    "/api/v1/integrations": "integrations",
    "/api/v1/inventory": "inventory",
    "/api/v1/medical-screening": "medical_screening",
    "/api/v1/medical-supplies": "medical_supplies",
    "/api/v1/meetings": "minutes",
    "/api/v1/minutes-records": "minutes",
    "/api/v1/notifications": "notifications",
    "/api/v1/prospective-members": "prospective_members",
    "/api/v1/public-portal": "public_info",
    "/api/v1/reports": "reports",
    "/api/v1/scheduling": "scheduling",
    "/api/v1/store": "storefront",
    "/api/v1/training": "training",
}

# Ungated on purpose. Each of these would break something real if gated, so
# the reason is recorded next to the exemption rather than in a commit nobody
# will find again.
DELIBERATELY_UNGATED = {
    "/api/v1/messages": "department messages render on every member's dashboard, and communications defaults off",
    "/api/v1/message-history": "email delivery diagnostics, not a module screen",
    "/api/v1/locations": "the stand-in the app serves when Facilities is off",
    "/api/v1/forms": "cross-module form builder; a core module in onboarding",
    "/api/v1/labels": "label printing for apparatus, facilities, prospects and members alike",
    "/api/v1/nfc-tags": "tag scanning shared across modules",
    "/api/v1/email-templates": "templates behind mail the app sends regardless of which screens exist",
    "/api/v1/analytics": "reads across several modules at once",
    "/api/v1/compliance": "reads across several modules at once",
    "/api/v1/admin-hours": "a real module, but it has no ModuleSettings field to gate on yet",
}


def _gate_map() -> dict:
    """Root path -> module key, read off the built application."""
    from fastapi.routing import APIRoute

    from main import app

    def expand(routes, prefix="", inherited=()):
        for route in routes:
            if type(route).__name__ == "_IncludedRouter":
                ctx = route.include_context
                yield from expand(
                    route.original_router.routes,
                    prefix + (ctx.prefix or ""),
                    tuple(inherited) + tuple(ctx.dependencies or ()),
                )
            elif isinstance(route, APIRoute):
                yield prefix + route.path, tuple(inherited)

    found: dict = {}
    for path, inherited in expand(app.routes):
        if not path.startswith("/api/v1"):
            continue
        root = "/".join(path.split("/")[:4])
        for dependency in inherited:
            call = getattr(dependency, "dependency", None)
            if getattr(call, "__name__", "") != "check_module_enabled":
                continue
            found[root] = call.required_module
    return found


def test_every_module_owned_api_root_is_gated():
    assert _gate_map() == EXPECTED_GATES


def test_the_exempt_roots_really_are_ungated():
    """An exemption that quietly acquired a gate is a broken screen."""
    gated = _gate_map()
    wrongly_gated = {
        root: gated[root] for root in DELIBERATELY_UNGATED if root in gated
    }
    assert not wrongly_gated, (
        "These roots are exempt for a documented reason but now carry a gate: "
        f"{wrongly_gated}"
    )


def test_every_gate_names_a_real_module_setting():
    """A typo'd module key would gate a router shut forever."""
    from app.schemas.organization import ModuleSettings

    unknown = set(EXPECTED_GATES.values()) - set(ModuleSettings.model_fields)
    assert not unknown, f"gates reference non-existent module fields: {unknown}"


# ── Cross-stack parity ──────────────────────────────────────────────────────


def _frontend_route_gates() -> dict:
    """module directory -> set of module keys its routes are gated on.

    Reads the .tsx as text, like test_onboarding_module_parity.py does: this
    only needs to compare identifiers, and a node round-trip from pytest would
    buy accuracy it does not need.
    """
    import re
    from pathlib import Path

    modules_dir = Path(__file__).resolve().parents[2] / "frontend" / "src" / "modules"
    assert modules_dir.is_dir(), modules_dir
    gates: dict = {}
    for routes_file in sorted(modules_dir.glob("*/routes.tsx")):
        keys = set(re.findall(r'requiredModule="(\w+)"', routes_file.read_text()))
        if keys:
            gates[routes_file.parent.name] = keys
    return gates


def test_a_gated_frontend_module_gates_every_one_of_its_routes():
    """A half-gated module is worse than an ungated one.

    One ungated route in an otherwise gated module is the bookmark that still
    works, and nothing about the screen says it should not.
    """
    import re
    from pathlib import Path

    modules_dir = Path(__file__).resolve().parents[2] / "frontend" / "src" / "modules"
    partial = {}
    for routes_file in sorted(modules_dir.glob("*/routes.tsx")):
        source = routes_file.read_text()
        protected = len(re.findall(r"<ProtectedRoute\b", source))
        gated = len(re.findall(r"requiredModule=", source))
        if gated and gated != protected:
            partial[routes_file.parent.name] = f"{gated}/{protected} gated"
    assert not partial, f"modules with some routes left ungated: {partial}"


def test_the_frontend_and_the_api_agree_on_which_modules_are_gated():
    """The two halves protect the same set, or the switch is a half-truth.

    A module gated only in the UI keeps serving its API to a bookmark or a
    stale tab — the defect this whole change exists to close. A module gated
    only in the API gives the member a broken screen instead of the
    "not enabled" explanation.
    """
    api_modules = set(EXPECTED_GATES.values())
    ui_modules = {key for keys in _frontend_route_gates().values() for key in keys}

    assert ui_modules == api_modules, (
        f"gated in the UI only: {sorted(ui_modules - api_modules)}; "
        f"gated in the API only: {sorted(api_modules - ui_modules)}"
    )
