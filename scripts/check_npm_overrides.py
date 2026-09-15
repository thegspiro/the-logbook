#!/usr/bin/env python3
"""Fail when a root npm override cannot resolve to what a workspace asks for.

npm applies the root `overrides` block to workspace dependencies too. When the
override forces a version the workspace's own spec excludes, nothing can satisfy
both and `npm ci` refuses the whole tree with an EUSAGE error.

That drift is what a dependency bot produces by construction: it edits the
manifest that declares the package -- `frontend/package.json` -- and never the
root `overrides` block that shadows it. PR #2567 bumped vite to 8.3.0 against an
override still pinning 8.2.2, and every frontend job died at `npm ci` before a
single test ran.

Only a *provable* contradiction is reported. An override of `^19.2.8` against a
declared `^19.3.0` is fine -- 19.3.x satisfies both -- and flagging it would fail
a tree npm installs happily, which is how the first draft of this check would
have taken `main` red. So the rule is narrow: when one side pins an exact
version, that version must satisfy the other side. Anything this cannot decide
(a disjunction, a wildcard, a URL) is skipped rather than guessed at.

This runs from the Backend Lint job precisely because that job does not install
npm dependencies. A frontend test could not police this: `npm ci` is the step
that fails, so nothing downstream of it ever executes.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOT_MANIFEST = ROOT / "package.json"

DEPENDENCY_SECTIONS = ("dependencies", "devDependencies", "optionalDependencies")

EXACT = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
RANGED = re.compile(r"^([\^~])(\d+)\.(\d+)\.(\d+)$")


def workspace_manifests(root_manifest: dict) -> list[tuple[str, Path]]:
    """Return (label, path) for each workspace manifest the root declares."""
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


def exact_version(spec: str) -> tuple[int, int, int] | None:
    """Return the version an exact pin names, or None if the spec is a range."""
    match = EXACT.match(spec.strip())
    if not match:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]


def satisfies(version: tuple[int, int, int], spec: str) -> bool | None:
    """Whether an exact version falls inside a spec. None when undecidable.

    Deliberately covers only `1.2.3`, `^1.2.3` and `~1.2.3`. A disjunction, a
    wildcard, a git URL or a `workspace:` protocol returns None so the caller
    skips it -- a guess here costs a red build on a tree npm installs fine.
    """
    spec = spec.strip()
    pinned = exact_version(spec)
    if pinned is not None:
        return version == pinned

    ranged = RANGED.match(spec)
    if not ranged:
        return None

    operator, major, minor, patch = (
        ranged.group(1),
        int(ranged.group(2)),
        int(ranged.group(3)),
        int(ranged.group(4)),
    )
    floor = (major, minor, patch)
    if version < floor:
        return False
    if operator == "~":
        return version < (major, minor + 1, 0)
    # Caret keeps the leftmost non-zero component, so ^0.2.3 admits no 0.3.0 and
    # ^0.0.3 admits nothing but 0.0.3 -- npm's rule for pre-1.0 packages, which
    # `esbuild` at ^0.28.1 is.
    if major > 0:
        return version < (major + 1, 0, 0)
    if minor > 0:
        return version < (0, minor + 1, 0)
    return version == floor


def override_conflicts(
    root_manifest: dict, workspaces: list[tuple[str, dict]]
) -> list[str]:
    """Return every override provably irreconcilable with a workspace's spec."""
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
            if declared is None or declared == override_spec:
                continue

            # Prove the contradiction from whichever side names a version.
            pinned_override = exact_version(override_spec)
            pinned_declared = exact_version(declared)
            if pinned_override is not None:
                verdict = satisfies(pinned_override, declared)
            elif pinned_declared is not None:
                verdict = satisfies(pinned_declared, override_spec)
            else:
                verdict = None

            if verdict is False:
                conflicts.append(
                    f'overrides["{package}"] is "{override_spec}" but {label} '
                    f'declares "{declared}", and no version satisfies both -- '
                    f"`npm ci` fails while they disagree. Move them together, "
                    f"or drop the override if it forces nothing."
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
