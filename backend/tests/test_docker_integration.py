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

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest

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


def _base_images() -> list[str]:
    """Base images the Dockerfiles pull, read from their FROM lines.

    Read rather than hard-coded so the reachability probe below keeps testing
    the images actually in use after a base-image bump.
    """
    images = []
    for dockerfile in (BACKEND_DIR / "Dockerfile", FRONTEND_DIR / "Dockerfile"):
        if not dockerfile.exists():
            continue
        for line in dockerfile.read_text().splitlines():
            if not line.upper().startswith("FROM "):
                continue
            image = line.split()[1]
            # Skip references to earlier stages in the same file — only the
            # external images are fetched from a registry.
            if ":" in image:
                images.append(image)
    return sorted(set(images))


def _registry_reachable() -> bool:
    """Whether the base images can actually be resolved from the registry.

    A running daemon is not sufficient: behind a proxy that blocks the registry
    CDN, `docker build` dies at "load metadata for ..." with a 403 and the build
    tests fail for a reason that has nothing to do with the Dockerfiles. That is
    an unavailable prerequisite, so the tests should skip the way they do when
    the daemon is missing.

    Deliberately probes only image *resolution*. A failure inside a RUN step is
    a real defect and still fails the test.
    """
    for image in _base_images():
        try:
            result = subprocess.run(
                ["docker", "manifest", "inspect", image],
                capture_output=True,
                timeout=60,
            )
        except (subprocess.TimeoutExpired, OSError):
            return False
        if result.returncode != 0:
            return False
    return True


_docker_ready = _docker_daemon_running()
_registry_ready = _docker_ready and _registry_reachable()

pytestmark = [
    pytest.mark.docker,
    pytest.mark.integration,
    pytest.mark.slow,
    pytest.mark.skipif(
        not _docker_ready,
        reason="Docker daemon is not available — skipping container tests",
    ),
]

# Config-only tests parse compose files and need no registry; the build and
# runtime tests do, so they carry the extra guard.
requires_registry = pytest.mark.skipif(
    not _registry_ready,
    reason="Docker registry is unreachable — cannot pull base images",
)

# Test-specific image tag prefix to avoid clashing with real builds
_TAG_PREFIX = "logbook-test"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run(
    cmd: list[str], *, timeout: int = 300, **kwargs
) -> subprocess.CompletedProcess:
    """Run a subprocess and return the result."""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        **kwargs,
    )


def _docker_build(
    context: Path, target: str | None = None, tag: str = ""
) -> subprocess.CompletedProcess:
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


def _docker_network_create(name: str) -> bool:
    """Create a user-defined bridge network so containers resolve by name."""
    _run(["docker", "network", "rm", name], timeout=30)
    return _run(["docker", "network", "create", name], timeout=60).returncode == 0


def _docker_network_rm(name: str):
    """Remove a network (best-effort)."""
    _run(["docker", "network", "rm", name], timeout=30)


def _start_mysql(container: str, network: str, timeout: int = 180) -> bool:
    """Start a MySQL container on `network` and block until it accepts queries.

    The backend cannot serve without a database: uvicorn runs the lifespan
    startup — which waits on MySQL and applies migrations — *before* it binds
    its socket, so a backend container with no reachable MySQL never opens
    port 3001 at all. Anything asserting the port is open has to supply one.
    """
    started = _run(
        [
            "docker",
            "run",
            "-d",
            "--name",
            container,
            "--network",
            network,
            "-e",
            "MYSQL_ROOT_PASSWORD=test_root_pass",
            "-e",
            "MYSQL_DATABASE=test_db",
            "-e",
            "MYSQL_USER=test_user",
            "-e",
            "MYSQL_PASSWORD=test_pass",
            # The migration chain hardcodes COLLATE utf8mb4_unicode_ci in places,
            # and a server defaulting to another collation fails cross-table FKs
            # with errno 150 (same reason CI aligns collation before migrating).
            "mysql:8.0",
            "--character-set-server=utf8mb4",
            "--collation-server=utf8mb4_unicode_ci",
        ],
        timeout=120,
    )
    if started.returncode != 0:
        return False

    deadline = time.time() + timeout
    while time.time() < deadline:
        ping = _run(
            [
                "docker",
                "exec",
                container,
                "mysqladmin",
                "ping",
                "-h",
                "127.0.0.1",
                "-uroot",
                "-ptest_root_pass",
            ],
            timeout=20,
        )
        if ping.returncode == 0 and "mysqld is alive" in ping.stdout:
            return True
        time.sleep(3)
    return False


