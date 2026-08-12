"""Regression tests for the repository dependency-scanner policy."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from check_security_scan_policy import active_trivy_entries  # noqa: E402
from check_security_scan_policy import policy_errors


def test_repository_security_scans_have_no_suppressions():
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    trivy = (ROOT / ".trivyignore").read_text()

    assert policy_errors(ci, trivy) == []


def test_policy_rejects_pip_audit_ignore():
    ci = "pip-audit -r requirements.txt --ignore-vuln PYSEC-2026-1"

    errors = policy_errors(ci, "# no entries\n")

    assert any("--ignore-vuln" in error for error in errors)
    assert any("PYSEC-2026-1" in error for error in errors)


def test_policy_rejects_active_trivy_entry():
    assert active_trivy_entries("# rationale\nCVE-2026-1234\n") == ["CVE-2026-1234"]
    errors = policy_errors("pip-audit -r requirements.txt", "CVE-2026-1234\n")
    assert any(".trivyignore" in error for error in errors)
