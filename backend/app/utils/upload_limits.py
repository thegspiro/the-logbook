"""Bounded reads for request uploads that are parsed in memory."""

from typing import Protocol


class AsyncUpload(Protocol):
    async def read(self, size: int = -1) -> bytes:
        """Read up to ``size`` bytes from the upload."""
        ...


async def read_upload_limited(upload: AsyncUpload, max_bytes: int) -> bytes:
    """Read at most one byte beyond the limit and reject oversized uploads."""
    content = await upload.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError(f"Upload exceeds the {max_bytes}-byte limit")
    return content
