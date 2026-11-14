"""Record documents are written as PDF/A-2b, and only those that can be.

CI has no veraPDF, so this asserts the structure veraPDF 1.28 checked by
hand on 2026-11-10 (every case below then passed it): the XMP packet that
declares the conformance and agrees with the information dictionary, the
sRGB output intent, embedded fonts, printable annotations, no encryption. A
minutes PDF that appends attachment PDFs from outside must not claim PDF/A.
"""

import re
from io import BytesIO

import pytest
from pypdf import PdfReader

from app.utils.certified_results_pdf import render_certified_results_pdf
from app.utils.evaluation_pdf import render_evaluation_pdf
from app.utils.minutes_pdf import render_minutes_pdf
from app.utils.pdfa import _xmp_date, to_pdfa
from tests.test_certified_results_pdf_layout import _data as certified_data
from tests.test_certified_results_pdf_layout import _logo_uri
from tests.test_evaluation_pdf import RECORD as EVALUATION
from tests.test_minutes_pdf_attachments import _attachment, _pdf, _png
from tests.test_pdf_fonts import _unembedded

pytestmark = pytest.mark.unit

MINUTES = {
    "title": "Monthly meeting",
    "sections": [
        {
            "title": "Notes",
            "content": '<p>See <a href="https://example.org/plan">the plan</a></p>',
            "format": "html",
        }
    ],
    "attendees": [{"name": "Ольга Петрова", "role": "FF", "status": "present"}],
}


def _xmp(reader: PdfReader) -> str:
    stream = reader.trailer["/Root"]["/Metadata"].get_object()
    assert stream["/Type"] == "/Metadata"
    assert stream["/Subtype"] == "/XML"
    # Archival readers must be able to read it without decoding.
    assert "/Filter" not in stream
    return stream.get_data().decode("utf-8")


def _assert_pdfa(pdf: bytes) -> None:
    reader = PdfReader(BytesIO(pdf))
    root = reader.trailer["/Root"]
    assert not reader.is_encrypted
    assert "/ID" in reader.trailer

    xmp = _xmp(reader)
    assert "<pdfaid:part>2</pdfaid:part>" in xmp
    assert "<pdfaid:conformance>B</pdfaid:conformance>" in xmp
    info = reader.metadata
    assert info is not None
    assert f"<pdf:Producer>{info['/Producer']}</pdf:Producer>" in xmp
    assert f"<xmp:CreateDate>{_xmp_date(info['/CreationDate'])}</xmp:CreateDate>" in xmp
    assert f"<xmp:ModifyDate>{_xmp_date(info['/ModDate'])}</xmp:ModifyDate>" in xmp

    intents = root["/OutputIntents"]
    assert len(intents) == 1
    intent = intents[0].get_object()
    assert intent["/S"] == "/GTS_PDFA1"
    profile = intent["/DestOutputProfile"].get_object()
    assert profile["/N"] == 3
    icc = profile.get_data()
    assert icc[36:40] == b"acsp"
    assert icc[16:20] == b"RGB "

    assert _unembedded(pdf) == []
    for page in reader.pages:
        for ref in page.get("/Annots") or []:
            annot = ref.get_object()
            if annot.get("/Subtype") != "/Popup":
                assert int(annot["/F"]) & 4, "annotation is not printable"


def test_certified_results_are_pdfa():
    pdf = render_certified_results_pdf(
        certified_data(),
        {"org_name": "Oakville FD", "generated_at": "today", "logo": _logo_uri()},
    ).getvalue()
    _assert_pdfa(pdf)


def test_a_finalized_evaluation_is_pdfa():
    _assert_pdfa(
        render_evaluation_pdf({**EVALUATION, "member_name": "Nguyễn Thị Hằng"})
    )


def test_minutes_with_a_link_and_an_image_are_pdfa():
    image = _png(80, 60)
    data = {
        **MINUTES,
        "attachments": [_attachment("a1", "image/png", len(image), title="Photo")],
    }
    pdf = render_minutes_pdf(
        data, {"generated_at": "now"}, attachment_contents={"a1": image}
    ).read()
    _assert_pdfa(pdf)
    reader = PdfReader(BytesIO(pdf))
    assert any(page.get("/Annots") for page in reader.pages), "link was not kept"


def test_minutes_that_append_an_outside_pdf_make_no_pdfa_claim():
    attached = _pdf(1)
    data = {
        **MINUTES,
        "attachments": [
            _attachment("a1", "application/pdf", len(attached), title="Budget")
        ],
    }
    pdf = render_minutes_pdf(
        data, {"generated_at": "now"}, attachment_contents={"a1": attached}
    ).read()
    reader = PdfReader(BytesIO(pdf))
    assert len(reader.pages) >= 2
    metadata = reader.trailer["/Root"].get("/Metadata")
    if metadata is not None:
        assert "pdfaid" not in metadata.get_object().get_data().decode("utf-8")


def _plain_pdf(title: str, author: str) -> bytes:
    from reportlab.pdfgen.canvas import Canvas

    from app.utils.pdf_fonts import BODY_FONT

    out = BytesIO()
    canvas = Canvas(out, initialFontName=BODY_FONT)
    canvas.setTitle(title)
    canvas.setAuthor(author)
    canvas.setFont(BODY_FONT, 12)
    canvas.drawString(72, 720, "Record")
    canvas.save()
    return out.getvalue()


def test_metadata_text_is_escaped_and_matches_the_info_dictionary():
    title = 'Q&A <Annual> "Election"'
    author = "Oakville & Co"
    reader = PdfReader(BytesIO(to_pdfa(_plain_pdf(title, author))))
    xmp = _xmp(reader)
    assert "Q&amp;A &lt;Annual&gt;" in xmp
    assert "<rdf:li>Oakville &amp; Co</rdf:li>" in xmp
    found = re.search(r'<rdf:li xml:lang="x-default">(.*?)</rdf:li>', xmp)
    assert found is not None
    unescaped = (
        found.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    )
    assert unescaped == str(reader.metadata["/Title"]) == title
    assert str(reader.metadata["/Author"]) == author


@pytest.mark.parametrize(
    ("pdf_date", "xmp_date"),
    [
        ("D:20261110093005+00'00'", "2026-11-10T09:30:05+00:00"),
        ("D:20261110093005-05'00'", "2026-11-10T09:30:05-05:00"),
        ("D:20261110093005Z", "2026-11-10T09:30:05Z"),
        ("D:20261110", "2026-11-10T00:00:00Z"),
    ],
)
def test_pdf_dates_become_the_same_instant_in_xmp(pdf_date: str, xmp_date: str):
    assert _xmp_date(pdf_date) == xmp_date


def test_an_encrypted_pdf_is_refused():
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(100, 100)
    writer.encrypt("secret")
    out = BytesIO()
    writer.write(out)
    with pytest.raises(ValueError, match="encrypted"):
        to_pdfa(out.getvalue())
