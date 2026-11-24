"""The History widget page (/embed/history/<token>) is framed the same way as
an embedded form (see ``test_nginx_embed_config``): the frontend site asks the
backend which websites may frame it, and each proxy in front passes the page
through without its server-level DENY. Checked by reading the locations, since
none of these configs runs in CI."""

import re
from pathlib import Path

import pytest

from app.api.public.history import EMBED_ANCESTORS_HEADER, NO_EMBED

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND = REPO_ROOT / "frontend" / "nginx.conf"
PROXIES = {
    "host install": REPO_ROOT / "infrastructure" / "nginx" / "nginx.conf",
    "compose production profile": REPO_ROOT
    / "infrastructure"
    / "nginx"
    / "docker.conf",
}
WIDGET_OPENER = 'location ~ "^/embed/history/'
#: The widget link's secret as ``secrets.token_urlsafe(32)`` makes it, and as
#: the backend's path parameter accepts it.
TOKEN_CLASS = "[A-Za-z0-9_-]{32,64}"


def _location(config: Path, opener: str) -> str:
    text = config.read_text()
    start = text.index(opener)
    depth = 0
    for i in range(text.index(" {\n", start) + 1, len(text)):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return text[start : i + 1]
    raise AssertionError(f"unterminated location in {config}")


def test_token_class_matches_the_backend():
    from app.api.public import history

    route = next(
        r
        for r in history.open_router.routes
        if getattr(r, "path", "").endswith("/widget/{token}/embed-policy")
    )
    param = next(p for p in route.dependant.path_params if p.name == "token")
    meta = {type(m).__name__: m for m in param.field_info.metadata}
    assert meta["MinLen"].min_length == 32
    assert meta["MaxLen"].max_length == 64
    for config in (FRONTEND, *PROXIES.values()):
        assert TOKEN_CLASS in _location(config, WIDGET_OPENER).splitlines()[0]


class TestFrontendSite:
    def test_asks_the_backend_and_writes_its_answer(self):
        location = _location(FRONTEND, WIDGET_OPENER)
        assert "auth_request /_history_widget_embed_policy;" in location
        header_var = "$upstream_http_" + EMBED_ANCESTORS_HEADER.lower().replace(
            "-", "_"
        )
        assert f"auth_request_set $embed_ancestors {header_var};" in location
        assert "frame-ancestors $embed_ancestors;" in location
        assert "X-Frame-Options" not in location
        assert "(?<history_widget_token>" in location

    def test_policy_request_is_internal_and_reaches_the_endpoint(self):
        location = _location(FRONTEND, "location = /_history_widget_embed_policy")
        assert "internal;" in location
        assert (
            "rewrite ^ /api/public/v1/history/widget/$history_widget_token"
            "/embed-policy break;"
        ) in location

    def test_keeps_a_strict_policy(self):
        location = _location(FRONTEND, WIDGET_OPENER)
        policy = re.search(r'Content-Security-Policy "([^"]+)"', location)
        assert policy is not None
        assert "script-src 'self';" in policy.group(1)
        assert "object-src 'none'" in policy.group(1)

    def test_refusal_is_none(self):
        assert NO_EMBED == "'none'"


@pytest.mark.parametrize("config", list(PROXIES.values()), ids=list(PROXIES))
class TestProxies:
    def test_does_not_inherit_deny(self, config):
        location = _location(config, WIDGET_OPENER)
        assert "add_header Strict-Transport-Security" in location
        assert "X-Frame-Options" not in location
        assert "frame-ancestors" not in location

    def test_proxies_directly(self, config):
        location = _location(config, WIDGET_OPENER)
        assert "proxy_pass http://frontend_app;" in location
        assert "@frontend" not in location
