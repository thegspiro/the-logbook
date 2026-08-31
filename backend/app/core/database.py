"""
Database Connection Manager

Uses SQLAlchemy async with connection pooling for MySQL.
Includes retry logic and connection timeouts for robust startup.
"""

import asyncio
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from urllib.parse import quote

from loguru import logger
from sqlalchemy import DateTime, MetaData, event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm.attributes import set_committed_value

from app.core.config import settings

# Naming convention for constraints - ensures consistent names for Alembic migrations
# This is critical for MySQL which requires explicit constraint names for ALTER operations
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Declarative base with naming conventions for all ORM models."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@event.listens_for(Base, "load", propagate=True)
def _on_load_stamp_utc(target, _context):
    """After loading any ORM model, tag naive datetime attributes as UTC.

    MySQL DATETIME columns do not store timezone info, so aiomysql returns
    naive datetime objects even when SQLAlchemy ``DateTime(timezone=True)``
    is used.  Without tzinfo Pydantic serialises the value without a ``Z``
    or ``+00:00`` suffix, causing JavaScript ``new Date()`` to treat it as
    browser-local time instead of UTC.
    """
    mapper = type(target).__mapper__
    for col in mapper.columns:
        if isinstance(col.type, DateTime) and col.type.timezone:
            attr = col.key
            val = getattr(target, attr, None)
            if isinstance(val, datetime) and val.tzinfo is None:
                set_committed_value(target, attr, val.replace(tzinfo=timezone.utc))


class DatabaseManager:
    """
    Database connection manager with async support
    """

    def __init__(self):
        self.engine = None
        self.session_factory = None

    @property
    def is_connected(self) -> bool:
        """Check if database is connected"""
        return self.engine is not None and self.session_factory is not None

    async def connect(self):
        """
        Initialize database connection with retry logic.

        Uses exponential backoff for retries to handle MySQL startup delays.
        """
        last_exception = None
        last_exception_type: str | None = None
        last_scrubbed_detail: str | None = None
        retry_delay = settings.DB_CONNECT_RETRY_DELAY

        for attempt in range(1, settings.DB_CONNECT_RETRIES + 1):
            try:
                logger.info(
                    f"Database connection attempt {attempt}/{settings.DB_CONNECT_RETRIES}..."
                )

                # Create async engine with connection timeout and optional SSL
                self.engine = create_async_engine(
                    settings.DATABASE_URL,
                    echo=settings.DB_ECHO,
                    pool_size=settings.DB_POOL_MAX,
                    max_overflow=settings.DB_POOL_MAX * 2,
                    pool_pre_ping=True,  # Verify connections before using
                    pool_recycle=3600,  # Recycle connections after 1 hour
                    connect_args=settings.get_db_connect_args(),
                )

                # Create session factory
                self.session_factory = async_sessionmaker(
                    self.engine,
                    class_=AsyncSession,
                    expire_on_commit=False,
                )

                # Test connection with timeout
                async with asyncio.timeout(settings.DB_CONNECT_TIMEOUT):
                    async with self.engine.begin() as conn:
                        from sqlalchemy import text

                        await conn.execute(text("SELECT 1"))

                logger.info("Database connection established")
                return  # Success - exit the retry loop

            except TimeoutError:
                last_exception = TimeoutError(
                    f"Database connection timed out after {settings.DB_CONNECT_TIMEOUT}s"
                )
                last_exception_type = "TimeoutError"
                last_scrubbed_detail = str(last_exception)
                logger.warning(f"Database connection attempt {attempt} timed out")
            except Exception as e:
                last_exception = e
                # Some async-driver exceptions embed the connection DSN (which
                # carries DB_PASSWORD). Log the exception type plus a message
                # scrubbed of the password so credentials never reach the logs
                # — and keep the scrubbed form as the only thing re-raised
                # below, so a total-failure re-raise can't leak it either.
                detail = str(e)
                db_password = getattr(settings, "DB_PASSWORD", "") or ""
                if db_password:
                    # DATABASE_URL percent-encodes the password (see
                    # Settings._db_credentials) so a reserved character in it
                    # (@ : / ? # %) survives a raw-string replace unscrubbed
                    # inside a DSN-embedding exception (Codex, PR #1917).
                    # Scrub both forms.
                    detail = detail.replace(db_password, "***")
                    detail = detail.replace(quote(db_password, safe=""), "***")
                last_exception_type = type(e).__name__
                last_scrubbed_detail = detail
                logger.warning(
                    f"Database connection attempt {attempt} failed: "
                    f"{type(e).__name__}: {detail}"
                )

            # Clean up failed engine
            if self.engine:
                try:
                    await self.engine.dispose()
                except Exception:
                    pass
                self.engine = None
                self.session_factory = None

            # Wait before retrying (exponential backoff with max cap)
            if attempt < settings.DB_CONNECT_RETRIES:
                logger.info(f"Retrying in {retry_delay}s...")
                await asyncio.sleep(retry_delay)
                retry_delay = min(
                    retry_delay * 2, settings.DB_CONNECT_RETRY_MAX_DELAY
                )  # Exponential backoff with cap

        # All retries exhausted
        logger.error(
            f"Database connection failed after {settings.DB_CONNECT_RETRIES} attempts"
        )
        # Re-raise the scrubbed detail rather than the original exception
        # object — the raw exception can embed the DSN (DB_PASSWORD), and
        # re-raising it here (the only path with no surrounding try/except at
        # the call site) would otherwise let it reach Uvicorn's startup
        # output and Sentry uncredentialed-log-scrub notwithstanding. `from
        # None` suppresses chaining, so the raw exception is never attached
        # as this one's __cause__/__context__ either.
        if last_exception is not None:
            raise ConnectionError(
                f"Database connection failed after {settings.DB_CONNECT_RETRIES} "
                f"attempts: {last_exception_type}: {last_scrubbed_detail}"
            ) from None
        raise ConnectionError("Failed to connect to database")

    async def disconnect(self):
        """Close database connection"""
        if self.engine:
            try:
                await self.engine.dispose()
            except Exception:
                # Reset state even when dispose() itself fails (Codex, PR
                # #2106) — otherwise self.engine/session_factory stay set to
                # the now-unusable engine and is_connected keeps reporting
                # True for a connection that is actually gone.
                logger.exception("Error disposing database engine")
                raise
            finally:
                self.engine = None
                self.session_factory = None
            logger.info("Database connection closed")

    async def get_session(self) -> AsyncGenerator[AsyncSession]:
        """
        Get database session (dependency injection)

        Usage:
            @app.get("/users")
            async def get_users(db: AsyncSession = Depends(get_db)):
                ...
        """
        if not self.session_factory:
            raise RuntimeError("Database not initialized. Call connect() first.")

        async with self.session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()


# Global database manager instance
database_manager = DatabaseManager()


def async_session_factory() -> AsyncSession:
    """
    Get an async session factory for creating database sessions.

    This function provides access to the session factory for use
    outside of FastAPI dependency injection (e.g., background tasks,
    middleware, startup checks).

    Usage:
        async with async_session_factory() as db:
            result = await db.execute(...)

    Returns:
        AsyncSession context manager

    Raises:
        RuntimeError: If database is not initialized
    """
    if not database_manager.session_factory:
        raise RuntimeError(
            "Database not initialized. Call database_manager.connect() first."
        )
    return database_manager.session_factory()


# Dependency for FastAPI route handlers
async def get_db() -> AsyncGenerator[AsyncSession]:
    """
    FastAPI dependency for database sessions
    """
    async for session in database_manager.get_session():
        yield session
