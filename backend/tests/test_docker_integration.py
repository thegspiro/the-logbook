"""
Docker Integration Tests (Container-Level)

These tests validate that Docker images build correctly and containers start
up healthy. They require a running Docker daemon and will be SKIPPED
automatically if Docker is not available.

Run with:
    pytest tests/test_docker_integration.py -v -m docker

Note: These tests are slower than unit tests because they build images and
start containers. They are marked with the 'docker' marker so they can be
run or excluded selectively.
"""

import os
import json
import time
import shutil
import subprocess
import pytest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]  # the-logbook/
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"

# ---------------------------------------------------------------------------
# Skip entire module if Docker is unavailable
# ---------------------------------------------------------------------------

_docker_available = shutil.which("docker") is not None


def _docker_daemon_running() -> bool:
    """Check if the Docker daemon is actually running."""
    if not _docker_available:
        return False
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


_docker_ready = _docker_daemon_running()

pytestmark = [
    pytest.mark.docker,
    pytest.mark.integration,
    pytest.mark.slow,
    pytest.mark.skipif(
        not _docker_ready,
        reason="Docker daemon is not available — skipping container tests",
    ),
]

# Test-specific image tag prefix to avoid clashing with real builds
_TAG_PREFIX = "logbook-test"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(cmd: list[str], *, timeout: int = 300, **kwargs) -> subprocess.CompletedProcess:
    """Run a subprocess and return the result."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        **kwargs,
    )


def _docker_build(context: Path, target: str | None = None, tag: str = "") -> subprocess.CompletedProcess:
    """Build a Docker image and return the result."""
    cmd = ["docker", "build", str(context)]
    if target:
        cmd += ["--target", target]
    if tag:
        cmd += ["-t", tag]
    # Don't pull to avoid network dependency — use cached base images
    return _run(cmd, timeout=600)


def _docker_rm_image(tag: str):
    """Remove a Docker image (best-effort, ignore errors)."""
    _run(["docker", "rmi", "-f", tag], timeout=30)


def _docker_stop_rm(container: str):
    """Stop and remove a container (best-effort)."""
    _run(["docker", "stop", container], timeout=30)
    _run(["docker", "rm", "-f", container], timeout=10)


def _docker_inspect(name: str) -> dict:
    """Docker inspect returning parsed JSON for a container or image."""
    result = _run(["docker", "inspect", name])
    if result.returncode != 0:
        return {}
    data = json.loads(result.stdout)
    return data[0] if data else {}


def _wait_for_healthy(container: str, timeout: int = 120) -> bool:
    """
    Wait until a container's health status becomes 'healthy'.
    Returns True if healthy within timeout, False otherwise.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        info = _docker_inspect(container)
        state = info.get("State", {})
        health = state.get("Health", {})
        status = health.get("Status", "")
        if status == "healthy":
            return True
        if state.get("Status") == "exited":
            return False
        time.sleep(2)
    return False


# ===========================================================================
# Backend Image Build Tests
# ===========================================================================


