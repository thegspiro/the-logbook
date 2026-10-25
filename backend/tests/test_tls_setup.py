"""TLS between the application, MySQL/MariaDB and Redis.

Drives the real certificate generator and the real server wrappers, and, where
the sandbox has them, the real servers: nothing in the handshake is mocked.
"""

import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path

import pytest

REPO = Path(__file__).parents[2]
SETUP = REPO / "scripts" / "tls-setup.sh"
DB_TLS = REPO / "scripts" / "db_tls.sh"
MYSQL_WRAPPER = REPO / "database" / "tls-entrypoint.sh"
REDIS_WRAPPER = REPO / "infrastructure" / "redis" / "tls-entrypoint.sh"
SIDECAR = REPO / "scripts" / "backup-sidecar.sh"

needs_openssl = pytest.mark.skipif(
    shutil.which("openssl") is None, reason="openssl is required"
)
IS_ROOT = hasattr(os, "geteuid") and os.geteuid() == 0


def _run(cmd, env=None, timeout=120, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, env=env, timeout=timeout, **kw
    )


def _setup(tls: Path, *args: str) -> subprocess.CompletedProcess:
    return _run(
        ["bash", str(SETUP), "--tls-dir", str(tls), *args],
        env={"PATH": os.environ["PATH"], "HOME": str(tls.parent)},
    )


def _openssl(*args: str) -> str:
    result = _run(["openssl", *args])
    assert result.returncode == 0, result.stderr
    return result.stdout


def _fingerprint(cert: Path) -> str:
    return _openssl("x509", "-in", str(cert), "-noout", "-fingerprint", "-sha256")


@pytest.fixture(scope="module")
def tls(tmp_path_factory) -> Path:
    """One generated set shared by the read-only tests."""
    base = tmp_path_factory.mktemp("tls") / "tls"
    result = _setup(base)
    assert result.returncode == 0, result.stderr + result.stdout
    return base


def _ca_key(tls: Path) -> Path:
    return Path(f"{tls}-ca-private") / "ca.key"


@needs_openssl
@pytest.mark.unit
class TestGenerator:
    def test_writes_the_expected_files(self, tls):
        expected = {
            "ca.pem",
            "mysql/ca.pem",
            "mysql/server.pem",
            "mysql/server.key",
            "redis/ca.pem",
            "redis/server.pem",
            "redis/server.key",
            "backend/ca.pem",
            "backend/client.pem",
            "backend/client.key",
            "backend/mysql-server.pem",
            "backend/redis-server.pem",
            "backup/ca.pem",
            "backup/client.pem",
            "backup/client.key",
        }
        found = {str(p.relative_to(tls)) for p in tls.rglob("*") if p.is_file()}
        assert found == expected

    def test_the_ca_private_key_is_outside_every_mounted_directory(self, tls):
        assert _ca_key(tls).exists()
        assert oct(_ca_key(tls).stat().st_mode & 0o777) == "0o600"
        for path in tls.rglob("*"):
            if path.is_file():
                assert "PRIVATE KEY" not in path.read_text() or path.suffix == ".key"
                assert path.name != "ca.key"

    def test_each_private_key_sits_only_in_its_own_directory(self, tls):
        keys = sorted(str(p.relative_to(tls)) for p in tls.rglob("*.key"))
        assert keys == [
            "backend/client.key",
            "backup/client.key",
            "mysql/server.key",
            "redis/server.key",
        ]
        for key in tls.rglob("*.key"):
            assert oct(key.stat().st_mode & 0o777) == "0o600"

    def test_the_public_files_hold_no_private_key(self, tls):
        for pem in tls.rglob("*.pem"):
            assert "PRIVATE KEY" not in pem.read_text(), pem

    def test_every_certificate_verifies_against_the_ca(self, tls):
        for cert in (
            "mysql/server.pem",
            "redis/server.pem",
            "backend/client.pem",
            "backup/client.pem",
        ):
            out = _openssl("verify", "-CAfile", str(tls / "ca.pem"), str(tls / cert))
            assert out.strip().endswith("OK")

    def test_servers_name_the_services_and_clients_do_not_serve(self, tls):
        mysql = _openssl(
            "x509",
            "-in",
            str(tls / "mysql/server.pem"),
            "-noout",
            "-ext",
            "subjectAltName,extendedKeyUsage",
        )
        for name in (
            "DNS:mysql",
            "DNS:db",
            "DNS:intranet-mysql",
            "DNS:logbook-db",
            "DNS:localhost",
            "IP Address:127.0.0.1",
        ):
            assert name in mysql
        assert "TLS Web Server Authentication" in mysql
        redis = _openssl(
            "x509",
            "-in",
            str(tls / "redis/server.pem"),
            "-noout",
            "-ext",
            "subjectAltName",
        )
        assert "DNS:redis" in redis
        assert "DNS:logbook-redis" in redis
        client = _openssl(
            "x509",
            "-in",
            str(tls / "backend/client.pem"),
            "-noout",
            "-ext",
            "extendedKeyUsage",
        )
        assert "TLS Web Client Authentication" in client
        assert "Server" not in client

    def test_certificates_are_not_cas(self, tls):
        text = _openssl("x509", "-in", str(tls / "mysql/server.pem"), "-noout", "-text")
        assert "CA:FALSE" in text

    def test_lifetimes_are_a_year_for_leaves_and_ten_for_the_ca(self, tls):
        def days(cert: Path) -> int:
            out = _openssl("x509", "-in", str(cert), "-noout", "-dates")
            from datetime import datetime

            fmt = "%b %d %H:%M:%S %Y %Z"
            a = re.search(r"notBefore=(.*)", out).group(1)
            b = re.search(r"notAfter=(.*)", out).group(1)
            return (datetime.strptime(b, fmt) - datetime.strptime(a, fmt)).days

        assert days(tls / "mysql/server.pem") == 365
        assert days(tls / "backend/client.pem") == 365
        assert days(tls / "ca.pem") == 3650

    def test_serial_numbers_are_random_not_one(self, tls):
        serials = {
            _openssl("x509", "-in", str(tls / c), "-noout", "-serial")
            for c in ("mysql/server.pem", "redis/server.pem", "backend/client.pem")
        }
        assert len(serials) == 3
        assert not any(s.strip().endswith("=01") for s in serials)

    def test_check_reports_ok_and_exits_zero(self, tls):
        result = _setup(tls, "--check")
        assert result.returncode == 0, result.stdout
        assert "mysql/server.pem" in result.stdout

    def test_print_env_names_the_container_paths(self, tmp_path):
        result = _setup(tmp_path / "tls", "--print-env")
        assert result.returncode == 0
        for line in (
            "DB_SSL=true",
            "DB_SSL_CA=/etc/ssl/logbook-tls/ca.pem",
            "DB_SSL_CERT=/etc/ssl/logbook-tls/client.pem",
            "DB_SSL_KEY=/etc/ssl/logbook-tls/client.key",
            "REDIS_SSL=true",
            "BACKEND_REDIS_PORT=6380",
        ):
            assert line in result.stdout
        assert not (tmp_path / "tls").exists()

    def test_unknown_option_is_refused(self, tmp_path):
        assert _setup(tmp_path / "tls", "--nope").returncode != 0


