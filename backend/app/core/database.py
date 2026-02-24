"""
Database Connection Manager

Uses SQLAlchemy async with connection pooling for MySQL.
Includes retry logic and connection timeouts for robust startup.
"""

import asyncio
from typing import AsyncGenerator

from loguru import logger
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import declarative_base

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

# Create declarative base with naming conventions
metadata = MetaData(naming_convention=NAMING_CONVENTION)
Base = declarative_base(metadata=metadata)


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
        retry_delay = settings.DB_CONNECT_RETRY_DELAY

        for attempt in range(1, settings.DB_CONNECT_RETRIES + 1):
            try:
                logger.info(
                    f"Database connection attempt {attempt}/{settings.DB_CONNECT_RETRIES}..."
                )

                # Create async engine with connection timeout
                self.engine = create_async_engine(
                    settings.DATABASE_URL,
                    echo=settings.DB_ECHO,
                    pool_size=settings.DB_POOL_MAX,
                    max_overflow=settings.DB_POOL_MAX * 2,
                    pool_pre_ping=True,  # Verify connections before using
                    pool_recycle=3600,  # Recycle connections after 1 hour
                    connect_args={
                        "connect_timeout": settings.DB_CONNECT_TIMEOUT,
                    },
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

            except asyncio.TimeoutError:
                last_exception = TimeoutError(
                    f"Database connection timed out after {settings.DB_CONNECT_TIMEOUT}s"
                )
                logger.warning(f"Database connection attempt {attempt} timed out")
            except Exception as e:
                last_exception = e
                logger.warning(f"Database connection attempt {attempt} failed: {e}")

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
        raise last_exception or ConnectionError("Failed to connect to database")

    async def disconnect(self):
        """Close database connection"""
        if self.engine:
            await self.engine.dispose()
            logger.info("Database connection closed")

    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
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
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency for database sessions
    """
    async for session in database_manager.get_session():
        yield session