class TestBackendImageBuild:
    """Test that the backend Docker image builds successfully for each stage."""

    def test_build_base_stage(self):
        tag = f"{_TAG_PREFIX}-backend-base"
        try:
            result = _docker_build(BACKEND_DIR, target="base", tag=tag)
            assert result.returncode == 0, (
                f"Backend 'base' stage failed to build:\n{result.stderr[-2000:]}"
            )
        finally:
            _docker_rm_image(tag)

    def test_build_dependencies_stage(self):
        tag = f"{_TAG_PREFIX}-backend-deps"
        try:
            result = _docker_build(BACKEND_DIR, target="dependencies", tag=tag)
            assert result.returncode == 0, (
                f"Backend 'dependencies' stage failed to build:\n{result.stderr[-2000:]}"
            )
        finally:
            _docker_rm_image(tag)

    def test_build_development_stage(self):
        tag = f"{_TAG_PREFIX}-backend-dev"
        try:
            result = _docker_build(BACKEND_DIR, target="development", tag=tag)
            assert result.returncode == 0, (
                f"Backend 'development' stage failed to build:\n{result.stderr[-2000:]}"
            )
        finally:
            _docker_rm_image(tag)

    def test_build_production_stage(self):
        tag = f"{_TAG_PREFIX}-backend-prod"
        try:
            result = _docker_build(BACKEND_DIR, target="production", tag=tag)
            assert result.returncode == 0, (
                f"Backend 'production' stage failed to build:\n{result.stderr[-2000:]}"
            )
        finally:
            _docker_rm_image(tag)

    def test_production_image_has_healthcheck(self):
        tag = f"{_TAG_PREFIX}-backend-hc"
        try:
            result = _docker_build(BACKEND_DIR, target="production", tag=tag)
            if result.returncode != 0:
                pytest.skip("Image build failed — cannot inspect")
            info = _docker_inspect(tag)
            config = info.get("Config", {})
            hc = config.get("Healthcheck", {})
            assert hc, "Production image must have a HEALTHCHECK configured"
            test_cmd = hc.get("Test", [])
            assert any("/health" in part for part in test_cmd), (
                f"HEALTHCHECK must target /health, got: {test_cmd}"
            )
        finally:
            _docker_rm_image(tag)

    def test_production_image_exposes_port(self):
        tag = f"{_TAG_PREFIX}-backend-port"
        try:
            result = _docker_build(BACKEND_DIR, target="production", tag=tag)
            if result.returncode != 0:
                pytest.skip("Image build failed — cannot inspect")
            info = _docker_inspect(tag)
            config = info.get("Config", {})
            exposed = config.get("ExposedPorts", {})
            assert "3001/tcp" in exposed, (
                f"Production image must expose port 3001, got: {list(exposed.keys())}"
            )
        finally:
            _docker_rm_image(tag)

    def test_production_image_runs_as_non_root(self):
        tag = f"{_TAG_PREFIX}-backend-user"
        try:
            result = _docker_build(BACKEND_DIR, target="production", tag=tag)
            if result.returncode != 0:
                pytest.skip("Image build failed — cannot inspect")
            info = _docker_inspect(tag)
            config = info.get("Config", {})
            user = config.get("User", "")
            assert user and user != "root" and user != "0", (
                f"Production image should run as non-root user, got: '{user}'"
            )
        finally:
            _docker_rm_image(tag)


# ===========================================================================
# Frontend Image Build Tests
# ===========================================================================


class TestFrontendImageBuild:
    """Test that the frontend Docker image builds successfully."""

    def test_build_development_stage(self):
        tag = f"{_TAG_PREFIX}-frontend-dev"
        try:
            result = _docker_build(FRONTEND_DIR, target="development", tag=tag)
            assert result.returncode == 0, (
                f"Frontend 'development' stage failed to build:\n{result.stderr[-2000:]}"
            )
        finally:
            _docker_rm_image(tag)

    def test_build_production_stage(self):
        tag = f"{_TAG_PREFIX}-frontend-prod"
        try:
            result = _docker_build(FRONTEND_DIR, target="production", tag=tag)
            assert result.returncode == 0, (
                f"Frontend 'production' stage failed to build:\n{result.stderr[-2000:]}"
            )
        finally:
            _docker_rm_image(tag)

    def test_production_image_has_healthcheck(self):
        tag = f"{_TAG_PREFIX}-frontend-hc"
        try:
            result = _docker_build(FRONTEND_DIR, target="production", tag=tag)
            if result.returncode != 0:
                pytest.skip("Image build failed — cannot inspect")
            info = _docker_inspect(tag)
            config = info.get("Config", {})
            hc = config.get("Healthcheck", {})
            assert hc, "Frontend production image must have a HEALTHCHECK"
        finally:
            _docker_rm_image(tag)

    def test_production_image_exposes_port_80(self):
        tag = f"{_TAG_PREFIX}-frontend-port"
        try:
            result = _docker_build(FRONTEND_DIR, target="production", tag=tag)
            if result.returncode != 0:
                pytest.skip("Image build failed — cannot inspect")
            info = _docker_inspect(tag)
            config = info.get("Config", {})
            exposed = config.get("ExposedPorts", {})
            assert "80/tcp" in exposed, (
                f"Frontend image must expose port 80, got: {list(exposed.keys())}"
            )
        finally:
            _docker_rm_image(tag)


