"""scripts/setup-ssl.sh must produce an nginx config that works for its install.

It used to copy one host config for every layout. Under the Compose stack that
config sent /api to 127.0.0.1:3001, which the production override does not
publish, and under install.sh --traditional it sent pages to 127.0.0.1:3000,
where nothing listened. It also ran `nginx -t` on an HTTPS block naming
certificate files before certbot had created them. These tests source the
script's functions and check what they generate; when nginx is installed they
also have it parse the result.
"""

import re
import shutil
import socket
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]
SETUP_SSL = REPO / "scripts" / "setup-ssl.sh"


def _bash(
    command: str, env: dict[str, str] | None = None
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["/bin/bash", "-c", f'source "{SETUP_SSL}"\n{command}'],
        capture_output=True,
        text=True,
        env=env or {"PATH": "/usr/bin:/bin"},
        timeout=20,
    )


def _render(function: str, *args: str) -> str:
    quoted = " ".join(f'"{a}"' for a in args)
    result = _bash(f"{function} {quoted}")
    assert result.returncode == 0, result.stderr
    return result.stdout


def _upstream(config: str, name: str) -> str:
    block = config.split(f"upstream {name} {{", 1)[1].split("}", 1)[0]
    servers = [
        line.split()[1].rstrip(";")
        for line in block.splitlines()
        if line.strip().startswith("server ")
    ]
    assert len(servers) == 1, servers
    return servers[0]


@pytest.mark.unit
class TestSiteConfig:
    def test_docker_sends_the_api_through_the_frontend_container(self):
        config = _render(
            "render_site_config", "docker", "logbook.example.org", str(REPO)
        )

        assert _upstream(config, "backend_api") == "127.0.0.1:3000"
        assert _upstream(config, "frontend_app") == "127.0.0.1:3000"

    def test_traditional_sends_the_api_to_the_backend(self):
        config = _render(
            "render_site_config", "traditional", "logbook.example.org", str(REPO)
        )

        assert _upstream(config, "backend_api") == "127.0.0.1:3001"
        assert _upstream(config, "frontend_app") == "127.0.0.1:3000"

    def test_domain_is_substituted_everywhere(self):
        config = _render(
            "render_site_config", "docker", "logbook.example.org", str(REPO)
        )

        assert "yourdomain.com" not in config
        assert "server_name logbook.example.org www.logbook.example.org;" in config
        assert "/etc/letsencrypt/live/logbook.example.org/fullchain.pem" in config

    def test_no_app_file_is_read_from_the_host_disk(self):
        # A `try_files $uri $uri/` resolved `/` against nginx's default root and
        # served its welcome page; an alias pointed at a directory no install
        # creates. Everything the app serves goes to the frontend site.
        config = _render(
            "render_site_config", "docker", "logbook.example.org", str(REPO)
        )
        directives = "\n".join(
            line for line in config.splitlines() if not line.lstrip().startswith("#")
        )

        assert "$uri/" not in directives
        assert "alias " not in directives
        assert "/var/www/logbook" not in directives


@pytest.mark.unit
class TestFrontendConfig:
    def test_serves_the_build_on_loopback_and_reaches_the_host_backend(self):
        config = _render("render_frontend_config", str(REPO))

        assert "listen 127.0.0.1:3000;" in config
        assert "listen 80;" not in config
        assert f"root {REPO}/frontend/dist;" in config
        assert "backend:3001" not in config
        assert "http://127.0.0.1:3001" in config

    def test_uses_names_a_debian_nginx_has_and_the_host_site_does_not(self):
        config = _render("render_frontend_config", str(REPO))

        # `main` exists only in the nginx:alpine image's own nginx.conf.
        assert " main " not in config
        assert "logbook_frontend_access.log combined" in config
        assert "$access_loggable" not in config
        assert "$frontend_access_loggable" in config


@pytest.mark.unit
class TestAcmeConfig:
    def test_serves_only_the_challenge_and_names_no_certificate(self):
        config = _render("render_acme_config", "logbook.example.org")

        assert "server_name logbook.example.org www.logbook.example.org;" in config
        assert "/.well-known/acme-challenge/" in config
        assert "ssl_certificate" not in config
        assert "443" not in config


@pytest.mark.unit
class TestDomainValidation:
    @pytest.mark.parametrize(
        "domain", ["logbook.example.org", "a.b", "fire-dept.example.co.uk"]
    )
    def test_accepts_hostnames(self, domain):
        assert _bash(f'valid_domain "{domain}"').returncode == 0

    @pytest.mark.parametrize(
        "domain",
        ["localhost", "-bad.example.org", "a/b.example.org", "x.org;rm", "a..b", ""],
    )
    def test_rejects_anything_else(self, domain):
        assert _bash(f'valid_domain "{domain}"').returncode != 0


