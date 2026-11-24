"""City, state and county for a US ZIP code, from the bundled GeoNames data.

The data ships with the app (app/data/us_zip_codes.json) rather than being
fetched from a lookup service, so it works on an air-gapped install and no ZIP
code a resident gave leaves the server (owner decision, 2026-11-21).
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, NamedTuple, Optional

_DATA = Path(__file__).resolve().parents[1] / "data" / "us_zip_codes.json"
_ZIP = re.compile(r"^\s*(\d{5})(?:-\d{4})?\s*$")


class ZipPlace(NamedTuple):
    zip_code: str
    city: str
    state: str
    county: str


@lru_cache(maxsize=1)
def _places() -> dict[str, list[Any]]:
    # A few MB, read once per process on first use. Each entry is
    # [city, state, county] followed by [latitude, longitude] where GeoNames
    # gives them (scripts/build_us_zip_codes.py).
    with _DATA.open(encoding="utf-8") as handle:
        loaded: dict[str, list[Any]] = json.load(handle)
    return loaded


def normalize_zip(value: str) -> Optional[str]:
    """The five-digit ZIP in "12345" or "12345-6789"; None for anything else."""
    match = _ZIP.match(value or "")
    return match.group(1) if match else None


def lookup_zip(value: str) -> Optional[ZipPlace]:
    zip_code = normalize_zip(value)
    if zip_code is None:
        return None
    found = _places().get(zip_code)
    if not found or len(found) < 3:
        return None
    city, state, county = found[0], found[1], found[2]
    return ZipPlace(zip_code, city, state, county)


def zip_coordinates(value: str) -> Optional[tuple[float, float]]:
    """(latitude, longitude) of a ZIP's centre; None when unknown.

    Kept apart from lookup_zip so the lookup endpoint's response is unchanged.
    """
    zip_code = normalize_zip(value)
    if zip_code is None:
        return None
    found = _places().get(zip_code)
    if not found or len(found) < 5:
        return None
    latitude, longitude = found[3], found[4]
    if not isinstance(latitude, (int, float)) or not isinstance(
        longitude, (int, float)
    ):
        return None
    return float(latitude), float(longitude)
