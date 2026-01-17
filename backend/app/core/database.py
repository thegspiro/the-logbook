"""
Database Connection Manager

Uses SQLAlchemy async with connection pooling for MySQL.
"""

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
from typing import AsyncGenerator
from loguru import logger

from app.core.config import settings


# Create declarative base for models
Base = declarative_base()


class DatabaseManager:
    """
    Database connection manager with async support
    """
    
    def __init__(self):
        self.engine = None
        self.session_factory = None
    
    async def connect(self):
        """Initialize database connection"""
        try:
            # Create async engine
            self.engine = create_async_engine(
                settings.DATABASE_URL,
                echo=settings.DB_ECHO,
                pool_size=settings.DB_POOL_MAX,
                max_overflow=settings.DB_POOL_MAX * 2,
                pool_pre_ping=True,  # Verify connections before using
                pool_recycle=3600,  # Recycle connections after 1 hour
            )
            
            # Create session factory
            self.session_factory = async_sessionmaker(
                self.engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )
            
            # Test connection
            async with self.engine.begin() as conn:
                from sqlalchemy import text
                await conn.execute(text("SELECT 1"))
            
            logger.info("Database connection established")
            
        except Exception as e:
            logger.error(f"Database connection failed: {e}")
            raise
    
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


# Dependency for FastAPI route handlers
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency for database sessions
    """
    async for session in database_manager.get_session():
        yield session
