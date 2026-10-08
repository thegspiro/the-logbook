"""Every endpoint that accepts an uploaded file must malware-scan it.

The owner's rule (docs/FILE_STORAGE_HARDENING.md, decision 8): every file fed
into the platform is scanned — stored on disk, stored in the database, or
parsed in memory and thrown away. A new upload endpoint that forgets is the
regression this catches.

An AST sweep over ``app/api``: any function with a parameter annotated
``UploadFile`` (or a list of them) must call one of the scanning entry points,
directly or through a helper defined in the same module. It is a structural
check, not a proof — it cannot see a scan that happens on a different code
path — so it errs toward naming every endpoint it cannot verify.
"""

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

APP_API = Path(__file__).resolve().parents[1] / "app" / "api"

# Calls that scan, or that route through FileStorageService (which scans).
SCANNING_CALLS = {
    "reject_if_malicious",
    "scan_and_validate_logo",
    "store_upload",
    "store_bytes",
}


def _call_names(node: ast.AST) -> set[str]:
    names = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Name):
                names.add(func.id)
            elif isinstance(func, ast.Attribute):
                names.add(func.attr)
    return names


def _takes_upload(func: ast.AST) -> bool:
    for arg in [*func.args.args, *func.args.kwonlyargs]:
        if arg.annotation is not None and "UploadFile" in ast.unparse(arg.annotation):
            return True
    return False


def _unscanned_upload_handlers() -> list[str]:
    offenders = []
    for path in sorted(APP_API.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        functions = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        # A module helper scans if it calls a scanning entry point.
        scanning_helpers = {
            name
            for name, node in functions.items()
            if _call_names(node) & SCANNING_CALLS
        }
        for name, node in functions.items():
            if not _takes_upload(node):
                continue
            calls = _call_names(node)
            if calls & SCANNING_CALLS or calls & scanning_helpers:
                continue
            offenders.append(f"{path.relative_to(APP_API.parent.parent)}::{name}")
    return offenders


def test_every_upload_endpoint_scans_what_it_receives():
    offenders = _unscanned_upload_handlers()
    assert not offenders, (
        "These handlers accept an uploaded file but never reach a malware "
        "scan. Store through FileStorageService, or call "
        "app.services.upload_scanning.reject_if_malicious before the file is "
        f"read, parsed or stored: {offenders}"
    )


def test_the_sweep_finds_upload_endpoints_at_all():
    """Guard against the sweep silently matching nothing."""
    found = 0
    for path in APP_API.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        found += sum(
            1
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and _takes_upload(node)
        )
    assert found >= 15
