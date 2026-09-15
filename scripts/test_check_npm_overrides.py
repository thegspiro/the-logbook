import json
import unittest
from pathlib import Path

from check_npm_overrides import (
    ROOT,
    ROOT_MANIFEST,
    declared_specs,
    exact_version,
    override_conflicts,
    satisfies,
    workspace_manifests,
)


def root(overrides, workspaces=("frontend",)):
    return {"workspaces": list(workspaces), "overrides": overrides}


def frontend(section, package, spec):
    return [("frontend/package.json", {section: {package: spec}})]


class SatisfiesTest(unittest.TestCase):
    def test_exact_spec_requires_equality(self):
        assert satisfies((8, 3, 0), "8.3.0") is True
        assert satisfies((8, 2, 2), "8.3.0") is False

    def test_caret_admits_higher_minor_below_next_major(self):
        assert satisfies((19, 3, 0), "^19.2.8") is True
        assert satisfies((19, 2, 7), "^19.2.8") is False
        assert satisfies((20, 0, 0), "^19.2.8") is False

    def test_caret_below_one_pins_the_minor(self):
        # ^0.28.1 keeps the leftmost non-zero component, so 0.29.0 is out.
        assert satisfies((0, 28, 2), "^0.28.1") is True
        assert satisfies((0, 29, 0), "^0.28.1") is False
        assert satisfies((0, 28, 0), "^0.28.1") is False

    def test_caret_on_a_zero_minor_pins_the_patch(self):
        assert satisfies((0, 0, 3), "^0.0.3") is True
        assert satisfies((0, 0, 4), "^0.0.3") is False

    def test_tilde_pins_the_minor(self):
        assert satisfies((1, 2, 9), "~1.2.3") is True
        assert satisfies((1, 3, 0), "~1.2.3") is False

    def test_undecidable_specs_return_none(self):
        for spec in ("^6.0.0 || ^7.0.0", "*", "latest", ">=1.2.3", "npm:other@1.2.3"):
            with self.subTest(spec=spec):
                assert satisfies((1, 2, 3), spec) is None

    def test_exact_version_rejects_ranges(self):
        assert exact_version("8.3.0") == (8, 3, 0)
        assert exact_version("^8.3.0") is None


class OverrideConflictTest(unittest.TestCase):
    def test_identical_spec_is_allowed(self):
        conflicts = override_conflicts(
            root({"esbuild": "^0.28.1"}),
            frontend("devDependencies", "esbuild", "^0.28.1"),
        )

        assert conflicts == []

    def test_exact_mismatch_is_reported(self):
        # The exact shape that took PR #2567's frontend jobs red.
        conflicts = override_conflicts(
            root({"vite": "8.2.2"}), frontend("devDependencies", "vite", "8.3.0")
        )

        assert len(conflicts) == 1
        assert "vite" in conflicts[0]
        assert "8.2.2" in conflicts[0]
        assert "8.3.0" in conflicts[0]

    def test_range_override_admitting_the_declared_range_is_allowed(self):
        # Live on main after #2567: overrides ^19.2.8 vs a declared ^19.3.0.
        # npm resolves 19.3.x, which satisfies both. Flagging this would fail a
        # tree npm installs happily -- the bug the first draft of this check had.
        conflicts = override_conflicts(
            root({"react": "^19.2.8"}), frontend("dependencies", "react", "^19.3.0")
        )

        assert conflicts == []

    def test_exact_override_outside_the_declared_range_is_reported(self):
        conflicts = override_conflicts(
            root({"vite": "8.2.2"}), frontend("devDependencies", "vite", "^8.3.0")
        )

        assert len(conflicts) == 1

    def test_exact_override_inside_the_declared_range_is_allowed(self):
        conflicts = override_conflicts(
            root({"vite": "8.3.1"}), frontend("devDependencies", "vite", "^8.3.0")
        )

        assert conflicts == []

    def test_declared_pin_outside_a_range_override_is_reported(self):
        conflicts = override_conflicts(
            root({"react": "^19.2.8"}), frontend("dependencies", "react", "20.0.0")
        )

        assert len(conflicts) == 1

    def test_undecidable_pair_is_skipped(self):
        conflicts = override_conflicts(
            root({"vite": "^6.0.0 || ^7.0.0"}),
            frontend("devDependencies", "vite", ">=8"),
        )

        assert conflicts == []

    def test_override_for_a_package_no_workspace_declares_is_allowed(self):
        # This is the case overrides exist for: forcing a transitive package
        # nothing declares directly.
        conflicts = override_conflicts(
            root({"nested-transitive": "1.2.3"}),
            frontend("devDependencies", "vite", "8.3.0"),
        )

        assert conflicts == []

    def test_dollar_reference_is_not_a_conflict(self):
        conflicts = override_conflicts(
            root({"react": "$react"}), frontend("dependencies", "react", "^19.3.0")
        )

        assert conflicts == []

    def test_nested_override_object_is_skipped(self):
        conflicts = override_conflicts(
            root({"react": {"react-dom": "^19.3.0"}}),
            frontend("dependencies", "react", "^19.2.8"),
        )

        assert conflicts == []

    def test_every_dependency_section_is_searched(self):
        for section in ("dependencies", "devDependencies", "optionalDependencies"):
            with self.subTest(section=section):
                conflicts = override_conflicts(
                    root({"pkg": "1.0.0"}), frontend(section, "pkg", "2.0.0")
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
