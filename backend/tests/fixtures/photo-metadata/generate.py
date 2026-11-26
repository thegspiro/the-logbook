"""Write the photo-metadata fixtures. Run once; the output is committed.

    cd backend && python tests/fixtures/photo-metadata/generate.py

Uses Pillow (a dependency already) and the standard library only. Each
fixture is a small real image carrying every kind of metadata the waiver
upload must remove, with marker strings that ``test_photo_metadata.py``
searches the stripped output for. Pillow writes the image; the metadata
segments and chunks are spliced in here byte by byte, because Pillow cannot
write an EXIF thumbnail, IPTC, MPF or a trailer.
"""

import io
import struct
import zlib
from pathlib import Path

from PIL import Image, ImageCms

HERE = Path(__file__).parent

# 38 deg 53' 21.17" N, 77 deg 10' 43.91" W: the rationals are distinctive
# enough to search the raw bytes for.
LATITUDE = [(38, 1), (53, 1), (2117, 100)]
LONGITUDE = [(77, 1), (10, 1), (4391, 100)]
XMP = (
    b'<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF '
    b'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" '
    b'exif:GPSLatitude="38,53.3528N" exif:GPSLongitude="77,10.7318W"/>'
    b'</rdf:RDF></x:xmpmeta><?xpacket end="w"?>'
)

BYTE, ASCII, SHORT, LONG, RATIONAL = 1, 2, 3, 4, 5
_SIZES = {BYTE: 1, ASCII: 1, SHORT: 2, LONG: 4, RATIONAL: 8}


def _picture(mode: str, size: tuple[int, int]) -> Image.Image:
    """A gradient, so a decoder has real pixels to agree on."""
    width, height = size
    image = Image.new("RGB", size)
    image.putdata(
        [
            ((x * 255) // width, (y * 255) // height, ((x + y) * 7) % 256)
            for y in range(height)
            for x in range(width)
        ]
    )
    return image.convert(mode)


def _jpeg(image: Image.Image, **options) -> bytes:
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=90, **options)
    return out.getvalue()


def tiff(endian: str, ifds: list, blobs: dict) -> bytes:
    """A TIFF block. *ifds* is a list of entry lists ``(tag, type, values)``
    where values may be ``("ifd", n)`` or ``("blob", key)`` (a LONG
    offset) or ``("len", key)``; IFD n's next pointer is IFD n+1 when
    ``ifds[n]`` is chained (only IFD0 -> IFD1 here, by index 0 -> 2)."""
    order = b"II" if endian == "<" else b"MM"

    def encode(kind, values):
        if kind == ASCII:
            return values
        if kind == RATIONAL:
            return b"".join(struct.pack(endian + "II", *v) for v in values)
        fmt = {BYTE: "B", SHORT: "H", LONG: "I"}[kind]
        return b"".join(struct.pack(endian + fmt, v) for v in values)

    # Pass one: positions. Every pointer is a LONG, so sizes are known.
    position = 8
    ifd_at, blob_at = [], {}
    for entries in ifds:
        ifd_at.append(position)
        position += 2 + 12 * len(entries) + 4
        for _tag, kind, values in entries:
            size = (
                len(values)
                if kind == ASCII
                else _SIZES[kind] * (1 if isinstance(values, tuple) else len(values))
            )
            if size > 4:
                position += size
    for key, blob in blobs.items():
        blob_at[key] = position
        position += len(blob)

    def resolve(values):
        if isinstance(values, tuple):
            what, key = values
            if what == "ifd":
                return [ifd_at[key]]
            if what == "blob":
                return [blob_at[key]]
            return [len(blobs[key])]
        return values

    out = bytearray(order + struct.pack(endian + "HI", 42, 8))
    for index, entries in enumerate(ifds):
        assert len(out) == ifd_at[index]
        data = bytearray()
        data_at = ifd_at[index] + 2 + 12 * len(entries) + 4
        out += struct.pack(endian + "H", len(entries))
        for tag, kind, values in entries:
            raw = encode(kind, resolve(values))
            count = len(raw) // _SIZES[kind]
            if len(raw) <= 4:
                field = raw.ljust(4, b"\x00")
            else:
                field = struct.pack(endian + "I", data_at + len(data))
                data += raw
            out += struct.pack(endian + "HHI", tag, kind, count) + field
        chained = index == 0 and len(ifds) > 2
        out += struct.pack(endian + "I", ifd_at[2] if chained else 0)
        out += data
    for key, blob in blobs.items():
        assert len(out) == blob_at[key]
        out += blob
    return bytes(out)