def _start_upstream_stub(container: str, network: str, alias: str) -> bool:
    """Run a placeholder under `alias` so nginx's upstream name resolves.

    nginx resolves every host named in a `proxy_pass` while parsing its config
    and refuses to start if one is unknown — "host not found in upstream". The
    frontend image proxies /api to `backend:3001`, so it cannot boot anywhere
    that name does not resolve, which is every one of these tests until one
    stands there. None of them call /api; they need the name to exist, not to
    answer, so a stock nginx:alpine — this image's own base, so already pulled
    — is enough.
    """
    return (
        _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                container,
                "--network",
                network,
                "--network-alias",
                alias,
                "nginx:alpine",
            ],
            timeout=120,
        ).returncode
        == 0
    )


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


@requires_registry
class TestBackendImageBuild:
    """Test that the backend Docker image builds successfully for each stage."""

    def test_build_base_stage(self):
        tag = f"{_TAG_PREFIX}-backend-base"
        try:
            result = _docker_build(BACKEND_DIR, target="base", tag=tag)
            assert (
                result.returncode == 0
            ), f"Backend 'base' stage failed to build:\n{result.stderr[-2000:]}"
        finally:
            _docker_rm_image(tag)

    def test_build_dependencies_stage(self):
        tag = f"{_TAG_PREFIX}-backend-deps"
        try:
            result = _docker_build(BACKEND_DIR, target="dependencies", tag=tag)
            assert (
                result.returncode == 0
            ), f"Backend 'dependencies' stage failed to build:\n{result.stderr[-2000:]}"
        finally:
            _docker_rm_image(tag)

    def test_build_development_stage(self):
        tag = f"{_TAG_PREFIX}-backend-dev"
        try:
            result = _docker_build(BACKEND_DIR, target="development", tag=tag)
            assert (
                result.returncode == 0
            ), f"Backend 'development' stage failed to build:\n{result.stderr[-2000:]}"
        finally:
            _docker_rm_image(tag)

    def test_build_production_stage(self):
        tag = f"{_TAG_PREFIX}-backend-prod"
        try:
            result = _docker_build(BACKEND_DIR, target="production", tag=tag)
            assert (
                result.returncode == 0
            ), f"Backend 'production' stage failed to build:\n{result.stderr[-2000:]}"
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
            assert any(
                "/health" in part for part in test_cmd
            ), f"HEALTHCHECK must target /health, got: {test_cmd}"
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
            assert (
                "3001/tcp" in exposed
            ), f"Production image must expose port 3001, got: {list(exposed.keys())}"
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
            assert user not in (
                "",
                "root",
                "0",
            ), f"Production image should run as non-root user, got: '{user}'"
        finally:
            _docker_rm_image(tag)


# ===========================================================================
# Frontend Image Build Tests
# ===========================================================================


@requires_registry
class TestFrontendImageBuild:
    """Test that the frontend Docker image builds successfully."""

    def test_build_development_stage(self):
        tag = f"{_TAG_PREFIX}-frontend-dev"
        try:
            result = _docker_build(FRONTEND_DIR, target="development", tag=tag)
            assert (
                result.returncode == 0
            ), f"Frontend 'development' stage failed to build:\n{result.stderr[-2000:]}"
        finally:
            _docker_rm_image(tag)

    def test_build_production_stage(self):
        tag = f"{_TAG_PREFIX}-frontend-prod"
        try:
            result = _docker_build(FRONTEND_DIR, target="production", tag=tag)
            assert (
                result.returncode == 0
            ), f"Frontend 'production' stage failed to build:\n{result.stderr[-2000:]}"
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
            assert (
                "80/tcp" in exposed
            ), f"Frontend image must expose port 80, got: {list(exposed.keys())}"
        finally:
            _docker_rm_image(tag)


# ===========================================================================
# Container Startup & Health Tests
# ===========================================================================


