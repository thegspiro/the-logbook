"""The nginx configs must agree with the backend on two things.

Which requests are never logged: the anonymous side of the suggestion box is
excluded by UNLOGGED_PATH in the backend and, separately, by a `map` and a
nested location in each nginx config — plus the frontend's UNREPORTED_REQUEST
for error reports. A route added to one and not the others would quietly log
anonymous submitters again, so each copy is checked here by what it *does* to a
set of paths, not by comparing pattern text.

How large a request may be: a proxy that refuses less than the backend's
MAX_REQUEST_BODY_SIZE rejects uploads the backend is built to accept, which is
how the frontend container came to refuse every screenshot over 1 MB.
"""

import re
from pathlib import Path

import pytest

from app.core.config import Settings
from app.core.logging import is_unlogged_path

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[2]

NGINX_CONFIGS = {
    "frontend container": REPO_ROOT / "frontend" / "nginx.conf",
    "host install": REPO_ROOT / "infrastructure" / "nginx" / "nginx.conf",
    "compose production profile": REPO_ROOT
    / "infrastructure"
    / "nginx"
    / "docker.conf",
}
# The AWS guide's host nginx: a documented snippet, with the map and the body
# limit but no nested location.
AWS_GUIDE = REPO_ROOT / "docs" / "deployment" / "aws.md"
ERROR_REPORTING_TS = REPO_ROOT / "frontend" / "src" / "services" / "errorReporting.ts"

# Paths as the backend sees them (no query string).
SAMPLE_PATHS = [
    "/api/v1/suggestions/boxes/6f1c2d3e-0000-4000-8000-000000000001/submissions",
    "/api/v1/suggestions/follow-up/lookup",
    "/api/v1/suggestions/follow-up/messages",
    "/api/v1/suggestions/follow-up/attachments/a1",
    "/api/v1/suggestions/boxes",
    "/api/v1/suggestions/boxes/b1",
    "/api/v1/suggestions/boxes/b1/submissions/extra",
    "/api/v1/suggestions/boxes/b1/submissionsx",
    "/api/v1/suggestions/mine",
    "/api/v1/suggestions/mine/s1/messages",
    "/api/v1/suggestions/review/s1",
    "/api/v1/suggestions/follow-up",
    "/api/v1/events",
    "/",
]

_MAP_RE = re.compile(
    r'map \$request_uri \$access_loggable \{\s*"~(?P<pattern>[^"]+)" 0;\s*default 1;'
)
_NESTED_LOCATION_RE = re.compile(
    r"location ~ (?P<pattern>\^/api/v1/suggestions/\S+) \{"
)
_BODY_SIZE_RE = re.compile(r"client_max_body_size\s+(?P<n>\d+)(?P<unit>[kKmMgG]?);")
_UNITS = {"": 1, "k": 1024, "m": 1024**2, "g": 1024**3}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _map_pattern(path: Path) -> re.Pattern[str]:
    match = _MAP_RE.search(_read(path))
    assert match, f"{path.relative_to(REPO_ROOT)} has no $access_loggable map"
    return re.compile(match.group("pattern"))


def _files_with_map() -> list[Path]:
    return [*NGINX_CONFIGS.values(), AWS_GUIDE]


@pytest.mark.parametrize("config", _files_with_map(), ids=lambda p: p.name)
class TestAccessLogMap:
    @pytest.mark.parametrize("path", SAMPLE_PATHS)
    def test_agrees_with_unlogged_path(self, config, path):
        pattern = _map_pattern(config)
        assert bool(pattern.search(path)) == is_unlogged_path(path)

    @pytest.mark.parametrize("path", SAMPLE_PATHS)
    def test_a_query_string_does_not_change_the_verdict(self, config, path):
        # $request_uri carries the query string; the backend decides on the
        # path alone.
        pattern = _map_pattern(config)
        assert bool(pattern.search(f"{path}?page=2")) == is_unlogged_path(path)


@pytest.mark.parametrize("config", NGINX_CONFIGS.values(), ids=NGINX_CONFIGS.keys())
@pytest.mark.parametrize("path", SAMPLE_PATHS)
def test_quiet_error_log_location_agrees_with_unlogged_path(config, path):
    match = _NESTED_LOCATION_RE.search(_read(config))
    assert match, f"{config.relative_to(REPO_ROOT)} has no anonymous-route location"
    assert bool(re.search(match.group("pattern"), path)) == is_unlogged_path(path)


@pytest.mark.parametrize("path", SAMPLE_PATHS)
def test_frontend_error_report_filter_agrees_with_unlogged_path(path):
    match = re.search(
        r"const UNREPORTED_REQUEST = /(?P<pattern>.+)/;", _read(ERROR_REPORTING_TS)
    )
    assert match, "UNREPORTED_REQUEST not found in errorReporting.ts"
    pattern = re.compile(match.group("pattern"))
    # The frontend reports a path relative to its /api/v1 baseURL.
    relative = path.removeprefix("/api/v1")
    assert bool(pattern.search(relative)) == is_unlogged_path(path)


@pytest.mark.parametrize("config", _files_with_map(), ids=lambda p: p.name)
def test_body_limit_matches_the_backend(config):
    ceiling = Settings.model_fields["MAX_REQUEST_BODY_SIZE"].default
    limits = [
        int(m.group("n")) * _UNITS[m.group("unit").lower()]
        for m in _BODY_SIZE_RE.finditer(_read(config))
    ]
    assert limits, f"{config.relative_to(REPO_ROOT)} sets no client_max_body_size"
    assert all(limit == ceiling for limit in limits), limits
