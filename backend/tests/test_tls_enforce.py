"""Refusing plaintext: the DB_REQUIRE_TLS / REDIS_REQUIRE_TLS switches, the
Redis health check that keeps working once the plaintext port is closed, and
scripts/tls-enforce.sh, which says whether flipping the switches is safe.

Real redis-server and mariadbd are driven wherever the sandbox has them; the
`docker` and `mysql` commands around them are small stubs.
"""

import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

from tests.test_tls_setup import (
    DB_TLS,
    IS_ROOT,
    MYSQL_WRAPPER,
    REDIS_WRAPPER,
    REPO,
    STUB_ENTRYPOINT,
    _free_port,
    _run,
    _setup,
    _wait_for,
    needs_openssl,
)

ENFORCE = REPO / "scripts" / "tls-enforce.sh"
REDIS_HEALTH = REPO / "infrastructure" / "redis" / "healthcheck.sh"
_MARIADB = shutil.which("mariadbd")
_INSTALL_DB = shutil.which("mariadb-install-db") or shutil.which("mysql_install_db")
_REDIS = shutil.which("redis-server")


@pytest.fixture(scope="module")
def tls(tmp_path_factory) -> Path:
    base = tmp_path_factory.mktemp("enforce") / "tls"
    result = _setup(base)
    assert result.returncode == 0, result.stderr + result.stdout
    return base


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


def _args(env) -> list[str]:
    return Path(env["STUB_ARGS"]).read_text().splitlines()


def _executable(path: Path, body: str) -> Path:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


@needs_openssl
@pytest.mark.unit
class TestDatabaseWrapperSwitch:
    @pytest.mark.parametrize("value", ["true", "TRUE", "True", "1", "yes", "on"])
    def test_the_switch_adds_secure_transport(self, tls, stub_path, value):
        env = {**stub_path, "DB_TLS_DIR": str(tls / "mysql"), "DB_REQUIRE_TLS": value}

        result = _run(["sh", str(MYSQL_WRAPPER), "--skip-log-bin"], env=env)

        assert result.returncode == 0, result.stderr
        assert "--require-secure-transport=ON" in _args(env)
        assert "refusing unencrypted TCP" in result.stderr

    @pytest.mark.parametrize("value", [None, "", "false", "0", "no", "off", "maybe"])
    def test_anything_else_leaves_plaintext_alone(self, tls, stub_path, value):
        env = {**stub_path, "DB_TLS_DIR": str(tls / "mysql")}
        if value is not None:
            env["DB_REQUIRE_TLS"] = value

        result = _run(["sh", str(MYSQL_WRAPPER)], env=env)

        assert result.returncode == 0, result.stderr
        assert "--require-secure-transport=ON" not in _args(env)

    def test_required_without_certificates_refuses_to_start(self, tmp_path, stub_path):
        env = {
            **stub_path,
            "DB_TLS_DIR": str(tmp_path / "absent"),
            "DB_REQUIRE_TLS": "true",
        }

        result = _run(["sh", str(MYSQL_WRAPPER), "--skip-log-bin"], env=env)

        assert result.returncode == 1
        assert "DB_REQUIRE_TLS=true but TLS cannot be offered" in result.stderr
        assert not Path(env["STUB_ARGS"]).exists(), "the server must not start"

    def test_required_with_an_incomplete_directory_refuses_to_start(
        self, tls, tmp_path, stub_path
    ):
        partial = tmp_path / "partial"
        partial.mkdir()
        shutil.copy(tls / "mysql" / "ca.pem", partial)
        env = {**stub_path, "DB_TLS_DIR": str(partial), "DB_REQUIRE_TLS": "true"}

        result = _run(["sh", str(MYSQL_WRAPPER)], env=env)

        assert result.returncode == 1
        assert "server.key(missing)" in result.stderr
        assert not Path(env["STUB_ARGS"]).exists()

    def test_not_required_still_starts_without_certificates(self, tmp_path, stub_path):
        env = {**stub_path, "DB_TLS_DIR": str(tmp_path / "absent")}

        result = _run(["sh", str(MYSQL_WRAPPER), "--skip-log-bin"], env=env)

        assert result.returncode == 0
        assert _args(env) == ["--skip-log-bin"]


