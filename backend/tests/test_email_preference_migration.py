"""Migration 20260816_0007 folds the dead `email` preference key away.

Two things are being protected. First the data rule: an explicit
``email: false`` was a real opt-out recorded through the admin contact panel,
so it has to survive onto the key the senders read — nobody should start
receiving mail again because a key was renamed underneath them. Second the
portability: the first version of this migration used MySQL's
``CAST(... AS JSON)``, which MariaDB has no syntax for, and MariaDB 10.11 is a
supported deployment target (docker-compose.arm.yml, and its own CI matrix
leg). The rewrite does the transform in Python so both engines run it.

The migration's SQL is exercised against a real database by the CI matrix; the
transform itself is pure, so it is asserted here against a fake connection. No
MySQL needed.
"""

import importlib.util
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260816_0007_unify_email_notification_preference.py"
)


def _load():
    """Load the migration by path: alembic/versions is not an import package."""
    spec = importlib.util.spec_from_file_location("_email_pref_probe", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(stored_rows):
    """Run upgrade() against a fake bind; return {user_id: written prefs}."""
    module = _load()
    written = {}

    rows = [(f"u{i}", raw) for i, raw in enumerate(stored_rows)]

    def execute(statement, params=None):
        text = str(statement)
        if text.strip().upper().startswith("SELECT"):
            return MagicMock(fetchall=MagicMock(return_value=rows))
        # An UPDATE: record what would be persisted.
        written[params["id"]] = json.loads(params["prefs"])
        return MagicMock()

    bind = MagicMock()
    bind.execute = MagicMock(side_effect=execute)

    inspector = MagicMock()
    inspector.get_table_names.return_value = ["users"]
    inspector.get_columns.return_value = [{"name": "notification_preferences"}]

    with patch.object(module.op, "get_bind", return_value=bind), patch.object(
        module.sa, "inspect", return_value=inspector
    ):
        module.upgrade()
    return written


class TestOptOutIsPreserved:
    def test_an_explicit_email_false_carries_onto_the_surviving_key(self):
        written = _run([json.dumps({"email": False, "email_notifications": True})])
        assert written["u0"] == {"email_notifications": False}

    def test_email_true_simply_loses_the_dead_key(self):
        written = _run([json.dumps({"email": True, "email_notifications": True})])
        assert written["u0"] == {"email_notifications": True}

    def test_an_existing_opt_out_is_not_resurrected_by_a_true_email_key(self):
        written = _run([json.dumps({"email": True, "email_notifications": False})])
        assert written["u0"] == {"email_notifications": False}

    def test_other_preferences_are_left_alone(self):
        written = _run(
            [json.dumps({"email": False, "sms_notifications": False, "x": 1})]
        )
        assert written["u0"] == {
            "sms_notifications": False,
            "x": 1,
            "email_notifications": False,
        }


class TestRowsItMustNotTouch:
    @pytest.mark.parametrize(
        "raw",
        [
            json.dumps({"email_notifications": False}),  # already migrated
            json.dumps({}),
            json.dumps([1, 2]),  # not an object
            "not json at all",
        ],
    )
    def test_a_row_with_no_dead_key_is_not_rewritten(self, raw):
        assert _run([raw]) == {}


class TestDriverShapes:
    def test_a_dict_from_the_driver_is_handled_like_a_json_string(self):
        # Some driver/engine combinations decode a JSON column for you.
        written = _run([{"email": False}])
        assert written["u0"] == {"email_notifications": False}


class TestPortability:
    def _sql_literals(self):
        """Every string this migration hands to sa.text().

        Parsed rather than grepped: the prose above these calls names the
        MySQL-only syntax it stopped using, and a plain substring search over
        the file would match the explanation as readily as a relapse.
        """
        import ast

        tree = ast.parse(MIGRATION_PATH.read_text())
        statements = []
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if getattr(func, "attr", None) != "text":
                continue
            for arg in node.args:
                fragments = [arg] if isinstance(arg, ast.Constant) else []
                if isinstance(arg, ast.BinOp):  # implicit concatenation
                    fragments = [
                        n for n in ast.walk(arg) if isinstance(n, ast.Constant)
                    ]
                statements.append(
                    "".join(f.value for f in fragments if isinstance(f.value, str))
                )
        return statements

    def test_the_migration_issues_sql(self):
        # Guards the guard: an assertion over an empty list passes vacuously.
        assert self._sql_literals()

    def test_no_mysql_only_json_cast_reaches_the_database(self):
        # CAST(... AS JSON) is a syntax error on MariaDB, so its return would
        # break upgrades on every ARM installation before either statement ran.
        offenders = [sql for sql in self._sql_literals() if "AS JSON" in sql.upper()]
        assert offenders == []


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-v"]))