def gps_exif(endian: str, thumbnail: bytes | None = None) -> bytes:
    """EXIF with Make, Orientation 6 and a GPS IFD, and an IFD1 thumbnail
    when one is given."""
    ifd0 = [
        (0x010F, ASCII, b"TestCam\x00"),
        (0x0112, SHORT, [6]),
        (0x8825, LONG, ("ifd", 1)),
    ]
    gps = [
        (0x0000, BYTE, [2, 3, 0, 0]),
        (0x0001, ASCII, b"N\x00"),
        (0x0002, RATIONAL, LATITUDE),
        (0x0003, ASCII, b"W\x00"),
        (0x0004, RATIONAL, LONGITUDE),
    ]
    ifds, blobs = [ifd0, gps], {}
    if thumbnail is not None:
        ifds.append(
            [
                (0x0103, SHORT, [6]),
                (0x0201, LONG, ("blob", "thumb")),
                (0x0202, LONG, ("len", "thumb")),
            ]
        )
        blobs["thumb"] = thumbnail
    return tiff(endian, ifds, blobs)


def segment(marker: int, payload: bytes) -> bytes:
    return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload


def split_header(jpeg: bytes) -> tuple[list[tuple[int, bytes]], bytes]:
    """The segments before the first SOS, and the rest from SOS on."""
    pos, segments = 2, []
    while jpeg[pos + 1] != 0xDA:
        marker = jpeg[pos + 1]
        (length,) = struct.unpack_from(">H", jpeg, pos + 2)
        segments.append((marker, jpeg[pos + 4 : pos + 2 + length]))
        pos += 2 + length
    return segments, jpeg[pos:]


def join(segments: list[tuple[int, bytes]], rest: bytes) -> bytes:
    return b"\xff\xd8" + b"".join(segment(m, p) for m, p in segments) + rest


def icc() -> bytes:
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def everything_jpeg() -> bytes:
    thumbnail = _jpeg(_picture("RGB", (8, 8)).transpose(Image.FLIP_LEFT_RIGHT))
    segments, rest = split_header(_jpeg(_picture("RGB", (48, 32)), icc_profile=icc()))
    jfif = segments[0]
    assert jfif[0] == 0xE0
    assert jfif[1].startswith(b"JFIF\x00")
    # A JFIF APP0 carrying a 2x2 uncompressed RGB thumbnail.
    jfif = (0xE0, jfif[1][:12] + b"\x02\x02" + bytes(range(100, 112)))
    iptc_city = b"\x1c\x02\x5a" + struct.pack(">H", 11) + b"Springfield"
    photoshop = (
        b"Photoshop 3.0\x00"
        + b"8BIM\x04\x04\x00\x00"
        + struct.pack(">I", len(iptc_city))
        + iptc_city
        + b"\x00"
    )
    extended = b"GPSAltitude=120.5 EXTENDED-XMP-MARKER"
    inserted = [
        jfif,
        (0xE0, b"JFXX\x00\x10" + thumbnail),
        (0xE1, b"Exif\x00\x00" + gps_exif("<", thumbnail)),
        (0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP),
        (
            0xE1,
            b"http://ns.adobe.com/xmp/extension/\x00"
            + b"0123456789ABCDEF0123456789ABCDEF"
            + struct.pack(">II", len(extended), 0)
            + extended,
        ),
        (0xE2, mpf(0, 0, 0)),
        (0xE2, b"FPXR\x00\x00FLASHPIX-MARKER"),
        (0xED, photoshop),
        (0xE6, b"GoPro\x00GOPRO-MARKER"),
        (0xEC, b"Ducky\x00\x01\x00\x04DUCKY-MARKER"),
        (0xEE, b"NotAdobe APP14-MARKER"),
        (0xEF, b"APP15-MARKER"),
        (0xFE, b"COMMENT-MARKER from the camera"),
    ]
    second = _jpeg(_picture("RGB", (8, 8)))
    body = join(inserted + segments[1:], rest)
    # The MPF's offsets count from its own TIFF header; its size is fixed,
    # so the placeholder above is replaced in place.
    base = body.index(b"MPF\x00") + 4
    real = mpf(len(body), len(second), len(body) - base)
    body = body.replace(mpf(0, 0, 0), real)
    return body + second + b"MotionPhoto_Data TRAILER-MARKER"


def mpf(primary_size: int, second_size: int, second_offset: int) -> bytes:
    """An APP2 MPF payload naming the primary image and a second one after
    its EOI, as a phone's depth map or a Motion Photo frame is laid out."""
    entries = struct.pack("<IIIHH", 0x20030000, primary_size, 0, 0, 0) + struct.pack(
        "<IIIHH", 0x00000000, second_size, second_offset, 0, 0
    )
    header = tiff(
        "<",
        [
            [
                (0xB000, BYTE, list(b"0100")),
                (0xB001, LONG, [2]),
                (0xB002, BYTE, list(entries)),
            ]
        ],
        {},
    )
    return b"MPF\x00" + header + b"MPF-MARKER"


