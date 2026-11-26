"""Decode one HEIC photo into a JPEG, in a process of its own.

Run by ``app/utils/heic_to_jpeg.py`` as ``python -I heic_decode_worker.py
<max_pixels> <max_bytes> <max_address_space>``, with the photo on stdin. The
JPEG is written to stdout; the exit status says what happened.

libheif and libde265 are native code parsing a member's bytes, and a crafted
file has been shown to crash them (a segfault in ``open_heif``). A crash here
ends this process, never the server's. So this file imports nothing from
``app`` (the -I flag also keeps the application's directory and environment
off its path), and it makes itself the process the kernel kills first when
memory runs out.

What comes out:

* **Upright.** libheif applies the container's rotation and mirroring
  (``irot`` / ``imir``) as the HEIF specification requires, and pi-heif then
  removes the EXIF and XMP orientation so nothing applies it twice. The EXIF
  itself is never parsed here: it is discarded, and Pillow's EXIF parser is
  one more thing a crafted file can break.
* **No metadata at all.** An iPhone photo's EXIF and XMP hold where it was
  taken. The JPEG is written from the pixels with only the colour profile,
  without which a Display P3 photo shifts colour.
* **Under the size limit**, by at most one lower-quality attempt: quality 85,
  then 60, then a refusal. ``optimize`` is off; it held the interpreter for
  over a second per attempt on a large photo.
"""

import io
import os
import resource
import sys

EXIT_OK = 0
EXIT_UNREADABLE = 2
EXIT_TOO_MANY_PIXELS = 3
EXIT_TOO_LARGE = 4
EXIT_DECODER_MISSING = 5
EXIT_USAGE = 6

QUALITIES = (85, 60)


def _be_the_one_to_go(max_address_space: int) -> None:
    """Leave no core dump, ask the kernel to pick this process first when
    memory runs out, and cap its address space as a backstop.

    A core dump of this process holds the member's photo in plaintext, and
    Docker's own units set ``LimitCORE=infinity``: with the kernel's default
    ``core_pattern`` a crash would leave it in the working directory, and with
    systemd-coredump on the host. Both honour a limit of zero, and lowering a
    limit needs no privilege. (``prctl(PR_SET_DUMPABLE, 0)`` is not used: it
    makes ``/proc/self`` root-owned, which breaks the OOM score write.)

    An unprivileged process may raise its own OOM score; no step needs root,
    and a refusal is ignored: the pixel cap is the control, the rest only
    decides who pays if it is not enough."""
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass
    try:
        with open("/proc/self/oom_score_adj", "w", encoding="ascii") as fh:
            fh.write("1000")
    except OSError:
        pass
    try:
        resource.setrlimit(resource.RLIMIT_AS, (max_address_space, max_address_space))
    except (ValueError, OSError):
        pass


def _convert(content: bytes, max_pixels: int, max_bytes: int) -> tuple[int, bytes]:
    try:
        import pi_heif
    except ImportError:
        return EXIT_DECODER_MISSING, b""

    # One thread: the server runs one conversion at a time per process, and
    # more threads raised neither the peak nor, measurably, the speed.
    pi_heif.options.DECODE_THREADS = 1
    # Only the primary image is wanted; thumbnails and depth maps are more
    # of the file for libheif to parse and more memory.
    pi_heif.options.THUMBNAILS = False
    pi_heif.options.DEPTH_IMAGES = False
    pi_heif.options.AUX_IMAGES = False

    heif = pi_heif.open_heif(io.BytesIO(content), convert_hdr_to_8bit=True)
    del content
    width, height = heif.size
    # The declared size, before a pixel is decoded. libheif refuses to decode
    # an image larger than the size its header declares.
    if width * height > max_pixels:
        return EXIT_TOO_MANY_PIXELS, b""
    icc_profile = heif.info.get("icc_profile")
    picture = heif.to_pillow()
    del heif
    if picture.mode != "RGB":
        picture = picture.convert("RGB")

    for quality in QUALITIES:
        out = io.BytesIO()
        options: dict = {"format": "JPEG", "quality": quality}
        if icc_profile:
            options["icc_profile"] = icc_profile
        # Nothing else is passed: Pillow writes EXIF and XMP to a JPEG only
        # when they are given to save(), so the photo's own are left behind.
        picture.save(out, **options)
        jpeg = out.getvalue()
        if not max_bytes or len(jpeg) <= max_bytes:
            return EXIT_OK, jpeg
    return EXIT_TOO_LARGE, b""


def main(argv: list[str]) -> int:
    try:
        max_pixels, max_bytes, max_address_space = (int(a) for a in argv[1:4])
    except ValueError:
        return EXIT_USAGE
    _be_the_one_to_go(max_address_space)
    content = sys.stdin.buffer.read()
    try:
        status, jpeg = _convert(content, max_pixels, max_bytes)
    except MemoryError:
        return EXIT_TOO_MANY_PIXELS
    except Exception:
        # Whatever the decoder or Pillow raised (ValueError, EOFError, the
        # SyntaxError libheif uses for an unsupported feature): the file
        # could not be read. The detail stays here; it is the member's file.
        return EXIT_UNREADABLE
    if status == EXIT_OK:
        sys.stdout.buffer.write(jpeg)
        sys.stdout.buffer.flush()
    return status


if __name__ == "__main__":
    # os._exit: skip interpreter teardown, which has nothing to save and can
    # only add another place for a damaged native library to fail.
    code = main(sys.argv)
    sys.stdout.flush()
    os._exit(code)
