"""Tests for bounded in-memory upload reads."""

import pytest

from app.utils.upload_limits import read_upload_limited


class RecordingUpload:
    def __init__(self, content: bytes):
        self.content = content
        self.requested_size: int | None = None

    async def read(self, size: int = -1) -> bytes:
        self.requested_size = size
        return self.content[:size]


async def test_read_upload_limited_reads_only_one_byte_past_limit():
    upload = RecordingUpload(b"123456")
    with pytest.raises(ValueError, match="5-byte limit"):
        await read_upload_limited(upload, 5)
    assert upload.requested_size == 6


async def test_read_upload_limited_returns_content_within_limit():
    upload = RecordingUpload(b"12345")
    assert await read_upload_limited(upload, 5) == b"12345"
