"""
Read a large result set in batches through a server-side cursor.

For exports whose size is the department's whole history: ``db.execute`` then
``.all()`` holds every row in memory at once, where this holds one batch.

The connection is busy for as long as the cursor is open, so a caller must not
issue another query on the same session between batches -- resolve anything
else the rows need (a timezone, a lookup map) before starting to read.
"""

from typing import Any, AsyncIterator, Optional, Sequence

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

EXPORT_BATCH_SIZE = 500


async def iter_row_batches(
    db: AsyncSession,
    query: Select,
    batch_size: Optional[int] = None,
    *,
    scalars: bool = False,
) -> AsyncIterator[Sequence[Any]]:
    """Yield the query's rows ``batch_size`` (default ``EXPORT_BATCH_SIZE``)
    at a time.

    ``scalars=True`` yields the first column of each row -- the ORM objects of
    a ``select(Model)`` -- instead of ``Row`` tuples.
    """
    size = batch_size or EXPORT_BATCH_SIZE
    result = await db.stream(query.execution_options(yield_per=size))
    source = result.scalars() if scalars else result
    async for batch in source.partitions(size):
        yield batch