@needs_openssl
@pytest.mark.unit
class TestLifecycle:
    def test_refuses_to_overwrite_an_existing_ca(self, tmp_path):
        tls = tmp_path / "tls"
        assert _setup(tls).returncode == 0
        before = _fingerprint(tls / "ca.pem")

        again = _setup(tls)

        assert again.returncode != 0
        assert "--renew" in again.stderr
        assert _fingerprint(tls / "ca.pem") == before

    def test_force_replaces_the_ca_and_everything_under_it(self, tmp_path):
        tls = tmp_path / "tls"
        _setup(tls)
        ca, leaf = _fingerprint(tls / "ca.pem"), _fingerprint(tls / "mysql/server.pem")

        result = _setup(tls, "--force")

        assert result.returncode == 0, result.stderr
        assert _fingerprint(tls / "ca.pem") != ca
        assert _fingerprint(tls / "mysql/server.pem") != leaf
        out = _openssl(
            "verify", "-CAfile", str(tls / "ca.pem"), str(tls / "mysql/server.pem")
        )
        assert out.strip().endswith("OK")

    def test_renew_keeps_the_ca_and_replaces_the_leaves(self, tmp_path):
        tls = tmp_path / "tls"
        _setup(tls)
        ca, leaf = _fingerprint(tls / "ca.pem"), _fingerprint(tls / "redis/server.pem")

        result = _setup(tls, "--renew", "--days", "30")

        assert result.returncode == 0, result.stderr
        assert _fingerprint(tls / "ca.pem") == ca
        assert _fingerprint(tls / "redis/server.pem") != leaf
        out = _openssl(
            "verify", "-CAfile", str(tls / "ca.pem"), str(tls / "redis/server.pem")
        )
        assert out.strip().endswith("OK")

    def test_renew_without_the_ca_key_is_refused(self, tmp_path):
        tls = tmp_path / "tls"
        _setup(tls)
        _ca_key(tls).unlink()

        result = _setup(tls, "--renew")

        assert result.returncode != 0
        assert "needs the existing CA" in result.stderr

    def test_check_exits_nonzero_when_a_certificate_is_close_to_expiry(self, tmp_path):
        tls = tmp_path / "tls"
        _setup(tls, "--days", "10")

        result = _setup(tls, "--check")

        assert result.returncode == 1
        assert "EXPIRES" in result.stdout

    def test_extra_names_reach_both_server_certificates(self, tmp_path):
        tls = tmp_path / "tls"

        _setup(tls, "--san", "db.example.org", "--san", "10.0.0.5")

        for cert in ("mysql/server.pem", "redis/server.pem"):
            text = _openssl(
                "x509", "-in", str(tls / cert), "-noout", "-ext", "subjectAltName"
            )
            assert "DNS:db.example.org" in text
            assert "IP Address:10.0.0.5" in text

    def test_a_ca_key_directory_can_be_chosen(self, tmp_path):
        tls, elsewhere = tmp_path / "tls", tmp_path / "vault"

        result = _setup(tls, "--ca-key-dir", str(elsewhere))

        assert result.returncode == 0, result.stderr
        assert (elsewhere / "ca.key").exists()
        assert not Path(f"{tls}-ca-private").exists()


