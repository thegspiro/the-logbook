"""Zip entry names for a period's PDFs come from text people typed (a member's
name, a form's title), so none may reach outside the folder the zip unpacks
into, and none may repeat."""

import pytest

from app.services.evaluation_document_service import _bundle_name

pytestmark = [pytest.mark.unit]


@pytest.mark.parametrize(
    ("stem", "expected"),
    [
        ("Pat Member - Annual - 2025-12-31", "Pat Member - Annual - 2025-12-31.pdf"),
        ("../../etc/passwd", "etc_passwd.pdf"),
        ("C:\\Windows\\x", "C_Windows_x.pdf"),
        ("..hidden", "hidden.pdf"),
        ("José Núñez", "José Núñez.pdf"),
        ("///", "evaluation.pdf"),
    ],
)
def test_a_name_holds_no_path(stem, expected):
    name = _bundle_name(stem, set())
    assert name == expected
    assert "/" not in name
    assert "\\" not in name
    assert not name.startswith(".")


def test_a_repeated_name_is_numbered():
    taken: set = set()
    names = [_bundle_name("Pat Member - Annual", taken) for _ in range(3)]
    assert names == [
        "Pat Member - Annual.pdf",
        "Pat Member - Annual (2).pdf",
        "Pat Member - Annual (3).pdf",
    ]


def test_a_long_name_is_cut_short():
    assert len(_bundle_name("x" * 500, set())) == 154
