#!/usr/bin/env python3
"""Fail when a root npm override contradicts a workspace's own dependency pin.

npm applies the root `overrides` block to workspace dependencies too, and its
own rule is that an override naming a package you depend on directly must carry
the *exact same spec* as that dependency. When the two drift, `npm ci` refuses
the whole tree with an EUSAGE error rather than resolving it.

That drift is what a dependency bot produces by construction: it edits the
manifest that declares the package -- `frontend/package.json` -- and never the
root `overrides` block that shadows it. PR #2567 bumped vite to 8.3.0 against an
override still pinning 8.2.2, and every frontend job died at `npm ci` before a
single test ran.

This check runs from the Backend Lint job precisely because that job does not
install npm dependencies. A frontend test could not police this: `npm ci` is the
step that fails, so nothing downstream of it ever executes.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOT_MANIFEST = ROOT / "package.json"

DEPENDENCY_SECTIONS = ("dependencies", "devDependencies", "optionalDependencies")


def workspace_manifests(root_manifest: dict) -> list[tuple[str, Path]]:
    """Return (name, path) for each workspace manifest the root declares."""
    found: list[tuple[str, Path]] = []
    for entry in root_manifest.get("workspaces", []):
        manifest = ROOT / entry / "package.json"
        if manifest.is_file():
            found.append((f"{entry}/package.json", manifest))
    return found


def declared_specs(manifest: dict) -> dict[str, str]:
    """Return every direct dependency spec in a manifest, by package name."""
    specs: dict[str, str] = {}
    for section in DEPENDENCY_SECTIONS:
        specs.update(manifest.get(section, {}))
    return specs


def override_conflicts(
    root_manifest: dict, workspaces: list[tuple[str, dict]]
) -> list[str]:
    """Return every override whose spec contradicts a direct dependency pin."""
    conflicts: list[str] = []
    overrides = root_manifest.get("overrides", {})
    for package, override_spec in sorted(overrides.items()):
        # A nested override object retargets a package's own dependencies
        # rather than the package itself, so there is no spec to compare.
        if not isinstance(override_spec, str):
            continue
        # `$name` defers to the root's own dependency spec, which is npm's
        # supported way of saying "whatever we depend on" -- never a conflict.
        if override_spec.startswith("$"):
            continue
        for label, manifest in workspaces:
            declared = declared_specs(manifest).get(package)
            if declared is not None and declared != override_spec:
                conflicts.append(
                    f'overrides["{package}"] is "{override_spec}" but {label} '
                    f'declares "{declared}" -- npm requires these to match '
                    f"exactly, and `npm ci` fails while they differ. Move both "
                    f"together, or drop the override if it forces nothing."
                )
    return conflicts


def main() -> int:
    root_manifest = json.loads(ROOT_MANIFEST.read_text())
    workspaces = [
        (label, json.loads(path.read_text()))
        for label, path in workspace_manifests(root_manifest)
    ]
    conflicts = override_conflicts(root_manifest, workspaces)
    if conflicts:
        for conflict in conflicts:
            print(f"ERROR: {conflict}", file=sys.stderr)
        return 1
    count = len(root_manifest.get("overrides", {}))
    print(f"npm overrides: {count} entries, none contradicting a workspace pin")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
