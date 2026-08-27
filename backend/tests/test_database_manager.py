"""
DatabaseManager (app/core/database.py) — connection retry and lifecycle.

CI2-33-3: connect()'s retry loop scrubbed DB_PASSWORD out of each attempt's
*logged* warning, but re-raised the raw, unscrubbed exception on total
failure. database_manager.connect() is called with no surrounding
try/except at its one call site (main.py's lifespan), so that raw exception
— which some async-driver exceptions embed the DSN (and therefore
DB_PASSWORD) inside — could reach Uvicorn's startup output and Sentry.

CI2-33-11: disconnect() disposed the engine but left self.engine/
self.session_factory pointing at it, so is_connected stayed True after a
clean disconnect — a latent trap for any future reconnect-on-demand logic.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.config import settings
from app.core.database import DatabaseManager

pytestmark = [pytest.mark.unit]


class TestConnectScrubsThePasswordOnTotalFailure:
    async def test_the_raised_exception_never_contains_the_raw_password(
        self, monkeypatch
    ):
        manager = DatabaseManager()
        monkeypatch.setattr(settings, "DB_CONNECT_RETRIES", 2)
        monkeypatch.setattr(settings, "DB_CONNECT_RETRY_DELAY", 0)
        monkeypatch.setattr(settings, "DB_CONNECT_RETRY_MAX_DELAY", 0)
        monkeypatch.setattr(settings, "DB_PASSWORD", "s3cr3t-password")

        def fail(*args, **kwargs):
            raise RuntimeError(
                "Can't connect: mysql+aiomysql://user:s3cr3t-password@host/db"
            )

        with patch("app.core.database.create_async_engine", side_effect=fail):
            with pytest.raises(ConnectionError) as exc_info:
                await manager.connect()

        assert "s3cr3t-password" not in str(exc_info.value)
        assert "***" in str(exc_info.value)

    async def test_the_scrubbed_exception_carries_no_cause_chain_either(
        self, monkeypatch
    ):
        """`from None` must suppress chaining — otherwise the raw exception
        (still holding the password) reaches loggers/Sentry via
        __cause__/__context__ even though the message itself is clean."""
        manager = DatabaseManager()
        monkeypatch.setattr(settings, "DB_CONNECT_RETRIES", 1)
        monkeypatch.setattr(settings, "DB_PASSWORD", "s3cr3t-password")

        def fail(*args, **kwargs):
            raise RuntimeError(
                "Can't connect: mysql+aiomysql://user:s3cr3t-password@host/db"
            )

        with patch("app.core.database.create_async_engine", side_effect=fail):
            with pytest.raises(ConnectionError) as exc_info:
                await manager.connect()

        assert exc_info.value.__cause__ is None
        assert "s3cr3t-password" not in str(exc_info.value.__context__ or "")

    async def test_the_percent_encoded_password_is_also_scrubbed(self, monkeypatch):
        """DATABASE_URL percent-encodes the password (see
        Settings._db_credentials), so a password with a reserved URL
        character (@ : / ? # %) appears in its encoded form inside a
        DSN-embedding exception — a raw-string replace misses it entirely
        (Codex, PR #1917)."""
        manager = DatabaseManager()
        monkeypatch.setattr(settings, "DB_CONNECT_RETRIES", 1)
        monkeypatch.setattr(settings, "DB_PASSWORD", "s3cr3t@pass/word")

        def fail(*args, **kwargs):
            raise RuntimeError(
                "Can't connect: mysql+aiomysql://user:s3cr3t%40pass%2Fword@host/db"
            )

        with patch("app.core.database.create_async_engine", side_effect=fail):
            with pytest.raises(ConnectionError) as exc_info:
                await manager.connect()

        assert "s3cr3t@pass/word" not in str(exc_info.value)
        assert "s3cr3t%40pass%2Fword" not in str(exc_info.value)
        assert "***" in str(exc_info.value)


class TestDisconnectResetsConnectionState:
    async def test_is_connected_is_false_after_disconnect(self):
        manager = DatabaseManager()
        manager.engine = MagicMock()
        manager.engine.dispose = AsyncMock()
        manager.session_factory = MagicMock()

        await manager.disconnect()

        assert manager.is_connected is False
        assert manager.engine is None
        assert manager.session_factory is None

    async def test_disconnect_on_an_already_disconnected_manager_is_a_noop(self):
        manager = DatabaseManager()
        # Should not raise even though nothing was ever connected.
        await manager.disconnect()
        assert manager.is_connected is False
