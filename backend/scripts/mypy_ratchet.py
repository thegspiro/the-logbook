#!/usr/bin/env python3
"""
mypy error-count ratchet.

Runs ``python -m mypy app`` (the version pinned in requirements.txt, with the
settings in mypy.ini) and compares the error count with the number recorded in
``mypy-baseline.txt``:

- above the baseline  -> fail, and print mypy's full output
- at the baseline     -> pass
- below the baseline  -> pass, and say to lower the baseline

The backend still carries type errors from before mypy was enforced, so a gate
of "zero errors" cannot be switched on yet. A ratchet holds the line instead:
nothing new gets in, and each fix lowers the bar for everyone after it.

What it cannot see: it compares a count, not the errors themselves, so a change
that fixes one error and introduces another nets to zero and passes. Lowering
the baseline as errors are fixed keeps that slack small.

Usage:
    python scripts/mypy_ratchet.py            # CI: check against the baseline
    python scripts/mypy_ratchet.py --update   # rewrite the baseline to today's count
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
BASELINE_FILE = BACKEND_DIR / "mypy-baseline.txt"

_FOUND = re.compile(
    r"^Found (\d+) errors? in \d+ files? \(checked \d+ source files?\)$"
)
_SUCCESS = re.compile(r"^Success: no issues found in \d+ source files?$")


def parse_error_count(output: str) -> int:
    """The error count from mypy's summary line.

    Raises ValueError when there is no summary line: mypy crashed, the config
    did not parse, or a plugin failed to load. Treating that as zero errors
    would pass a run that checked nothing.
    """
    for line in reversed(output.strip().splitlines()):
        line = line.strip()
        found = _FOUND.match(line)
        if found:
            return int(found.group(1))
        if _SUCCESS.match(line):
            return 0
    raise ValueError("mypy produced no summary line; it did not finish a check")


def read_baseline(path: Path = BASELINE_FILE) -> int:
    """The recorded count: the first line that is not blank or a comment."""
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return int(line)
    raise ValueError(f"{path.name} holds no count")


def write_baseline(count: int, path: Path = BASELINE_FILE) -> None:
    path.write_text(
        "# mypy error count for `python -m mypy app`, enforced by\n"
        "# scripts/mypy_ratchet.py. Lower it when you fix errors\n"
        "# (`python scripts/mypy_ratchet.py --update`); never raise it.\n"
        f"{count}\n"
    )


def verdict(count: int, baseline: int) -> tuple[bool, str]:
    """Whether ``count`` passes against ``baseline``, and what to tell the reader."""
    if count > baseline:
        return False, (
            f"mypy reports {count} errors, {count - baseline} more than the "
            f"baseline of {baseline}. Fix the new errors (mypy's output is "
            "above); do not raise the baseline."
        )
    if count < baseline:
        return True, (
            f"mypy reports {count} errors, {baseline - count} fewer than the "
            f"baseline of {baseline}. Lock the improvement in: run "
            "`python scripts/mypy_ratchet.py --update` and commit "
            "mypy-baseline.txt."
        )
    return True, f"mypy reports {count} errors, matching the baseline."


def run_mypy() -> str:
    completed = subprocess.run(
        [sys.executable, "-m", "mypy", "app"],
        cwd=BACKEND_DIR,
        capture_output=True,
        text=True,
    )
    return completed.stdout + completed.stderr


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--update",
        action="store_true",
        help="rewrite mypy-baseline.txt to the current count",
    )
    args = parser.parse_args()

    output = run_mypy()
    try:
        count = parse_error_count(output)
    except ValueError as exc:
        print(output)
        print(f"\n{exc}", file=sys.stderr)
        return 2

    if args.update:
        write_baseline(count)
        print(f"Baseline set to {count}.")
        return 0

    ok, message = verdict(count, read_baseline())
    if not ok:
        print(output)
    print(message, file=sys.stdout if ok else sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
