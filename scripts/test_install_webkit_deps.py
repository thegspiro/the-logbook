""".github/scripts/install-webkit-deps.sh falls back to archive.ubuntu.com.

On 2026-11-11 the runners' Azure Ubuntu mirror stopped serving packages for
three and a half hours, and every Mobile Safari shard timed out installing
WebKit's system libraries before a test ran. These run the real script against
a stub installer and a scratch apt directory, so they need no network, no root
and no Playwright:

- a healthy install is left alone and the apt sources are not touched;
- the outage's signature (package fetches from the Azure mirror logged as
  `Ign:`) stops the attempt, kills it, repoints apt and retries;
- a failure on both mirrors, and a stall that outlasts the budget, fail the
  step with a message rather than hanging it.
"""

import os
import stat
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPT = REPO / ".github" / "scripts" / "install-webkit-deps.sh"

AZURE_MIRRORS = (
    "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
    "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
)

# The stub reads the scratch apt directory the way apt would: while the mirror
# list still names the Azure host it reproduces the outage (Ign lines, then
# hangs), and once the host is gone it installs. MODE overrides that.
STUB = """#!/usr/bin/env bash
echo $$ >> "$STUB_PIDS"
echo attempt >> "$STUB_CALLS"
case "${MODE:-mirror}" in
  fail) echo "E: Unable to locate package"; exit 100 ;;
  hang) sleep 600; exit 0 ;;
  thirdparty)
    # apt-get update refuses to continue while any enabled source fails, so a
    # third-party repository answering 403 fails the whole install.
    if [ -f "$APT_ETC/sources.list.d/microsoft-prod.list" ]; then
      echo "Err:6 https://packages.microsoft.com/ubuntu/24.04/prod noble InRelease"
      echo "  403  Forbidden [IP: 13.107.213.40 443]"
      echo "E: Failed to fetch https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/InRelease  403  Forbidden [IP: 13.107.213.40 443]"
      exit 100
    fi
    echo "Setting up libwoff1 ..."
    exit 0 ;;
esac
if grep -q azure.archive.ubuntu.com "$APT_ETC/apt-mirrors.txt"; then
  for i in 1 2 3 4 5; do
    echo "Ign:$i http://azure.archive.ubuntu.com/ubuntu noble/main amd64 libpkg$i"
    sleep 0.1
  done
  sleep 600
fi
echo "Setting up libwoff1 ..."
exit 0
"""


def _executable(path: Path, body: str) -> None:
    path.write_text(body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class InstallWebkitDepsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.apt = self.tmp / "apt"
        (self.apt / "sources.list.d").mkdir(parents=True)
        (self.apt / "apt-mirrors.txt").write_text(AZURE_MIRRORS)
        (self.apt / "sources.list.d" / "ubuntu.sources").write_text(
            "URIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
        )
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        # sudo runs its arguments as the current user: the script's
        # privileged steps then act on the scratch tree and the stub's
        # processes, which this user owns.
        _executable(bin_dir / "sudo", '#!/usr/bin/env bash\nexec "$@"\n')
        self.stub = self.tmp / "install-stub"
        _executable(self.stub, STUB)
        self.pids = self.tmp / "pids"
        self.calls = self.tmp / "calls"
        self.env = {
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "INSTALL_CMD": str(self.stub),
            "APT_ETC": str(self.apt),
            "TOTAL_BUDGET": "30",
            "POLL_SECONDS": "0.2",
            "STUB_PIDS": str(self.pids),
            "STUB_CALLS": str(self.calls),
        }

    def tearDown(self):
        for pid in self._pids():
            try:
                os.kill(pid, 9)
            except ProcessLookupError:
                pass
        self._tmp.cleanup()

    def _pids(self):
        if not self.pids.exists():
            return []
        return [int(p) for p in self.pids.read_text().split()]

    def _run(self, **env):
        return subprocess.run(
            ["bash", str(SCRIPT)],
            env={**self.env, **env},
            capture_output=True,
            text=True,
            timeout=60,
        )

    def _attempts(self):
        return self.calls.read_text().count("attempt") if self.calls.exists() else 0

    def test_a_healthy_install_leaves_the_sources_alone(self):
        (self.apt / "apt-mirrors.txt").write_text(
            "https://archive.ubuntu.com/ubuntu/\tpriority:1\n"
        )

        result = self._run()

        assert result.returncode == 0, result.stdout + result.stderr
        assert self._attempts() == 1
        assert "Setting up libwoff1" in result.stdout
        assert (self.apt / "apt-mirrors.txt").read_text() == (
            "https://archive.ubuntu.com/ubuntu/\tpriority:1\n"
        )

    def test_a_stalled_azure_mirror_is_abandoned_for_archive_ubuntu_com(self):
        result = self._run()

        assert result.returncode == 0, result.stdout + result.stderr
        assert self._attempts() == 2
        mirrors = (self.apt / "apt-mirrors.txt").read_text()
        assert "azure.archive.ubuntu.com" not in mirrors
        assert "http://archive.ubuntu.com/ubuntu/\tpriority:1" in mirrors
        # The sources file names no host, so it is left as it was.
        assert (self.apt / "sources.list.d" / "ubuntu.sources").read_text() == (
            "URIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
        )
        assert "stopping this attempt" in result.stdout
        # The stalled attempt is dead, not left holding apt's locks.
        stalled = self._pids()[0]
        try:
            os.kill(stalled, 0)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError(f"stalled attempt {stalled} is still running")

    def test_a_failure_on_both_mirrors_fails_the_step(self):
        result = self._run(MODE="fail")

        assert result.returncode == 1
        assert self._attempts() == 2
        assert "from either mirror" in result.stdout

    def test_a_third_party_source_refusing_access_is_disabled_for_the_retry(self):
        # On 2026-11-26 and 27 packages.microsoft.com answered 403 to the
        # runners, and apt-get update failed both attempts: the retry only
        # changed the Ubuntu mirror, which was never the problem.
        healthy = "https://archive.ubuntu.com/ubuntu/\tpriority:1\n"
        (self.apt / "apt-mirrors.txt").write_text(healthy)
        microsoft = self.apt / "sources.list.d" / "microsoft-prod.list"
        microsoft.write_text(
            "deb [arch=amd64] https://packages.microsoft.com/ubuntu/24.04/prod noble main\n"
        )
        docker = self.apt / "sources.list.d" / "docker.list"
        docker.write_text("deb https://download.docker.com/linux/ubuntu noble stable\n")

        result = self._run(MODE="thirdparty")

        assert result.returncode == 0, result.stdout + result.stderr
        assert self._attempts() == 2
        assert not microsoft.exists()
        assert "packages.microsoft.com" in result.stdout
        # Only the source that failed is touched.
        assert docker.exists()
        assert (self.apt / "apt-mirrors.txt").read_text() == healthy
        assert (self.apt / "sources.list.d" / "ubuntu.sources").exists()

    def test_a_stall_with_no_azure_signature_is_bounded_by_the_budget(self):
        started = time.monotonic()

        result = self._run(MODE="hang", TOTAL_BUDGET="2")

        assert result.returncode == 1
        assert time.monotonic() - started < 20
        assert "budget" in result.stdout


if __name__ == "__main__":
    unittest.main()
