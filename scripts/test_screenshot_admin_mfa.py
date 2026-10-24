"""The screenshot seeder signs in as an administrator enrolled in two-factor.

Privileged members must use MFA, and sensitive actions — role grants, security
settings — need a re-verification on the session. The seeder therefore enrols
the demo administrator in TOTP, keeps the secret outside the repository, signs
in with a code, and answers a step-up refusal by re-verifying and retrying
once. capture.mjs signs into the browser with the same secret through
`totp.mjs`, so both generators are held to the same RFC 6238 vector here.

The HTTP behaviour is tested against a small in-process stand-in for the
backend's auth routes rather than mocks of `urllib`, so cookies, headers and
the JSON error body travel the way they do against the real server.
"""

from __future__ import annotations

import base64
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
SCREENSHOTS = REPO_ROOT / "scripts" / "screenshots"


def _load_seeder():
    # The seeder imports its sibling bootstrap_demo by bare name, so its
    # directory has to be importable first.
    sys.path.insert(0, str(SCREENSHOTS))
    import seed_demo_data

    return seed_demo_data


seed = _load_seeder()

# RFC 6238 Appendix B, SHA-1: the ASCII key "12345678901234567890". The RFC
# prints eight digits; the six-digit code is their last six. Encoded here
# rather than written out so the secret scanner does not read the published
# vector as a leaked key.
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode("ascii")
RFC_VECTORS = {
    59: "287082",
    1111111109: "081804",
    1111111111: "050471",
    1234567890: "005924",
    2000000000: "279037",
    20000000000: "353130",
}

SECRET = "JBSWY3DPEHPK3PXP"
ADMIN = seed.DEMO_ADMIN_USERNAME


def raised(exc_type: type[BaseException], fn) -> BaseException:
    """The exception *fn* raises, failing the test if it raises nothing.

    CI runs these with stdlib unittest and no pytest installed, so
    pytest.raises is unavailable; the repo's flake8 plugin rejects
    assertRaises.
    """
    try:
        fn()
    except exc_type as exc:
        return exc
    raise AssertionError(f"{exc_type.__name__} not raised")


class FakeClock:
    """Stands in for both the client's clock and the stand-in server's."""

    def __init__(self, now: float) -> None:
        self.now = now
        self.slept: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


class FakeBackend:
    """Just enough of /api/v1/auth to exercise sign-in and step-up.

    Codes are checked the way `_verify_and_consume_totp` checks them: one step
    of drift either side, and a step at or below the last one spent is refused.
    """

    def __init__(self, clock: FakeClock, *, enrolled: bool, secret: str) -> None:
        self.clock = clock
        self.enrolled = enrolled
        self.secret = secret
        self.last_step: int | None = None
        self.stepped_up = False
        # How many times /sensitive refuses before honouring a step-up;
        # None means it refuses for ever.
        self.sensitive_refusals: int | None = 1
        self.requests: list[str] = []
        self.sensitive_calls = 0

    def verify(self, code: str) -> bool:
        current = int(self.clock.time()) // 30
        for step in (current - 1, current, current + 1):
            if seed.totp_now(self.secret, at=step * 30) == code:
                if self.last_step is not None and step <= self.last_step:
                    return False
                self.last_step = step
                return True
        return False

    def handle(self, method: str, path: str, body: dict, cookie: str):
        self.requests.append(f"{method} {path}")
        signed_in = "access_token=ok" in cookie
        bad_code = (400, {"detail": "Invalid", "code": "LB-AUTH-007"}, {})
        if path == "/api/v1/auth/login":
            if self.enrolled:
                return 200, {"mfa_required": True, "mfa_token": "pending"}, {}
            return 200, {"ok": True}, {"Set-Cookie": "access_token=ok; Path=/"}
        if path == "/api/v1/auth/mfa/login":
            if body.get("temp_token") != "pending" or not self.verify(body["code"]):
                return 401, {"detail": "Invalid", "code": "LB-AUTH-007"}, {}
            return 200, {"ok": True}, {"Set-Cookie": "access_token=ok; Path=/"}
        if not signed_in:
            return 401, {"detail": "Not authenticated"}, {}
        if path == "/api/v1/auth/mfa/setup":
            return 200, {"secret": self.secret}, {}
        if path == "/api/v1/auth/mfa/verify-setup":
            if not self.verify(body["code"]):
                return bad_code
            self.enrolled = True
            return 200, {"recovery_codes": ["x"]}, {}
        if path == "/api/v1/auth/step-up":
            if not self.verify(body.get("code") or ""):
                return bad_code
            self.stepped_up = True
            return 200, {"verified": True}, {}
        if path == "/api/v1/sensitive":
            self.sensitive_calls += 1
            refuse = self.sensitive_refusals is None or self.sensitive_refusals > 0
            if refuse or not self.stepped_up:
                if self.sensitive_refusals:
                    self.sensitive_refusals -= 1
                return (
                    403,
                    {"detail": "Please confirm", "code": "LB-AUTH-013"},
                    {"X-Stepup-Required": "true"},
                )
            return 200, {"done": True}, {}
        return 404, {"detail": "no route"}, {}


