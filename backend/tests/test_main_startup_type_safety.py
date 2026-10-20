"""``main.py`` states the cases it used to assume away.

mypy reported nine errors in ``main.py`` that CI never saw, because the ratchet
only checks ``app/``. Four of them were values that really can be ``None`` or an
unexpected type at runtime, and each was handled by an accident rather than a
decision:

* a migration file Python cannot load gave an ``AttributeError`` on ``None``;
* an empty ``alembic/versions`` made ``get_current_head()`` return ``None``,
  which flowed on to ``command.upgrade()``;
* a health check that found the database or Redis "connected" with no client
  to use called ``None`` and reported ``unhealthy`` for a state that is
  ``disconnected``;
* the rate-limit handler was typed for ``RateLimitExceeded`` while Starlette
  hands every handler an ``Exception``.

These pin the behaviour that now replaces each accident.
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

import main

pytestmark = pytest.mark.unit


class TestMigrationFileThatCannotBeLoaded:
    def test_an_unloadable_file_raises_import_error(self, tmp_path):
        # An unrecognised suffix makes spec_from_file_location return None.
        migration = tmp_path / "revision.unknown"
        migration.write_text("revision = 'abc'\n")

        with pytest.raises(ImportError, match="Cannot load migration module"):
            main._run_migration_file(MagicMock(), str(migration))


class TestNoHeadRevision:
    def test_a_missing_head_skips_migrations_instead_of_upgrading_to_none(self):
        script_dir = MagicMock()
        script_dir.walk_revisions.return_value = []
        script_dir.get_current_head.return_value = None

        # _cleanup_duplicate_revisions deletes files from the real versions
        # directory, so it must never run against it from a test.
        with (
            patch.object(main, "_cleanup_duplicate_revisions"),
            patch.object(main, "startup_status", MagicMock()),
            patch(
                "alembic.script.ScriptDirectory.from_config", return_value=script_dir
            ),
            patch("sqlalchemy.create_engine") as create_engine,
            patch("alembic.command.upgrade") as upgrade,
        ):
            main.run_migrations()

        create_engine.assert_not_called()
        upgrade.assert_not_called()


class TestHealthCheckWithoutAClient:
    @staticmethod
    def _startup_status():
        return SimpleNamespace(
            phase="running", errors=[], ready=False, to_dict=lambda: {}
        )

    async def _check(self, database, cache) -> dict:
        with (
            patch.object(main, "startup_status", self._startup_status()),
            patch("app.core.database.database_manager", database),
            patch("app.core.cache.cache_manager", cache),
        ):
            response = await main.health_check()
        assert isinstance(response, JSONResponse)
        return json.loads(response.body)

    async def test_connected_database_without_a_session_factory_is_disconnected(self):
        body = await self._check(
            SimpleNamespace(is_connected=True, session_factory=None),
            SimpleNamespace(is_connected=False, redis=None),
        )

        assert body["checks"]["database"] == "disconnected"
        assert body["status"] == "degraded"

    async def test_connected_cache_without_a_client_is_disconnected(self):
        class _Session:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def execute(self, *args, **kwargs):
                return None

        body = await self._check(
            SimpleNamespace(is_connected=True, session_factory=_Session),
            SimpleNamespace(is_connected=True, redis=None),
        )

        assert body["checks"]["database"] == "connected"
        assert body["checks"]["redis"] == "disconnected"
        assert body["status"] == "degraded"


class TestRateLimitHandlerTypedForAnyException:
    @staticmethod
    def _request():
        return SimpleNamespace(state=SimpleNamespace(), app=SimpleNamespace())

    def test_a_rate_limit_error_still_gets_the_support_code(self):
        limit = SimpleNamespace(error_message=None, limit="5 per 1 minute")

        response = main._rate_limit_handler_with_code(
            self._request(), RateLimitExceeded(limit)
        )

        assert response.status_code == 429
        body = json.loads(response.body)
        assert body["detail"].startswith("Rate limit exceeded")
        assert body["code"] == main.ErrorCode.SYS_RATE_LIMITED.value

    def test_any_other_exception_is_raised_untouched(self):
        problem = ValueError("not a rate limit")

        with pytest.raises(ValueError, match="not a rate limit") as raised:
            main._rate_limit_handler_with_code(self._request(), problem)

        assert raised.value is problem