# ===========================================================================
# Container Startup & Health Tests
# ===========================================================================


class TestBackendContainerHealth:
    """
    Test that the backend container starts and reaches a healthy state.

    Note: The full health check requires MySQL and Redis. These tests run
    the backend in isolation to verify the container *starts* and responds
    on port 3001 — the health endpoint may report "degraded" without
    dependencies, but the container itself should be functional.
    """

    _tag = f"{_TAG_PREFIX}-backend-health"
    _container = f"{_TAG_PREFIX}-backend-health-ctr"

    @pytest.fixture(autouse=True)
    def build_and_cleanup(self):
        """Build the image once, clean up container after each test."""
        result = _docker_build(BACKEND_DIR, target="production", tag=self._tag)
        if result.returncode != 0:
            pytest.skip(f"Backend build failed: {result.stderr[-500:]}")
        yield
        _docker_stop_rm(self._container)
        _docker_rm_image(self._tag)

    def test_container_starts_without_crash(self):
        """Container should start and stay running (not exit immediately)."""
        result = _run([
            "docker", "run", "-d",
            "--name", self._container,
            "-e", "ENVIRONMENT=development",
            "-e", "SECRET_KEY=test-secret-key-for-docker-integration",
            "-e", "ENCRYPTION_KEY=test-encryption-key-1234567890abcdef",
            "-e", "ENCRYPTION_SALT=test-salt-value",
            "-e", "DB_HOST=localhost",
            "-e", "DB_NAME=test_db",
            "-e", "DB_USER=test_user",
            "-e", "DB_PASSWORD=test_pass",
            self._tag,
        ])
        assert result.returncode == 0, f"Container failed to start: {result.stderr}"

        # Give it a few seconds to potentially crash
        time.sleep(5)

        info = _docker_inspect(self._container)
        state = info.get("State", {})
        running = state.get("Running", False)
        exit_code = state.get("ExitCode", -1)

        # The container may not be fully healthy (no DB) but it should
        # at least be running — not crashed with a non-zero exit code
        if not running:
            logs = _run(["docker", "logs", "--tail", "50", self._container])
            pytest.fail(
                f"Container exited with code {exit_code}. "
                f"Last logs:\n{logs.stdout[-2000:]}\n{logs.stderr[-2000:]}"
            )

    def test_container_listens_on_port(self):
        """Container should accept TCP connections on port 3001."""
        result = _run([
            "docker", "run", "-d",
            "--name", self._container,
            "-p", "13001:3001",
            "-e", "ENVIRONMENT=development",
            "-e", "SECRET_KEY=test-secret-key-for-docker-integration",
            "-e", "ENCRYPTION_KEY=test-encryption-key-1234567890abcdef",
            "-e", "ENCRYPTION_SALT=test-salt-value",
            "-e", "DB_HOST=localhost",
            "-e", "DB_NAME=test_db",
            "-e", "DB_USER=test_user",
            "-e", "DB_PASSWORD=test_pass",
            self._tag,
        ])
        if result.returncode != 0:
            pytest.skip(f"Container failed to start: {result.stderr}")

        # Wait for the server to bind
        deadline = time.time() + 30
        listening = False
        while time.time() < deadline:
            check = _run([
                "docker", "exec", self._container,
                "python", "-c",
                "import socket; s=socket.socket(); s.settimeout(2); s.connect(('127.0.0.1',3001)); s.close(); print('OK')",
            ], timeout=10)
            if check.returncode == 0 and "OK" in check.stdout:
                listening = True
                break
            time.sleep(2)

        assert listening, "Backend container did not start listening on port 3001 within 30s"