@needs_openssl
@pytest.mark.unit
class TestRedisWrapperSwitch:
    def _env(self, tls, stub_path, **extra):
        return {**stub_path, "REDIS_TLS_DIR": str(tls / "redis"), **extra}

    def test_the_switch_closes_the_plaintext_port_and_requires_certificates(
        self, tls, stub_path
    ):
        env = self._env(tls, stub_path, REDIS_REQUIRE_TLS="true")

        result = _run(
            ["sh", str(REDIS_WRAPPER), "redis-server", "--port", "6379"], env=env
        )

        argv = _args(env)
        assert result.returncode == 0, result.stderr
        assert argv[argv.index("--tls-auth-clients") + 1] == "yes"
        assert "optional" not in argv
        assert argv[-6:-4] == ["--port", "0"], "the last --port wins in Redis"
        assert argv[argv.index("--unixsocketperm") + 1] == "700"
        assert "/tmp/redis-health.sock" in argv

    def test_without_the_switch_clients_stay_optional_and_the_port_stays_open(
        self, tls, stub_path
    ):
        env = self._env(tls, stub_path)

        _run(["sh", str(REDIS_WRAPPER), "redis-server", "--port", "6379"], env=env)

        argv = _args(env)
        assert argv[argv.index("--tls-auth-clients") + 1] == "optional"
        assert argv.count("--port") == 1
        assert "--unixsocket" not in argv

    def test_required_without_certificates_refuses_to_start(self, tmp_path, stub_path):
        env = {
            **stub_path,
            "REDIS_TLS_DIR": str(tmp_path / "absent"),
            "REDIS_REQUIRE_TLS": "true",
        }

        result = _run(["sh", str(REDIS_WRAPPER), "redis-server"], env=env)

        assert result.returncode == 1
        assert "REDIS_REQUIRE_TLS=true but TLS cannot be offered" in result.stderr
        assert not Path(env["STUB_ARGS"]).exists()

    def test_required_with_a_command_that_is_not_redis_server_refuses(
        self, tls, stub_path
    ):
        env = self._env(tls, stub_path, REDIS_REQUIRE_TLS="true")

        result = _run(["sh", str(REDIS_WRAPPER), "redis-sentinel"], env=env)

        assert result.returncode == 1
        assert "command is not redis-server" in result.stderr


