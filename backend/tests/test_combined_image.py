"""
The combined image the Unraid Community Applications template runs.

Owner decision of 2026-11-01 (docs/KNOWN_LIMITATIONS.md, "Unraid Community
Apps Template"): one image holding nginx and the API, published to ghcr.io by
a release workflow. The pieces live in five files that nothing else ties
together -- the template, the workflow, docker-bake.hcl, the combined
Dockerfile and its entrypoint -- and a name or port that drifts in one of them
gives a template that pulls an image nobody publishes, or a container that
answers on a port the template does not map. These tests read each file and
hold them to one another.

Static only; tests/test_docker_integration.py builds and runs the image.
"""

import re
import shutil
import subprocess
import xml.etree.ElementTree as ElementTree
from pathlib import Path

import pytest
import yaml

ROOT_DIR = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT_DIR / "unraid" / "the-logbook.xml"
WORKFLOW = ROOT_DIR / ".github" / "workflows" / "release-image.yml"
BAKE = ROOT_DIR / "docker-bake.hcl"
COMBINED_DIR = ROOT_DIR / "docker" / "combined"
DOCKERFILE = COMBINED_DIR / "Dockerfile"
ENTRYPOINT = COMBINED_DIR / "entrypoint.sh"
FRONTEND_NGINX = ROOT_DIR / "frontend" / "nginx.conf"
BACKEND_DOCKERFILE = ROOT_DIR / "backend" / "Dockerfile"

SHA_PINNED = re.compile(r"^[\w.-]+/[\w.-]+@[0-9a-f]{40}$")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _template() -> ElementTree.Element:
    return ElementTree.parse(TEMPLATE).getroot()


def _template_configs() -> list[ElementTree.Element]:
    return _template().findall("Config")


def _workflow() -> dict:
    return yaml.safe_load(_read(WORKFLOW))


def _workflow_triggers() -> dict:
    data = _workflow()
    # PyYAML reads the bare key `on` as the boolean True.
    return data.get("on", data.get(True)) or {}


def _publish_steps() -> list[dict]:
    return _workflow()["jobs"]["publish"]["steps"]


def _step(action: str) -> dict:
    matches = [s for s in _publish_steps() if s.get("uses", "").startswith(action)]
    assert len(matches) == 1, f"expected one {action} step, found {len(matches)}"
    return matches[0]


def _hcl_block(kind: str, name: str) -> str:
    """Body of `<kind> "<name>" { ... }` in docker-bake.hcl, braces balanced."""
    content = _read(BAKE)
    match = re.search(rf'^{kind}\s+"{re.escape(name)}"\s*\{{', content, re.M)
    assert match, f'docker-bake.hcl has no {kind} "{name}"'
    depth = 0
    for index in range(match.end() - 1, len(content)):
        if content[index] == "{":
            depth += 1
        elif content[index] == "}":
            depth -= 1
            if depth == 0:
                return content[match.end() : index]
    raise AssertionError(f'unbalanced braces in {kind} "{name}"')


def _hcl_string(body: str, key: str) -> str:
    match = re.search(rf'^\s*{key}\s*=\s*"([^"]*)"', body, re.M)
    assert match, f"no {key} = in block"
    return match.group(1)


def _bake_image() -> str:
    return _hcl_string(_hcl_block("variable", "IMAGE"), "default")


def _dockerfile_lines(path: Path) -> list[str]:
    """Logical lines (continuations joined, comments dropped)."""
    lines: list[str] = []
    pending = ""
    for raw in _read(path).splitlines():
        stripped = raw.strip()
        if not pending and (not stripped or stripped.startswith("#")):
            continue
        if stripped.endswith("\\"):
            pending += stripped[:-1] + " "
            continue
        lines.append(pending + stripped)
        pending = ""
    return lines


def _instructions(path: Path, keyword: str) -> list[str]:
    return [
        line.split(None, 1)[1] if " " in line else ""
        for line in _dockerfile_lines(path)
        if line.split(None, 1)[0].upper() == keyword
    ]


def _final_stage_instructions(path: Path, keyword: str) -> list[str]:
    lines = _dockerfile_lines(path)
    last_from = max(
        i for i, line in enumerate(lines) if line.upper().startswith("FROM ")
    )
    return [
        line.split(None, 1)[1]
        for line in lines[last_from:]
        if line.split(None, 1)[0].upper() == keyword
    ]


