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
from unittest.mock import AsyncMock, MagicMock, patch

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
    # Platform, session and cross-module surfaces. None of these is owned by a
    # single module, so a gate would either be a permanent no-op (the
    # essential modules always report enabled) or would take away a surface
    # that spans modules.
    "/api/v1/": "the API root itself",
    "/api/v1/auth": "sign-in, refresh and MFA — reachable before any module is",
    "/api/v1/users": "essential module",
    "/api/v1/roles": "essential module",
    "/api/v1/organization": "essential module; also where the switch itself lives",
    "/api/v1/documents": "essential module",
    "/api/v1/events": "essential module",
    "/api/v1/event-requests": "public event requests; the form engine, not the Events screen",
    "/api/v1/officers": "roster and org structure, not a module",
    "/api/v1/operational-ranks": "roster and org structure, not a module",
    "/api/v1/org-chart": "roster and org structure, not a module",
    "/api/v1/legal-documents": "acknowledgements every member owes regardless of modules",
    "/api/v1/station-documents": "documents, an essential module",
    "/api/v1/label-preset": "label printing shared across modules",
    "/api/v1/label-printers": "label printing shared across modules",
    "/api/v1/onboarding": "first-run setup, which is what decides the modules",
    "/api/v1/audit-logs": "platform surface",
    "/api/v1/security": "platform surface",
    "/api/v1/ip-security": "platform surface",
    "/api/v1/errors": "platform surface",
    "/api/v1/platform-analytics": "platform surface",
    "/api/v1/scheduled": "platform task scheduling, unrelated to the Scheduling module",
    "/api/v1/dashboard": "spans modules; gates its own blocks one at a time",
    "/api/v1/admin-hub": "spans modules; gates its own metrics one at a time",
    "/api/v1/testing-checklist": (
        "the testing home's shared run: it lists every module's pages, "
        "including the ones a department has switched off — which is a thing "
        "a tester needs to record a result against"
    ),
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


def _all_api_roots() -> set:
    """Every ``/api/v1`` root the built application serves."""
    from fastapi.routing import APIRoute

    from main import app

    def expand(routes, prefix=""):
        for route in routes:
            if type(route).__name__ == "_IncludedRouter":
                ctx = route.include_context
                yield from expand(
                    route.original_router.routes, prefix + (ctx.prefix or "")
                )
            elif isinstance(route, APIRoute):
                yield prefix + route.path

    return {
        "/".join(path.split("/")[:4])
        for path in expand(app.routes)
        if path.startswith("/api/v1")
    }


def test_every_api_root_is_either_gated_or_a_recorded_exemption():
    """The direction the map alone cannot pin.

    ``test_every_module_owned_api_root_is_gated`` compares only the roots that
    *have* a gate, so mounting a new module router with none changes nothing
    it can see and it passes — the exact drift its docstring claims to catch.
    Requiring the two lists to partition every root is what closes that: a new
    router has to be gated or written down, and "written down" is a line in
    DELIBERATELY_UNGATED that a reviewer reads.
    """
    unaccounted = _all_api_roots() - set(EXPECTED_GATES) - set(DELIBERATELY_UNGATED)
    assert not unaccounted, (
        "These API roots are neither gated on a module nor recorded as exempt. "
        "Gate the router with module_gate(...), or add it to "
        f"DELIBERATELY_UNGATED with the reason: {sorted(unaccounted)}"
    )


def test_no_exemption_outlives_the_router_it_describes():
    """A stale exemption is a gate nobody notices is missing."""
    stale = set(DELIBERATELY_UNGATED) - _all_api_roots()
    assert not stale, f"exempted roots the app no longer serves: {sorted(stale)}"


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


# Routes inside a gated module that must stay open, each for a reason that
# would break something real if the gate were added. Two kinds:
#
#   * token-authorized public pages — the caller has no session for the gate
#     to resolve an organization from, and the token is what authorizes them;
#   * the stand-ins the app serves *because* a module is off, where gating on
#     that module would remove the fallback along with the feature.
ROUTES_OPEN_BY_DESIGN = {
    "/ballot": "public token vote from an emailed link",
    "/display/:code": "public kiosk display, no session",
    "/display/:code/events/:eventId/guest": "public kiosk display, no session",
    "/f/:slug": "public form submission; answers /api/public/v1/forms",
    "/application-status/:token": "an applicant checking their own application",
    "/locations": "the stand-in served when Facilities is off",
    "/apparatus-basic": "the stand-in served when Apparatus is off",
}


