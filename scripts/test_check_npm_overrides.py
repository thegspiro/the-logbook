import json
import unittest
from pathlib import Path

from check_npm_overrides import (
    ROOT,
    ROOT_MANIFEST,
    declared_specs,
    override_conflicts,
    workspace_manifests,
)


def root(overrides, workspaces=("frontend",)):
    return {"workspaces": list(workspaces), "overrides": overrides}


class OverrideConflictTest(unittest.TestCase):
    def test_matching_spec_is_allowed(self):
        conflicts = override_conflicts(
            root({"esbuild": "^0.28.1"}),
            [("frontend/package.json", {"devDependencies": {"esbuild": "^0.28.1"}})],
        )

        assert conflicts == []

    def test_drifted_spec_is_reported(self):
        # The exact shape that took PR #2567's frontend jobs red.
        conflicts = override_conflicts(
            root({"vite": "8.2.2"}),
            [("frontend/package.json", {"devDependencies": {"vite": "8.3.0"}})],
        )

        assert len(conflicts) == 1
        assert "vite" in conflicts[0]
        assert "8.2.2" in conflicts[0]
        assert "8.3.0" in conflicts[0]

    def test_override_for_a_package_no_workspace_declares_is_allowed(self):
        # This is the case overrides exist for: forcing a transitive package
        # nothing declares directly.
        conflicts = override_conflicts(
            root({"nested-transitive": "1.2.3"}),
            [("frontend/package.json", {"devDependencies": {"vite": "8.3.0"}})],
        )

        assert conflicts == []

    def test_dollar_reference_is_not_a_conflict(self):
        conflicts = override_conflicts(
            root({"react": "$react"}),
            [("frontend/package.json", {"dependencies": {"react": "^19.3.0"}})],
        )

        assert conflicts == []

    def test_nested_override_object_is_skipped(self):
        conflicts = override_conflicts(
            root({"react": {"react-dom": "^19.3.0"}}),
            [("frontend/package.json", {"dependencies": {"react": "^19.2.8"}})],
        )

        assert conflicts == []

    def test_every_dependency_section_is_searched(self):
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            with self.subTest(section=section):
                conflicts = override_conflicts(
                    root({"pkg": "1.0.0"}),
                    [("frontend/package.json", {section: {"pkg": "2.0.0"}})],
                )

                assert len(conflicts) == 1

    def test_declared_specs_merges_sections(self):
        specs = declared_specs(
            {"dependencies": {"a": "1"}, "devDependencies": {"b": "2"}}
        )

        assert specs == {"a": "1", "b": "2"}


class RepositoryManifestTest(unittest.TestCase):
    """The committed manifests must satisfy the rule, not just the fixtures."""

    def test_repository_has_no_override_conflicts(self):
        root_manifest = json.loads(ROOT_MANIFEST.read_text())
        workspaces = [
            (label, json.loads(path.read_text()))
            for label, path in workspace_manifests(root_manifest)
        ]

        assert override_conflicts(root_manifest, workspaces) == []

    def test_workspace_manifests_are_discovered(self):
        root_manifest = json.loads(ROOT_MANIFEST.read_text())
        labels = [label for label, _ in workspace_manifests(root_manifest)]

        assert "frontend/package.json" in labels

    def test_workspace_paths_resolve_under_the_repository(self):
        root_manifest = json.loads(ROOT_MANIFEST.read_text())

        for _, path in workspace_manifests(root_manifest):
            assert Path(path).is_file()
            assert ROOT in Path(path).parents


if __name__ == "__main__":
    unittest.main()