def serve(backend: FakeBackend) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def _reply(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw or b"{}")
            code, payload, headers = backend.handle(
                self.command, self.path, body, self.headers.get("Cookie") or ""
            )
            data = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = _reply

        def log_message(self, *args) -> None:  # keep test output quiet
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class StateDirTestCase(unittest.TestCase):
    """Points XDG_STATE_HOME at a scratch directory and clears the override."""

    def setUp(self) -> None:
        self.state = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.state, True)
        env = {
            "XDG_STATE_HOME": self.state,
            "SCREENSHOT_ADMIN_PASSWORD": "demo-Aa1",
        }
        patcher = mock.patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop(seed.ADMIN_TOTP_ENV, None)

    @property
    def secret_file(self) -> Path:
        return Path(self.state) / "logbook-screenshots" / "admin-totp.env"


class TotpVectorTest(unittest.TestCase):
    def test_python_generator_matches_rfc_6238(self) -> None:
        for at, expected in RFC_VECTORS.items():
            with self.subTest(at=at):
                assert seed.totp_now(RFC_SECRET, at=at) == expected

    def test_node_generator_matches_rfc_6238(self) -> None:
        node = shutil.which("node")
        if node is None:  # pragma: no cover - CI images all ship node
            raise unittest.SkipTest("node is required to run totp.mjs")
        module = json.dumps(str(SCREENSHOTS / "totp.mjs"))
        script = (
            f"import {{ totpForStep, totpStep }} from {module};"
            f"const at = {json.dumps(list(RFC_VECTORS))};"
            f"console.log(JSON.stringify(at.map((t) => "
            f"totpForStep({json.dumps(RFC_SECRET)}, totpStep(t)))));"
        )
        proc = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
            check=True,
        )
        assert json.loads(proc.stdout) == list(RFC_VECTORS.values())


class SecretFileTest(StateDirTestCase):
    def test_written_mode_600_under_the_state_directory(self) -> None:
        path = seed.write_admin_totp_secret(SECRET)
        assert path == self.secret_file
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
        assert seed.read_admin_totp_secret() == SECRET

    def test_rewrite_replaces_and_stays_private(self) -> None:
        seed.write_admin_totp_secret("AAAAAAAA")
        os.chmod(self.secret_file, 0o644)
        seed.write_admin_totp_secret(SECRET)
        assert seed.read_admin_totp_secret() == SECRET
        assert stat.S_IMODE(self.secret_file.stat().st_mode) == 0o600

    def test_absent_file_reads_as_none(self) -> None:
        assert seed.read_admin_totp_secret() is None

    def test_env_override_wins_over_the_file(self) -> None:
        seed.write_admin_totp_secret("AAAAAAAA")
        with mock.patch.dict(os.environ, {seed.ADMIN_TOTP_ENV: SECRET}):
            assert seed.read_admin_totp_secret() == SECRET

    def test_node_reads_the_same_file_and_override(self) -> None:
        node = shutil.which("node")
        if node is None:  # pragma: no cover - CI images all ship node
            raise unittest.SkipTest("node is required to run totp.mjs")
        seed.write_admin_totp_secret(SECRET)
        module = json.dumps(str(SCREENSHOTS / "totp.mjs"))
        script = (
            f"import {{ readAdminTotpSecret }} from {module};"
            "console.log(JSON.stringify(readAdminTotpSecret()));"
        )

        def run(extra: dict) -> str:
            env = {**os.environ, **extra}
            proc = subprocess.run(
                [node, "--input-type=module", "-e", script],
                capture_output=True,
                text=True,
                check=True,
                env=env,
            )
            return json.loads(proc.stdout)

        assert run({}) == SECRET
        assert run({seed.ADMIN_TOTP_ENV: "OVERRIDE"}) == "OVERRIDE"


