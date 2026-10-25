"""The /embed/f/<slug> page is the one page another site may frame.

Every nginx config that serves the app adds X-Frame-Options DENY and
frame-ancestors 'none' at server level, and a browser enforces every policy it
receives — so a single config left inheriting those blocks the embed whatever
the department allowed, and nothing errors to say so. Checked by reading the
locations themselves, since none of these configs runs in CI.

Verified by hand against a running nginx (frontend site behind each proxy,
with a stand-in backend) when written: the embed page carried only the
backend's answer, every other page kept DENY, and a backend that could not be
reached failed the page with a 500.
"""

import re
from pathlib import Path

import pytest

from app.api.public.forms import EMBED_ANCESTORS_HEADER, SLUG_PATTERN

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


def _location(config: Path, opener: str) -> str:
    """The body of the location whose opening line starts with *opener*."""
    text = config.read_text()
    start = text.index(opener)
    depth = 0
    # The block opens at the end of the line: a regex's own {12} must not count.
    for i in range(text.index(" {\n", start) + 1, len(text)):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return text[start : i + 1]
    raise AssertionError(f"unterminated location in {config}")


def _embed_location(config: Path) -> str:
    return _location(config, 'location ~ "^/embed/f/')


def _slug_class(location: str) -> str:
    match = re.search(r"\[(a-f0-9)\]\{(\d+)\}", location)
    assert match, location.splitlines()[0]
    return f"[{match.group(1)}]{{{match.group(2)}}}"


def test_slug_pattern_matches_the_backend():
    assert SLUG_PATTERN.pattern == r"^[a-f0-9]{12}$"
    for config in (FRONTEND, *PROXIES.values()):
        assert _slug_class(_embed_location(config)) == "[a-f0-9]{12}", config


class TestFrontendSite:
    def test_asks_the_backend_and_writes_its_answer(self):
        location = _embed_location(FRONTEND)
        assert "auth_request /_embed_policy;" in location
        header_var = "$upstream_http_" + EMBED_ANCESTORS_HEADER.lower().replace(
            "-", "_"
        )
        assert f"auth_request_set $embed_ancestors {header_var};" in location
        assert "frame-ancestors $embed_ancestors;" in location

    def test_sends_no_deny(self):
        location = _embed_location(FRONTEND)
        assert "X-Frame-Options" not in location
        assert "frame-ancestors 'none'" not in location

    def test_keeps_the_rest_of_the_policy(self):
        location = _embed_location(FRONTEND)
        for header in (
            "X-Content-Type-Options",
            "Referrer-Policy",
            "Strict-Transport-Security",
            "Cache-Control",
        ):
            assert f"add_header {header}" in location, header
        assert "script-src 'self';" in location
        assert "form-action 'self'" in location

    def test_policy_request_is_internal_and_reaches_the_endpoint(self):
        location = _location(FRONTEND, "location = /_embed_policy")
        assert "internal;" in location
        assert (
            "rewrite ^ /api/public/v1/forms/$embed_slug/embed-policy break;" in location
        )
        # setup-ssl.sh rewrites exactly this string for a host install.
        assert "proxy_pass http://backend:3001;" in location
        assert "(?<embed_slug>" in _embed_location(FRONTEND)


@pytest.mark.parametrize("config", list(PROXIES.values()), ids=list(PROXIES))
class TestProxies:
    def test_embed_location_does_not_inherit_deny(self, config):
        location = _embed_location(config)
        # One add_header of its own is what stops the server-level ones being
        # inherited; DENY must not be among them.
        assert "add_header Strict-Transport-Security" in location
        assert "X-Frame-Options" not in location
        assert "frame-ancestors" not in location

    def test_proxies_directly_rather_than_through_a_named_location(self, config):
        # A request handed to @frontend takes @frontend's headers, which
        # inherit the server's DENY.
        location = _embed_location(config)
        assert "proxy_pass http://frontend_app;" in location
        assert "@frontend" not in location

    def test_everything_else_still_denies(self, config):
        text = config.read_text()
        assert 'add_header X-Frame-Options "DENY" always;' in text