class TestBackendContainerHealth:
    """
    Test that the backend container starts and reaches a healthy state.

    Note: Redis is genuinely optional at startup — it is connected inside an
    `asyncio.gather(..., return_exceptions=True)`, so its absence degrades the
    health report without blocking the boot. MySQL is not: the lifespan waits
    for it and runs migrations before uvicorn binds. So `test_container_starts_
    without_crash` runs the container bare (it only has to stay up), while
    `test_container_listens_on_port` brings up a MySQL sidecar on a private
    network, because a port that only opens after the database answers cannot
    be asserted without one.
    """

    _tag = f"{_TAG_PREFIX}-backend-health"
    _container = f"{_TAG_PREFIX}-backend-health-ctr"
    _mysql = f"{_TAG_PREFIX}-backend-health-mysql"
    _network = f"{_TAG_PREFIX}-backend-health-net"

    @pytest.fixture(autouse=True)
    def _build_and_cleanup(self):
        """Build the image once, clean up container after each test."""
        result = _docker_build(BACKEND_DIR, target="production", tag=self._tag)
        if result.returncode != 0:
            pytest.skip(f"Backend build failed: {result.stderr[-500:]}")
        yield
        # The backend container has to go first: while it is attached, the
        # network cannot be removed and the next test's create would fail.
        _docker_stop_rm(self._container)
        _docker_stop_rm(self._mysql)
        _docker_network_rm(self._network)
        _docker_rm_image(self._tag)

    def test_container_starts_without_crash(self):
        """Container should start and stay running (not exit immediately)."""
        result = _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                self._container,
                "-e",
                "ENVIRONMENT=development",
                "-e",
                "SECRET_KEY=test-secret-key-for-docker-integration",
                "-e",
                "ENCRYPTION_KEY=test-encryption-key-1234567890abcdef",
                "-e",
                "ENCRYPTION_SALT=test-salt-value",
                "-e",
                "DB_HOST=localhost",
                "-e",
                "DB_NAME=test_db",
                "-e",
                "DB_USER=test_user",
                "-e",
                "DB_PASSWORD=test_pass",
                self._tag,
            ]
        )
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
        """Container should accept TCP connections on port 3001.

        Unlike its sibling above, this one needs a real MySQL. Uvicorn runs
        the lifespan startup before it binds, and that startup waits for the
        database and applies the migration chain, so the port only opens once
        a database has answered. Pointed at a `DB_HOST` that does not resolve,
        the container sits in `_wait_for_mysql`'s backoff (40 attempts, up to
        ~10 minutes) and never listens — which is what this test used to
        assert against, with a 30s budget it could not meet.
        """
        assert _docker_network_create(self._network), "Could not create network"
        assert _start_mysql(
            self._mysql, self._network
        ), "MySQL sidecar did not become ready"

        result = _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                self._container,
                "--network",
                self._network,
                "-p",
                "13001:3001",
                "-e",
                "ENVIRONMENT=development",
                "-e",
                "SECRET_KEY=test-secret-key-for-docker-integration",
                "-e",
                "ENCRYPTION_KEY=test-encryption-key-1234567890abcdef",
                "-e",
                "ENCRYPTION_SALT=test-salt-value",
                "-e",
                f"DB_HOST={self._mysql}",
                "-e",
                "DB_NAME=test_db",
                "-e",
                "DB_USER=test_user",
                "-e",
                "DB_PASSWORD=test_pass",
                self._tag,
            ]
        )
        if result.returncode != 0:
            pytest.skip(f"Container failed to start: {result.stderr}")

        # Generous: a cold database pays MySQL's own init plus the full
        # migration chain before uvicorn binds. Bounded well under the
        # module's 1800s pytest timeout so a genuine hang still fails.
        deadline = time.time() + 420
        listening = False
        while time.time() < deadline:
            check = _run(
                [
                    "docker",
                    "exec",
                    self._container,
                    "python",
                    "-c",
                    "import socket; s=socket.socket(); s.settimeout(2); s.connect(('127.0.0.1',3001)); s.close(); print('OK')",
                ],
                timeout=10,
            )
            if check.returncode == 0 and "OK" in check.stdout:
                listening = True
                break
            time.sleep(2)

        assert (
            listening
        ), "Backend container did not start listening on port 3001 within 30s"