def _module_routes() -> dict:
    """module directory -> [(path, element source)] for every <Route>.

    A plain split is accurate here because no module nests routes — App.tsx
    owns the layout nesting — and ``test_module_routes_are_flat`` keeps that
    true, since a nested route would make this parse silently wrong.
    """
    import re
    from pathlib import Path

    modules_dir = Path(__file__).resolve().parents[2] / "frontend" / "src" / "modules"
    assert modules_dir.is_dir(), modules_dir
    found = {}
    for routes_file in sorted(modules_dir.glob("*/routes.tsx")):
        source = routes_file.read_text()
        routes = []
        for segment in source.split("<Route")[1:]:
            match = re.search(r'path="([^"]+)"', segment)
            if match:
                routes.append((match.group(1), segment))
        found[routes_file.parent.name] = routes
    return found


def test_module_routes_are_flat():
    """The parse above assumes it; a nested route would break it silently."""
    from pathlib import Path

    modules_dir = Path(__file__).resolve().parents[2] / "frontend" / "src" / "modules"
    nested = [
        f.parent.name
        for f in sorted(modules_dir.glob("*/routes.tsx"))
        if "</Route>" in f.read_text()
    ]
    assert not nested, (
        "these modules nest their routes, so _module_routes() no longer reads "
        f"them correctly: {nested}"
    )


# frontend/src/modules/<directory> -> the module key that directory is the
# home of. Every route under a home directory belongs to that module, so the
# completeness check below applies to all of them.
#
# A directory absent from this map is not a gated module's home. It may still
# carry a module gate on an individual route — /members/:userId/training is
# Training's data hosted on a Membership route — and that route is gated on
# its own merits without making every sibling route in Membership answerable
# to Training.
MODULE_HOME_DIRECTORIES = {
    "apparatus": "apparatus",
    "elections": "elections",
    "facilities": "facilities",
    "finance": "finance",
    "grants-fundraising": "grants",
    "integrations": "integrations",
    "inventory": "inventory",
    "medical-screening": "medical_screening",
    "medical-supplies": "medical_supplies",
    "minutes": "minutes",
    "notifications": "notifications",
    "prospective-members": "prospective_members",
    "public-portal": "public_info",
    "reports": "reports",
    "scheduling": "scheduling",
    "storefront": "storefront",
    "training": "training",
}


def test_every_api_gated_module_has_a_home_directory():
    """The map above has to cover the gated set, or the check below skips one.

    A module whose home directory is missing here is silently exempt from the
    completeness check — which is the failure mode this whole test exists to
    close, one level up.
    """
    missing = set(EXPECTED_GATES.values()) - set(MODULE_HOME_DIRECTORIES.values())
    assert not missing, (
        "these modules are gated in the API but have no frontend home "
        f"directory recorded, so their routes are not checked: {sorted(missing)}"
    )


def test_a_home_directory_names_a_module_that_exists():
    """A typo'd entry would exempt the directory it was meant to cover."""
    from app.schemas.organization import ModuleSettings

    unknown = set(MODULE_HOME_DIRECTORIES.values()) - set(ModuleSettings.model_fields)
    assert not unknown, f"home directories naming no module field: {sorted(unknown)}"


def test_a_gated_frontend_module_gates_every_one_of_its_routes():
    """A half-gated module is worse than an ungated one.

    One ungated route in an otherwise gated module is the bookmark that still
    works, and nothing about the screen says it should not.

    This counts *routes*, not ``<ProtectedRoute>`` elements. The earlier
    version compared those two counts, which meant a route carrying no
    ``<ProtectedRoute>`` at all was invisible to it — and that is where the
    real gap was: Training had fifteen member-facing routes with none, so the
    module scored as fully gated while ``/training/my-training`` loaded on a
    department that had switched Training off and then 403'd against its own
    API. Elections, Scheduling and Inventory had the same shape.

    A ``<Navigate>`` redirect needs no gate: it lands on the route it points
    at, which carries one.
    """
    partial = {}
    for directory, routes in _module_routes().items():
        if directory not in MODULE_HOME_DIRECTORIES:
            continue
        ungated = [
            path
            for path, seg in routes
            if "requiredModule=" not in seg
            and "<Navigate" not in seg
            and path not in ROUTES_OPEN_BY_DESIGN
        ]
        if ungated:
            partial[directory] = ungated
    assert not partial, (
        "routes inside a gated module with no module gate of their own. Add "
        "the gate, or record the route in ROUTES_OPEN_BY_DESIGN with the "
        f"reason it must stay open: {partial}"
    )


