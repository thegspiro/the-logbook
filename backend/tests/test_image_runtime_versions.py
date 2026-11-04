"""
The shipped images run the Python and Node that CI tests on.

Owner decision of 2026-11-01 ("pin images to tested versions", see
docs/KNOWN_LIMITATIONS.md, "Dependencies"): a container must not run an
interpreter the test suites never ran on. Both sides are read from the files
that define them -- the ``setup-python`` / ``setup-node`` steps of every
workflow and the ``FROM`` lines of every Dockerfile -- so bumping one without
the other fails here rather than shipping an untested runtime.

Static only; needs no Docker daemon.
"""

import json
import re
from pathlib import Path

import pytest
import yaml

ROOT_DIR = Path(__file__).resolve().parents[2]
WORKFLOWS_DIR = ROOT_DIR / ".github" / "workflows"


def _dockerfiles() -> list[Path]:
    """Every Dockerfile the repository builds an image from."""
    found = [
        path
        for path in ROOT_DIR.rglob("Dockerfile*")
        if "node_modules" not in path.parts and path.is_file()
    ]
    return sorted(found)


def _workflow_step_versions(action: str, key: str) -> set[str]:
    """Every ``with.<key>`` given to ``uses: <action>@...`` in any workflow."""
    versions: set[str] = set()
    for workflow in sorted(WORKFLOWS_DIR.glob("*.yml")):
        data = yaml.safe_load(workflow.read_text(encoding="utf-8")) or {}
        for job in (data.get("jobs") or {}).values():
            for step in job.get("steps") or []:
                uses = str(step.get("uses", ""))
                if uses.split("@", 1)[0] != action:
                    continue
                value = (step.get("with") or {}).get(key)
                if value is not None:
                    versions.add(str(value).strip())
    return versions


def _ci_python() -> str:
    versions = _workflow_step_versions("actions/setup-python", "python-version")
    assert versions, "no workflow sets up Python; nothing to compare images to"
    assert len(versions) == 1, (
        f"workflows test on more than one Python ({sorted(versions)}); decide "
        "which one the images ship before pinning them"
    )
    (version,) = versions
    assert re.fullmatch(r"\d+\.\d+", version), (
        f"CI's python-version {version!r} is not a major.minor; the image tag "
        "comparison below needs one"
    )
    return version


def _ci_node_major() -> str:
    versions = _workflow_step_versions("actions/setup-node", "node-version")
    assert versions, "no workflow sets up Node; nothing to compare images to"
    majors = {v.split(".", 1)[0] for v in versions}
    assert len(majors) == 1, f"workflows test on more than one Node: {sorted(versions)}"
    (major,) = majors
    assert major.isdigit(), f"CI's node-version {versions} has no numeric major"
    return major


def _from_images(dockerfile: Path) -> list[str]:
    """External images named in FROM lines (stage references are skipped)."""
    images = []
    for line in dockerfile.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[0].upper() != "FROM":
            continue
        args = [p for p in parts[1:] if not p.startswith("--")]
        if args:
            images.append(args[0])
    return images


def _images_named(repository: str) -> list[tuple[Path, str]]:
    out = []
    for dockerfile in _dockerfiles():
        for image in _from_images(dockerfile):
            name, _, tag = image.partition(":")
            if name.rsplit("/", 1)[-1] == repository:
                out.append((dockerfile.relative_to(ROOT_DIR), tag))
    return out


class TestImagesRunTheTestedRuntime:
    def test_there_are_python_and_node_images_to_check(self):
        """Guards the two checks below against passing vacuously."""
        assert _images_named("python"), "no Dockerfile builds on a python image"
        assert _images_named("node"), "no Dockerfile builds on a node image"

    def test_every_python_base_is_the_ci_python(self):
        ci = _ci_python()
        drifted = [
            f"{path}: python:{tag}"
            for path, tag in _images_named("python")
            if not re.fullmatch(rf"{re.escape(ci)}(-[a-z0-9.-]+)?", tag)
        ]
        assert not drifted, (
            f"CI tests on Python {ci}, but these images run something else "
            f"(pin them to python:{ci}-<variant>): {drifted}"
        )

    def test_every_node_base_is_the_ci_node_major(self):
        major = _ci_node_major()
        drifted = [
            f"{path}: node:{tag}"
            for path, tag in _images_named("node")
            if not re.fullmatch(rf"{major}(\.\d+){{0,2}}(-[a-z0-9.-]+)?", tag)
        ]
        assert not drifted, (
            f"CI tests on Node {major}, but these images run something else "
            f"(pin them to node:{major}-<variant>): {drifted}"
        )

    @pytest.mark.parametrize(
        "manifest", ["package.json", "frontend/package.json"], ids=lambda p: p
    )
    def test_node_engines_floor_is_the_ci_major(self, manifest: str):
        """``engines`` is the third statement of the Node version; it must
        name the same major the images and CI use."""
        engines = json.loads((ROOT_DIR / manifest).read_text(encoding="utf-8"))[
            "engines"
        ]["node"]
        floor = re.match(r">=\s*(\d+)", engines)
        assert floor, f"{manifest} engines.node {engines!r} has no >= floor"
        assert floor.group(1) == _ci_node_major()
