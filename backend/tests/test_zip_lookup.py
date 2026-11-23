"""City and state from a ZIP code, out of the GeoNames data bundled with the app.

Unit tests: the lookup reads a committed file, never the network. The data
file itself is checked too, because ``data/`` is gitignored repository-wide
and a copy that never reached git would pass every local run and fail in
production.
"""

import importlib.util
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.crr import zip_lookup
from app.services import zip_lookup as zip_lookup_module
from app.services.zip_lookup import lookup_zip, normalize_zip, zip_coordinates

pytestmark = pytest.mark.unit

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
REPO = Path(__file__).resolve().parents[2]
BUILDER = Path(__file__).resolve().parents[1] / "scripts" / "build_us_zip_codes.py"


def _builder():
    spec = importlib.util.spec_from_file_location("_build_us_zip_codes", BUILDER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestNormalize:
    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ("22046", "22046"),
            (" 22046 ", "22046"),
            ("22046-1234", "22046"),
            ("2204", None),
            ("220461", None),
            ("ABCDE", None),
            ("", None),
        ],
    )
    def test_only_a_five_digit_zip_or_zip_plus_four(self, raw, expected):
        assert normalize_zip(raw) == expected


class TestLookup:
    def test_a_known_zip_gives_its_city_state_and_county(self):
        place = lookup_zip("90210")
        assert place is not None
        assert (place.city, place.state, place.county) == (
            "Beverly Hills",
            "CA",
            "Los Angeles",
        )

    def test_zip_plus_four_finds_the_same_place(self):
        assert lookup_zip("90210-3456") == lookup_zip("90210")

    def test_an_unknown_zip_finds_nothing(self):
        assert lookup_zip("00000") is None


class TestCoordinates:
    def test_a_known_zip_has_its_centre(self):
        assert zip_coordinates("22046-1234") == (38.8856, -77.1802)

    def test_an_unknown_or_malformed_zip_has_none(self):
        assert zip_coordinates("00000") is None
        assert zip_coordinates("2204") is None

    def test_an_entry_without_coordinates_still_looks_up(self, monkeypatch):
        # The shape written before coordinates were added: the lookup must
        # keep answering, and the coordinates must say "unknown", not crash.
        monkeypatch.setattr(
            zip_lookup_module,
            "_places",
            lambda: {"12345": ["Schenectady", "NY", "Schenectady"]},
        )
        assert lookup_zip("12345").city == "Schenectady"
        assert zip_coordinates("12345") is None


class TestBuilder:
    _ROW = "US\t22046\tFalls Church\tVirginia\tVA\tFalls Church (city)\t610\t\t\t{lat}\t{lng}\t4"

    def test_coordinates_are_kept_and_rounded(self):
        places = _builder().parse(self._ROW.format(lat="38.885612", lng="-77.180239"))
        assert places["22046"] == [
            "Falls Church",
            "VA",
            "Falls Church (city)",
            38.8856,
            -77.1802,
        ]

    @pytest.mark.parametrize(("lat", "lng"), [("", ""), ("abc", "1"), ("95", "1")])
    def test_missing_or_impossible_coordinates_are_left_off(self, lat, lng):
        places = _builder().parse(self._ROW.format(lat=lat, lng=lng))
        assert places["22046"] == ["Falls Church", "VA", "Falls Church (city)"]

    async def test_the_endpoint_refuses_a_malformed_zip(self):
        with pytest.raises(HTTPException) as caught:
            await zip_lookup(zip_code="9021", current_user=None)
        assert caught.value.status_code == 400

    async def test_the_endpoint_answers_not_found_for_an_unknown_zip(self):
        with pytest.raises(HTTPException) as caught:
            await zip_lookup(zip_code="00000", current_user=None)
        assert caught.value.status_code == 404

    async def test_the_endpoint_returns_the_place(self):
        found = await zip_lookup(zip_code="02134", current_user=None)
        assert (found.zip_code, found.city, found.state) == ("02134", "Allston", "MA")


class TestBundledData:
    def test_the_data_covers_the_country(self):
        places = json.loads((DATA / "us_zip_codes.json").read_text(encoding="utf-8"))
        assert len(places) > 40000
        # [city, state, county, latitude, longitude] for every ZIP: the map on
        # Outreach Impact places activities by these coordinates.
        assert all(
            len(v) == 5
            and all(isinstance(x, str) for x in v[:3])
            and all(isinstance(x, float) for x in v[3:])
            for v in places.values()
        )

    def test_the_licence_terms_ship_beside_the_data(self):
        text = " ".join(
            (DATA / "us_zip_codes.LICENSE.txt").read_text(encoding="utf-8").split()
        )
        assert "Creative Commons Attribution 4.0" in text
        assert "www.geonames.org" in text

    def test_the_footer_credits_geonames(self):
        # CC BY 4.0 asks for credit with a link (owner: in the footer).
        layout = (
            REPO / "frontend" / "src" / "components" / "layout" / "AppLayout.tsx"
        ).read_text(encoding="utf-8")
        assert "https://www.geonames.org" in layout
