#!/usr/bin/env python3
"""Fail when dependency scanners acquire unreviewed vulnerability suppressions."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CI_WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
TRIVY_IGNORE = ROOT / ".trivyignore"

VULNERABILITY_ID = re.compile(r"\b(?:CVE-\d{4}-\d+|GHSA-[\w-]+|PYSEC-\d{4}-\d+)\b")


def active_trivy_entries(content: str) -> list[str]:
    """Return non-comment entries from a Trivy ignore file."""
    return [
        line.strip()
        for line in content.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]


def policy_errors(ci_content: str, trivy_content: str) -> list[str]:
    """Return scanner-policy violations found in supplied configuration text."""
    errors: list[str] = []
    if "pip-audit -r requirements.txt" not in ci_content:
        errors.append("CI must run pip-audit against backend/requirements.txt")
    if "--ignore-vuln" in ci_content:
        errors.append("pip-audit must not suppress advisories with --ignore-vuln")

    trivy_entries = active_trivy_entries(trivy_content)
    if trivy_entries:
        errors.append(
            ".trivyignore must not contain active entries: " + ", ".join(trivy_entries)
        )

    # Catch IDs hidden in scanner command continuations even if a flag spelling
    # changes. Comments are excluded so the policy can explain retired findings.
    ci_commands = "\n".join(
        line for line in ci_content.splitlines() if not line.lstrip().startswith("#")
    )
    ids = sorted(set(VULNERABILITY_ID.findall(ci_commands)))
    if ids:
        errors.append("CI scanner commands contain advisory IDs: " + ", ".join(ids))
    return errors


def main() -> int:
    errors = policy_errors(CI_WORKFLOW.read_text(), TRIVY_IGNORE.read_text())
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("Security scan policy: no dependency vulnerability suppressions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