@needs_openssl
@pytest.mark.skipif(_REDIS is None, reason="redis-server not installed")
@pytest.mark.unit
class TestRealRedisEnforced:
    @pytest.fixture
    def server(self, tls, tmp_path, stub_path):
        plain, secure = _free_port(), _free_port()
        sock = tmp_path / "health.sock"
        env = {
            **stub_path,
            "REDIS_TLS_DIR": str(tls / "redis"),
            "REDIS_TLS_PORT": str(secure),
            "REDIS_REQUIRE_TLS": "true",
            "REDIS_HEALTH_SOCKET": str(sock),
        }
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
        proc = subprocess.Popen(
            _args(env), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:
            _wait_for(secure)
            yield plain, secure, sock
        finally:
            proc.terminate()
            proc.wait(timeout=10)

    def _client(self, tls, port, *, cert=True):
        import redis

        kwargs = dict(
            host="localhost",
            port=port,
            password="pw",
            socket_timeout=5,
            ssl=True,
            ssl_ca_certs=str(tls / "ca.pem"),
            ssl_check_hostname=True,
        )
        if cert:
            kwargs.update(
                ssl_certfile=str(tls / "backend/client.pem"),
                ssl_keyfile=str(tls / "backend/client.key"),
            )
        return redis.Redis(**kwargs)

    def test_the_plaintext_port_is_closed(self, server):
        import redis

        plain, _, _ = server
        with pytest.raises(redis.exceptions.ConnectionError):
            redis.Redis(host="127.0.0.1", port=plain, password="pw").ping()

    def test_tls_with_a_client_certificate_connects(self, server, tls):
        _, secure, _ = server
        assert self._client(tls, secure).ping()

    def test_tls_without_a_client_certificate_is_refused(self, server, tls):
        import redis

        _, secure, _ = server
        with pytest.raises(redis.exceptions.RedisError):
            self._client(tls, secure, cert=False).ping()

    def test_the_server_certificate_is_not_a_client_certificate(self, server, tls):
        """The server pair carries serverAuth only; it must not open the door."""
        import redis

        _, secure, _ = server
        client = redis.Redis(
            host="localhost",
            port=secure,
            password="pw",
            ssl=True,
            ssl_ca_certs=str(tls / "ca.pem"),
            ssl_certfile=str(tls / "redis/server.pem"),
            ssl_keyfile=str(tls / "redis/server.key"),
        )
        with pytest.raises(redis.exceptions.RedisError):
            client.ping()

    def test_the_health_check_passes_through_the_socket(self, server):
        _, _, sock = server
        env = {
            "PATH": os.environ["PATH"],
            "REDIS_REQUIRE_TLS": "true",
            "REDIS_PASSWORD": "pw",
            "REDIS_HEALTH_SOCKET": str(sock),
        }

        assert _run(["sh", str(REDIS_HEALTH)], env=env).returncode == 0

    def test_the_health_check_fails_with_the_wrong_password(self, server):
        _, _, sock = server
        env = {
            "PATH": os.environ["PATH"],
            "REDIS_REQUIRE_TLS": "true",
            "REDIS_PASSWORD": "wrong",
            "REDIS_HEALTH_SOCKET": str(sock),
        }

        assert _run(["sh", str(REDIS_HEALTH)], env=env).returncode == 1


@pytest.mark.unit
class TestRedisHealthScript:
    @pytest.fixture
    def cli(self, tmp_path):
        bin_dir = tmp_path / "hbin"
        bin_dir.mkdir()
        log = tmp_path / "cli.log"
        _executable(
            bin_dir / "redis-cli",
            f'#!/bin/sh\necho "$REDISCLI_AUTH|$*" >> "{log}"\necho "${{FAKE_REPLY:-PONG}}"\n',
        )
        return {"PATH": f"{bin_dir}:{os.environ['PATH']}"}, log

    def test_without_the_switch_it_pings_the_plaintext_port(self, cli):
        path, log = cli

        result = _run(["sh", str(REDIS_HEALTH)], env={**path, "REDIS_PASSWORD": "pw"})

        assert result.returncode == 0
        assert log.read_text().strip() == "pw|ping"

    def test_with_the_switch_it_uses_the_socket(self, cli):
        path, log = cli
        env = {
            **path,
            "REDIS_PASSWORD": "pw",
            "REDIS_REQUIRE_TLS": "true",
            "REDIS_HEALTH_SOCKET": "/tmp/x.sock",
        }

        assert _run(["sh", str(REDIS_HEALTH)], env=env).returncode == 0
        assert log.read_text().strip() == "pw|-s /tmp/x.sock ping"

    def test_the_password_never_appears_in_arguments(self, cli):
        path, log = cli

        _run(["sh", str(REDIS_HEALTH)], env={**path, "REDIS_PASSWORD": "s3cret"})

        assert "s3cret" not in log.read_text().split("|", 1)[1]

    def test_anything_but_pong_is_unhealthy(self, cli):
        path, _ = cli

        result = _run(["sh", str(REDIS_HEALTH)], env={**path, "FAKE_REPLY": "LOADING"})

        assert result.returncode == 1

    def test_no_password_sets_no_auth(self, cli):
        path, log = cli

        _run(["sh", str(REDIS_HEALTH)], env=path)

        assert log.read_text().strip() == "|ping"


@needs_openssl
@pytest.mark.skipif(
    not (_MARIADB and _INSTALL_DB), reason="mariadbd / mariadb-install-db not installed"
)
@pytest.mark.unit
class TestRealDatabaseEnforced:
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
        env = {
            **stub_path,
            "DB_TLS_DIR": str(tls / "mysql"),
            "DB_REQUIRE_TLS": "true",
        }
        built = _run(["sh", str(MYSQL_WRAPPER), "--skip-name-resolve"], env=env)
        assert built.returncode == 0, built.stderr
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
                *_args(env),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            _wait_for(port, timeout=40)
            admin = shutil.which("mariadb") or shutil.which("mysql")
            made = _run(
                [
                    admin,
                    "--no-defaults",
                    "-uroot",
                    f"-S{sock}",
                    "-e",
                    "CREATE USER 'app'@'%' IDENTIFIED BY 'pw'; "
                    "GRANT ALL ON *.* TO 'app'@'%'; "
                    "CREATE USER 'app'@'localhost' IDENTIFIED BY 'pw'; "
                    "GRANT ALL ON *.* TO 'app'@'localhost';",
                ]
            )
            assert made.returncode == 0, made.stderr
            yield port, admin, sock
        finally:
            proc.terminate()
            proc.wait(timeout=20)

    def _connect(self, port, **ssl_args):
        import pymysql

        return pymysql.connect(
            host="127.0.0.1",
            port=port,
            user="app",
            password="pw",
            ssl=ssl_args or None,
            connect_timeout=5,
        )

    def test_plaintext_tcp_is_refused(self, server):
        port, admin, _ = server

        done = _run(
            [
                admin,
                "--no-defaults",
                "-uapp",
                "-ppw",
                "-h127.0.0.1",
                f"-P{port}",
                "--skip-ssl",
                "-e",
                "SELECT 1",
            ]
        )

        assert done.returncode == 1
        assert "Access denied" in done.stderr

    def test_verified_tls_connects(self, server, tls):
        port, _, _ = server
        conn = self._connect(
            port,
            ca=str(tls / "ca.pem"),
            cert=str(tls / "backend/client.pem"),
            key=str(tls / "backend/client.key"),
        )
        cur = conn.cursor()
        cur.execute("SHOW STATUS LIKE 'Ssl_cipher'")
        assert cur.fetchone()[1].startswith("TLS_")
        conn.close()

    def test_the_unix_socket_is_exempt_so_the_health_check_and_exec_dump_work(
        self, server
    ):
        _, admin, sock = server

        done = _run(
            [
                admin,
                "--no-defaults",
                "-uapp",
                "-ppw",
                f"-S{sock}",
                "-e",
                "SELECT 1",
            ]
        )

        assert done.returncode == 0, done.stderr


# --------------------------------------------------------------- tls-enforce.sh
DOCKER_STUB = """#!/bin/sh
# Stands in for docker: `ps` lists FAKE_CONTAINERS, `exec NAME [-e K=V]... CMD`
# runs CMD on this machine with the shims in PATH.
case "$1" in
  ps) printf '%s\\n' $FAKE_CONTAINERS ;;
  exec)
    shift
    while [ "$1" = "-e" ]; do
      export "$2"
      shift 2
    done
    shift
    exec "$@"
    ;;
esac
"""


@pytest.fixture
def enforce_env(tmp_path):
    bin_dir = tmp_path / "ebin"
    bin_dir.mkdir()
    _executable(bin_dir / "docker", DOCKER_STUB)
    return {
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "HOME": str(tmp_path),
        "FAKE_CONTAINERS": "",
    }, bin_dir


def _enforce(env, *args):
    return _run(["bash", str(ENFORCE), *args], env=env)


@pytest.mark.unit
class TestEnforceScript:
    def test_the_script_is_valid_bash(self):
        assert _run(["bash", "-n", str(ENFORCE)]).returncode == 0

    def test_it_changes_nothing_and_says_so_in_its_header(self):
        text = ENFORCE.read_text()
        assert "it changes nothing" in text.lower()
        for forbidden in ("ALTER USER", "SET PERSIST", "CONFIG SET", "docker restart"):
            assert forbidden not in text

    def test_no_container_found_is_a_failure_that_names_the_option(self, enforce_env):
        env, _ = enforce_env

        result = _enforce(env)

        assert result.returncode == 1
        assert "--db-container" in result.stdout
        assert "--redis-container" in result.stdout

    def test_unknown_options_are_rejected(self, enforce_env):
        env, _ = enforce_env

        assert _enforce(env, "--wat").returncode == 1


@pytest.mark.unit
class TestEnforceDatabase:
    @pytest.fixture
    def mysql(self, enforce_env, tmp_path):
        env, bin_dir = enforce_env
        env = {
            **env,
            "FAKE_CONTAINERS": "logbook-db",
            "MYSQL_ROOT_PASSWORD": "root",
            "DB_TLS_DIR": "/etc/mysql/tls",
            "FAKE_SERVED": "/etc/mysql/tls/server.pem",
            "FAKE_PLAIN": "",
            "FAKE_AUDIT_FAILS": "",
        }
        _executable(
            bin_dir / "mysql",
            """#!/bin/sh
case "$*" in
  *ssl_cert*) printf '%s\\n' "$FAKE_SERVED" ;;
  *) [ -z "$FAKE_AUDIT_FAILS" ] || exit 1; printf '%s' "$FAKE_PLAIN" ;;
esac
""",
        )
        return env

    def test_a_clean_server_is_safe_and_prints_the_env_line(self, mysql):
        result = _enforce(mysql, "--skip-redis")

        assert result.returncode == 0, result.stdout
        assert "DB_REQUIRE_TLS=true" in result.stdout
        assert "No connection is using plaintext" in result.stdout

    def test_a_plaintext_client_is_named_and_blocks_the_switch(self, mysql):
        env = {**mysql, "FAKE_PLAIN": "intranet_user\t172.18.0.9:51234\n"}

        result = _enforce(env, "--skip-redis")

        assert result.returncode == 1
        assert "intranet_user" in result.stdout
        assert "172.18.0.9:51234" in result.stdout
        assert "DB_REQUIRE_TLS=true" not in result.stdout

    def test_a_server_not_using_our_certificate_blocks_the_switch(self, mysql):
        env = {**mysql, "FAKE_SERVED": "server-cert.pem"}

        result = _enforce(env, "--skip-redis")

        assert result.returncode == 1
        assert "not using the certificates" in result.stdout
        assert "DB_REQUIRE_TLS=true" not in result.stdout

    def test_a_server_that_cannot_list_connections_blocks_unless_told(self, mysql):
        env = {**mysql, "FAKE_AUDIT_FAILS": "1"}

        blocked = _enforce(env, "--skip-redis")
        allowed = _enforce(env, "--skip-redis", "--no-audit")

        assert blocked.returncode == 1
        assert "DB_REQUIRE_TLS=true" not in blocked.stdout
        assert allowed.returncode == 0
        assert "DB_REQUIRE_TLS=true" in allowed.stdout

    def test_a_named_container_is_used(self, mysql):
        env = {**mysql, "FAKE_CONTAINERS": "other"}

        result = _enforce(env, "--skip-redis", "--db-container", "custom-db")

        assert result.returncode == 0
        assert "Database (custom-db)" in result.stdout


@needs_openssl
@pytest.mark.skipif(_REDIS is None, reason="redis-server not installed")
@pytest.mark.unit
class TestEnforceRedis:
    @pytest.fixture
    def server(self, tls, tmp_path, enforce_env, stub_path):
        env, bin_dir = enforce_env
        plain, secure = _free_port(), _free_port()
        wrapper_env = {
            **stub_path,
            "REDIS_TLS_DIR": str(tls / "redis"),
            "REDIS_TLS_PORT": str(secure),
        }
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
            env=wrapper_env,
        )
        assert built.returncode == 0, built.stderr
        proc = subprocess.Popen(
            _args(wrapper_env), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        _executable(
            bin_dir / "redis-cli",
            f'#!/bin/sh\nexec {shutil.which("redis-cli")} -p {plain} "$@"\n',
        )
        try:
            _wait_for(plain)
            _wait_for(secure)
            yield (
                {
                    **env,
                    "FAKE_CONTAINERS": "logbook-redis",
                    "REDIS_PASSWORD": "pw",
                    "REDIS_TLS_PORT": str(secure),
                },
                plain,
                secure,
            )
        finally:
            proc.terminate()
            proc.wait(timeout=10)

    def test_an_idle_server_is_safe(self, server):
        env, _, _ = server

        result = _enforce(env, "--skip-db")

        assert result.returncode == 0, result.stdout + result.stderr
        assert "Listening for TLS" in result.stdout
        assert "REDIS_REQUIRE_TLS=true" in result.stdout

    def test_a_plaintext_client_is_named_and_blocks_the_switch(self, server):
        import redis

        env, plain, _ = server
        client = redis.Redis(host="127.0.0.1", port=plain, password="pw")
        client.client_setname("old-worker")
        client.ping()
        try:
            result = _enforce(env, "--skip-db")
        finally:
            client.close()

        assert result.returncode == 1
        assert "old-worker" in result.stdout
        assert "REDIS_REQUIRE_TLS=true" not in result.stdout

    def test_a_client_using_tls_is_not_listed(self, server, tls):
        import redis

        env, _, secure = server
        client = redis.Redis(
            host="localhost",
            port=secure,
            password="pw",
            ssl=True,
            ssl_ca_certs=str(tls / "ca.pem"),
            ssl_certfile=str(tls / "backend/client.pem"),
            ssl_keyfile=str(tls / "backend/client.key"),
        )
        client.client_setname("good-worker")
        client.ping()
        try:
            result = _enforce(env, "--skip-db")
        finally:
            client.close()

        assert result.returncode == 0, result.stdout
        assert "good-worker" not in result.stdout

    def test_a_server_without_a_tls_port_blocks_the_switch(self, tmp_path, enforce_env):
        env, bin_dir = enforce_env
        plain = _free_port()
        proc = subprocess.Popen(
            [
                _REDIS,
                "--port",
                str(plain),
                "--requirepass",
                "pw",
                "--save",
                "",
                "--dir",
                str(tmp_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        _executable(
            bin_dir / "redis-cli",
            f'#!/bin/sh\nexec {shutil.which("redis-cli")} -p {plain} "$@"\n',
        )
        try:
            _wait_for(plain)
            result = _enforce(
                {**env, "FAKE_CONTAINERS": "logbook-redis", "REDIS_PASSWORD": "pw"},
                "--skip-db",
            )
        finally:
            proc.terminate()
            proc.wait(timeout=10)

        assert result.returncode == 1
        assert "not listening for TLS" in result.stdout
        assert "REDIS_REQUIRE_TLS=true" not in result.stdout


@pytest.mark.unit
class TestComposeWiring:
    STACKS = {
        "docker-compose.yml": ("mysql", "redis"),
        "unraid/docker-compose-unraid.yml": ("db", "redis"),
        "unraid/docker-compose-build-from-source.yml": ("db", "redis"),
    }

    @staticmethod
    def _service(text, name):
        import re

        match = re.search(rf"(?m)^  {re.escape(name)}:\n((?:(?:    .*|\s*)\n)+)", text)
        assert match, name
        return match.group(1)

    @pytest.mark.parametrize("path", sorted(STACKS))
    def test_the_database_receives_the_switch_defaulting_off(self, path):
        block = self._service((REPO / path).read_text(), self.STACKS[path][0])

        assert "DB_REQUIRE_TLS: ${DB_REQUIRE_TLS:-false}" in block

    @pytest.mark.parametrize("path", sorted(STACKS))
    def test_redis_receives_the_switch_defaulting_off(self, path):
        block = self._service((REPO / path).read_text(), self.STACKS[path][1])

        assert "REDIS_REQUIRE_TLS: ${REDIS_REQUIRE_TLS:-false}" in block

    @pytest.mark.parametrize("path", sorted(STACKS))
    def test_redis_health_check_is_the_tls_aware_script(self, path):
        block = self._service((REPO / path).read_text(), self.STACKS[path][1])

        assert '["CMD", "sh", "/healthcheck.sh"]' in block
        assert "infrastructure/redis/healthcheck.sh:/healthcheck.sh:ro" in block
        assert "redis-cli -a" not in block, "the password must not be on a command line"

    def test_the_health_script_is_mounted_from_a_file_that_exists(self):
        assert REDIS_HEALTH.exists()
        assert _run(["sh", "-n", str(REDIS_HEALTH)]).returncode == 0

    def test_db_tls_library_is_unchanged_by_the_switch(self):
        assert "REQUIRE" not in DB_TLS.read_text()
