"""The wizard's overwrite reaches departments that already onboarded.

The onboarding position editor saved whatever its checkboxes said, and its
defaults came from a role-type heuristic rather than from ``DEFAULT_POSITIONS``.
The first Continue therefore replaced the seeded rows: ``member`` got
``facilities.view`` and ``notifications.view`` back — two earlier migrations had
removed the former — and ``board_of_directors`` got ``.*`` on eighteen modules
it is not seeded with. ``dependencies.py`` unions every assigned position's
stored permissions, so those are live grants.

Presenting the registry's own defaults fixes departments that have not
onboarded. The endpoint refuses to run again once setup is complete, so only
``20260901_1320_f7b3c8d2e569`` reaches the rest — and it has to recognise an
untouched row without disturbing one somebody edited.
"""

import importlib.util
from pathlib import Path

import pytest

_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("_repair_grants", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheRewriteTable:
    def test_it_revokes_the_two_grants_the_heuristic_re_added_to_member(self):
        member = _migration()._REWRITES["member"]

        assert "facilities.view" in member["old"]
        assert "notifications.view" in member["old"]
        assert "facilities.view" not in member["new"]
        assert "notifications.view" not in member["new"]

    def test_it_revokes_the_board_manage_grants(self):
        board = _migration()._REWRITES["board_of_directors"]

        wildcards_before = [p for p in board["old"] if p.endswith(".*")]
        wildcards_after = [p for p in board["new"] if p.endswith(".*")]
        assert len(wildcards_before) >= 18
        assert len(wildcards_after) < len(wildcards_before)

    def test_every_entry_actually_changes_something(self):
        """A slug whose old and new agree has nothing to repair, and listing it
        only invites a reader to think it did."""
        for slug, rewrite in _migration()._REWRITES.items():
            assert sorted(rewrite["old"]) != sorted(rewrite["new"]), slug

    def test_the_stored_lists_are_json_serialisable_strings(self):
        for slug, rewrite in _migration()._REWRITES.items():
            for key in ("old", "new"):
                assert all(isinstance(p, str) for p in rewrite[key]), (slug, key)


class TestItOnlyRewritesAnUntouchedRow:
    """Matched on the whole stored list, because the old save was a
    replacement: an untouched row holds exactly the heuristic's output. A row
    that differs by one permission has been edited since, and revoking a grant
    somebody chose to make is worse than leaving a mistaken one in place."""

    @staticmethod
    def _matches(stored, slug):
        rewrite = _migration()._REWRITES[slug]
        return sorted(rewrite["old"]) == sorted(stored)

    def test_the_heuristic_output_is_recognised(self):
        member = _migration()._REWRITES["member"]
        assert self._matches(list(reversed(member["old"])), "member")

    @pytest.mark.parametrize("edit", ["add", "remove"])
    def test_an_edited_row_is_left_alone(self, edit):
        member = _migration()._REWRITES["member"]
        stored = list(member["old"])
        if edit == "add":
            stored.append("reports.manage")
        else:
            stored.pop()

        assert not self._matches(stored, "member")

    def test_an_already_repaired_row_is_left_alone(self):
        """Re-running the migration must not thrash a row it already fixed."""
        member = _migration()._REWRITES["member"]
        assert not self._matches(member["new"], "member")
