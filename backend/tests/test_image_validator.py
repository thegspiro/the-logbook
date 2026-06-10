"""
Tests for the secure image upload validator (app/utils/image_validator.py).

The validator is a security boundary for user-supplied logo/avatar uploads:
it enforces magic-byte type detection, blocks dangerous formats, strips
EXIF/metadata, guards against decompression bombs, and bounds file size and
dimensions. These tests exercise each protection directly with images built
in-memory by Pillow so they run offline and deterministically.
"""

import base64
import io

import pytest
from fastapi import HTTPException
from PIL import Image

from app.utils.image_validator import (
    ImageValidationError,
    ImageValidator,
    get_image_validator,
    validate_logo_image,
)


def _png_b64(size=(64, 64), color=(10, 20, 30), data_uri=False):
    """Encode an in-memory PNG as base64 (optionally with a data URI prefix)."""
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode()
    if data_uri:
        return f"data:image/png;base64,{encoded}"
    return encoded


def _encoded_b64(fmt, size=(64, 64), color=(10, 20, 30)):
    """Encode an in-memory image of an arbitrary format as bare base64."""
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode()


@pytest.fixture
def validator():
    return ImageValidator()


class TestHappyPath:
    def test_accepts_valid_png(self, validator):
        out, meta = validator.validate_and_process(_png_b64())
        assert out.startswith("data:image/png;base64,")
        assert meta["format"] == "PNG"
        assert meta["dimensions"] == "64x64"
        assert meta["metadata_stripped"] is True

    def test_accepts_valid_jpeg(self, validator):
        out, meta = validator.validate_and_process(_encoded_b64("JPEG"))
        assert out.startswith("data:image/jpeg;base64,")
        assert meta["format"] == "JPEG"

    def test_accepts_data_uri_prefixed_input(self, validator):
        out, _ = validator.validate_and_process(_png_b64(data_uri=True))
        assert out.startswith("data:image/png;base64,")

    def test_output_is_decodable_and_smaller_metadata(self, validator):
        out, meta = validator.validate_and_process(_png_b64())
        # The reported processed size must match the actual re-encoded payload.
        decoded = base64.b64decode(out.split(",")[1])
        assert meta["processed_size"] == len(decoded)


class TestDecoding:
    def test_rejects_invalid_base64(self, validator):
        with pytest.raises(ImageValidationError, match="Invalid base64"):
            validator.validate_and_process("not-valid-base64!!!")

    def test_rejects_empty_image_bytes(self, validator):
        empty = base64.b64encode(b"").decode()
        with pytest.raises(ImageValidationError, match="empty"):
            validator.validate_and_process(empty)


class TestTypeAndFormatGuards:
    def test_rejects_non_image_payload(self, validator):
        payload = base64.b64encode(b"this is plainly not an image").decode()
        with pytest.raises(ImageValidationError, match="Unsupported image type"):
            validator.validate_and_process(payload)

    def test_rejects_gif_with_clean_message(self, validator):
        """A GIF is rejected at magic-byte detection, not relabeled."""
        with pytest.raises(
            ImageValidationError, match="Unsupported image type: image/gif"
        ):
            validator.validate_and_process(_encoded_b64("GIF"))

    def test_rejects_bmp(self, validator):
        with pytest.raises(ImageValidationError, match="Unsupported image type"):
            validator.validate_and_process(_encoded_b64("BMP"))


class TestSizeAndDimensionGuards:
    def test_rejects_oversized_file(self, validator):
        oversized = base64.b64encode(
            b"\x00" * (ImageValidator.MAX_FILE_SIZE_BYTES + 1)
        ).decode()
        with pytest.raises(ImageValidationError, match="too large"):
            validator.validate_and_process(oversized)

    def test_rejects_dimensions_above_maximum(self, validator):
        # A 4097px-wide strip is over the dimension cap but tiny in bytes.
        over = _png_b64(size=(ImageValidator.MAX_DIMENSION + 1, 16))
        with pytest.raises(ImageValidationError, match="Maximum"):
            validator.validate_and_process(over)

    def test_rejects_dimensions_below_minimum(self, validator):
        under = _png_b64(size=(8, 8))
        with pytest.raises(ImageValidationError, match="too small"):
            validator.validate_and_process(under)

    def test_enforce_square_rejects_non_square(self, validator):
        with pytest.raises(ImageValidationError, match="square"):
            validator.validate_and_process(_png_b64(size=(64, 32)), enforce_square=True)

    def test_enforce_square_accepts_square(self, validator):
        out, _ = validator.validate_and_process(
            _png_b64(size=(64, 64)), enforce_square=True
        )
        assert out.startswith("data:image/png;base64,")


class TestMetadataStripping:
    def test_exif_is_removed_from_output(self, validator):
        buf = io.BytesIO()
        img = Image.new("RGB", (64, 64), (5, 5, 5))
        exif = img.getexif()
        exif[0x0110] = "SecretCameraModel"  # Model tag — privacy-sensitive
        img.save(buf, format="JPEG", exif=exif)
        raw = buf.getvalue()
        assert b"SecretCameraModel" in raw  # sanity: input really has the tag

        out, meta = validator.validate_and_process(base64.b64encode(raw).decode())
        cleaned = base64.b64decode(out.split(",")[1])
        assert b"SecretCameraModel" not in cleaned
        assert meta["metadata_stripped"] is True


class TestDecompressionBomb:
    def test_rejects_decompression_bomb(self, validator, monkeypatch):
        """An image exceeding Pillow's pixel ceiling is rejected on load."""
        # Lower the global ceiling so an ordinary test image trips the guard
        # without allocating a real multi-gigapixel bomb.
        monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 10)
        with pytest.raises(ImageValidationError, match="decompression bomb"):
            validator.validate_and_process(_png_b64(size=(64, 64)))


class TestConvenienceHelpers:
    def test_validate_logo_image_passes_through_none(self):
        assert validate_logo_image(None) is None

    def test_validate_logo_image_passes_through_empty_string(self):
        assert validate_logo_image("") is None

    def test_validate_logo_image_returns_clean_data(self):
        result = validate_logo_image(_png_b64())
        assert result is not None
        assert result.startswith("data:image/png;base64,")

    def test_validate_logo_image_raises_http_400_on_bad_input(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_logo_image(_encoded_b64("GIF"))
        assert exc_info.value.status_code == 400
        assert "Invalid image" in str(exc_info.value.detail)

    def test_get_image_validator_is_singleton(self):
        assert get_image_validator() is get_image_validator()
