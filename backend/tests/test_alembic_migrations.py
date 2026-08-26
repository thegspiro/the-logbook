"""
Alembic Migration Chain Integrity Tests

Validates the migration file structure to catch issues like duplicate
revision IDs, broken chains, and branching before they crash the app
at startup.

Run with:
    pytest tests/test_alembic_migrations.py -v
"""

import re
from pathlib import Path

import pytest

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _parse_migrations():
    """Parse all migration files and extract revision metadata.

    ``down_revision`` may be ``None`` (base), a single revision string, or a
    tuple/list of revisions (a merge migration that reconciles a fork). It is
    parsed into ``down_revisions`` (a list of parents) so the chain checks
    model the real DAG rather than assuming a single linear history.
    """
    migrations = []
    revision_re = re.compile(
        r"^revision(?:\s*:\s*\w+)?\s*=\s*['\"](.+?)['\"]", re.MULTILINE
    )
    # Capture the full right-hand side so tuple/list parents are handled.
    down_rev_re = re.compile(
        r"^down_revision(?:\s*:[^=\n]+)?\s*=\s*(.+)$", re.MULTILINE
    )

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name == "__pycache__":
            continue
        content = path.read_text(encoding="utf-8")
        rev_match = revision_re.search(content)
        if not rev_match:
            continue

        down_match = down_rev_re.search(content)
        parents: list[str] = []
        is_base = False
        if down_match:
            rhs = down_match.group(1).strip()
            parents = re.findall(r"['\"]([^'\"]+)['\"]", rhs)
            if not parents and rhs.startswith("None"):
                is_base = True

        migrations.append(
            {
                "file": path.name,
                "path": path,
                "revision": rev_match.group(1),
                "down_revisions": parents,
                # First parent, retained for the linear chronological walk.
                "down_revision": parents[0] if parents else None,
                "is_base": is_base,
            }
        )
    return migrations


MIGRATIONS = _parse_migrations()


class TestRenumberedRevisionCompatibility:
    """Previously released revision stamps must remain upgradeable."""

    def test_legacy_revision_ids_remain_in_the_graph(self):
        by_revision = {migration["revision"]: migration for migration in MIGRATIONS}

        assert by_revision["20260812_0005"]["down_revisions"] == ["20260813_0002"]
        assert by_revision["20260812_0006"]["down_revisions"] == ["20260812_0005"]
        assert set(by_revision["20260813_0007_merge"]["down_revisions"]) == {
            "20260812_0006",
            "20260813_0007",
        }
        assert by_revision["20260813_0008"]["down_revisions"] == ["20260813_0007_merge"]


class TestNoDuplicateRevisions:
    """Ensure no two migration files share the same revision ID."""

    def test_no_duplicate_revision_ids(self):
        seen = {}
        duplicates = []
        for m in MIGRATIONS:
            rev = m["revision"]
            if rev in seen:
                duplicates.append(
                    f"Revision '{rev}' used by both " f"{seen[rev]} and {m['file']}"
                )
            seen[rev] = m["file"]

        assert duplicates == [], "Duplicate Alembic revision IDs found:\n" + "\n".join(
            f"  - {d}" for d in duplicates
        )

    def test_forks_are_resolved_into_a_single_head(self):
        """A parent with multiple children is a fork. Forks are valid only
        when a downstream merge migration reconciles them — i.e. the DAG must
        still collapse to exactly one head."""
        children: dict = {}
        for m in MIGRATIONS:
            for parent in m["down_revisions"]:
                children.setdefault(parent, []).append(m["file"])
        forks = {p: kids for p, kids in children.items() if len(kids) > 1}

        all_parents = {p for m in MIGRATIONS for p in m["down_revisions"]}
        heads = [m for m in MIGRATIONS if m["revision"] not in all_parents]

        assert len(heads) == 1, (
            "Unresolved fork in the migration chain — every fork must be "
            "reconciled by a merge migration into a single head.\n"
            f"Forks: {forks}\n"
            f"Heads: {[h['file'] for h in heads]}"
        )


