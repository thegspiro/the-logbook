"""Migration 20260903_1300 settles legacy email_service sections.

The transform is pure, so it is asserted against a fake connection in the
manner of test_email_preference_migration.py; the CI matrix runs the real
SQL on MySQL 8.0 and MariaDB 10.11.
"""

import importlib.util
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260903_1300_e3a9c1d5b7f2_settle_legacy_email_settings.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("_email_settle_probe", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(stored_rows, table_present=True):
    """Run upgrade() against a fake bind; return {org_id: written settings}."""
    module = _load()
    written = {}
    rows = [(f"org{i}", raw) for i, raw in enumerate(stored_rows)]

    def execute(statement, params=None):
        text = str(statement)
        if text.strip().upper().startswith("SELECT"):
            return MagicMock(fetchall=MagicMock(return_value=rows))
        written[params["id"]] = json.loads(params["settings"])
        return MagicMock()

    bind = MagicMock()
    bind.execute = MagicMock(side_effect=execute)
    inspector = MagicMock()
    inspector.get_table_names.return_value = ["organizations"] if table_present else []

    with (
        patch.object(module.op, "get_bind", return_value=bind),
        patch.object(module.sa, "inspect", return_value=inspector),
    ):
        module.upgrade()
    return written


class TestLegacyPlatformIsSettled:
    def test_label_with_smtp_host_becomes_selfhosted(self):
        written = _run(
            [
                json.dumps(
                    {
                        "email_service": {
                            "enabled": True,
                            "platform": "sendgrid",
                            "smtp_host": "smtp.sendgrid.net",
                            "smtp_password": "enc:x",
                        },
                        "modules": {"events": True},
                    }
                )
            ]
        )

        email = written["org0"]["email_service"]
        assert email["platform"] == "selfhosted"
        assert email["smtp_host"] == "smtp.sendgrid.net"
        assert email["smtp_password"] == "enc:x"
        # The rest of the settings document is carried through untouched.
        assert written["org0"]["modules"] == {"events": True}

    def test_label_without_smtp_host_becomes_other(self):
        written = _run([json.dumps({"email_service": {"platform": "mailgun"}})])

        assert written["org0"]["email_service"]["platform"] == "other"

    def test_missing_platform_becomes_other(self):
        written = _run([json.dumps({"email_service": {"enabled": False}})])

        assert written["org0"]["email_service"]["platform"] == "other"


class TestLegacyOAuthKeysArePruned:
    def test_every_retired_key_is_removed_and_the_rest_kept(self):
        written = _run(
            [
                json.dumps(
                    {
                        "email_service": {
                            "enabled": True,
                            "platform": "gmail",
                            "from_email": "chief@example.org",
                            "google_client_id": "123.apps.googleusercontent.com",
                            "google_client_secret": "enc:dead",
                            "google_app_password": "enc:live",
                            "microsoft_tenant_id": "t",
                            "microsoft_client_id": "c",
                            "microsoft_client_secret": "enc:dead2",
                        }
                    }
                )
            ]
        )

        email = written["org0"]["email_service"]
        assert email == {
            "enabled": True,
            "platform": "gmail",
            "from_email": "chief@example.org",
            "google_app_password": "enc:live",
        }


class TestRowsAreOnlyWrittenWhenTheyChange:
    def test_canonical_row_is_left_alone(self):
        written = _run(
            [
                json.dumps(
                    {
                        "email_service": {
                            "enabled": True,
                            "platform": "gmail",
                            "from_email": "chief@example.org",
                            "google_app_password": "enc:live",
                        }
                    }
                )
            ]
        )

        assert written == {}

    def test_rows_without_an_email_section_are_left_alone(self):
        written = _run(
            [
                json.dumps({"modules": {"events": True}}),
                json.dumps({"email_service": None}),
                "",
                None,
            ]
        )

        assert written == {}

    def test_driver_returning_a_dict_is_handled(self):
        # aiomysql/PyMySQL hand JSON back as str; some drivers hand back dict.
        written = _run([{"email_service": {"platform": "sendgrid", "smtp_host": "h"}}])

        assert written["org0"]["email_service"]["platform"] == "selfhosted"

    def test_missing_table_is_skipped(self):
        # CI runs `alembic upgrade head` on an empty database before create_all.
        assert _run([json.dumps({"email_service": {}})], table_present=False) == {}
