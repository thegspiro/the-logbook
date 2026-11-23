"""A migration whose change already exists is skipped alone, not with every
migration after it (app/core/migration_recovery.py).

Startup used to stamp alembic_version to head on any "already exists" or
"duplicate" error, which marked every later migration as applied without
running it; an installation stamped that way kept event_requests.contact_email
NOT NULL and failed phone-only requests. Driven against a fake Alembic so each
case states exactly which migrations ran.
"""

import pytest

from app.core.migration_recovery import (
    heads_after_marking,
    is_duplicate_error,
    ready_revisions,
    upgrade_skipping_duplicates,
)

pytestmark = pytest.mark.unit

LINEAR = {"base": (), "a": ("base",), "b": ("a",), "c": ("b",)}
# base -> x, base -> y, both merged by m, then n on top.
BRANCHED = {"base": (), "x": ("base",), "y": ("base",), "m": ("x", "y"), "n": ("m",)}


class FakeAlembic:
    """Applies revisions in parent-first order, as `alembic upgrade` does, and
    raises a duplicate error on any revision in ``duplicates``."""

    def __init__(self, revisions, heads, duplicates=(), other_errors=()):
        self.revisions = revisions
        self.heads = list(heads)
        self.duplicates = set(duplicates)
        self.other_errors = set(other_errors)
        self.ran: list[str] = []

    def _applied(self):
        seen, stack = set(), list(self.heads)
        while stack:
            rev = stack.pop()
            if rev not in seen:
                seen.add(rev)
                stack.extend(self.revisions[rev])
        return seen

    def upgrade(self, target):
        while target not in self._applied():
            rev = ready_revisions(self.revisions, self.heads, target)[0]
            if rev in self.duplicates:
                raise RuntimeError(f"(1060, \"Duplicate column name 'col_{rev}'\")")
            if rev in self.other_errors:
                raise RuntimeError("(1146, \"Table 'x' doesn't exist\")")
            self.ran.append(rev)
            self.heads = heads_after_marking(self.revisions, self.heads, rev)

    def run(self, target):
        return upgrade_skipping_duplicates(
            revisions=self.revisions,
            target=target,
            upgrade=self.upgrade,
            read_heads=lambda: list(self.heads),
            write_heads=self._write,
        )

    def _write(self, heads):
        self.heads = list(heads)


def test_a_healthy_upgrade_runs_everything_and_skips_nothing():
    alembic = FakeAlembic(LINEAR, ["base"])
    assert alembic.run("c") == []
    assert alembic.ran == ["a", "b", "c"]
    assert alembic.heads == ["c"]


def test_only_the_migration_that_already_exists_is_skipped():
    """The old behaviour would have stamped to c with neither b nor c run."""
    alembic = FakeAlembic(LINEAR, ["base"], duplicates={"b"})
    skipped = alembic.run("c")
    assert [s.revision for s in skipped] == ["b"]
    assert "Duplicate column" in skipped[0].error
    assert alembic.ran == ["a", "c"]
    assert alembic.heads == ["c"]


def test_each_of_several_duplicates_is_skipped_separately():
    alembic = FakeAlembic(LINEAR, ["base"], duplicates={"a", "c"})
    assert [s.revision for s in alembic.run("c")] == ["a", "c"]
    assert alembic.ran == ["b"]


def test_a_duplicate_on_one_branch_leaves_the_other_branch_and_the_merge_running():
    alembic = FakeAlembic(BRANCHED, ["base"], duplicates={"x"})
    assert [s.revision for s in alembic.run("n")] == ["x"]
    assert set(alembic.ran) == {"y", "m", "n"}
    assert alembic.heads == ["n"]


def test_any_other_error_still_stops_the_upgrade():
    alembic = FakeAlembic(LINEAR, ["base"], other_errors={"b"})
    with pytest.raises(RuntimeError, match="1146"):
        alembic.run("c")
    assert alembic.ran == ["a"]


def test_marking_a_merge_replaces_both_of_its_parents():
    assert heads_after_marking(BRANCHED, ["x", "y"], "m") == ["m"]
    assert heads_after_marking(BRANCHED, ["x", "base"], "y") == ["x", "y"]


def test_only_revisions_whose_parents_are_applied_are_ready():
    assert ready_revisions(BRANCHED, ["base"], "n") == ["x", "y"]
    assert ready_revisions(BRANCHED, ["x"], "n") == ["y"]
    assert ready_revisions(BRANCHED, ["n"], "n") == []


@pytest.mark.parametrize(
    ("message", "duplicate"),
    [
        ("(1060, \"Duplicate column name 'source'\")", True),
        ("(1050, \"Table 'shifts' already exists\")", True),
        ("(1061, \"Duplicate key name 'ix_x'\")", True),
        ("(1265, \"Data truncated for column 'x'\")", False),
    ],
)
def test_what_counts_as_already_present(message, duplicate):
    assert is_duplicate_error(RuntimeError(message)) is duplicate


def test_skipping_the_target_itself_finishes_without_asking_alembic_again():
    calls = []
    heads = ["b"]

    def upgrade(rev):
        calls.append(rev)
        raise RuntimeError("(1060, \"Duplicate column name 'source'\")")

    def write(new):
        heads[:] = new

    skipped = upgrade_skipping_duplicates(
        revisions=LINEAR,
        target="c",
        upgrade=upgrade,
        read_heads=lambda: list(heads),
        write_heads=write,
    )
    assert [s.revision for s in skipped] == ["c"]
    assert heads == ["c"]
    assert calls == ["c", "c"]