@pytest.mark.unit
class TestArguments:
    def test_an_unknown_flag_is_refused(self):
        result = _bash("main logbook.example.org admin@example.org --weird")

        assert result.returncode == 1
        assert "Usage:" in result.stdout

    def test_a_bad_domain_is_refused_before_anything_else(self):
        result = _bash('main "bad domain" admin@example.org --docker')

        assert result.returncode == 1
        assert "is not a valid domain name" in result.stdout


@pytest.mark.unit
class TestDetectMode:
    def test_docker_when_the_frontend_container_is_running(self, tmp_path):
        docker = tmp_path / "docker"
        docker.write_text("#!/bin/sh\necho intranet-backend\necho intranet-frontend\n")
        docker.chmod(0o755)

        result = _bash("detect_mode", env={"PATH": f"{tmp_path}:/usr/bin:/bin"})

        if Path("/etc/systemd/system/logbook-backend.service").exists():
            pytest.skip("this machine has a traditional install, which wins")
        assert result.returncode == 0
        assert result.stdout.strip() == "docker"

    def test_unknown_when_neither_is_present(self, tmp_path):
        docker = tmp_path / "docker"
        docker.write_text("#!/bin/sh\nexit 0\n")
        docker.chmod(0o755)

        result = _bash("detect_mode", env={"PATH": f"{tmp_path}:/usr/bin:/bin"})

        if Path("/etc/systemd/system/logbook-backend.service").exists():
            pytest.skip("this machine has a traditional install")
        assert result.returncode != 0


@pytest.mark.unit
@pytest.mark.skipif(shutil.which("nginx") is None, reason="nginx is not installed")
class TestNginxAcceptsTheConfigs:
    """Have a real nginx parse the generated files, as `nginx -t` does on a server."""

    @pytest.fixture
    def certs(self, tmp_path):
        cert = tmp_path / "cert.pem"
        key = tmp_path / "key.pem"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=logbook.example.org",
                "-keyout",
                str(key),
                "-out",
                str(cert),
            ],
            check=True,
            capture_output=True,
        )
        return cert, key

    @staticmethod
    def _free_port() -> int:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]

    def _nginx_t(self, tmp_path, certs, *configs: str) -> subprocess.CompletedProcess:
        cert, key = certs
        includes = []
        # `nginx -t` opens every listening socket, and an unprivileged CI
        # runner may not bind 80 or 443, so each port moves to a free one.
        ports: dict[str, str] = {}

        def move_port(match: re.Match) -> str:
            port = ports.setdefault(match[2], str(self._free_port()))
            return f"{match[1]}{port}"

        for i, config in enumerate(configs):
            # Point at throwaway certificates, and drop IPv6 listeners, which
            # a container without IPv6 cannot open even for a syntax test.
            config = (
                config.replace(
                    "/etc/letsencrypt/live/logbook.example.org/fullchain.pem", str(cert)
                )
                .replace(
                    "/etc/letsencrypt/live/logbook.example.org/privkey.pem", str(key)
                )
                .replace(
                    "/etc/letsencrypt/live/logbook.example.org/chain.pem", str(cert)
                )
            )
            config = "\n".join(
                line for line in config.splitlines() if "listen [::]" not in line
            )
            config = re.sub(r"(listen\s+(?:[\d.]+:)?)(\d+)", move_port, config)
            path = tmp_path / f"site{i}.conf"
            path.write_text(config.replace("/var/log/nginx/", f"{tmp_path}/"))
            includes.append(f"include {path};")
        main = tmp_path / "nginx.conf"
        mime = Path("/etc/nginx/mime.types")
        main.write_text(
            f"pid {tmp_path}/nginx.pid;\nerror_log {tmp_path}/error.log;\n"
            "events {}\nhttp {\n"
            # nginx opens its compiled-in access log unless the http block
            # names one, and an unprivileged CI runner cannot open that.
            f"access_log {tmp_path}/access.log;\n"
            + (f"include {mime};\n" if mime.exists() else "")
            + "\n".join(includes)
            + "\n}\n"
        )
        return subprocess.run(
            ["nginx", "-t", "-c", str(main), "-p", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=20,
        )

    def test_acme_config(self, tmp_path, certs):
        result = self._nginx_t(
            tmp_path, certs, _render("render_acme_config", "logbook.example.org")
        )
        assert result.returncode == 0, result.stderr

    def test_docker_config(self, tmp_path, certs):
        site = _render("render_site_config", "docker", "logbook.example.org", str(REPO))
        result = self._nginx_t(tmp_path, certs, site)
        assert result.returncode == 0, result.stderr

    def test_traditional_configs_load_together(self, tmp_path, certs):
        site = _render(
            "render_site_config", "traditional", "logbook.example.org", str(REPO)
        )
        frontend = _render("render_frontend_config", str(REPO))
        result = self._nginx_t(tmp_path, certs, site, frontend)
        assert result.returncode == 0, result.stderr
