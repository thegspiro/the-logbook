"""
Docker Configuration Validation Tests (Unit-Level)

These tests validate Dockerfiles, docker-compose configurations, and the health
endpoint contract WITHOUT requiring a running Docker daemon. They parse and
inspect the configuration files directly to catch misconfigurations early.

Run with:
    pytest tests/test_docker_config.py -v
"""

import os
import re
import pytest
import yaml
from pathlib import Path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parents[2]  # the-logbook/
BACKEND_DIR = ROOT_DIR / "backend"
FRONTEND_DIR = ROOT_DIR / "frontend"


def _read(path: Path) -> str:
    """Read a file and return its contents."""
    return path.read_text(encoding="utf-8")


def _parse_dockerfile_stages(content: str) -> list[dict]:
    """
    Parse a Dockerfile into a list of stage dicts.
    Each dict has keys: name, base, instructions (list of (cmd, args) tuples).
    Handles backslash line continuations so multi-line instructions are joined.
    """
    # First, join backslash-continued lines
    logical_lines: list[str] = []
    raw_lines = content.splitlines()
    i = 0
    while i < len(raw_lines):
        line = raw_lines[i]
        while line.rstrip().endswith("\\") and i + 1 < len(raw_lines):
            line = line.rstrip()[:-1] + " " + raw_lines[i + 1].strip()
            i += 1
        logical_lines.append(line)
        i += 1

    stages: list[dict] = []
    current: dict | None = None

    for line in logical_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        parts = stripped.split(None, 1)
        if not parts:
            continue

        instruction = parts[0].upper()
        args = parts[1] if len(parts) > 1 else ""

        if instruction == "FROM":
            # e.g. "python:3.13-slim as base" or "dependencies as production"
            from_match = re.match(
                r"(.+?)\s+[Aa][Ss]\s+(\S+)", args
            )
            if from_match:
                base_image, stage_name = from_match.groups()
            else:
                base_image = args.strip()
                stage_name = f"_stage_{len(stages)}"
            current = {
                "name": stage_name,
                "base": base_image.strip(),
                "instructions": [],
            }
            stages.append(current)
        elif current is not None:
            current["instructions"].append((instruction, args))

    return stages


def _get_instructions(stage: dict, keyword: str) -> list[str]:
    """Return all args for a given instruction keyword within a stage."""
    return [args for cmd, args in stage["instructions"] if cmd == keyword]


# ===========================================================================
# Backend Dockerfile Tests
# ===========================================================================


