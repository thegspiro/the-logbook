"""The Unraid installer's prompts must work under `curl ... | bash`.

That is the documented install command, and under it bash reads the script
from stdin. A bare `read` took its answer from the next line of the script
instead of from the keyboard, and that line never ran. These tests pipe a
script into bash the same way and check that the answer comes from the
terminal and the next line still runs.
"""

import re
import subprocess
from pathlib import Path

import pytest

UNRAID_SETUP = Path(__file__).parents[2] / "unraid" / "unraid-setup.sh"


def _ask_function() -> str:
    source = UNRAID_SETUP.read_text()
    match = re.search(r"^ask\(\) \{.*?^\}\n", source, re.S | re.M)
    assert match, "ask() not found in unraid-setup.sh"
    return match.group(0)


def _piped_install(tty: Path | str) -> subprocess.CompletedProcess:
    # The whole script arrives on stdin, as it does from curl.
    script = (
        _ask_function()
        + 'ask CHOICE "Choose option [1-4]: "\n'
        + 'echo "CHOICE=$CHOICE"\n'
        + "echo NEXT-LINE-RAN\n"
    )
    return subprocess.run(
        ["bash"],
        input=script,
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin", "PROMPT_TTY": str(tty)},
        timeout=20,
    )


@pytest.mark.unit
class TestPromptsUnderCurlPipeBash:
    def test_answer_comes_from_the_terminal_not_the_script(self, tmp_path):
        tty = tmp_path / "tty"
        tty.write_text("2\n")

        result = _piped_install(tty)

        assert result.returncode == 0, result.stderr
        assert "CHOICE=2" in result.stdout
        assert "NEXT-LINE-RAN" in result.stdout

    def test_without_a_terminal_stdin_is_read_as_before(self):
        # No terminal at all (an unattended run): the old behaviour stands.
        # This is also the failure the tty read prevents: the answer is the
        # script's next line, which is consumed and never runs.
        result = _piped_install("/nonexistent/tty")

        assert result.returncode == 0, result.stderr
        assert "CHOICE=" not in result.stdout
        assert "NEXT-LINE-RAN" in result.stdout

    def test_every_prompt_goes_through_ask(self):
        source = UNRAID_SETUP.read_text()
        body = re.sub(r"^ask\(\) \{.*?^\}\n", "", source, flags=re.S | re.M)
        bare_reads = [
            line.strip()
            for line in body.splitlines()
            if re.match(r"\s*read\s", line) and not line.strip().startswith("#")
        ]
        assert bare_reads == []
        for variable in ("INSTALL_TYPE", "HTTPS_ORIGIN", "UNINSTALL_TYPE"):
            assert f"ask {variable} " in source
