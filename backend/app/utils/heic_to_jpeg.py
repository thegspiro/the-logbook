"""Turn a phone's HEIC photo into a JPEG with nothing of its metadata.

Owner decision of 2026-11-26: a HEIC photo filed with a waiver request is
stored as a JPEG, so the request page can show it and any browser can open
it. Decoding is done by pi-heif, the decode-only build of pillow-heif whose
wheels bundle libheif and libde265 under the LGPLv3. pillow-heif itself was
ruled out: its binary wheels include the x265 encoder and are GPLv2 as a
whole, which this MIT project cannot ship in its images.

**The decoder runs in a child process, never in the server's.** libheif is
native code parsing a member's bytes, and a one-byte change to a valid photo
was found to segfault ``pi_heif.open_heif``. In-process, that killed the
uvicorn worker, and with it every request it was serving; a thread gives no
protection. ``heic_decode_worker.py`` runs under ``python -I`` with a minimal
environment and no application code. Whatever happens to it (a crash, an
exception, running out of memory, running too long) the member gets a 400
and the server carries on.

* **A pixel cap of its own**, checked on the declared size before decoding.
  ``Image.MAX_IMAGE_PIXELS`` (about 89 MP, and doubled by the logo validator
  in the same process) let a 20 KB solid-colour photo take over 1.3 GB. The
  child's peak was measured at about 193 MB for an iPhone's default 24 MP
  photo and 360 MB at 48 MP; the backend container is limited to 768 MB
  (384 MB in the minimal compose file), and the child counts against the same
  limit. So 24 MP is taken and 48 MP is refused.
* **The child is the one to go.** It raises its own OOM score, so if memory
  runs out the kernel kills the conversion rather than the server, and caps
  its address space as a backstop.
* **One conversion at a time** per server process, and a wall-clock limit.

Missing dependency: this module refuses to import without pi-heif, so the
backend does not start without it (``docs/UPGRADING.md``). The dependency is
required; there is no fallback that stores a HEIC as filed.
"""

import asyncio
import importlib.util
import os
import sys
import weakref
from pathlib import Path
from typing import Optional

from loguru import logger

from app.core.error_codes import CodedHTTPException, ErrorCode

if importlib.util.find_spec("pi_heif") is None:
    raise ImportError(
        "pi-heif is required to accept HEIC photos; install backend/requirements.txt"
    )

WORKER = str(Path(__file__).with_name("heic_decode_worker.py"))

#: 25 megapixels: an iPhone's default 24 MP photo (5712 x 4284) fits, a
#: 48 MP one (8064 x 6048) does not. See the module docstring for the
#: measurement behind it.
MAX_PIXELS = 25_000_000
#: The child's address-space backstop: about twice its measured virtual peak
#: (300 MB) at the pixel cap.
MAX_ADDRESS_SPACE = 640 * 1024 * 1024
#: Measured at under a second for 24 MP; generous for a slow NAS CPU.
TIMEOUT_SECONDS = 30.0

# The worker's exit statuses (heic_decode_worker.py).
EXIT_OK = 0
EXIT_UNREADABLE = 2
EXIT_TOO_MANY_PIXELS = 3
EXIT_TOO_LARGE = 4
EXIT_DECODER_MISSING = 5

UNREADABLE = (
    "We couldn't read this photo. Save it as a JPEG and try again "
    "(on an iPhone, choose Most Compatible under Settings, Camera, Formats)."
)
TOO_MANY_PIXELS = (
    "This photo is too large to accept. Save a smaller copy as a JPEG " "and try again."
)

# One semaphore per event loop: an asyncio.Semaphore binds to the loop it
# first waits on, and the test suite runs a loop per test.
_slots: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore]" = (
    weakref.WeakKeyDictionary()
)


def _slot() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    slot = _slots.get(loop)
    if slot is None:
        slot = _slots[loop] = asyncio.Semaphore(1)
    return slot


def _child_environment() -> dict[str, str]:
    """Only what the interpreter needs. The server's environment holds the
    database password and the encryption key; a process parsing hostile
    bytes gets none of it."""
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        # Fewer glibc malloc arenas: less address space for the cap to count.
        "MALLOC_ARENA_MAX": "2",
    }


def _refuse(detail: str, code: ErrorCode = ErrorCode.UPLD_TYPE_NOT_ALLOWED):
    return CodedHTTPException(status_code=400, detail=detail, error_code=code)


async def _run(
    content: bytes, max_bytes: int, max_pixels: int, timeout: float
) -> tuple[Optional[int], bytes]:
    """The worker's exit status (None when it was stopped for time) and its
    output."""
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-I",
        WORKER,
        str(max_pixels),
        str(max_bytes),
        str(MAX_ADDRESS_SPACE),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        # The decoder's messages describe the member's file; not kept.
        stderr=asyncio.subprocess.DEVNULL,
        env=_child_environment(),
    )
    try:
        out, _ = await asyncio.wait_for(process.communicate(content), timeout)
    except asyncio.TimeoutError:
        process.kill()
        await process.wait()
        return None, b""
    except BaseException:
        # Cancelled (the client went away): do not leave the child running.
        if process.returncode is None:
            process.kill()
            await process.wait()
        raise
    return process.returncode, out


async def heic_to_jpeg(
    content: bytes,
    max_bytes: Optional[int] = None,
    *,
    max_pixels: int = MAX_PIXELS,
    timeout: float = TIMEOUT_SECONDS,
) -> bytes:
    """The photo in *content* as JPEG bytes, or a refusal: 400 when it cannot
    be read, has more than *max_pixels* pixels, or cannot be brought under
    *max_bytes*; 503 when the decoder is missing from the server."""
    async with _slot():
        status, jpeg = await _run(content, max_bytes or 0, max_pixels, timeout)
    if status == EXIT_OK and jpeg.startswith(b"\xff\xd8"):
        return jpeg
    if status == EXIT_TOO_MANY_PIXELS:
        raise _refuse(TOO_MANY_PIXELS)
    if status == EXIT_TOO_LARGE:
        limit_mb = (max_bytes or 0) // (1024 * 1024)
        raise _refuse(
            f"This photo is over {limit_mb}MB once converted to JPEG. "
            "Save a smaller copy and try again.",
            ErrorCode.UPLD_TOO_LARGE,
        )
    if status == EXIT_DECODER_MISSING:
        logger.error("HEIC conversion unavailable: pi-heif is not installed")
        raise CodedHTTPException(
            status_code=503,
            detail="Photo conversion is temporarily unavailable.",
            error_code=ErrorCode.UPLD_VALIDATION_UNAVAILABLE,
        )
    # Unreadable, crashed (a negative status is the signal that ended it),
    # stopped for time, or output that is not a JPEG. Only the status is
    # logged: anything more would describe the member's file.
    logger.warning("HEIC conversion refused: worker status {}", status)
    raise _refuse(UNREADABLE)