def progressive_jpeg() -> bytes:
    jpeg = _jpeg(
        _picture("RGB", (40, 24)),
        progressive=True,
        exif=b"Exif\x00\x00" + gps_exif(">"),
    )
    # A COM and an APP13 between the first scan and what follows it.
    first_sos = jpeg.index(b"\xff\xda")
    pos = first_sos + 2 + struct.unpack_from(">H", jpeg, first_sos + 2)[0]
    while True:
        pos = jpeg.index(b"\xff", pos)
        if jpeg[pos + 1] in (0x00,) or 0xD0 <= jpeg[pos + 1] <= 0xD7:
            pos += 2
            continue
        break
    between = segment(0xFE, b"BETWEEN-SCANS-MARKER") + segment(
        0xED, b"Photoshop 3.0\x00BETWEEN-SCANS-IPTC"
    )
    return jpeg[:pos] + between + jpeg[pos:]


def cmyk_jpeg() -> bytes:
    jpeg = _jpeg(_picture("CMYK", (24, 24)), exif=b"Exif\x00\x00" + gps_exif("<"))
    assert b"Adobe" in jpeg
    return jpeg


def chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def everything_png() -> bytes:
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("Comment", "TEXT-MARKER")
    info.add_text("Description", "ZTXT-MARKER " * 20, zip=True)
    info.add_itxt("XML:com.adobe.xmp", XMP.decode())
    out = io.BytesIO()
    _picture("RGB", (24, 16)).save(
        out, format="PNG", pnginfo=info, icc_profile=icc(), exif=gps_exif("<")
    )
    png = out.getvalue()
    for kind in (b"eXIf", b"iCCP", b"iTXt", b"zTXt"):
        assert kind in png
    ihdr_end = 8 + 12 + 13
    time = chunk(b"tIME", struct.pack(">HBBBBB", 2026, 11, 26, 9, 30, 0))
    private = chunk(b"prVt", b"PRIVATE-MARKER")
    return png[:ihdr_end] + time + private + png[ihdr_end:] + b"TRAILER-AFTER-IEND"


def restart_jpeg() -> bytes:
    """A restart interval of one MCU, so the scan carries RSTn markers."""
    return _jpeg(
        _picture("RGB", (64, 48)),
        restart_marker_blocks=1,
        exif=b"Exif\x00\x00" + gps_exif(">"),
    )


def palette_png() -> bytes:
    """A palette PNG with transparency and every colour chunk the strip
    keeps, plus GPS in eXIf. Pillow writes PLTE, tRNS and pHYs; sRGB, gAMA
    and cHRM are spliced in before PLTE, where the specification puts them."""
    image = _picture("RGB", (20, 12)).quantize(colors=16)
    out = io.BytesIO()
    image.save(out, format="PNG", transparency=3, dpi=(144, 144), exif=gps_exif("<"))
    png = out.getvalue()
    for kind in (b"PLTE", b"tRNS", b"pHYs", b"eXIf"):
        assert kind in png
    ihdr_end = 8 + 12 + 13
    colour = (
        chunk(b"sRGB", b"\x00")
        + chunk(b"gAMA", struct.pack(">I", 45455))
        + chunk(
            b"cHRM",
            struct.pack(">8I", 31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000),
        )
    )
    return png[:ihdr_end] + colour + png[ihdr_end:]


def animated_png() -> bytes:
    """A two-frame APNG (acTL, fcTL, fdAT) with a cICP chunk and GPS in
    eXIf."""
    first = _picture("RGB", (16, 16))
    second = first.transpose(Image.FLIP_LEFT_RIGHT)
    out = io.BytesIO()
    first.save(
        out,
        format="PNG",
        save_all=True,
        append_images=[second],
        duration=100,
        exif=gps_exif("<"),
    )
    png = out.getvalue()
    for kind in (b"acTL", b"fcTL", b"fdAT", b"eXIf"):
        assert kind in png
    ihdr_end = 8 + 12 + 13
    # BT.709 primaries, sRGB transfer, RGB, full range.
    return png[:ihdr_end] + chunk(b"cICP", b"\x01\x0d\x00\x01") + png[ihdr_end:]


def main() -> None:
    for name, content in [
        ("everything.jpg", everything_jpeg()),
        ("progressive.jpg", progressive_jpeg()),
        ("cmyk-adobe.jpg", cmyk_jpeg()),
        ("everything.png", everything_png()),
        ("restart.jpg", restart_jpeg()),
        ("palette.png", palette_png()),
        ("animated.png", animated_png()),
    ]:
        (HERE / name).write_bytes(content)
        Image.open(io.BytesIO(content)).load()
        print(name, len(content))


if __name__ == "__main__":
    main()
