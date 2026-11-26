"""The page CSP allows map tiles from exactly one outside host, the one the map uses.

Outreach Impact's CRR map draws OpenStreetMap's tiles (owner decision,
2026-11-23). The tiles are images, so every Content-Security-Policy the nginx
configs send widens img-src by that one host and nothing else. If the map's
tile host and the CSP drift apart, the map is a grey box; if img-src grows a
second outside host, the policy has widened without anyone deciding to.

The department's public website (frontend/nginx.conf's second listener) is
not the application and draws no map. Its policy is told apart by its
``default-src 'none'`` and is held to the stricter rule: no outside host at
all.
"""

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

REPO = Path(__file__).resolve().parents[2]
CONFIGS = [
    REPO / "frontend" / "nginx.conf",
    REPO / "infrastructure" / "nginx" / "nginx.conf",
    REPO / "infrastructure" / "nginx" / "docker.conf",
]
MAP = REPO / "frontend" / "src" / "pages" / "community-engagement" / "CrrZipMap.tsx"
TILE_ORIGIN = "https://tile.openstreetmap.org"


_PUBLIC_WEBSITE_POLICY = "default-src 'none'"


def _policies(config: Path) -> list[str]:
    return re.findall(r'Content-Security-Policy\s+"([^"]*)"', config.read_text())


def _img_sources(config: Path) -> list[list[str]]:
    """The img-src source list of every application CSP header in one config."""
    found = []
    for header in _policies(config):
        if header.startswith(_PUBLIC_WEBSITE_POLICY):
            continue
        match = re.search(r"img-src([^;]*)", header)
        if match:
            found.append(match.group(1).split())
    return found


@pytest.mark.parametrize("config", CONFIGS, ids=lambda p: str(p.relative_to(REPO)))
def test_every_page_csp_allows_the_tile_host_and_no_other(config):
    sources = _img_sources(config)
    assert sources, f"{config} sends no CSP with an img-src"
    for listed in sources:
        outside = [s for s in listed if s.startswith("http")]
        assert outside == [TILE_ORIGIN], listed


def test_the_public_website_policy_names_no_outside_host():
    policies = [
        header
        for header in _policies(REPO / "frontend" / "nginx.conf")
        if header.startswith(_PUBLIC_WEBSITE_POLICY)
    ]
    assert len(policies) == 1
    assert "http" not in policies[0]
    assert "'unsafe-inline'" not in policies[0]
    assert "script-src" not in policies[0]


def test_the_map_requests_tiles_from_the_allowed_host():
    url = re.search(r"const TILE_URL = '([^']+)'", MAP.read_text())
    assert url is not None
    assert url.group(1).startswith(TILE_ORIGIN + "/")
