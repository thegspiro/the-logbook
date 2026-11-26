"""The public website's listener in frontend/nginx.conf.

The second server block serves the department's public website and nothing
else. Pinned: it hands every path to the backend's own router, says so with
the header that router reads, takes GET and HEAD only, and has no location
that reaches the API or the members' application.
"""

import re
from pathlib import Path

import pytest

from app.api.public import site

pytestmark = pytest.mark.unit

REPO = Path(__file__).resolve().parents[2]
CONFIG = (REPO / "frontend" / "nginx.conf").read_text()


def _public_server() -> str:
    start = CONFIG.index("listen 8080;")
    return CONFIG[CONFIG.rindex("server {", 0, start) :]


def test_it_is_the_last_server_block_and_the_only_one_on_its_port():
    assert CONFIG.count("listen 8080;") == 1
    assert _public_server().count("server {") == 1


def test_every_path_is_handed_to_the_backends_router():
    block = _public_server()
    assert f"rewrite ^(.*)$ {site.ROUTE_PREFIX}$1 break;" in block
    assert re.findall(r"^\s*location\s+(\S+)", block, re.M) == [
        "@public_site_unavailable",
        "/",
    ]


def test_it_sets_the_header_the_router_reads():
    header = re.search(r"proxy_set_header (X-Public-Site-\S+) 1;", _public_server())
    assert header is not None
    assert header.group(1).lower() == site.MAPPED_HEADER


def test_nothing_but_get_and_head_is_accepted():
    assert re.search(r"limit_except GET HEAD \{\s*deny all;\s*\}", _public_server())


def test_the_members_application_is_not_served_here():
    block = _public_server()
    assert "/api" not in re.sub(r"#.*", "", block)
    assert "try_files" not in block
    assert "index.html" not in block


def test_the_backends_own_policy_is_replaced_not_doubled():
    block = _public_server()
    assert "proxy_hide_header Content-Security-Policy;" in block
    assert block.count("add_header Content-Security-Policy") == 1
    assert "upgrade-insecure-requests" not in re.sub(r"#.*", "", block)