# ---------------------------------------------------------------------------
# One image name, in three places
# ---------------------------------------------------------------------------


class TestOneImageName:
    def test_template_pulls_the_image_the_workflow_publishes(self):
        repository = _template().findtext("Repository")
        image_env = _workflow()["env"]["IMAGE"]
        assert repository == f"{image_env}:latest", (
            f"the template pulls {repository!r} but the release workflow "
            f"publishes {image_env!r}"
        )

    def test_bake_default_is_the_same_image(self):
        assert _bake_image() == _workflow()["env"]["IMAGE"]

    def test_image_is_the_projects_ghcr_package(self):
        assert _workflow()["env"]["IMAGE"] == "ghcr.io/thegspiro/the-logbook"
        assert _template().findtext("Registry") == "https://ghcr.io/"

    def test_metadata_tags_the_workflow_image(self):
        assert _step("docker/metadata-action")["with"]["images"] == "${{ env.IMAGE }}"

    def test_template_icon_is_a_file_in_this_repository(self):
        """Community Applications shows a broken image for an icon URL that
        404s; the template pointed at an unraid/icon.png that never existed."""
        prefix = "https://raw.githubusercontent.com/thegspiro/the-logbook/main/"
        icon = _template().findtext("Icon") or ""
        assert icon.startswith(prefix), icon
        assert (ROOT_DIR / icon[len(prefix) :]).is_file(), f"{icon} does not exist"

    def test_template_is_no_longer_marked_as_a_draft(self):
        text = _read(TEMPLATE)
        assert "NOT INSTALLABLE" not in text
        assert "DRAFT" not in text


# ---------------------------------------------------------------------------
# The release workflow
# ---------------------------------------------------------------------------


class TestReleaseWorkflow:
    def test_runs_on_a_version_tag_and_by_hand(self):
        triggers = _workflow_triggers()
        assert "workflow_dispatch" in triggers
        tags = (triggers.get("push") or {}).get("tags") or []
        assert any(t.startswith("v") for t in tags), f"no version tag trigger: {tags}"
        assert "branches" not in (
            triggers.get("push") or {}
        ), "a branch push must not publish: the template installs :latest"

    def test_only_the_publish_job_can_write_packages(self):
        data = _workflow()
        assert data["permissions"] == {"contents": "read"}
        assert data["jobs"]["publish"]["permissions"] == {
            "contents": "read",
            "packages": "write",
        }

    def test_logs_in_with_the_workflow_token_not_a_stored_secret(self):
        login = _step("docker/login-action")["with"]
        assert login["registry"] == "ghcr.io"
        assert login["password"] == "${{ secrets.GITHUB_TOKEN }}"

    def test_third_party_actions_are_pinned_to_a_commit(self):
        """Same rule as supply-chain.yml: first-party actions/* by major tag,
        everything else by commit SHA, because this job can publish the
        image every installation pulls."""
        for step in _publish_steps():
            uses = step.get("uses")
            if not uses or uses.startswith("actions/"):
                continue
            assert SHA_PINNED.match(uses), f"{uses} is not pinned to a commit SHA"

    def test_builds_multi_arch(self):
        platforms = set(_workflow()["env"]["PLATFORMS"].split(","))
        assert {"linux/amd64", "linux/arm64"} <= platforms
        assert any(
            s.get("uses", "").startswith("docker/setup-qemu-action")
            for s in _publish_steps()
        ), "arm64 needs QEMU on an amd64 runner"

    def test_bakes_the_combined_target_from_the_bake_file_and_pushes(self):
        bake = _step("docker/bake-action")["with"]
        assert bake["targets"] == "combined"
        assert bake["push"] is True
        assert bake["source"] == "."
        files = [line.strip() for line in bake["files"].splitlines() if line.strip()]
        assert files[0] == "./docker-bake.hcl"
        assert "${{ steps.meta.outputs.bake-file-tags }}" in files

    def test_latest_moves_only_on_a_release_tag(self):
        flavor = _step("docker/metadata-action")["with"]["flavor"]
        assert "latest=${{ startsWith(github.ref, 'refs/tags/v') }}" in flavor

    def test_bake_platform_variable_matches_the_workflow_env(self):
        """The workflow passes PLATFORMS through the environment, which bake
        reads only for a variable of exactly that name."""
        _hcl_block("variable", "PLATFORMS")
        assert "PLATFORMS" in _workflow()["env"]


