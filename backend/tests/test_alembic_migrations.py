"""
Alembic Migration Chain Integrity Tests

Validates the migration file structure to catch issues like duplicate
revision IDs, broken chains, and branching before they crash the app
at startup.

Run with:
    pytest tests/test_alembic_migrations.py -v
"""

import re
import pytest
from pathlib import Path

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _parse_migrations():
    """Parse all migration files and extract revision metadata."""
    migrations = []
    revision_re = re.compile(r"^revision\s*=\s*['\"](.+?)['\"]", re.MULTILINE)
    down_rev_re = re.compile(r"^down_revision\s*=\s*['\"](.+?)['\"]", re.MULTILINE)
    down_rev_none_re = re.compile(
        r"^down_revision\s*=\s*None", re.MULTILINE
    )

    for path in sorted(VERSIONS_DIR.glob("*.py")):
        if path.name == "__pycache__":
            continue
        content = path.read_text(encoding="utf-8")
        rev_match = revision_re.search(content)
        down_match = down_rev_re.search(content)
        down_none = down_rev_none_re.search(content)

        if rev_match:
            migrations.append({
                "file": path.name,
                "path": path,
                "revision": rev_match.group(1),
                "down_revision": down_match.group(1) if down_match else None,
                "is_base": down_none is not None and not down_match,
            })
    return migrations


MIGRATIONS = _parse_migrations()


class TestNoDuplicateRevisions:
    """Ensure no two migration files share the same revision ID."""

    def test_no_duplicate_revision_ids(self):
        seen = {}
        duplicates = []
        for m in MIGRATIONS:
            rev = m["revision"]
            if rev in seen:
                duplicates.append(
                    f"Revision '{rev}' used by both "
                    f"{seen[rev]} and {m['file']}"
                )
            seen[rev] = m["file"]

        assert duplicates == [], (
            "Duplicate Alembic revision IDs found:\n"
            + "\n".join(f"  - {d}" for d in duplicates)
        )

    def test_no_duplicate_down_revisions(self):
        """Two migrations pointing to the same parent means a fork."""
        seen = {}
        forks = []
        for m in MIGRATIONS:
            down = m["down_revision"]
            if down is None:
                continue
            if down in seen:
                forks.append(
                    f"down_revision '{down}' shared by "
                    f"{seen[down]} and {m['file']}"
                )
            seen[down] = m["file"]

        assert forks == [], (
            "Forked migration chain detected (multiple children for one parent):\n"
            + "\n".join(f"  - {f}" for f in forks)
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
        """Every down_revision should point to an existing revision."""
        all_revisions = {m["revision"] for m in MIGRATIONS}
        broken = []
        for m in MIGRATIONS:
            down = m["down_revision"]
            if down is not None and down not in all_revisions:
                broken.append(
                    f"{m['file']}: down_revision '{down}' "
                    f"does not match any revision"
                )

        assert broken == [], (
            "Broken migration chain links:\n"
            + "\n".join(f"  - {b}" for b in broken)
        )

    def test_all_migrations_reachable_from_base(self):
        """Walk from base to head and ensure every migration is visited."""
        rev_to_file = {m["revision"]: m["file"] for m in MIGRATIONS}
        down_to_child = {}
        for m in MIGRATIONS:
            if m["down_revision"] is not None:
                down_to_child[m["down_revision"]] = m["revision"]

        bases = [m for m in MIGRATIONS if m["is_base"]]
        if not bases:
            pytest.skip("No base migration found")

        visited = set()
        current = bases[0]["revision"]
        while current:
            visited.add(current)
            current = down_to_child.get(current)

        unreachable = set(rev_to_file.keys()) - visited
        assert unreachable == set(), (
            "Migrations not reachable from base:\n"
            + "\n".join(
                f"  - {rev_to_file[r]} (revision={r})" for r in unreachable
            )
        )

    def test_exactly_one_head(self):
        """Only one migration should have no child pointing to it."""
        all_down_revisions = {
            m["down_revision"] for m in MIGRATIONS if m["down_revision"]
        }
        heads = [
            m for m in MIGRATIONS if m["revision"] not in all_down_revisions
        ]
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
            if "revision = " not in content:
                missing.append(path.name)

        assert missing == [], (
            "Migration files missing revision identifier:\n"
            + "\n".join(f"  - {m}" for m in missing)
        )

    def test_all_migrations_have_upgrade_function(self):
        missing = []
        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            if "def upgrade" not in content:
                missing.append(path.name)

        assert missing == [], (
            "Migration files missing upgrade() function:\n"
            + "\n".join(f"  - {m}" for m in missing)
        )

    def test_all_migrations_have_downgrade_function(self):
        missing = []
        for path in sorted(VERSIONS_DIR.glob("*.py")):
            content = path.read_text(encoding="utf-8")
            if "def downgrade" not in content:
                missing.append(path.name)

        assert missing == [], (
            "Migration files missing downgrade() function:\n"
            + "\n".join(f"  - {m}" for m in missing)
        )