class TestFrontendContainerHealth:
    """Test that the frontend container starts and serves content.

    Every test here runs on a private network with a stub answering to
    `backend`, because nginx will not start while the host named in its /api
    `proxy_pass` is unresolvable. The tests themselves only touch static
    routes — index.html and the image's own healthcheck on `/` — so the stub
    never has to serve anything.
    """

    _tag = f"{_TAG_PREFIX}-frontend-health"
    _container = f"{_TAG_PREFIX}-frontend-health-ctr"
    _peer = f"{_TAG_PREFIX}-frontend-health-upstream"
    _network = f"{_TAG_PREFIX}-frontend-health-net"

    @pytest.fixture(autouse=True)
    def _build_and_cleanup(self):
        result = _docker_build(FRONTEND_DIR, target="production", tag=self._tag)
        if result.returncode != 0:
            pytest.skip(f"Frontend build failed: {result.stderr[-500:]}")
        assert _docker_network_create(self._network), "Could not create network"
        assert _start_upstream_stub(
            self._peer, self._network, "backend"
        ), "Upstream stub did not start"
        yield
        # Attached containers first — a network with members cannot be removed,
        # and the next test's create would then fail.
        _docker_stop_rm(self._container)
        _docker_stop_rm(self._peer)
        _docker_network_rm(self._network)
        _docker_rm_image(self._tag)

    def test_container_starts_without_crash(self):
        result = _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                self._container,
                "--network",
                self._network,
                self._tag,
            ]
        )
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
        result = _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                self._container,
                "--network",
                self._network,
                self._tag,
            ]
        )
        if result.returncode != 0:
            pytest.skip(f"Container failed to start: {result.stderr}")

        # Wait for nginx to be ready
        deadline = time.time() + 20
        served = False
        while time.time() < deadline:
            check = _run(
                [
                    "docker",
                    "exec",
                    self._container,
                    "wget",
                    "--quiet",
                    "--tries=1",
                    "--spider",
                    "http://localhost/",
                ],
                timeout=10,
            )
            if check.returncode == 0:
                served = True
                break
            time.sleep(2)

        assert served, "Frontend container did not serve content on port 80 within 20s"

    def test_frontend_becomes_healthy(self):
        """Frontend container should pass its own HEALTHCHECK."""
        result = _run(
            [
                "docker",
                "run",
                "-d",
                "--name",
                self._container,
                "--network",
                self._network,
                "--health-interval=5s",
                "--health-timeout=3s",
                "--health-start-period=5s",
                "--health-retries=3",
                self._tag,
            ]
        )
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

    The compose files mark several variables required (``${VAR:?...}``), so
    without values `config` aborts on the first one and validates nothing. Those
    values come from the developer's own `.env`, which makes the result depend
    on local setup: on a checkout that has not run `cp .env.example .env` these
    tests fail with a missing-variable error that says nothing about the compose
    files. Supplying throwaway values here keeps the test hermetic and keeps it
    testing what it is named for — the structure of the compose files.
    """

    _compose_available = shutil.which("docker") is not None

    # Placeholders only: `config` interpolates and discards them, and nothing is
    # started. Values are shaped to satisfy any length or format expectations.
    _COMPOSE_ENV = {
        "SECRET_KEY": "x" * 64,
        "ENCRYPTION_KEY": "0" * 64,
        "ENCRYPTION_SALT": "0" * 32,
        "DB_PASSWORD": "test-db-password",
        "MYSQL_ROOT_PASSWORD": "test-root-password",
        "REDIS_PASSWORD": "test-redis-password",
    }

    @classmethod
    def _env(cls) -> dict:
        """Process environment plus the variables compose requires."""
        return {**os.environ, **cls._COMPOSE_ENV}

    @pytest.mark.skipif(
        not _compose_available,
        reason="docker compose not available",
    )
    def test_main_compose_validates(self):
        result = _run(
            ["docker", "compose", "-f", "docker-compose.yml", "config", "--quiet"],
            timeout=30,
            cwd=str(ROOT_DIR),
            env=self._env(),
        )
        assert (
            result.returncode == 0
        ), f"docker-compose.yml failed validation:\n{result.stderr}"

    @pytest.mark.skipif(
        not _compose_available,
        reason="docker compose not available",
    )
    def test_minimal_compose_validates(self):
        result = _run(
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.yml",
                "-f",
                "docker-compose.minimal.yml",
                "config",
                "--quiet",
            ],
            timeout=30,
            cwd=str(ROOT_DIR),
            env=self._env(),
        )
        assert (
            result.returncode == 0
        ), f"Minimal compose override failed validation:\n{result.stderr}"

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
                "docker",
                "compose",
                "-f",
                "docker-compose.yml",
                "-f",
                "docker-compose.arm.yml",
                "config",
                "--quiet",
            ],
            timeout=30,
            cwd=str(ROOT_DIR),
            env=self._env(),
        )
        assert (
            result.returncode == 0
        ), f"ARM compose override failed validation:\n{result.stderr}"