# ---------------------------------------------------------------------------
# docker-bake.hcl reuses the existing builds
# ---------------------------------------------------------------------------


class TestBakeReusesTheExistingImages:
    @pytest.mark.parametrize(
        ("target", "context", "dockerfile"),
        [
            ("backend-production", "backend", "Dockerfile"),
            ("frontend-production", ".", "frontend/Dockerfile"),
        ],
    )
    def test_component_targets_are_the_production_stages(
        self, target: str, context: str, dockerfile: str
    ):
        body = _hcl_block("target", target)
        assert _hcl_string(body, "context") == context
        assert _hcl_string(body, "dockerfile") == dockerfile
        assert _hcl_string(body, "target") == "production"

    def test_combined_target_is_fed_by_those_targets(self):
        body = _hcl_block("target", "combined")
        assert _hcl_string(body, "context") == "docker/combined"
        assert re.search(r'"backend-image"\s*=\s*"target:backend-production"', body)
        assert re.search(r'"frontend-image"\s*=\s*"target:frontend-production"', body)

    def test_combined_target_takes_its_tags_from_the_metadata_target(self):
        """A tag set on "combined" itself would override the release tags the
        workflow's metadata file supplies through inheritance."""
        body = _hcl_block("target", "combined")
        assert re.search(r'inherits\s*=\s*\["docker-metadata-action"\]', body)
        assert not re.search(r"^\s*tags\s*=", body, re.M)

    def test_combined_dockerfile_builds_only_on_the_bake_contexts(self):
        """No base image of its own: the Python (and the Node that built the
        bundle) are the backend's and frontend's, which
        test_image_runtime_versions.py holds to CI's versions."""
        bases = [args.split()[0] for args in _instructions(DOCKERFILE, "FROM")]
        assert bases == ["frontend-image", "backend-image"]


# ---------------------------------------------------------------------------
# The combined Dockerfile and entrypoint
# ---------------------------------------------------------------------------


class TestCombinedDockerfile:
    def test_runs_as_the_backend_images_user(self):
        backend_user = _final_stage_instructions(BACKEND_DOCKERFILE, "USER")[-1]
        assert _final_stage_instructions(DOCKERFILE, "USER")[-1] == backend_user
        assert backend_user != "root"

    def test_exposes_the_port_the_template_maps(self):
        web_ui = [
            c
            for c in _template_configs()
            if c.get("Type") == "Port" and c.get("Name") == "WebUI Port"
        ]
        assert len(web_ui) == 1
        target = web_ui[0].get("Target")
        assert _final_stage_instructions(DOCKERFILE, "EXPOSE") == [target]
        assert f"[PORT:{web_ui[0].get('Default')}]" in _template().findtext("WebUI")

    def test_template_maps_no_port_but_the_web_interface(self):
        """The API listens on loopback only; a mapping to 3001 would publish
        nothing and invite somebody to go looking for it."""
        ports = [
            c.get("Target") for c in _template_configs() if c.get("Type") == "Port"
        ]
        assert ports == ["3000"]

    def test_healthcheck_goes_through_nginx_to_the_api(self):
        healthcheck = " ".join(_final_stage_instructions(DOCKERFILE, "HEALTHCHECK"))
        assert "http://127.0.0.1:3000/health" in healthcheck

    def test_starts_the_entrypoint(self):
        assert _final_stage_instructions(DOCKERFILE, "CMD") == [
            '["/usr/local/bin/logbook-entrypoint"]'
        ]
        copies = " ".join(_instructions(DOCKERFILE, "COPY"))
        assert "entrypoint.sh /usr/local/bin/logbook-entrypoint" in copies

    def test_validates_nginx_as_the_runtime_user(self):
        lines = _dockerfile_lines(DOCKERFILE)
        user_at = max(i for i, line in enumerate(lines) if line.startswith("USER "))
        assert "RUN nginx -t" in lines[user_at:]


