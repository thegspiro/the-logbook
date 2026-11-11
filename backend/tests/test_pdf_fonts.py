"""Generated documents embed every font they use, and print non-Latin names.

ReportLab falls back to Helvetica — a standard font that is never embedded and
covers Latin-1 only — wherever a style, a table cell or a canvas call does not
name a font. One such fallback anywhere in a document drops the characters it
cannot draw and disqualifies the file from PDF/A. This walks every font
resource of every page of every document generator and fails on any font
without an embedded font program.

Label sheets and ID cards stay on Helvetica by owner decision (2026-11-09) and
are not in the document list.
"""

from io import BytesIO
from typing import Iterator, List, Set, Tuple

import pytest
from pypdf import PdfReader
from pypdf.generic import DictionaryObject

from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.pdf_fonts import BODY_FONT, document_stylesheet
from app.utils.pdf_report_kit import ReportMeta, cell, data_table, render_report
from tests.test_pdf_print_safety import DOCUMENTS

pytestmark = pytest.mark.unit

NAMES = ["Łukasz Wiśniewski", "Nguyễn Thị Hằng", "Ольга Петрова", "Σοφία Παπαδοπούλου"]


def _fonts(resources: DictionaryObject, seen: Set[int]) -> Iterator[DictionaryObject]:
    resources = resources.get_object() if resources is not None else None
    if not resources:
        return
    fonts = resources.get("/Font")
    if fonts:
        for ref in fonts.get_object().values():
            yield ref.get_object()
    xobjects = resources.get("/XObject")
    if xobjects:
        for ref in xobjects.get_object().values():
            xobj = ref.get_object()
            key = id(xobj)
            if key in seen or xobj.get("/Subtype") != "/Form":
                continue
            seen.add(key)
            yield from _fonts(xobj.get("/Resources"), seen)


def _unembedded(pdf: bytes) -> List[Tuple[int, str]]:
    missing = []
    for number, page in enumerate(PdfReader(BytesIO(pdf)).pages, start=1):
        for font in _fonts(page.get("/Resources"), set()):
            descriptor_owner = font
            if font.get("/Subtype") == "/Type0":
                descriptor_owner = font["/DescendantFonts"][0].get_object()
            descriptor = descriptor_owner.get("/FontDescriptor")
            descriptor = descriptor.get_object() if descriptor else {}
            if not any(
                k in descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3")
            ):
                missing.append((number, str(font.get("/BaseFont"))))
    return missing


@pytest.mark.parametrize("name", list(DOCUMENTS))
def test_every_font_in_the_document_is_embedded(name: str):
    pdf = DOCUMENTS[name]()
    assert _unembedded(pdf) == []


def test_the_sample_stylesheet_is_rebased_onto_the_bundled_faces():
    sheet = document_stylesheet()
    assert sheet["Normal"].fontName == BODY_FONT
    for name, style in sheet.byName.items():
        # List styles carry only a bullet font.
        for attr in ("fontName", "bulletFontName"):
            font = getattr(style, attr, None)
            assert font is None or font.startswith("LogbookSans"), (name, attr, font)


def test_non_latin_names_print_in_a_report():
    meta = ReportMeta("Roster", "Oakville FD", "2026-11-10 09:00 EST")

    def body(styles):
        return [data_table(["Member"], [[cell(n)] for n in NAMES], [meta.width])]

    pdf = render_report(meta, body)
    text = " ".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    for name in NAMES:
        assert name in text
    assert _unembedded(pdf) == []


def test_non_latin_names_print_in_minutes():
    data = {
        "title": "Monthly meeting",
        "attendees": [
            {"name": n, "role": "Firefighter", "status": "present"} for n in NAMES
        ],
    }
    pdf = render_minutes_pdf(data, {"generated_at": "now"}).read()
    text = " ".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    for name in NAMES:
        assert name in text