class TestBackendDockerfile:
    """Validate backend/Dockerfile structure and best practices."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.path = BACKEND_DIR / "Dockerfile"
        self.content = _read(self.path)
        self.stages = _parse_dockerfile_stages(self.content)

    def test_dockerfile_exists(self):
        assert self.path.exists(), "backend/Dockerfile is missing"

    def test_has_multi_stage_build(self):
        assert len(self.stages) >= 3, (
            f"Expected at least 3 build stages (base, dependencies, production), "
            f"found {len(self.stages)}: {[s['name'] for s in self.stages]}"
        )

    def test_has_production_stage(self):
        stage_names = [s["name"] for s in self.stages]
        assert "production" in stage_names, (
            f"Missing 'production' stage. Found: {stage_names}"
        )

    def test_has_development_stage(self):
        stage_names = [s["name"] for s in self.stages]
        assert "development" in stage_names, (
            f"Missing 'development' stage. Found: {stage_names}"
        )

    def test_production_stage_has_healthcheck(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        healthchecks = _get_instructions(prod, "HEALTHCHECK")
        assert len(healthchecks) > 0, (
            "Production stage is missing a HEALTHCHECK instruction"
        )

    def test_healthcheck_targets_health_endpoint(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        healthchecks = _get_instructions(prod, "HEALTHCHECK")
        hc_text = " ".join(healthchecks)
        assert "/health" in hc_text, (
            f"HEALTHCHECK does not reference /health endpoint: {hc_text}"
        )

    def test_production_exposes_correct_port(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        exposed = _get_instructions(prod, "EXPOSE")
        assert any("3001" in e for e in exposed), (
            f"Production stage should EXPOSE 3001, got: {exposed}"
        )

    def test_production_runs_as_non_root(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        users = _get_instructions(prod, "USER")
        assert len(users) > 0, "Production stage should switch to a non-root USER"
        assert users[-1].strip() != "root", (
            "Production stage should not run as root"
        )

    def test_production_copies_application_code(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        copies = _get_instructions(prod, "COPY")
        copy_text = " ".join(copies)
        assert "main.py" in copy_text, "Production stage must COPY main.py"
        assert "app/" in copy_text, "Production stage must COPY app/ directory"

    def test_production_has_cmd(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        cmds = _get_instructions(prod, "CMD")
        assert len(cmds) > 0, "Production stage must have a CMD instruction"
        cmd_text = " ".join(cmds)
        assert "uvicorn" in cmd_text, (
            f"Production CMD should run uvicorn, got: {cmd_text}"
        )

    def test_base_uses_slim_image(self):
        base = self.stages[0]
        assert "slim" in base["base"] or "alpine" in base["base"], (
            f"Base image should use a slim/alpine variant for smaller size, got: {base['base']}"
        )

    def test_python_env_vars_set(self):
        """Verify recommended Python environment variables for containers."""
        assert "PYTHONUNBUFFERED" in self.content, (
            "PYTHONUNBUFFERED should be set for proper container logging"
        )
        assert "PYTHONDONTWRITEBYTECODE" in self.content, (
            "PYTHONDONTWRITEBYTECODE should be set to avoid .pyc files in containers"
        )


# ===========================================================================
# Frontend Dockerfile Tests
# ===========================================================================


class TestFrontendDockerfile:
    """Validate frontend/Dockerfile structure and best practices."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.path = FRONTEND_DIR / "Dockerfile"
        self.content = _read(self.path)
        self.stages = _parse_dockerfile_stages(self.content)

    def test_dockerfile_exists(self):
        assert self.path.exists(), "frontend/Dockerfile is missing"

    def test_has_multi_stage_build(self):
        assert len(self.stages) >= 2, (
            f"Expected at least 2 build stages, found {len(self.stages)}"
        )

    def test_has_production_stage(self):
        stage_names = [s["name"] for s in self.stages]
        assert "production" in stage_names, (
            f"Missing 'production' stage. Found: {stage_names}"
        )

    def test_production_uses_nginx(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        assert "nginx" in prod["base"], (
            f"Production stage should use nginx, got: {prod['base']}"
        )

    def test_production_stage_has_healthcheck(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        healthchecks = _get_instructions(prod, "HEALTHCHECK")
        assert len(healthchecks) > 0, (
            "Frontend production stage is missing a HEALTHCHECK instruction"
        )

    def test_production_exposes_port_80(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        exposed = _get_instructions(prod, "EXPOSE")
        assert any("80" in e for e in exposed), (
            f"Frontend production stage should EXPOSE 80, got: {exposed}"
        )

    def test_copies_nginx_config(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        copies = _get_instructions(prod, "COPY")
        copy_text = " ".join(copies)
        assert "nginx.conf" in copy_text, (
            "Production stage must COPY custom nginx.conf"
        )

    def test_copies_built_assets(self):
        prod = next(s for s in self.stages if s["name"] == "production")
        copies = _get_instructions(prod, "COPY")
        copy_text = " ".join(copies)
        assert "dist" in copy_text or "build" in copy_text, (
            "Production stage must COPY built frontend assets"
        )

    def test_build_stage_has_build_command(self):
        build = next(
            (s for s in self.stages if s["name"] == "build"),
            None,
        )
        if build is None:
            pytest.skip("No explicit 'build' stage found")
        runs = _get_instructions(build, "RUN")
        run_text = " ".join(runs)
        assert "build" in run_text, (
            f"Build stage should run a build command, got: {run_text}"
        )


# ===========================================================================
# Docker Compose Tests
# ===========================================================================


class TestDockerCompose:
    """Validate docker-compose.yml structure and service definitions."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.path = ROOT_DIR / "docker-compose.yml"
        self.content = _read(self.path)
        self.config = yaml.safe_load(self.content)

    def test_compose_file_exists(self):
        assert self.path.exists(), "docker-compose.yml is missing"

    def test_compose_parses_as_valid_yaml(self):
        assert isinstance(self.config, dict), "docker-compose.yml is not valid YAML"

    def test_has_required_services(self):
        services = set(self.config.get("services", {}).keys())
        required = {"mysql", "redis", "backend", "frontend"}
        missing = required - services
        assert not missing, f"Missing required services: {missing}"

    def test_backend_depends_on_mysql(self):
        backend = self.config["services"]["backend"]
        depends = backend.get("depends_on", {})
        assert "mysql" in depends, "Backend must depend on mysql"

    def test_backend_depends_on_redis(self):
        backend = self.config["services"]["backend"]
        depends = backend.get("depends_on", {})
        assert "redis" in depends, "Backend must depend on redis"

    def test_mysql_has_healthcheck(self):
        mysql = self.config["services"]["mysql"]
        assert "healthcheck" in mysql, "MySQL service must have a healthcheck"
        hc = mysql["healthcheck"]
        assert "test" in hc, "MySQL healthcheck must have a test command"

    def test_redis_has_healthcheck(self):
        redis_svc = self.config["services"]["redis"]
        assert "healthcheck" in redis_svc, "Redis service must have a healthcheck"

    def test_backend_waits_for_healthy_dependencies(self):
        backend = self.config["services"]["backend"]
        depends = backend.get("depends_on", {})
        for dep_name, dep_config in depends.items():
            if isinstance(dep_config, dict):
                assert dep_config.get("condition") == "service_healthy", (
                    f"Backend should wait for {dep_name} to be healthy, "
                    f"got condition: {dep_config.get('condition')}"
                )

    def test_volumes_defined(self):
        volumes = self.config.get("volumes", {})
        assert "mysql_data" in volumes, "mysql_data volume must be defined"
        assert "redis_data" in volumes, "redis_data volume must be defined"

    def test_network_defined(self):
        networks = self.config.get("networks", {})
        assert len(networks) > 0, "At least one network must be defined"

    def test_services_on_same_network(self):
        network_name = list(self.config.get("networks", {}).keys())[0]
        for svc_name in ("mysql", "redis", "backend", "frontend"):
            svc = self.config["services"][svc_name]
            svc_networks = svc.get("networks", [])
            assert network_name in svc_networks, (
                f"Service '{svc_name}' must be on the '{network_name}' network"
            )

    def test_mysql_port_not_exposed_by_default(self):
        """SEC-14: Database port should NOT be exposed to the host."""
        mysql = self.config["services"]["mysql"]
        assert "ports" not in mysql, (
            "MySQL port should NOT be exposed to the host by default (SEC-14)"
        )

    def test_redis_port_not_exposed_by_default(self):
        """SEC-14: Redis port should NOT be exposed to the host."""
        redis_svc = self.config["services"]["redis"]
        assert "ports" not in redis_svc, (
            "Redis port should NOT be exposed to the host by default (SEC-14)"
        )

    def test_backend_has_restart_policy(self):
        backend = self.config["services"]["backend"]
        assert "restart" in backend, "Backend should have a restart policy"

    def test_backend_environment_has_required_vars(self):
        backend = self.config["services"]["backend"]
        env = backend.get("environment", {})
        required_vars = {"DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
                         "REDIS_HOST", "REDIS_PORT", "SECRET_KEY"}
        if isinstance(env, dict):
            env_keys = set(env.keys())
        else:
            # list format: ["KEY=value", ...]
            env_keys = {item.split("=")[0] for item in env}
        missing = required_vars - env_keys
        assert not missing, f"Backend missing required environment vars: {missing}"


class TestDockerComposeMinimal:
    """Validate docker-compose.minimal.yml override file."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.path = ROOT_DIR / "docker-compose.minimal.yml"
        self.content = _read(self.path)
        self.config = yaml.safe_load(self.content)

    def test_file_exists(self):
        assert self.path.exists(), "docker-compose.minimal.yml is missing"

    def test_parses_as_valid_yaml(self):
        assert isinstance(self.config, dict)

    def test_overrides_backend_service(self):
        services = self.config.get("services", {})
        assert "backend" in services, "Minimal override must configure the backend"

    def test_backend_uses_single_worker(self):
        backend = self.config["services"]["backend"]
        cmd = backend.get("command", [])
        cmd_str = " ".join(cmd) if isinstance(cmd, list) else str(cmd)
        assert "--workers" in cmd_str and "1" in cmd_str, (
            "Minimal profile backend should use a single worker"
        )

    def test_has_resource_limits(self):
        """Minimal profile should set memory limits for constrained environments."""
        for svc_name in ("mysql", "redis", "backend"):
            svc = self.config["services"].get(svc_name, {})
            deploy = svc.get("deploy", {})
            resources = deploy.get("resources", {})
            limits = resources.get("limits", {})
            assert "memory" in limits, (
                f"Service '{svc_name}' should have memory limits in minimal profile"
            )


class TestDockerComposeArm:
    """Validate docker-compose.arm.yml override file."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.path = ROOT_DIR / "docker-compose.arm.yml"
        if not self.path.exists():
            pytest.skip("docker-compose.arm.yml not present")
        self.content = _read(self.path)
        self.config = yaml.safe_load(self.content)

    def test_parses_as_valid_yaml(self):
        assert isinstance(self.config, dict)

    def test_specifies_arm_platform(self):
        """ARM override should set platform: linux/arm64 on services."""
        services = self.config.get("services", {})
        arm_platforms_found = False
        for svc_name, svc in services.items():
            if "platform" in svc:
                assert "arm64" in svc["platform"] or "arm" in svc["platform"], (
                    f"Service '{svc_name}' platform should specify ARM architecture"
                )
                arm_platforms_found = True
        assert arm_platforms_found, (
            "ARM compose file should specify ARM platform for at least one service"
        )


# ===========================================================================
# Health Endpoint Contract Tests
# ===========================================================================


class TestHealthEndpointContract:
    """
    Validate the health endpoint implementation against the expected contract,
    by inspecting the source code. No running server required.
    """

    @pytest.fixture(autouse=True)
    def setup(self):
        self.main_py = _read(BACKEND_DIR / "main.py")

    def test_health_endpoint_is_defined(self):
        assert '@app.get("/health")' in self.main_py, (
            "main.py must define a GET /health endpoint"
        )

    def test_health_detailed_endpoint_is_defined(self):
        assert '@app.get("/health/detailed")' in self.main_py, (
            "main.py must define a GET /health/detailed endpoint"
        )

    def test_health_returns_required_fields(self):
        """The health response dict must include status, version, environment, timestamp."""
        # Look for the health_status dict construction
        for field in ("status", "version", "environment", "timestamp"):
            assert f'"{field}"' in self.main_py, (
                f"Health endpoint response must include '{field}' field"
            )

    def test_health_checks_database(self):
        assert "database" in self.main_py, (
            "Health endpoint must check database connectivity"
        )

    def test_health_checks_redis(self):
        assert "redis" in self.main_py, (
            "Health endpoint must check Redis connectivity"
        )

    def test_health_has_status_levels(self):
        """Verify the endpoint can report healthy, degraded, and unhealthy states."""
        for status in ("healthy", "degraded", "unhealthy"):
            assert f'"{status}"' in self.main_py, (
                f"Health endpoint must support '{status}' status level"
            )

    def test_detailed_health_blocked_in_production(self):
        """The detailed endpoint must be restricted in production."""
        # Find the detailed health function
        detailed_idx = self.main_py.index("health_check_detailed")
        nearby = self.main_py[detailed_idx:detailed_idx + 500]
        assert "production" in nearby, (
            "/health/detailed must check for production environment"
        )


# ===========================================================================
# Supporting File Tests
# ===========================================================================


class TestSupportingFiles:
    """Validate files required for Docker builds exist and are well-formed."""

    def test_backend_requirements_exists(self):
        assert (BACKEND_DIR / "requirements.txt").exists()

    def test_frontend_nginx_conf_exists(self):
        assert (FRONTEND_DIR / "nginx.conf").exists()

    def test_frontend_package_json_exists(self):
        assert (FRONTEND_DIR / "package.json").exists()

    def test_nginx_conf_has_spa_routing(self):
        """SPA routing must fall back to index.html."""
        nginx_conf = _read(FRONTEND_DIR / "nginx.conf")
        assert "try_files" in nginx_conf and "index.html" in nginx_conf, (
            "nginx.conf must have SPA try_files fallback to index.html"
        )

    def test_nginx_conf_proxies_health(self):
        """nginx should proxy /health to the backend."""
        nginx_conf = _read(FRONTEND_DIR / "nginx.conf")
        assert "/health" in nginx_conf and "proxy_pass" in nginx_conf, (
            "nginx.conf should proxy /health requests to the backend"
        )

    def test_nginx_conf_proxies_api(self):
        """nginx should proxy /api to the backend."""
        nginx_conf = _read(FRONTEND_DIR / "nginx.conf")
        assert "/api" in nginx_conf, (
            "nginx.conf should proxy /api requests to the backend"
        )

    def test_requirements_has_uvicorn(self):
        reqs = _read(BACKEND_DIR / "requirements.txt")
        assert "uvicorn" in reqs, "requirements.txt must include uvicorn"

    def test_requirements_has_fastapi(self):
        reqs = _read(BACKEND_DIR / "requirements.txt")
        assert "fastapi" in reqs, "requirements.txt must include fastapi"

    def test_requirements_has_requests_for_healthcheck(self):
        """The backend Dockerfile HEALTHCHECK uses 'requests' library."""
        reqs = _read(BACKEND_DIR / "requirements.txt")
        assert "requests" in reqs, (
            "requirements.txt must include 'requests' (used by Dockerfile HEALTHCHECK)"
        )
