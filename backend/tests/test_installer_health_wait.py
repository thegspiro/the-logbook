"""The universal installer's wait for a healthy backend must be able to succeed.

It probed with `curl` inside the backend container, and the backend image has
no curl, so the probe failed on every attempt: every install waited out the
full timeout and ended with "Services may still be starting". These tests run
the installer's own wait_for_services() with docker stubbed out.
"""

import re
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]
UNIVERSAL_INSTALL = REPO / "scripts" / "universal-install.sh"
BACKEND_DOCKERFILE = REPO / "backend" / "Dockerfile"

_LOG_STUBS = """
log_info() { echo "INFO:$1"; }
log_success() { echo "OK:$1"; }
log_warning() { echo "WARN:$1"; }
sleep() { :; }
"""


def _wait_for_services() -> str:
    source = UNIVERSAL_INSTALL.read_text()
    match = re.search(r"^wait_for_services\(\) \{.*?^\}\n", source, re.S | re.M)
    assert match, "wait_for_services() not found in universal-install.sh"
    return match.group(0)


def _run(docker_stub: str) -> subprocess.CompletedProcess:
    script = (
        _LOG_STUBS
        + docker_stub
        + _wait_for_services()
        + "COMPOSE_FILE_ARGS=(-f a.yml)\nwait_for_services\n"
    )
    return subprocess.run(
        ["bash", "-c", script], capture_output=True, text=True, timeout=20
    )


@pytest.mark.unit
class TestInstallerHealthWait:
    def test_a_healthy_backend_is_reported_healthy(self):
        # A stand-in for the backend container: it has python, not curl.
        stub = """
docker() {
    case "$*" in
        *" exec -T backend python -c "*) return 0 ;;
        *) return 127 ;;
    esac
}
"""
        result = _run(stub)

        assert result.returncode == 0, result.stderr
        assert "OK:Backend is healthy" in result.stdout
        assert "Services may still be starting" not in result.stdout

    def test_an_unhealthy_backend_still_times_out_with_a_warning(self):
        result = _run("docker() { return 1; }\n")

        assert result.returncode == 0, result.stderr
        assert "OK:Backend is healthy" not in result.stdout
        assert "WARN:Services may still be starting" in result.stdout

    def test_probe_matches_the_backend_images_own_healthcheck(self):
        # Both probe the same endpoint the same way, so the installer cannot
        # call a backend healthy that the container itself reports unhealthy.
        probe = (
            "import requests; r = requests.get('http://localhost:3001/health', "
            "timeout=5); exit(0 if r.status_code == 200 else 1)"
        )
        assert probe in BACKEND_DOCKERFILE.read_text()
        assert probe in _wait_for_services()
        assert "exec -T backend curl" not in UNIVERSAL_INSTALL.read_text()
