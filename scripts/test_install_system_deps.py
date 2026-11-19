""".github/scripts/install-system-deps.sh on a runner image without ffmpeg.

From 2026-11-18 some ubuntu-latest jobs ran on ubuntu-26.04, which ships
libmagic but not ffmpeg, so the backend jobs had to download ffmpeg through the
runner's regional mirror. On #4424 that mirror crawled, the first
`apt-get install` held the script's whole budget, and Backend Unit Tests failed
before a test ran. These run the real script against a stub apt-get and a
scratch apt directory, on a PATH with no ffmpeg, so they need no network, no
root and no apt:

- a job that does not run ffmpeg installs nothing;
- a healthy install runs once and leaves the apt sources alone;
- a crawling regional mirror is abandoned at half the budget, apt is pointed at
  archive.ubuntu.com, and the retry installs;
- a failure on both mirrors fails the step with a message, inside the budget.
"""

import shutil
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / ".github" / "scripts" / "install-system-deps.sh"

REGIONAL_MIRRORS = (
    "http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\tpriority:1\n"
    "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
)
SECURITY_SOURCE = (
    "Types: deb\n"
    "URIs: http://us-east-2.ec2.archive.ubuntu.com/ubuntu/\n"
    "Suites: resolute resolute-updates\n"
    "\n"
    "Types: deb\n"
    "URIs: http://security.ubuntu.com/ubuntu/\n"
    "Suites: resolute-security\n"
)

# Reads the scratch apt directory the way apt would: while the mirror list
# still names the regional host, `install` reproduces the crawl (it never
# finishes); once the host is gone it installs. MODE overrides that. `exec` so
# that timeout(1) kills the sleeping process itself, and no orphan keeps the
# test's output pipe open.
APT_GET_STUB = """#!/usr/bin/env bash
echo "$1" >> "$STUB_CALLS"
[ "$1" = update ] && exit 0
case "${MODE:-mirror}" in
  fail) echo "E: Unable to fetch some archives"; exit 100 ;;
  hang) exec sleep 600 ;;
esac
if grep -q 'ec2\\.archive\\.ubuntu\\.com' "$APT_ETC/apt-mirrors.txt"; then
  echo "Get:14 http://us-east-2.ec2.archive.ubuntu.com/ubuntu resolute/main libopus0"
  exec sleep 600
fi
echo "Setting up ffmpeg ..."
exit 0
"""

# libmagic present, as on both runner images, so only ffmpeg is missing.
LDCONFIG_STUB = """#!/usr/bin/env bash
printf '\\tlibmagic.so.1 (libc6,x86-64) => /lib/x86_64-linux-gnu/libmagic.so.1\\n'
"""

# What the script runs besides the stubs. Linked into a directory of their own
# so the PATH it sees has no ffmpeg, whatever the machine running the tests has.
TOOLS = ("bash", "env", "date", "awk", "seq", "sleep", "timeout", "grep", "sed", "cat")


def _executable(path: Path, body: str) -> None:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class InstallSystemDepsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.apt = self.tmp / "apt"
        (self.apt / "sources.list.d").mkdir(parents=True)
        (self.apt / "apt-mirrors.txt").write_text(REGIONAL_MIRRORS)
        (self.apt / "sources.list.d" / "ubuntu.sources").write_text(SECURITY_SOURCE)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        for tool in TOOLS:
            found = shutil.which(tool)
            assert found, f"{tool} is needed to run the script under test"
            (bin_dir / tool).symlink_to(found)
        self.apt_get = self.tmp / "apt-get"
        _executable(self.apt_get, APT_GET_STUB)
        ldconfig = self.tmp / "ldconfig"
        _executable(ldconfig, LDCONFIG_STUB)
        self.calls = self.tmp / "calls"
        self.env = {
            "PATH": str(bin_dir),
            "APT_GET": str(self.apt_get),
            "AS_ROOT": "",
            "APT_ETC": str(self.apt),
            "APT_BUDGET": "12",
            "LDCONFIG": str(ldconfig),
            "STUB_CALLS": str(self.calls),
        }

    def tearDown(self):
        self._tmp.cleanup()

    def _run(self, **env):
        started = time.monotonic()
        result = subprocess.run(
            ["bash", str(SCRIPT)],
            env={**self.env, **env},
            capture_output=True,
            text=True,
            timeout=60,
        )
        return result, time.monotonic() - started

    def _installs(self):
        if not self.calls.exists():
            return 0
        return self.calls.read_text().split().count("install")

    def test_a_job_that_does_not_run_ffmpeg_installs_nothing(self):
        result, _ = self._run(INSTALL_MEDIA_TOOLS="false")

        assert result.returncode == 0, result.stdout + result.stderr
        assert not self.calls.exists()
        assert "Skipping apt entirely" in result.stdout

    def test_a_healthy_install_runs_once_and_leaves_the_sources_alone(self):
        (self.apt / "apt-mirrors.txt").write_text(
            "https://archive.ubuntu.com/ubuntu/\tpriority:1\n"
        )

        result, _ = self._run()

        assert result.returncode == 0, result.stdout + result.stderr
        assert "Missing ffmpeg; will install ffmpeg." in result.stdout
        assert self._installs() == 1
        assert (self.apt / "apt-mirrors.txt").read_text() == (
            "https://archive.ubuntu.com/ubuntu/\tpriority:1\n"
        )

    def test_a_crawling_regional_mirror_is_abandoned_for_archive_ubuntu_com(self):
        result, elapsed = self._run()

        assert result.returncode == 0, result.stdout + result.stderr
        assert self._installs() == 2
        # The first attempt was stopped at half the 12s budget, not the whole.
        assert 5 <= elapsed < 11, elapsed
        mirrors = (self.apt / "apt-mirrors.txt").read_text()
        assert "ec2.archive.ubuntu.com" not in mirrors
        assert "http://archive.ubuntu.com/ubuntu/\tpriority:1" in mirrors
        sources = (self.apt / "sources.list.d" / "ubuntu.sources").read_text()
        assert "URIs: http://archive.ubuntu.com/ubuntu/\n" in sources
        assert "URIs: http://security.ubuntu.com/ubuntu/\n" in sources

    def test_a_failure_on_both_mirrors_fails_the_step_inside_the_budget(self):
        result, elapsed = self._run(MODE="hang")

        assert result.returncode == 1
        assert "Failed to install system packages within 12s: ffmpeg" in result.stdout
        assert self._installs() == 2
        assert elapsed < 15, elapsed


if __name__ == "__main__":
    unittest.main()
