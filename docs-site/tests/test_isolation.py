"""The docs site's isolation settings, so a later edit cannot quietly undo them.

The site is public and shares a host with the application. These tests pin the
properties docs-site/README.md ("Isolation") promises: no host port, an
internal-only network for the site, a pinned tunnel that alone bridges to the
outside, and resource caps on both containers.
"""

import xml.etree.ElementTree as ET
from pathlib import Path

import pytest
import yaml

DOCS_SITE = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def compose() -> dict:
    return yaml.safe_load((DOCS_SITE / "docker-compose.yml").read_text())


@pytest.fixture(scope="module")
def services(compose: dict) -> dict:
    return compose["services"]


def test_no_container_publishes_a_host_port(services: dict) -> None:
    for name, service in services.items():
        assert "ports" not in service, name
        assert service.get("network_mode") != "host", name


def test_site_is_only_on_the_internal_network(compose: dict, services: dict) -> None:
    assert services["logbook-docs"]["networks"] == ["docs-internal"]
    assert compose["networks"]["docs-internal"]["internal"] is True


def test_tunnel_alone_bridges_to_the_outside(compose: dict, services: dict) -> None:
    tunnel = services["logbook-docs-tunnel"]
    assert sorted(tunnel["networks"]) == ["docs-egress", "docs-internal"]
    assert compose["networks"]["docs-egress"].get("internal") is not True


def test_tunnel_image_is_pinned(services: dict) -> None:
    image = services["logbook-docs-tunnel"]["image"]
    repository, _, tag = image.partition(":")
    assert repository == "cloudflare/cloudflared"
    assert tag and tag != "latest"


def test_tunnel_metrics_stay_on_loopback(services: dict) -> None:
    command = services["logbook-docs-tunnel"]["command"]
    metrics = command[command.index("--metrics") + 1]
    assert metrics.startswith("127.0.0.1:")
    assert "--management-diagnostics=false" in command


def test_tunnel_token_comes_from_the_environment(services: dict) -> None:
    token = services["logbook-docs-tunnel"]["environment"]["TUNNEL_TOKEN"]
    assert token.startswith("${DOCS_TUNNEL_TOKEN:?")


@pytest.mark.parametrize("name", ["logbook-docs", "logbook-docs-tunnel"])
def test_every_container_is_hardened_and_capped(services: dict, name: str) -> None:
    service = services[name]
    assert service["read_only"] is True
    assert service["cap_drop"] == ["ALL"]
    assert "no-new-privileges:true" in service["security_opt"]
    assert not str(service["user"]).startswith("0")
    assert service["mem_limit"]
    assert service["cpus"]
    assert service["pids_limit"]
    assert service["logging"]["options"]["max-size"]


def test_site_tmp_cannot_hold_executables(services: dict) -> None:
    options = services["logbook-docs"]["tmpfs"][0].split(":", 1)[1].split(",")
    assert {"noexec", "nosuid", "nodev"} <= set(options)
    assert any(option.startswith("size=") for option in options)


def test_tunnel_token_file_never_enters_the_image_build() -> None:
    ignored = (DOCS_SITE / "Dockerfile.dockerignore").read_text().splitlines()
    assert "docs-site/.env" in ignored


def test_unraid_template_matches_the_compose_isolation() -> None:
    root = ET.parse(DOCS_SITE / "unraid-template.xml").getroot()
    assert root.findtext("Network") == "logbook-docs-internal"
    assert not [c for c in root.iter("Config") if c.get("Type") == "Port"]
    params = root.findtext("ExtraParams") or ""
    for flag in (
        "--read-only",
        "--cap-drop=ALL",
        "no-new-privileges:true",
        "--memory=",
        "--cpus=",
        "--pids-limit=",
        "noexec",
    ):
        assert flag in params, flag
