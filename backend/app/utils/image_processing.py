"""Image optimization utilities for uploaded images (#21)."""
from io import BytesIO
from PIL import Image
from loguru import logger


# Maximum dimensions for different image types
IMAGE_SIZE_LIMITS = {
    "avatar": (400, 400),
    "logo": (800, 800),
    "photo": (1920, 1080),
    "thumbnail": (200, 200),
}


def optimize_image(
    file_bytes: bytes,
    max_size: tuple[int, int] = (1920, 1080),
    quality: int = 85,
    output_format: str = "WEBP",
) -> bytes:
    """
    Resize and compress an uploaded image.

    - Strips EXIF metadata (privacy)
    - Converts to WebP for smaller file sizes
    - Resizes to fit within max_size while preserving aspect ratio
    - Falls back to original bytes if processing fails
    """
    try:
        img = Image.open(BytesIO(file_bytes))

        # Convert RGBA to RGB for JPEG/WebP compatibility
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Resize if larger than max dimensions (preserve aspect ratio)
        img.thumbnail(max_size, Image.LANCZOS)

        # Save optimized
        output = BytesIO()
        img.save(output, format=output_format, quality=quality, optimize=True)
        optimized = output.getvalue()

        saved_pct = (1 - len(optimized) / len(file_bytes)) * 100 if file_bytes else 0
        logger.debug(f"Image optimized: {len(file_bytes)} -> {len(optimized)} bytes ({saved_pct:.0f}% reduction)")

        return optimized
    except Exception as e:
        logger.warning(f"Image optimization failed, using original: {e}")
        return file_bytes


def generate_thumbnail(file_bytes: bytes, size: tuple[int, int] = (200, 200)) -> bytes:
    """Generate a small thumbnail from image bytes."""
    return optimize_image(file_bytes, max_size=size, quality=70, output_format="WEBP")
