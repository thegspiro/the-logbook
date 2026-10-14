"""install.sh --traditional must find a Python the backend can run on.

It installed python3.10, but the backend is tested on 3.13 and its image runs
3.14, so `pip install -r requirements.txt` failed after MySQL, Redis and nginx
were already on the server. These tests run the script's own functions under
bash with stand-in interpreters on PATH.
"""

import re
import subprocess
from pathlib import Path

import pytest

INSTALL = Path(__file__).parents[2] / "install.sh"

_STUBS = """
print_header() { echo "HEADER:$1"; }
print_success() { echo "OK:$1"; }
print_error() { echo "ERROR:$1"; }
print_warning() { echo "WARN:$1"; }
print_info() { echo "INFO:$1"; }
"""


def _source(*names: str) -> str:
    source = INSTALL.read_text()
    match = re.search(r'^BACKEND_PYTHON_MIN="[^"]+"\n', source, re.M)
    assert match, "BACKEND_PYTHON_MIN not found in install.sh"
    parts = [_STUBS, match.group(0)]
    for name in names:
        found = re.search(rf"^{name}\(\) \{{.*?^\}}\n", source, re.S | re.M)
        assert found, f"{name}() not found in install.sh"
        parts.append(found.group(0))
    return "".join(parts)


def _fake_python(bin_dir: Path, name: str, version: tuple[int, int]) -> None:
    """A stand-in interpreter answering only what install.sh asks of it."""
    ok = 0 if version >= (3, 13) else 1
    script = bin_dir / name
    script.write_text(
        "#!/bin/sh\n"
        f'if [ "$1" = "--version" ]; then echo "Python {version[0]}.{version[1]}.0"; exit 0; fi\n'
        f'if [ "$1" = "-c" ]; then exit {ok}; fi\n'
        "exit 2\n"
    )
    script.chmod(0o755)


def _run(bin_dir: Path, command: str) -> subprocess.CompletedProcess:
    sudo = bin_dir / "sudo"
    sudo.write_text(f'#!/bin/sh\necho "$@" >> {bin_dir}/sudo.log\n')
    sudo.chmod(0o755)
    return subprocess.run(
        ["/bin/bash", "-c", command],
        capture_output=True,
        text=True,
        env={"PATH": str(bin_dir)},
        timeout=20,
    )


@pytest.mark.unit
class TestFindBackendPython:
    def test_system_python3_is_used_when_new_enough(self, tmp_path):
        _fake_python(tmp_path, "python3", (3, 13))

        result = _run(tmp_path, _source("find_backend_python") + "find_backend_python")

        assert result.returncode == 0
        assert result.stdout.strip() == "python3"

    def test_a_versioned_interpreter_is_used_when_python3_is_too_old(self, tmp_path):
        _fake_python(tmp_path, "python3", (3, 10))
        _fake_python(tmp_path, "python3.13", (3, 13))

        result = _run(tmp_path, _source("find_backend_python") + "find_backend_python")

        assert result.returncode == 0
        assert result.stdout.strip() == "python3.13"

    def test_nothing_new_enough_is_a_failure(self, tmp_path):
        _fake_python(tmp_path, "python3", (3, 12))

        result = _run(tmp_path, _source("find_backend_python") + "find_backend_python")

        assert result.returncode != 0
        assert result.stdout.strip() == ""


@pytest.mark.unit
class TestTraditionalDeploymentRefusesOldPython:
    def test_refuses_before_installing_anything(self, tmp_path):
        _fake_python(tmp_path, "python3", (3, 10))

        result = _run(
            tmp_path,
            _source("find_backend_python", "traditional_deployment")
            + "traditional_deployment",
        )

        assert result.returncode == 1
        assert "ERROR:The backend needs Python 3.13 or newer" in result.stdout
        assert "Python 3.10.0" in result.stdout
        assert "./install.sh --docker" in result.stdout
        # No apt-get, no service setup: the server is left as it was.
        assert not (tmp_path / "sudo.log").exists()

    def test_refuses_when_there_is_no_python_at_all(self, tmp_path):
        result = _run(
            tmp_path,
            _source("find_backend_python", "traditional_deployment")
            + "traditional_deployment",
        )

        assert result.returncode == 1
        assert "(found: none)" in result.stdout
        assert not (tmp_path / "sudo.log").exists()

    @pytest.mark.parametrize(
        ("interpreters", "venv_package"),
        [
            ({"python3": (3, 13)}, "python3-venv"),
            ({"python3": (3, 10), "python3.13": (3, 13)}, "python3.13-venv"),
        ],
    )
    def test_installs_the_venv_package_for_the_chosen_interpreter(
        self, tmp_path, interpreters, venv_package
    ):
        for name, version in interpreters.items():
            _fake_python(tmp_path, name, version)
        # Stop right after the package install: the rest needs a real server.

        result = _run(
            tmp_path,
            _source("find_backend_python", "traditional_deployment")
            + "setup_environment() { exit 0; }\n"
            + "traditional_deployment",
        )
        sudo_log = (tmp_path / "sudo.log").read_text()

        assert result.returncode == 0, result.stdout + result.stderr
        assert f" {venv_package} " in sudo_log
        assert "python3.10" not in sudo_log