class AdminSignInTest(StateDirTestCase):
    def start(self, *, enrolled: bool) -> tuple[FakeBackend, seed.Api, FakeClock]:
        # Two seconds into a step, so a reused step forces a visible wait.
        clock = FakeClock(1_700_000_012.0)
        backend = FakeBackend(clock, enrolled=enrolled, secret=SECRET)
        server = serve(backend)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        for target, value in (("time_module", clock), ("sleep", clock.sleep)):
            patcher = mock.patch.object(seed, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        host, port = server.server_address[:2]
        return backend, seed.Api(f"http://{host}:{port}"), clock

    def login(self, api: seed.Api) -> None:
        with redirect_stdout(io.StringIO()):
            api.login()

    def test_enrols_an_unenrolled_admin_and_stores_the_secret_first(self) -> None:
        backend, api, _ = self.start(enrolled=False)
        written_before_verify = []
        original = backend.handle

        def spy(method, path, body, cookie):
            if path.endswith("/mfa/verify-setup"):
                written_before_verify.append(self.secret_file.exists())
            return original(method, path, body, cookie)

        backend.handle = spy
        self.login(api)
        assert backend.enrolled
        assert written_before_verify == [True]
        assert seed.read_admin_totp_secret() == SECRET
        assert stat.S_IMODE(self.secret_file.stat().st_mode) == 0o600

    def test_enrolled_admin_completes_the_code_step(self) -> None:
        backend, api, _ = self.start(enrolled=True)
        seed.write_admin_totp_secret(SECRET)
        self.login(api)
        assert backend.requests == [
            "POST /api/v1/auth/login",
            "POST /api/v1/auth/mfa/login",
        ]
        assert any(c.name == "access_token" for c in api.jar)

    def test_enrolled_admin_without_a_secret_fails_fast(self) -> None:
        backend, api, _ = self.start(enrolled=True)
        message = str(raised(SystemExit, lambda: self.login(api)))
        assert "no secret is available" in message
        assert "Reset MFA" in message
        assert "fresh database" in message
        assert backend.requests == ["POST /api/v1/auth/login"]

    def test_wrong_secret_says_so_after_one_retry(self) -> None:
        backend, api, _ = self.start(enrolled=True)
        seed.write_admin_totp_secret("AAAAAAAAAAAAAAAA")
        assert "does not match" in str(raised(SystemExit, lambda: self.login(api)))
        assert backend.requests.count("POST /api/v1/auth/mfa/login") == 2

    def test_override_set_on_an_unenrolled_admin_refuses_to_enrol(self) -> None:
        backend, api, _ = self.start(enrolled=False)
        with mock.patch.dict(os.environ, {seed.ADMIN_TOTP_ENV: SECRET}):
            raised(SystemExit, lambda: self.login(api))
        assert not backend.enrolled
        assert not self.secret_file.exists()

    def test_step_up_then_retry_once(self) -> None:
        backend, api, clock = self.start(enrolled=True)
        seed.write_admin_totp_secret(SECRET)
        self.login(api)
        assert api.post("/sensitive") == {"done": True}
        assert backend.requests[2:] == [
            "POST /api/v1/sensitive",
            "POST /api/v1/auth/step-up",
            "POST /api/v1/sensitive",
        ]
        # The sign-in spent this step, so the step-up waited for the next one
        # instead of being refused as a replay.
        assert clock.slept
        assert 28 <= clock.slept[0] <= 30

    def test_a_refusal_that_persists_is_raised_not_looped(self) -> None:
        backend, api, _ = self.start(enrolled=True)
        seed.write_admin_totp_secret(SECRET)
        self.login(api)
        backend.sensitive_refusals = None
        error = raised(seed.ApiError, lambda: api.post("/sensitive"))
        assert error.code == 403
        assert backend.sensitive_calls == 2
        assert backend.requests.count("POST /api/v1/auth/step-up") == 1

    def test_a_step_spent_elsewhere_is_retried_on_the_next(self) -> None:
        backend, api, clock = self.start(enrolled=True)
        seed.write_admin_totp_secret(SECRET)
        # Another client (a capture run) spent the current step already.
        backend.last_step = int(clock.time()) // 30
        self.login(api)
        assert backend.requests.count("POST /api/v1/auth/mfa/login") == 2
        assert any(c.name == "access_token" for c in api.jar)

    def test_password_session_steps_up_with_its_password(self) -> None:
        api = seed.Api("http://127.0.0.1:9")
        api.password = "pw"
        with mock.patch.object(api, "call") as call:
            api.step_up()
        call.assert_called_once_with("POST", "/auth/step-up", {"password": "pw"})

    def test_is_stepup_required_reads_header_or_code(self) -> None:
        assert seed.is_stepup_required(403, {"X-Stepup-Required": "true"}, "")
        assert seed.is_stepup_required(403, {}, '{"code":"LB-AUTH-013"}')
        assert not seed.is_stepup_required(403, {}, '{"code":"LB-PERM-001"}')
        assert not seed.is_stepup_required(401, {"X-Stepup-Required": "true"}, "")


if __name__ == "__main__":
    unittest.main()