def test_no_route_is_exempt_after_it_stops_existing():
    """A stale exemption is a gate nobody notices is missing."""
    live = {path for routes in _module_routes().values() for path, _ in routes}
    stale = set(ROUTES_OPEN_BY_DESIGN) - live
    assert not stale, f"exempted routes no module declares any more: {sorted(stale)}"


# Gated in the UI and deliberately not in the API. One entry, and it should
# stay a short list: the asymmetry is only defensible when the flag governs a
# department's *screens* rather than the data behind them.
UI_ONLY_GATES = {
    "forms": (
        "the flag governs whether this department builds its own forms, not "
        "whether the form engine runs. Prospective Members' stage config "
        "lists published forms and FieldRenderer calls /forms/member-lookup "
        "from inside prospect applications and event requests, so gating the "
        "router breaks screens belonging to modules that are still on."
    ),
}


def test_the_frontend_and_the_api_agree_on_which_modules_are_gated():
    """The two halves protect the same set, or the switch is a half-truth.

    A module gated only in the UI keeps serving its API to a bookmark or a
    stale tab — the defect this whole change exists to close. A module gated
    only in the API gives the member a broken screen instead of the
    "not enabled" explanation.

    ``UI_ONLY_GATES`` is the exception list, and it is an exception list
    rather than a loophole: an entry has to name why the module's data is
    still needed by screens that are switched on.
    """
    api_modules = set(EXPECTED_GATES.values())
    ui_modules = {key for keys in _frontend_route_gates().values() for key in keys}

    assert ui_modules - api_modules <= set(UI_ONLY_GATES), (
        "gated in the UI only, with no recorded reason: "
        f"{sorted(ui_modules - api_modules - set(UI_ONLY_GATES))}"
    )
    assert (
        not api_modules - ui_modules
    ), f"gated in the API only: {sorted(api_modules - ui_modules)}"


def test_a_ui_only_gate_is_still_gated_somewhere_in_the_ui():
    """An exemption whose UI gate was removed is a flag that governs nothing."""
    ui_modules = {key for keys in _frontend_route_gates().values() for key in keys}
    orphaned = set(UI_ONLY_GATES) - ui_modules
    assert not orphaned, (
        "these modules are exempt from the API gate because the UI gates them, "
        f"and the UI no longer does: {sorted(orphaned)}"
    )


# ── The public portal, which the session-based gate cannot reach ────────────


async def test_the_public_portal_refuses_when_public_info_is_off():
    """``/api/public/v1`` is a second mount with API-key callers.

    ``require_module`` resolves the organization from the caller's session,
    and this router's callers are external websites holding an API key. So
    gating ``/api/v1/public-portal`` left this one serving organization
    details, events and member statistics from a module the department had
    retired — the exact "the API kept answering" defect, on the surface that
    publishes to the open internet.
    """
    from types import SimpleNamespace as NS

    from fastapi import HTTPException

    from app.api.public.portal import check_portal_enabled

    config = NS(enabled=True, organization_id="org-a")
    with patch(
        "app.services.organization_service.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=NS(enabled_modules=["members", "events"])),
    ):
        with pytest.raises(HTTPException) as raised:
            await check_portal_enabled(config, MagicMock())

    assert raised.value.status_code == 503


async def test_the_public_portal_serves_when_the_module_is_on():
    """Both switches have to hold, so the enabled case must still pass."""
    from types import SimpleNamespace as NS

    from app.api.public.portal import check_portal_enabled

    config = NS(enabled=True, organization_id="org-a")
    with patch(
        "app.services.organization_service.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=NS(enabled_modules=["members", "public_info"])),
    ):
        await check_portal_enabled(config, MagicMock())


async def test_the_portals_own_switch_still_refuses_independently():
    """The module being on does not override the portal's own off switch."""
    from types import SimpleNamespace as NS

    from fastapi import HTTPException

    from app.api.public.portal import check_portal_enabled

    config = NS(enabled=False, organization_id="org-a")
    with patch(
        "app.services.organization_service.OrganizationService.get_enabled_modules",
        new=AsyncMock(return_value=NS(enabled_modules=["public_info"])),
    ):
        with pytest.raises(HTTPException) as raised:
            await check_portal_enabled(config, MagicMock())

    assert raised.value.status_code == 503