class TestMigrationChain:
    """Validate the migration chain forms a single linear sequence."""

    def test_exactly_one_base_migration(self):
        bases = [m for m in MIGRATIONS if m["is_base"]]
        assert len(bases) == 1, (
            f"Expected exactly 1 base migration (down_revision=None), "
            f"found {len(bases)}: {[b['file'] for b in bases]}"
        )

    def test_chain_is_complete(self):
        """Every parent (incl. each parent of a merge) must exist."""
        all_revisions = {m["revision"] for m in MIGRATIONS}
        broken = []
        for m in MIGRATIONS:
            for down in m["down_revisions"]:
                if down not in all_revisions:
                    broken.append(
                        f"{m['file']}: down_revision '{down}' "
                        f"does not match any revision"
                    )

        assert broken == [], "Broken migration chain links:\n" + "\n".join(
            f"  - {b}" for b in broken
        )

    def test_all_migrations_reachable_from_base(self):
        """Walk the DAG from base following every edge (merges have multiple
        parents) and ensure every migration is visited."""
        rev_to_file = {m["revision"]: m["file"] for m in MIGRATIONS}
        children: dict = {}
        for m in MIGRATIONS:
            for parent in m["down_revisions"]:
                children.setdefault(parent, []).append(m["revision"])

        bases = [m for m in MIGRATIONS if m["is_base"]]
        if not bases:
            pytest.skip("No base migration found")

        visited = set()
        stack = [bases[0]["revision"]]
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            stack.extend(children.get(current, []))

        unreachable = set(rev_to_file.keys()) - visited
        assert (
            unreachable == set()
        ), "Migrations not reachable from base:\n" + "\n".join(
            f"  - {rev_to_file[r]} (revision={r})" for r in unreachable
        )

    def test_exactly_one_head(self):
        """Only one migration should have no child pointing to it (parents of
        merge migrations are flattened so merges don't create phantom heads)."""
        all_parents = {p for m in MIGRATIONS for p in m["down_revisions"]}
        heads = [m for m in MIGRATIONS if m["revision"] not in all_parents]
        assert len(heads) == 1, (
            f"Expected exactly 1 head migration, found {len(heads)}: "
            f"{[h['file'] for h in heads]}"
        )


class TestMigrationFileQuality:
    """Basic quality checks on migration files."""

    def test_all_migrations_have_revision(self):
        """Every .py file in versions/ should have a revision identifier."""
        missing = []
        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            if "revision" not in content or (
                "revision = " not in content and "revision:" not in content
            ):
                missing.append(path.name)

        assert (
            missing == []
        ), "Migration files missing revision identifier:\n" + "\n".join(
            f"  - {m}" for m in missing
        )

    def test_all_migrations_have_upgrade_function(self):
        missing = []
        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            if "def upgrade" not in content:
                missing.append(path.name)

        assert (
            missing == []
        ), "Migration files missing upgrade() function:\n" + "\n".join(
            f"  - {m}" for m in missing
        )

    def test_all_migrations_have_downgrade_function(self):
        missing = []
        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            if "def downgrade" not in content:
                missing.append(path.name)

        assert (
            missing == []
        ), "Migration files missing downgrade() function:\n" + "\n".join(
            f"  - {m}" for m in missing
        )

    def test_filename_matches_revision_id(self):
        """Migration filenames should start with their revision ID.

        Uses a date-based naming convention: YYYYMMDD_NNNN_description.py
        where the revision ID is the YYYYMMDD_NNNN prefix.
        """
        mismatches = []
        # Only check migrations that use date-based revision IDs (YYYYMMDD_NNNN)
        date_rev_re = re.compile(r"^\d{8}_\d{4}$")
        for m in MIGRATIONS:
            if date_rev_re.match(m["revision"]):
                if not m["file"].startswith(m["revision"]):
                    mismatches.append(
                        f"{m['file']}: revision='{m['revision']}' "
                        f"does not match filename prefix"
                    )

        assert (
            mismatches == []
        ), "Migration filenames don't match their revision IDs:\n" + "\n".join(
            f"  - {m}" for m in mismatches
        )

    def test_downgrade_is_not_empty_pass(self):
        """Downgrade functions should contain real rollback logic, not just pass."""
        empty_downgrades = []
        downgrade_re = re.compile(
            r"def downgrade\(\)[^:]*:\s*\n(\s+)pass\s*$",
            re.MULTILINE,
        )

        # Merge migrations legitimately use pass for both upgrade and downgrade
        upgrade_pass_re = re.compile(
            r"def upgrade\(\)[^:]*:\s*\n(\s+)pass\s*$",
            re.MULTILINE,
        )
        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            if downgrade_re.search(content):
                if upgrade_pass_re.search(content):
                    continue
                empty_downgrades.append(path.name)

        assert empty_downgrades == [], (
            "Migrations with empty downgrade() (just 'pass') — these are "
            "not reversible:\n" + "\n".join(f"  - {f}" for f in empty_downgrades)
        )

    def test_no_drop_table_without_if_exists(self):
        """DROP TABLE in migrations should use IF EXISTS to be idempotent."""
        violations = []
        # Match op.execute containing DROP TABLE without IF EXISTS
        drop_re = re.compile(
            r"DROP\s+TABLE\s+(?!IF\s+EXISTS)",
            re.IGNORECASE,
        )

        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            for i, line in enumerate(content.splitlines(), 1):
                if drop_re.search(line):
                    violations.append(f"{path.name}:{i}")

        assert violations == [], (
            "Migrations using DROP TABLE without IF EXISTS "
            "(not idempotent on re-run):\n" + "\n".join(f"  - {v}" for v in violations)
        )

    def test_date_based_revisions_are_chronologically_ordered(self):
        """Date-based revision IDs should be in chronological order.

        Only checks revisions on different dates — same-date ordering
        varies due to historical numbering conventions.
        """
        date_rev_re = re.compile(r"^(\d{8})_(\d{4})$")
        rev_to_file = {m["revision"]: m for m in MIGRATIONS}
        down_to_child = {}
        for m in MIGRATIONS:
            if m["down_revision"] is not None:
                down_to_child[m["down_revision"]] = m["revision"]

        bases = [m for m in MIGRATIONS if m["is_base"]]
        if not bases:
            pytest.skip("No base migration found")

        # Walk the chain; only flag when a later date has a lower date prefix
        out_of_order = []
        current = bases[0]["revision"]
        while current in down_to_child:
            child = down_to_child[current]
            cur_match = date_rev_re.match(current)
            child_match = date_rev_re.match(child)
            if cur_match and child_match:
                cur_date = cur_match.group(1)
                child_date = child_match.group(1)
                if child_date < cur_date:
                    out_of_order.append(
                        f"{rev_to_file[child]['file']} (rev={child}) comes "
                        f"after {rev_to_file[current]['file']} (rev={current}) "
                        f"but has an earlier date"
                    )
            current = child

        assert (
            out_of_order == []
        ), "Migration revision IDs are not in chronological order:\n" + "\n".join(
            f"  - {o}" for o in out_of_order
        )


