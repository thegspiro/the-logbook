#!/usr/bin/env python3
"""Render JUnit XML into the GitHub Actions run summary.

Reading a CI failure currently means opening the job log and scrolling. On
2026-08-19 a one-line ModuleNotFoundError sat behind ~1,400 lines of Alembic
migration chatter and MariaDB boot output; the log tail that a reader reaches
first was the service container shutting down, which says nothing about why the
job failed. This puts the failing test names on the run's front page instead,
where GitHub shows them without a click.

Deliberately incapable of failing the build. A summary is a convenience, and a
broken convenience must never turn a green run red or a red run green — the
exit status is always 0, with problems reported as workflow warnings.
"""

from __future__ import annotations

import argparse
import glob
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# GitHub truncates a step summary at 1 MiB. Long before that it stops being
# readable, and the failing names are the point — the full detail is in the
# uploaded artifact.
MAX_LISTED_FAILURES = 40
MAX_MESSAGE_CHARS = 300


class Totals:
    """Accumulated counts across every parsed suite."""

    def __init__(self) -> None:
        self.tests = 0
        self.failures = 0
        self.errors = 0
        self.skipped = 0
        self.time = 0.0

    def add(self, suite: ET.Element) -> None:
        self.tests += int(suite.get("tests") or 0)
        self.failures += int(suite.get("failures") or 0)
        self.errors += int(suite.get("errors") or 0)
        self.skipped += int(suite.get("skipped") or 0)
        try:
            self.time += float(suite.get("time") or 0.0)
        except ValueError:
            pass

    @property
    def bad(self) -> int:
        return self.failures + self.errors


def _suites(root: ET.Element) -> list[ET.Element]:
    """Return the testsuite elements, whether or not they are wrapped."""
    if root.tag == "testsuite":
        return [root]
    return list(root.iter("testsuite"))


def _case_label(case: ET.Element) -> str:
    classname = (case.get("classname") or "").strip()
    name = (case.get("name") or "?").strip()
    return f"{classname}::{name}" if classname else name


def _failure_detail(case: ET.Element) -> str | None:
    """Return a one-line reason when a case failed or errored, else None."""
    for tag in ("failure", "error"):
        node = case.find(tag)
        if node is None:
            continue
        message = (node.get("message") or node.text or "").strip()
        # Keep the first line: pytest puts the assertion on it and the rest is
        # a traceback that the artifact carries in full.
        first = message.splitlines()[0] if message else tag
        if len(first) > MAX_MESSAGE_CHARS:
            first = first[:MAX_MESSAGE_CHARS] + "…"
        return first
    return None


def collect(paths: list[str]) -> tuple[Totals, list[tuple[str, str]], list[str]]:
    """Parse every readable report, returning totals, failures and warnings."""
    totals = Totals()
    failures: list[tuple[str, str]] = []
    warnings: list[str] = []
    seen = False

    for pattern in paths:
        matches = sorted(glob.glob(pattern, recursive=True))
        if not matches and not any(ch in pattern for ch in "*?["):
            matches = [pattern] if Path(pattern).exists() else []
        for match in matches:
            seen = True
            try:
                root = ET.parse(match).getroot()
            except (ET.ParseError, OSError) as exc:
                warnings.append(f"could not read {match}: {exc}")
                continue
            for suite in _suites(root):
                totals.add(suite)
                for case in suite.iter("testcase"):
                    detail = _failure_detail(case)
                    if detail is not None:
                        failures.append((_case_label(case), detail))

    if not seen:
        warnings.append(f"no JUnit reports matched: {', '.join(paths)}")
    return totals, failures, warnings


def render(title: str, totals: Totals, failures: list[tuple[str, str]]) -> str:
    # Zero tests is reported as its own state, never as a pass. A run whose
    # reports were all missing or unparseable has not demonstrated anything,
    # and rendering that as a green tick is the exact confusion between "no bad
    # news" and "good news" that the aggregate gate exists to prevent.
    if totals.bad:
        verdict = "❌ failed"
    elif totals.tests == 0:
        verdict = "⚠️ no results"
    else:
        verdict = "✅ passed"
    lines = [
        f"### {title}",
        "",
        "| Result | Tests | Failures | Errors | Skipped | Time |",
        "| --- | --- | --- | --- | --- | --- |",
        f"| {verdict} | {totals.tests} | {totals.failures} | {totals.errors} "
        f"| {totals.skipped} | {totals.time:.1f}s |",
        "",
    ]

    if failures:
        lines.append(f"#### Failing tests ({len(failures)})")
        lines.append("")
        for label, detail in failures[:MAX_LISTED_FAILURES]:
            lines.append(f"- `{label}`  \n  {detail}")
        if len(failures) > MAX_LISTED_FAILURES:
            omitted = len(failures) - MAX_LISTED_FAILURES
            lines.append("")
            lines.append(
                f"_{omitted} further failure(s) not listed; the full report is "
                "in this run's artifacts._"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", help="JUnit XML files or globs")
    parser.add_argument(
        "--title", default="Test results", help="heading for the summary section"
    )
    args = parser.parse_args()

    try:
        totals, failures, warnings = collect(args.paths)
        summary = render(args.title, totals, failures)
    except Exception as exc:  # a summary must never break a job
        print(f"::warning::could not build the test summary: {exc}")
        return 0

    for warning in warnings:
        print(f"::warning::{warning}")

    destination = os.environ.get("GITHUB_STEP_SUMMARY")
    if destination:
        try:
            with open(destination, "a", encoding="utf-8") as handle:
                handle.write(summary)
        except OSError as exc:
            print(f"::warning::could not write the step summary: {exc}")
    else:
        sys.stdout.write(summary)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