class TestNginxRewrite:
    """The combined image serves frontend/nginx.conf with two substitutions.
    If that file grows an upstream the substitutions do not match, the build
    greps catch it -- these say why before a build is attempted."""

    def test_frontend_conf_listens_on_exactly_one_port_80(self):
        listens = re.findall(r"^\s*listen\s+[^;]+;", _read(FRONTEND_NGINX), re.M)
        assert [line.strip() for line in listens] == ["listen 80;"]

    def test_every_upstream_is_the_one_the_rewrite_replaces(self):
        upstreams = set(
            re.findall(r"^\s*proxy_pass\s+([^;]+);", _read(FRONTEND_NGINX), re.M)
        )
        assert upstreams == {"http://backend:3001"}

    def test_rewrite_targets_the_entrypoints_api_address(self):
        dockerfile = _read(DOCKERFILE)
        entrypoint = _read(ENTRYPOINT)
        assert "s#http://backend:3001#http://127.0.0.1:3001#g" in dockerfile
        assert "API_HOST=127.0.0.1" in entrypoint
        assert "API_PORT=3001" in entrypoint
        assert r"listen 3000;" in dockerfile

    def test_main_conf_defines_the_log_format_the_site_uses(self):
        assert " main if=$access_loggable;" in _read(FRONTEND_NGINX)
        assert re.search(
            r"^\s*log_format main ", _read(COMBINED_DIR / "nginx.conf"), re.M
        )


class TestEntrypoint:
    def test_is_posix_sh(self):
        assert _read(ENTRYPOINT).startswith("#!/bin/sh\n")

    @pytest.mark.parametrize("shell", ["sh", "dash"])
    def test_parses(self, shell: str):
        if not shutil.which(shell):
            pytest.skip(f"{shell} is not installed")
        result = subprocess.run(
            [shell, "-n", str(ENTRYPOINT)], capture_output=True, text=True
        )
        assert result.returncode == 0, result.stderr

    def test_runs_the_same_app_as_the_backend_image(self):
        """Migrations run in the app's own startup, so starting the same
        module with the same worker count keeps them identical."""
        backend_cmd = _final_stage_instructions(BACKEND_DOCKERFILE, "CMD")[-1]
        workers = re.search(r'"--workers",\s*"(\d+)"', backend_cmd)
        assert workers, backend_cmd
        assert '"main:app"' in backend_cmd
        entrypoint = _read(ENTRYPOINT)
        assert "uvicorn main:app" in entrypoint
        assert f'WORKERS="${{WEB_CONCURRENCY:-{workers.group(1)}}}"' in entrypoint

    def test_api_is_bound_to_loopback(self):
        assert '--host "$API_HOST"' in _read(ENTRYPOINT)


# ---------------------------------------------------------------------------
# The template can boot in production
# ---------------------------------------------------------------------------


class TestTemplateProductionGate:
    """The template defaults ENVIRONMENT to production, where the API refuses
    to start until each of these is settled (validate_security_configuration
    in app/core/config.py). Unraid passes only the variables a template lists,
    so one missing here is a boot loop every install discovers by hand."""

    @pytest.mark.parametrize(
        ("setting", "default"),
        [
            ("ENABLE_DOCS", "false"),
            ("SECURITY_REQUIRE_TLS", "false"),
            ("SECURITY_ENFORCE_HTTPS", "false"),
            ("COOKIE_SECURE", "true"),
            ("DB_SSL", "false"),
            ("REDIS_SSL", "false"),
        ],
    )
    def test_gate_setting_is_listed_with_the_compose_stacks_default(
        self, setting: str, default: str
    ):
        configs = {c.get("Target"): c for c in _template_configs()}
        assert setting in configs, f"{setting} is missing from the template"
        assert configs[setting].get("Default") == default
        compose = _read(ROOT_DIR / "unraid" / "docker-compose-unraid.yml")
        assert f"{setting}: ${{{setting}:-{default}}}" in compose, (
            f"the template's {setting} default no longer matches the Unraid "
            "compose stack's"
        )

    def test_redis_password_is_required(self):
        configs = {c.get("Target"): c for c in _template_configs()}
        assert configs["REDIS_PASSWORD"].get("Required") == "true"
        assert configs["REDIS_PASSWORD"].get("Mask") == "true"