class TestResumeCountReconciliation:
    """20260813_0007 repairs the databases the resume-count renumbering skipped.

    ``20260812_0002`` used to be the prospect-uniqueness migration. A deployment
    that upgraded before it was renumbered is stamped for work now attributed to
    the resume-count file, so Alembic walks past it and ``skill_tests``
    never gets ``resume_count`` — a NOT NULL column the model reads on every
    skills-test load. The stamp is legitimate and cannot be rewritten, so the
    schema is reconciled instead, and that only works if the reconciliation is
    a no-op everywhere else.
    """

    RECONCILE = "20260813_0007"
    ORIGINAL = "20260812_0002"

    def _migration(self, revision):
        found = [m for m in MIGRATIONS if m["revision"] == revision]
        assert found, f"No migration with revision {revision}"
        return found[0]

    def test_reconciliation_runs_after_the_revision_it_repairs(self):
        """It has to sit downstream of the whole renumbered stretch.

        An affected database is stamped at 20260812_0002, so anything at or
        before that revision is never replayed for it.
        """
        reconcile = self._migration(self.RECONCILE)
        assert reconcile["down_revisions"] == ["20260813_0006"]

        # Walk parents back from the reconciliation to the revision it repairs.
        by_revision = {m["revision"]: m for m in MIGRATIONS}
        seen = set()
        current = reconcile
        while current["down_revisions"]:
            parent = current["down_revisions"][0]
            assert parent not in seen, f"cycle in the chain at {parent}"
            seen.add(parent)
            if parent == self.ORIGINAL:
                break
            current = by_revision[parent]
        assert self.ORIGINAL in seen

    def test_upgrade_is_guarded_so_a_re_run_changes_nothing(self):
        source = self._migration(self.RECONCILE)["path"].read_text(encoding="utf-8")
        assert 'has_table("skill_tests")' in source, (
            "skill_tests is model-only on some deployments; the migration must "
            "skip cleanly when the table is absent"
        )
        assert 'if "resume_count" in' in source, (
            "the migration must return early when the column is already there — "
            "the whole fleet apart from the affected deployments runs it as a "
            "no-op"
        )

    def test_column_definition_matches_the_migration_it_repairs(self):
        """A different type or default would be schema drift by another name."""
        reconcile = self._migration(self.RECONCILE)["path"].read_text(encoding="utf-8")
        original = self._migration(self.ORIGINAL)["path"].read_text(encoding="utf-8")

        column_re = re.compile(
            r'sa\.Column\(\s*"resume_count",(.*?)\)\s*,?\s*\)', re.DOTALL
        )
        reconcile_def = column_re.search(reconcile)
        original_def = column_re.search(original)
        assert reconcile_def is not None, f"{self.RECONCILE} adds no resume_count"
        assert original_def is not None, f"{self.ORIGINAL} adds no resume_count"

        def _normalized(text: str) -> str:
            return re.sub(r"\s+", "", text)

        assert _normalized(reconcile_def.group(1)) == _normalized(
            original_def.group(1)
        ), (
            "20260813_0007 must add exactly the column 20260812_0002 adds — "
            "same type, nullability and server default"
        )

    def test_downgrade_does_not_drop_the_column(self):
        """Reversing the repair must not break the databases that were fine.

        20260812_0002 stays applied when this revision is reversed, so dropping
        the column here would leave the model reading a column that is gone.
        """
        source = self._migration(self.RECONCILE)["path"].read_text(encoding="utf-8")
        downgrade = source.split("def downgrade()", 1)[1]
        assert "drop_column" not in downgrade

    @pytest.mark.integration
    def test_upgrade_restores_the_column_and_is_idempotent(self):
        """Run it for real against the test database, twice."""
        import importlib.util

        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from sqlalchemy import create_engine, inspect

        from app.core.config import settings

        path = self._migration(self.RECONCILE)["path"]
        spec = importlib.util.spec_from_file_location("_reconcile_probe", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def _has_column(connection) -> bool:
            return "resume_count" in {
                c["name"] for c in inspect(connection).get_columns("skill_tests")
            }

        engine = create_engine(settings.SYNC_DATABASE_URL)
        try:
            with engine.connect() as conn:
                if not inspect(conn).has_table("skill_tests"):
                    pytest.skip("skill_tests is not present in the test database")

                # Reproduce the affected deployment: stamped, column missing.
                if _has_column(conn):
                    conn.exec_driver_sql(
                        "ALTER TABLE skill_tests DROP COLUMN resume_count"
                    )
                    conn.commit()
                assert not _has_column(conn)

                with Operations.context(MigrationContext.configure(conn)):
                    module.upgrade()
                conn.commit()
                assert _has_column(conn)

                column = next(
                    c
                    for c in inspect(conn).get_columns("skill_tests")
                    if c["name"] == "resume_count"
                )
                assert column["nullable"] is False
                assert str(column["default"]).strip("'") == "0"

                # Idempotent: the same file on a database that already has it.
                with Operations.context(MigrationContext.configure(conn)):
                    module.upgrade()
                conn.commit()
                assert _has_column(conn)
        finally:
            # Never leave the shared test database short a NOT NULL column,
            # whatever failed above — MySQL DDL does not roll back.
            with engine.connect() as conn:
                if inspect(conn).has_table("skill_tests") and not _has_column(conn):
                    conn.exec_driver_sql(
                        "ALTER TABLE skill_tests "
                        "ADD COLUMN resume_count INTEGER NOT NULL DEFAULT 0"
                    )
                    conn.commit()
            engine.dispose()


class TestValidateMigrationsScriptFailsOnAFork:
    """The dedicated gate must be at least as strict as the test suite.

    `scripts/validate_migrations.py` is what CI's Backend Lint job runs on
    every push, and it is the only check whose whole purpose is the chain. A
    fork used to reach it as a *warning*: the script printed "Multiple heads
    detected" and then "VALIDATION PASSED" and exited 0, so the gate written
    for this exact problem waved it through while `alembic upgrade head` was
    already failing with "Multiple head revisions".

    Both forks of 2026-08-24 were caught by TestMigrationChain above instead —
    the general-purpose suite being stricter than the dedicated gate is the
    inversion this pins shut.
    """

    @staticmethod
    def _write(tmp_path, name, revision, down_revision):
        down = "None" if down_revision is None else f'"{down_revision}"'
        (tmp_path / name).write_text(
            f'"""Fixture migration."""\n\n'
            f'revision = "{revision}"\n'
            f"down_revision = {down}\n"
            f"branch_labels = None\n"
            f"depends_on = None\n\n\n"
            f"def upgrade():\n    pass\n\n\n"
            f"def downgrade():\n    pass\n"
        )

    def _validate(self, tmp_path):
        import importlib.util

        script = (
            Path(__file__).resolve().parents[1] / "scripts" / "validate_migrations.py"
        )
        spec = importlib.util.spec_from_file_location("_validate_migrations", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        # (is_valid, errors, warnings)
        return module.validate_migrations(tmp_path)

    def test_a_linear_chain_passes(self, tmp_path):
        self._write(tmp_path, "0001_base.py", "aaaa11112222", None)
        self._write(tmp_path, "0002_next.py", "bbbb11112222", "aaaa11112222")

        is_valid, errors, _warnings = self._validate(tmp_path)

        assert is_valid is True
        assert errors == []

    def test_a_forked_chain_fails(self, tmp_path):
        """Two migrations claiming the same parent — the exact shape that
        broke this branch twice when main landed a migration first."""
        self._write(tmp_path, "0001_base.py", "aaaa11112222", None)
        self._write(tmp_path, "0002_ours.py", "bbbb11112222", "aaaa11112222")
        self._write(tmp_path, "0003_theirs.py", "cccc11112222", "aaaa11112222")

        is_valid, errors, _warnings = self._validate(tmp_path)

        assert is_valid is False, (
            "A forked chain must FAIL the dedicated gate, not warn: "
            "`alembic upgrade head` cannot run until it is resolved."
        )
        assert any("Multiple heads" in e for e in errors), errors