class TestFrontendContainerHealth:
    """Test that the frontend container starts and serves content."""

    _tag = f"{_TAG_PREFIX}-frontend-health"
    _container = f"{_TAG_PREFIX}-frontend-health-ctr"

    @pytest.fixture(autouse=True)
    def build_and_cleanup(self):
        result = _docker_build(FRONTEND_DIR, target="production", tag=self._tag)
        if result.returncode != 0:
            pytest.skip(f"Frontend build failed: {result.stderr[-500:]}")
        yield
        _docker_stop_rm(self._container)
        _docker_rm_image(self._tag)

    def test_container_starts_without_crash(self):
        result = _run([
            "docker", "run", "-d",
            "--name", self._container,
            self._tag,
        ])
        assert result.returncode == 0, f"Container failed to start: {result.stderr}"

        time.sleep(3)

        info = _docker_inspect(self._container)
        state = info.get("State", {})
        running = state.get("Running", False)

        if not running:
            logs = _run(["docker", "logs", "--tail", "50", self._container])
            pytest.fail(
                f"Frontend container crashed. "
                f"Logs:\n{logs.stdout[-2000:]}\n{logs.stderr[-2000:]}"
            )

    def test_nginx_serves_index(self):
        """Frontend container should serve index.html on port 80."""
        result = _run([
            "docker", "run", "-d",
            "--name", self._container,
            self._tag,
        ])
        if result.returncode != 0:
            pytest.skip(f"Container failed to start: {result.stderr}")

        # Wait for nginx to be ready
        deadline = time.time() + 20
        served = False
        while time.time() < deadline:
            check = _run([
                "docker", "exec", self._container,
                "wget", "--quiet", "--tries=1", "--spider",
                "http://localhost/",
            ], timeout=10)
            if check.returncode == 0:
                served = True
                break
            time.sleep(2)

        assert served, "Frontend container did not serve content on port 80 within 20s"

    def test_frontend_becomes_healthy(self):
        """Frontend container should pass its own HEALTHCHECK."""
        result = _run([
            "docker", "run", "-d",
            "--name", self._container,
            "--health-interval=5s",
            "--health-timeout=3s",
            "--health-start-period=5s",
            "--health-retries=3",
            self._tag,
        ])
        if result.returncode != 0:
            pytest.skip(f"Container failed to start: {result.stderr}")

        healthy = _wait_for_healthy(self._container, timeout=60)
        assert healthy, "Frontend container did not become healthy within 60s"


# ===========================================================================
# Docker Compose Config Validation Tests
# ===========================================================================


class TestDockerComposeConfig:
    """
    Validate docker-compose configuration using 'docker compose config'.
    This catches variable interpolation errors, invalid references, and
    schema issues that static YAML parsing alone cannot detect.
    """

    _compose_available = shutil.which("docker") is not None

    @pytest.mark.skipif(
        not _compose_available,
        reason="docker compose not available",
    )
    def test_main_compose_validates(self):
        result = _run(
            ["docker", "compose", "-f", "docker-compose.yml", "config", "--quiet"],
            timeout=30,
            cwd=str(ROOT_DIR),
        )
        assert result.returncode == 0, (
            f"docker-compose.yml failed validation:\n{result.stderr}"
        )

    @pytest.mark.skipif(
        not _compose_available,
        reason="docker compose not available",
    )
    def test_minimal_compose_validates(self):
        result = _run(
            [
                "docker", "compose",
                "-f", "docker-compose.yml",
                "-f", "docker-compose.minimal.yml",
                "config", "--quiet",
            ],
            timeout=30,
            cwd=str(ROOT_DIR),
        )
        assert result.returncode == 0, (
            f"Minimal compose override failed validation:\n{result.stderr}"
        )

    @pytest.mark.skipif(
        not _compose_available,
        reason="docker compose not available",
    )
    def test_arm_compose_validates(self):
        arm_path = ROOT_DIR / "docker-compose.arm.yml"
        if not arm_path.exists():
            pytest.skip("docker-compose.arm.yml not present")
        result = _run(
            [
                "docker", "compose",
                "-f", "docker-compose.yml",
                "-f", "docker-compose.arm.yml",
                "config", "--quiet",
            ],
            timeout=30,
            cwd=str(ROOT_DIR),
        )
        assert result.returncode == 0, (
            f"ARM compose override failed validation:\n{result.stderr}"
        )