STUB_ENTRYPOINT = """#!/bin/sh
printf '%s\\n' "$@" > "$STUB_ARGS"
"""


@pytest.fixture
def stub_path(tmp_path: Path) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "docker-entrypoint.sh"
    stub.write_text(STUB_ENTRYPOINT)
    stub.chmod(0o755)
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "STUB_ARGS": str(tmp_path / "args.txt"),
    }


def _wrapper(script: Path, env: dict[str, str], *args: str):
    result = _run(["sh", str(script), *args], env=env)
    assert result.returncode == 0, result.stderr
    argv = Path(env["STUB_ARGS"]).read_text().splitlines()
    return argv, result.stderr


@pytest.mark.unit
class TestServerWrappers:
    def test_mysql_without_certificates_starts_exactly_as_before(
        self, tmp_path, stub_path
    ):
        env = {**stub_path, "DB_TLS_DIR": str(tmp_path / "absent")}

        argv, err = _wrapper(
            MYSQL_WRAPPER, env, "--skip-log-bin", "--max_connections=5"
        )

        assert argv == ["--skip-log-bin", "--max_connections=5"]
        assert err == ""

    @needs_openssl
    def test_mysql_with_certificates_adds_the_tls_flags(self, tls, stub_path):
        env = {**stub_path, "DB_TLS_DIR": str(tls / "mysql")}

        argv, err = _wrapper(MYSQL_WRAPPER, env, "--skip-log-bin")

        assert argv[0] == "--skip-log-bin"
        assert f"--ssl-ca={tls}/mysql/ca.pem" in argv
        assert f"--ssl-cert={tls}/mysql/server.pem" in argv
        assert f"--ssl-key={tls}/mysql/server.key" in argv
        assert "--tls-version=TLSv1.2,TLSv1.3" in argv
        assert "TLS 1.2/1.3" in err

    def test_mysql_with_an_incomplete_directory_warns_and_starts_without_tls(
        self, tmp_path, stub_path
    ):
        (tmp_path / "tls").mkdir()
        (tmp_path / "tls" / "ca.pem").write_text("x")
        env = {**stub_path, "DB_TLS_DIR": str(tmp_path / "tls")}

        argv, err = _wrapper(MYSQL_WRAPPER, env, "--skip-log-bin")

        assert argv == ["--skip-log-bin"]
        assert "WITHOUT TLS" in err
        assert "server.pem(missing)" in err

    @pytest.mark.skipif(IS_ROOT, reason="root reads any file")
    @needs_openssl
    def test_an_unreadable_key_warns_instead_of_crashing_the_database(
        self, tls, tmp_path, stub_path
    ):
        copy = tmp_path / "mysql"
        shutil.copytree(tls / "mysql", copy)
        (copy / "server.key").chmod(0o000)
        env = {**stub_path, "DB_TLS_DIR": str(copy)}

        argv, err = _wrapper(MYSQL_WRAPPER, env, "--skip-log-bin")

        assert argv == ["--skip-log-bin"]
        assert "not readable" in err

    def test_redis_without_certificates_starts_exactly_as_before(
        self, tmp_path, stub_path
    ):
        env = {**stub_path, "REDIS_TLS_DIR": str(tmp_path / "absent")}

        argv, err = _wrapper(REDIS_WRAPPER, env, "redis-server", "--requirepass", "x")

        assert argv == ["redis-server", "--requirepass", "x"]
        assert err == ""

    @needs_openssl
    def test_redis_with_certificates_also_listens_for_tls_and_keeps_plaintext(
        self, tls, stub_path
    ):
        env = {**stub_path, "REDIS_TLS_DIR": str(tls / "redis")}

        argv, _ = _wrapper(REDIS_WRAPPER, env, "redis-server", "--requirepass", "x")

        assert argv[:3] == ["redis-server", "--requirepass", "x"]
        assert argv[argv.index("--tls-port") + 1] == "6380"
        assert argv[argv.index("--tls-auth-clients") + 1] == "optional"
        assert argv[argv.index("--tls-cert-file") + 1] == f"{tls}/redis/server.pem"
        assert argv[argv.index("--tls-key-file") + 1] == f"{tls}/redis/server.key"
        assert argv[argv.index("--tls-ca-cert-file") + 1] == f"{tls}/redis/ca.pem"
        assert "--port" not in argv, "the plaintext port must stay open in this step"

    @needs_openssl
    def test_redis_tls_port_can_be_changed(self, tls, stub_path):
        env = {
            **stub_path,
            "REDIS_TLS_DIR": str(tls / "redis"),
            "REDIS_TLS_PORT": "7777",
        }

        argv, _ = _wrapper(REDIS_WRAPPER, env, "redis-server")

        assert argv[argv.index("--tls-port") + 1] == "7777"

    @needs_openssl
    def test_redis_flags_are_not_added_to_some_other_command(self, tls, stub_path):
        env = {**stub_path, "REDIS_TLS_DIR": str(tls / "redis")}

        argv, err = _wrapper(REDIS_WRAPPER, env, "sh", "-c", "true")

        assert argv == ["sh", "-c", "true"]
        assert "not redis-server" in err

    def test_redis_with_an_incomplete_directory_starts_without_tls(
        self, tmp_path, stub_path
    ):
        (tmp_path / "r").mkdir()
        (tmp_path / "r" / "server.key").write_text("x")
        env = {**stub_path, "REDIS_TLS_DIR": str(tmp_path / "r")}

        argv, err = _wrapper(REDIS_WRAPPER, env, "redis-server")

        assert argv == ["redis-server"]
        assert "WITHOUT TLS" in err


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for(port: int, timeout: float = 15.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as s:
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.2)
    raise AssertionError(f"nothing listening on {port}")


