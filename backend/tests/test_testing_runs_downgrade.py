"""The testing-runs downgrade must survive a create_all-built installation.

``testing_checklist_entries`` and ``testing_runs`` are create_all-only tables
(CLAUDE.md pitfall #26), so an installation that started the app before running
the upgrade carries the run_id foreign key under SQLAlchemy's naming
convention rather than the name this migration's own upgrade gives it. The
downgrade has to find that constraint whatever it is called: dropping by a
hardcoded name aborts with 1091 when the name is absent, and skipping the drop
lets ``drop_column`` abort with 1828 instead. Either way the DDL above has
already committed, so the schema is left with the unique index gone, run_id
still present and the revision still stamped — a state nothing self-heals,
because Alembic will not re-run a revision it believes is applied.
"""

import importlib.util
from pathlib import Path

import pytest

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_MIGRATION = _VERSIONS / "20260827_1600_c4d8e2f7a913_testing_runs.py"


def _module():
    spec = importlib.util.spec_from_file_location("_testing_runs_probe", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestForeignKeyDiscovery:
    def test_downgrade_does_not_drop_a_foreign_key_by_hardcoded_name(self):
        """The upgrade may name it; the downgrade may not assume that name."""
        source = _MIGRATION.read_text(encoding="utf-8")
        downgrade = source.split("def downgrade()", 1)[1]
        assert "fk_testing_entry_run" not in downgrade

    def test_finds_the_constraint_under_the_create_all_name(self, monkeypatch):
        module = _module()

        class _Inspector:
            @staticmethod
            def get_foreign_keys(table):
                assert table == "testing_checklist_entries"
                return [
                    {
                        "name": "fk_testing_checklist_entries_run_id_testing_runs",
                        "constrained_columns": ["run_id"],
                    },
                    {
                        "name": "fk_testing_checklist_entries_organization_id",
                        "constrained_columns": ["organization_id"],
                    },
                ]

        monkeypatch.setattr(module, "_inspector", lambda: _Inspector())
        assert module._foreign_keys_on("testing_checklist_entries", "run_id") == [
            "fk_testing_checklist_entries_run_id_testing_runs"
        ]

    def test_finds_the_constraint_under_the_migrations_own_name(self, monkeypatch):
        module = _module()

        class _Inspector:
            @staticmethod
            def get_foreign_keys(table):
                return [
                    {"name": "fk_testing_entry_run", "constrained_columns": ["run_id"]}
                ]

        monkeypatch.setattr(module, "_inspector", lambda: _Inspector())
        assert module._foreign_keys_on("testing_checklist_entries", "run_id") == [
            "fk_testing_entry_run"
        ]

    @pytest.mark.parametrize(
        "foreign_keys",
        [
            [],
            [{"name": None, "constrained_columns": ["run_id"]}],
            [{"name": "fk_other", "constrained_columns": ["organization_id"]}],
            [{"name": "fk_no_columns"}],
        ],
    )
    def test_returns_nothing_when_no_named_constraint_covers_the_column(
        self, monkeypatch, foreign_keys
    ):
        """An unnamed or absent constraint must not become a drop of ``None``."""
        module = _module()
        monkeypatch.setattr(
            module,
            "_inspector",
            lambda: type(
                "I", (), {"get_foreign_keys": staticmethod(lambda t: foreign_keys)}
            )(),
        )
        assert module._foreign_keys_on("testing_checklist_entries", "run_id") == []
