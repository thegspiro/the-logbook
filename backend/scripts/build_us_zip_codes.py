"""Rebuild app/data/us_zip_codes.json from GeoNames' US postal code file.

The lookup that fills in city and state from a ZIP code reads the JSON this
writes. Run it from backend/ to refresh the data, then commit the result:

    python scripts/build_us_zip_codes.py

GeoNames publishes the data under Creative Commons Attribution 4.0, which asks
for credit with a link to www.geonames.org. The app's footer carries it, and
app/data/us_zip_codes.LICENSE.txt records the terms beside the file.

Output shape, one entry per five-digit ZIP, sorted, so a refresh reads as a
small diff: {"02134": ["Allston", "MA", "Suffolk"], ...}
"""

import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

SOURCE_URL = "https://download.geonames.org/export/zip/US.zip"
OUTPUT = Path(__file__).resolve().parents[1] / "app" / "data" / "us_zip_codes.json"

# Columns of the GeoNames postal code dump (its readme.txt): country code,
# postal code, place name, admin name1 (state), admin code1 (state code),
# admin name2 (county), ...
_ZIP, _PLACE, _STATE_CODE, _COUNTY = 1, 2, 4, 5


def parse(text: str) -> dict[str, list[str]]:
    places: dict[str, list[str]] = {}
    for line in text.splitlines():
        fields = line.split("\t")
        if len(fields) <= _COUNTY:
            continue
        zip_code = fields[_ZIP].strip()
        if len(zip_code) != 5 or not zip_code.isdigit():
            continue
        # GeoNames lists each ZIP once; keep the first if that ever changes.
        places.setdefault(
            zip_code,
            [
                fields[_PLACE].strip(),
                fields[_STATE_CODE].strip(),
                fields[_COUNTY].strip(),
            ],
        )
    return dict(sorted(places.items()))


def main() -> int:
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    text = archive.read("US.txt").decode("utf-8")
    places = parse(text)
    if len(places) < 30000:
        print(f"Only {len(places)} ZIP codes parsed; refusing to overwrite.")
        return 1
    OUTPUT.write_text(
        json.dumps(places, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(places)} ZIP codes to {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