@needs_openssl
@pytest.mark.skipif(
    shutil.which("redis-server") is None, reason="redis-server not installed"
)
@pytest.mark.unit
class TestRealRedis:
    @pytest.fixture
    def server(self, tls, tmp_path, stub_path):
        plain, secure = _free_port(), _free_port()
        env = {
            **stub_path,
            "REDIS_TLS_DIR": str(tls / "redis"),
            "REDIS_TLS_PORT": str(secure),
        }
        # The stub entrypoint only records arguments, so run redis-server the
        # way the real entrypoint would: with the arguments the wrapper built.
        built = _run(
            [
                "sh",
                str(REDIS_WRAPPER),
                "redis-server",
                "--port",
                str(plain),
                "--requirepass",
                "pw",
                "--save",
                "",
                "--dir",
                str(tmp_path),
            ],
            env=env,
        )
        assert built.returncode == 0, built.stderr
        argv = Path(env["STUB_ARGS"]).read_text().splitlines()
        proc = subprocess.Popen(
            argv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:
            _wait_for(plain)
            _wait_for(secure)
            yield plain, secure
        finally:
            proc.terminate()
            proc.wait(timeout=10)

    def _client(self, tls, port, *, ca=True, cert=True, host="localhost"):
        import redis

        kwargs = dict(host=host, port=port, password="pw", socket_timeout=5)
        if port:
            kwargs.update(
                ssl=True,
                ssl_ca_certs=str(tls / "ca.pem") if ca else None,
                ssl_check_hostname=True,
            )
            if cert:
                kwargs.update(
                    ssl_certfile=str(tls / "backend/client.pem"),
                    ssl_keyfile=str(tls / "backend/client.key"),
                )
        return redis.Redis(**kwargs)

    def test_plaintext_still_works_in_this_step(self, server):
        import redis

        plain, _ = server
        assert redis.Redis(host="127.0.0.1", port=plain, password="pw").ping()

    def test_tls_with_a_client_certificate_verifies_and_connects(self, server, tls):
        _, secure = server
        assert self._client(tls, secure).ping()

    def test_tls_without_a_client_certificate_is_accepted_for_now(self, server, tls):
        _, secure = server
        assert self._client(tls, secure, cert=False).ping()

    def test_a_server_not_signed_by_our_ca_is_refused(self, server, tmp_path):
        import redis

        other = tmp_path / "other"
        assert _setup(other).returncode == 0
        _, secure = server
        client = redis.Redis(
            host="localhost",
            port=secure,
            password="pw",
            ssl=True,
            ssl_ca_certs=str(other / "ca.pem"),
            ssl_check_hostname=True,
        )
        with pytest.raises(redis.exceptions.ConnectionError):
            client.ping()

    def test_a_wrong_server_name_is_refused(self, server, tls):
        import redis

        _, secure = server
        with pytest.raises(redis.exceptions.ConnectionError):
            self._client(tls, secure, host="127.0.0.2").ping()

    def test_the_applications_own_context_connects(self, server, tls, monkeypatch):
        import asyncio

        from app.core import cache as cache_module

        _, secure = server
        monkeypatch.setattr(cache_module.settings, "REDIS_SSL", True)
        monkeypatch.setattr(cache_module.settings, "REDIS_HOST", "localhost")
        monkeypatch.setattr(cache_module.settings, "REDIS_PORT", secure)
        monkeypatch.setattr(cache_module.settings, "REDIS_PASSWORD", "pw")
        monkeypatch.setattr(cache_module.settings, "REDIS_SSL_CA", str(tls / "ca.pem"))
        monkeypatch.setattr(
            cache_module.settings, "REDIS_SSL_CERT", str(tls / "backend/client.pem")
        )
        monkeypatch.setattr(
            cache_module.settings, "REDIS_SSL_KEY", str(tls / "backend/client.key")
        )

        async def go():
            manager = cache_module.CacheManager()
            await manager.connect()
            try:
                return await manager.redis.ping()
            finally:
                await manager.disconnect()

        assert asyncio.run(go()) is True


@pytest.mark.unit
class TestClientSettings:
    def test_the_database_context_presents_the_client_certificate(
        self, tls, monkeypatch
    ):
        from app.core.config import Settings

        settings = Settings(
            DB_SSL=True,
            DB_SSL_CA=str(tls / "ca.pem"),
            DB_SSL_CERT=str(tls / "backend/client.pem"),
            DB_SSL_KEY=str(tls / "backend/client.key"),
        )

        ctx = settings.get_db_connect_args()["ssl"]

        assert ctx.verify_mode.name == "CERT_REQUIRED"
        assert ctx.check_hostname is True

    def test_without_a_client_certificate_nothing_is_loaded(self, tls):
        from app.core.config import Settings

        ctx = Settings(
            DB_SSL=True, DB_SSL_CA=str(tls / "ca.pem")
        ).get_db_connect_args()["ssl"]

        assert ctx.verify_mode.name == "CERT_REQUIRED"

    def test_a_missing_client_key_file_fails_when_the_context_is_built(self, tls):
        from app.core.config import Settings

        settings = Settings(
            DB_SSL=True,
            DB_SSL_CA=str(tls / "ca.pem"),
            DB_SSL_CERT=str(tls / "backend/client.pem"),
            DB_SSL_KEY=str(tls / "nope.key"),
        )

        with pytest.raises(FileNotFoundError):
            settings.get_db_connect_args()

    @pytest.mark.parametrize(
        "kwargs",
        [
            {"DB_SSL_CERT": "/c.pem"},
            {"DB_SSL_KEY": "/c.key"},
            {"REDIS_SSL_CERT": "/c.pem"},
            {"REDIS_SSL_KEY": "/c.key"},
        ],
    )
    def test_half_a_client_certificate_is_a_critical_finding(self, kwargs):
        from app.core.config import Settings

        findings = Settings(**kwargs).validate_security_config()

        assert any(
            f.startswith("CRITICAL") and "must be set together" in f for f in findings
        )

    def test_a_complete_pair_is_not(self):
        from app.core.config import Settings

        findings = Settings(
            DB_SSL_CERT="/c.pem",
            DB_SSL_KEY="/c.key",
            REDIS_SSL_CERT="/r.pem",
            REDIS_SSL_KEY="/r.key",
        ).validate_security_config()

        assert not any("must be set together" in f for f in findings)

    def test_preflight_names_an_unreadable_client_certificate(self, tls):
        from app.core.config import Settings
        from app.preflight import _unreadable_ca_paths

        settings = Settings(
            DB_SSL=True,
            DB_SSL_CA=str(tls / "ca.pem"),
            DB_SSL_CERT="/nonexistent/client.pem",
            DB_SSL_KEY=str(tls / "backend/client.key"),
        )

        problems = _unreadable_ca_paths(settings)

        assert [p[0] for p in problems] == ["DB_SSL_CERT"]

    def test_redis_options_use_the_arguments_redis_py_accepts(self, tls, monkeypatch):
        """redis-py's asyncio client takes ssl_* keywords, not ssl=/SSLContext."""
        import asyncio

        from app.core import cache as cache_module

        captured: dict = {}

        class Stop(Exception):
            pass

        def fake_from_url(url, **kwargs):
            captured.update(kwargs, url=url)
            raise Stop

        monkeypatch.setattr(
            cache_module.redis.Redis, "from_url", staticmethod(fake_from_url)
        )
        for name, value in {
            "REDIS_SSL": True,
            "REDIS_SSL_CA": str(tls / "ca.pem"),
            "REDIS_SSL_CERT": str(tls / "backend/client.pem"),
            "REDIS_SSL_KEY": str(tls / "backend/client.key"),
            "REDIS_CONNECT_RETRIES": 1,
        }.items():
            monkeypatch.setattr(cache_module.settings, name, value)

        asyncio.run(cache_module.CacheManager().connect())

        assert captured["url"].startswith("rediss://")
        assert "ssl" not in captured
        assert captured["ssl_ca_certs"] == str(tls / "ca.pem")
        assert captured["ssl_cert_reqs"] == "required"
        assert captured["ssl_check_hostname"] is True
        assert captured["ssl_certfile"] == str(tls / "backend/client.pem")
        assert captured["ssl_keyfile"] == str(tls / "backend/client.key")

    def test_redis_without_a_ca_encrypts_but_does_not_verify(self, monkeypatch):
        import asyncio

        from app.core import cache as cache_module

        captured: dict = {}

        def fake_from_url(url, **kwargs):
            captured.update(kwargs)
            raise RuntimeError

        monkeypatch.setattr(
            cache_module.redis.Redis, "from_url", staticmethod(fake_from_url)
        )
        for name, value in {
            "REDIS_SSL": True,
            "REDIS_SSL_CA": "",
            "REDIS_SSL_CERT": "",
            "REDIS_SSL_KEY": "",
            "REDIS_CONNECT_RETRIES": 1,
        }.items():
            monkeypatch.setattr(cache_module.settings, name, value)

        asyncio.run(cache_module.CacheManager().connect())

        assert captured["ssl_cert_reqs"] == "none"
        assert captured["ssl_check_hostname"] is False
        assert "ssl_certfile" not in captured


def _db_tls(
    env_dir: Path | None,
    body: str = 'db_tls_args; echo "rc=$?"; printf "%s\\n" "${DB_TLS_ARGS[@]}"',
):
    env = {"PATH": os.environ["PATH"]}
    if env_dir is not None:
        env["DB_TLS_DIR"] = str(env_dir)
    return _run(["bash", "-c", f'source "{DB_TLS}"\n{body}'], env=env)


@pytest.mark.unit
class TestDbTlsArgs:
    def test_unset_means_no_arguments(self):
        out = _db_tls(None).stdout.splitlines()
        assert out[0] == "rc=0"
        assert [line for line in out[1:] if line] == []

    def test_a_missing_or_empty_directory_means_no_arguments(self, tmp_path):
        (tmp_path / "empty").mkdir()
        for target in (tmp_path / "absent", tmp_path / "empty"):
            out = _db_tls(target).stdout.splitlines()
            assert out[0] == "rc=0"
            assert [line for line in out[1:] if line] == []

    def test_a_complete_directory_verifies_the_server_and_presents_a_certificate(
        self, tmp_path
    ):
        for name in ("ca.pem", "client.pem", "client.key"):
            (tmp_path / name).write_text("x")

        out = _db_tls(tmp_path).stdout.splitlines()

        assert out[0] == "rc=0"
        assert out[1:] == [
            "--ssl-mode=VERIFY_IDENTITY",
            f"--ssl-ca={tmp_path}/ca.pem",
            f"--ssl-cert={tmp_path}/client.pem",
            f"--ssl-key={tmp_path}/client.key",
        ]

    def test_a_partial_directory_is_an_error_not_a_silent_plaintext_fallback(
        self, tmp_path
    ):
        (tmp_path / "ca.pem").write_text("x")

        result = _db_tls(tmp_path)

        assert result.stdout.splitlines()[0] == "rc=1"
        assert "refusing to connect without TLS" in result.stderr


DUMP_STUB = """#!/bin/bash
printf '%s\\n' "$@" > "$STUB_ARGS"
echo "-- dump"
echo "INSERT INTO t VALUES (1);"
"""


@pytest.mark.unit
class TestSidecarTls:
    def _env(self, tmp_path: Path):
        bin_dir = tmp_path / "bin"
        bin_dir.mkdir()
        stub = bin_dir / "mysqldump"
        stub.write_text(DUMP_STUB)
        stub.chmod(0o755)
        (tmp_path / "backups").mkdir()
        (tmp_path / "keys").mkdir()
        return {
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "RUN_ONCE": "1",
            "VERIFY_EVERY_N_BACKUPS": "0",
            "DB_PASSWORD": "pw",
            "BACKUP_DIR": str(tmp_path / "backups"),
            "BACKUP_KEYS_DIR": str(tmp_path / "keys"),
            "TMPDIR": str(tmp_path),
            "STUB_ARGS": str(tmp_path / "dump_args.txt"),
        }

    def test_with_certificates_the_dump_connects_over_verified_tls(self, tmp_path):
        env = self._env(tmp_path)
        tlsd = tmp_path / "tlsd"
        tlsd.mkdir()
        for name in ("ca.pem", "client.pem", "client.key"):
            (tlsd / name).write_text("x")
        env["DB_TLS_DIR"] = str(tlsd)

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode == 0, result.stderr + result.stdout
        args = Path(env["STUB_ARGS"]).read_text().splitlines()
        assert "--ssl-mode=VERIFY_IDENTITY" in args
        assert f"--ssl-ca={tlsd}/ca.pem" in args
        assert f"--ssl-cert={tlsd}/client.pem" in args

    def test_without_certificates_it_connects_as_before(self, tmp_path):
        env = self._env(tmp_path)

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode == 0, result.stderr + result.stdout
        args = Path(env["STUB_ARGS"]).read_text().splitlines()
        assert not any(a.startswith("--ssl") for a in args)

    def test_a_partial_directory_aborts_the_run_and_publishes_nothing(self, tmp_path):
        env = self._env(tmp_path)
        tlsd = tmp_path / "tlsd"
        tlsd.mkdir()
        (tlsd / "client.pem").write_text("x")
        env["DB_TLS_DIR"] = str(tlsd)

        result = _run(["bash", str(SIDECAR)], env=env)

        assert result.returncode != 0
        assert "incomplete" in result.stderr
        assert not [
            p for p in (tmp_path / "backups").iterdir() if p.name.startswith("logbook_")
        ]
        assert not Path(env["STUB_ARGS"]).exists(), "mysqldump must not have been run"


STACKS = {
    "docker-compose.yml": {
        "mysql": "mysql",
        "redis": "redis",
        "tls": "${TLS_DIR:-./tls}",
    },
    "unraid/docker-compose-unraid.yml": {
        "mysql": "db",
        "redis": "redis",
        "tls": "/mnt/user/appdata/the-logbook/tls",
    },
    "unraid/docker-compose-build-from-source.yml": {
        "mysql": "db",
        "redis": "redis",
        "tls": "/mnt/user/appdata/the-logbook/tls",
    },
}


def _service(text: str, name: str) -> str:
    """The text of one top-level service, without a YAML parser (the production
    file uses !reset/!override tags)."""
    match = re.search(rf"(?m)^  {re.escape(name)}:\n((?:(?:    .*|\s*)\n)+)", text)
    assert match, f"service {name} not found"
    return match.group(1)


@pytest.mark.unit
class TestComposeWiring:
    @pytest.mark.parametrize("path", sorted(STACKS))
    def test_database_gets_the_wrapper_and_its_certificates(self, path):
        text = (REPO / path).read_text()
        spec = STACKS[path]
        block = _service(text, spec["mysql"])

        assert 'entrypoint: ["sh", "/tls-entrypoint.sh"]' in block
        assert "./database/tls-entrypoint.sh:/tls-entrypoint.sh:ro" in block
        assert f'{spec["tls"]}/mysql:/etc/mysql/tls:ro' in block

    @pytest.mark.parametrize("path", sorted(STACKS))
    def test_redis_gets_the_wrapper_and_its_certificates(self, path):
        text = (REPO / path).read_text()
        spec = STACKS[path]
        block = _service(text, spec["redis"])

        assert 'entrypoint: ["sh", "/tls-entrypoint.sh"]' in block
        assert "./infrastructure/redis/tls-entrypoint.sh:/tls-entrypoint.sh:ro" in block
        assert f'{spec["tls"]}/redis:/etc/redis/tls:ro' in block

    @pytest.mark.parametrize("path", sorted(STACKS))
    def test_backend_mounts_its_client_certificate_and_reads_the_settings(self, path):
        text = (REPO / path).read_text()
        spec = STACKS[path]
        block = _service(text, "backend")

        assert f'{spec["tls"]}/backend:/etc/ssl/logbook-tls:ro' in block
        for name in ("DB_SSL_CERT", "DB_SSL_KEY", "REDIS_SSL_CERT", "REDIS_SSL_KEY"):
            assert f"{name}: ${{{name}:-}}" in block
        assert "REDIS_PORT: ${BACKEND_REDIS_PORT:-6379}" in block

    def test_the_production_override_restates_the_mount_it_would_otherwise_drop(self):
        block = _service((REPO / "docker-compose.prod.yml").read_text(), "backend")

        assert "${TLS_DIR:-./tls}/backend:/etc/ssl/logbook-tls:ro" in block
        assert "DB_SSL_CERT: ${DB_SSL_CERT:-}" in block

    @pytest.mark.parametrize(
        ("path", "tls"),
        [
            ("docker-compose.prod.yml", "${TLS_DIR:-./tls}"),
            ("unraid/docker-compose-unraid.yml", "/mnt/user/appdata/the-logbook/tls"),
            (
                "unraid/docker-compose-build-from-source.yml",
                "/mnt/user/appdata/the-logbook/tls",
            ),
        ],
    )
    def test_the_backup_sidecar_gets_its_client_certificate(self, path, tls):
        block = _service((REPO / path).read_text(), "backup")

        assert f"{tls}/backup:/tls:ro" in block
        assert "DB_TLS_DIR: /tls" in block

    @pytest.mark.parametrize("script", [MYSQL_WRAPPER, REDIS_WRAPPER, SETUP, DB_TLS])
    def test_scripts_exist_and_the_wrappers_are_runnable_by_sh(self, script):
        assert script.exists()
        shell = "sh" if script in (MYSQL_WRAPPER, REDIS_WRAPPER) else "bash"
        assert _run([shell, "-n", str(script)]).returncode == 0

    def test_generated_directories_are_not_committed(self):
        ignore = (REPO / ".gitignore").read_text().splitlines()
        assert "/tls/" in ignore
        assert "/tls-ca-private/" in ignore


_MARIADB = shutil.which("mariadbd")
_INSTALL_DB = shutil.which("mariadb-install-db") or shutil.which("mysql_install_db")


@needs_openssl
@pytest.mark.skipif(
    not (_MARIADB and _INSTALL_DB), reason="mariadbd / mariadb-install-db not installed"
)
@pytest.mark.unit
class TestRealMariaDb:
    """The flags the wrapper adds are accepted by a real server, and the
    application's own connection arguments verify it and present a client
    certificate."""

    @pytest.fixture
    def server(self, tls, tmp_path, stub_path):
        data, sock = tmp_path / "data", tmp_path / "m.sock"
        init = _run(
            [
                _INSTALL_DB,
                "--no-defaults",
                f"--datadir={data}",
                "--auth-root-authentication-method=normal",
            ]
        )
        assert init.returncode == 0, init.stderr
        port = _free_port()
        env = {**stub_path, "DB_TLS_DIR": str(tls / "mysql")}
        built = _run(["sh", str(MYSQL_WRAPPER), "--skip-name-resolve"], env=env)
        assert built.returncode == 0, built.stderr
        flags = Path(env["STUB_ARGS"]).read_text().splitlines()
        user = ["--user=root"] if IS_ROOT else []
        proc = subprocess.Popen(
            [
                _MARIADB,
                "--no-defaults",
                *user,
                f"--datadir={data}",
                f"--port={port}",
                f"--socket={sock}",
                "--bind-address=127.0.0.1",
                f"--pid-file={tmp_path / 'm.pid'}",
                *flags,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            _wait_for(port, timeout=40)
            admin = shutil.which("mariadb") or shutil.which("mysql")
            sql = (
                "CREATE USER 'app'@'%' IDENTIFIED BY 'pw'; "
                "GRANT ALL ON *.* TO 'app'@'%';"
            )
            made = _run([admin, "--no-defaults", "-uroot", f"-S{sock}", "-e", sql])
            assert made.returncode == 0, made.stderr
            yield port, admin, sock
        finally:
            proc.terminate()
            proc.wait(timeout=20)

    def _connect(self, port, tls, **ssl_args):
        import pymysql

        return pymysql.connect(
            host="127.0.0.1",
            port=port,
            user="app",
            password="pw",
            ssl=ssl_args or None,
            connect_timeout=5,
        )

    def test_the_application_verifies_the_server_and_connects_encrypted(
        self, server, tls
    ):
        from app.core.config import Settings

        port, _, _ = server
        args = Settings(
            DB_SSL=True,
            DB_SSL_CA=str(tls / "ca.pem"),
            DB_SSL_CERT=str(tls / "backend/client.pem"),
            DB_SSL_KEY=str(tls / "backend/client.key"),
        ).get_db_connect_args()
        args.pop("init_command")
        import pymysql

        conn = pymysql.connect(
            host="127.0.0.1", port=port, user="app", password="pw", **args
        )
        cur = conn.cursor()
        cur.execute("SHOW STATUS LIKE 'Ssl_cipher'")
        assert cur.fetchone()[1].startswith("TLS_")
        conn.close()

    def test_a_server_certificate_from_another_ca_is_refused(self, server, tmp_path):
        import pymysql

        port, _, _ = server
        other = tmp_path / "other"
        assert _setup(other).returncode == 0
        with pytest.raises(pymysql.err.OperationalError):
            self._connect(port, other, ca=str(other / "ca.pem"), check_hostname=True)

    def test_a_client_certificate_can_be_made_mandatory_per_account(self, server, tls):
        import pymysql

        port, admin, sock = server
        done = _run(
            [
                admin,
                "--no-defaults",
                "-uroot",
                f"-S{sock}",
                "-e",
                "ALTER USER 'app'@'%' REQUIRE X509;",
            ]
        )
        assert done.returncode == 0, done.stderr
        with pytest.raises(pymysql.err.OperationalError):
            self._connect(port, tls, ca=str(tls / "ca.pem"))
        conn = self._connect(
            port,
            tls,
            ca=str(tls / "ca.pem"),
            cert=str(tls / "backend/client.pem"),
            key=str(tls / "backend/client.key"),
        )
        conn.close()
