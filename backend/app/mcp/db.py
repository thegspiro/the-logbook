"""
Database sessions for tool handlers.

Tools run outside FastAPI's dependency injection — the MCP SDK dispatches
them — so they cannot ``Depends(get_db)``. ``open_session`` wraps the same
session factory the rest of the application uses. It is a module attribute
rather than a direct import so the test-suite can point it at its
rolled-back-per-test session without patching the application's database
manager.
"""

from contextlib import asynccontextmanager
from typing import AsyncIterator, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory

SessionFactory = Callable[[], AsyncSession]

session_factory: SessionFactory = async_session_factory


@asynccontextmanager
async def open_session() -> AsyncIterator[AsyncSession]:
    async with session_factory() as db:
        yield db
