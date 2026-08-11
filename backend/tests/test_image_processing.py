"""Security regression tests for the shared image optimizer."""

from io import BytesIO

import pytest
from PIL import Image, UnidentifiedImageError

from app.utils.image_processing import MAX_INPUT_PIXELS, optimize_image


def test_optimizer_reencodes_and_bounds_dimensions():
    source = BytesIO()
    Image.new("RGB", (100, 50), color="red").save(source, format="PNG")

    result = optimize_image(source.getvalue(), max_size=(20, 20))

    output = Image.open(BytesIO(result))
    assert output.format == "WEBP"
    assert output.size == (20, 10)


def test_optimizer_rejects_invalid_image_instead_of_returning_original():
    malicious = b"\x89PNG\r\n\x1a\nnot-an-image"

    with pytest.raises(UnidentifiedImageError):
        optimize_image(malicious)


def test_optimizer_rejects_images_over_pixel_budget(monkeypatch):
    source = BytesIO()
    Image.new("RGB", (10, 10)).save(source, format="PNG")
    monkeypatch.setattr("app.utils.image_processing.MAX_INPUT_PIXELS", 99)

    with pytest.raises(Image.DecompressionBombError):
        optimize_image(source.getvalue())

    assert MAX_INPUT_PIXELS > 99
