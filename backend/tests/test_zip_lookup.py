"""City and state from a ZIP code, out of the GeoNames data bundled with the app.

Unit tests: the lookup reads a committed file, never the network. The data
file itself is checked too, because ``data/`` is gitignored repository-wide
and a copy that never reached git would pass every local run and fail in
production.
"""

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.v1.endpoints.crr import zip_lookup
from app.services.zip_lookup import lookup_zip, normalize_zip

pytestmark = pytest.mark.unit

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
REPO = Path(__file__).resolve().parents[2]


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
        assert all(len(v) == 3 for v in list(places.values())[:100])

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
