"""The minutes PDF carries the files filed with the minutes.

Owner decision 2026-11-01: images are drawn into the PDF, PDF attachments are
appended after the minutes, and anything else is listed by name. A size and a
page budget keep one PDF build from reading or drawing without bound, and a
file that cannot be read is listed with the reason rather than failing the
whole export.

Pure rendering: plain dicts and bytes in, a PDF out, read back with pypdf.
"""

from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.utils import minutes_pdf_attachments as budget
from app.utils.minutes_pdf import render_minutes_pdf

pytestmark = pytest.mark.unit

META = {"generated_at": "now"}


def _pdf(pages: int, label: str = "Attached page") -> bytes:
    buf = BytesIO()
    page = canvas.Canvas(buf, pagesize=letter)
    for number in range(pages):
        page.drawString(72, 700, f"{label} {number + 1}")
        page.showPage()
    page.save()
    return buf.getvalue()


def _png(width: int = 40, height: int = 30) -> bytes:
    buf = BytesIO()
    Image.new("RGBA", (width, height), (200, 30, 30, 128)).save(buf, "PNG")
    return buf.getvalue()


def _attachment(att_id: str, mime: str, size: int, title: str = "", name: str = ""):
    return {
        "id": att_id,
        "title": title or att_id,
        "category": "report",
        "name": name or f"{att_id}.bin",
        "sha256": "a" * 64,
        "mime_type": mime,
        "file_size": size,
    }


def _render(attachments, contents) -> PdfReader:
    data = {"title": "Monthly meeting", "attachments": attachments}
    out = render_minutes_pdf(data, META, attachment_contents=contents).read()
    assert out.startswith(b"%PDF")
    return PdfReader(BytesIO(out))


def _text(reader: PdfReader) -> str:
    # Whitespace collapsed: a note wraps inside its table cell.
    return " ".join(
        " ".join((page.extract_text() or "").split()) for page in reader.pages
    )


def _minutes_only_pages(attachments) -> int:
    data = {"title": "Monthly meeting", "attachments": attachments}
    return len(PdfReader(render_minutes_pdf(data, META)).pages)


def _image_count(reader: PdfReader) -> int:
    return sum(len(page.images) for page in reader.pages)


class TestEachKindOfFile:
    def test_a_pdf_attachment_is_appended_after_the_minutes(self):
        attached = _pdf(2)
        atts = [_attachment("rep", "application/pdf", len(attached))]

        reader = _render(atts, {"rep": attached})

        assert len(reader.pages) == _minutes_only_pages(atts) + 2
        assert "Attached page 2" in (reader.pages[-1].extract_text() or "")
        assert "Appended" in _text(reader)

    def test_an_image_is_drawn_into_the_pdf(self):
        image = _png()
        atts = [_attachment("img", "image/png", len(image), title="Hydrant photo")]

        reader = _render(atts, {"img": image})

        assert _image_count(reader) == 1
        assert "Hydrant photo" in _text(reader)

    def test_a_word_file_is_listed_by_name_and_not_embedded(self):
        mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        atts = [_attachment("doc", mime, 10, name="bylaws-draft.docx")]

        reader = _render(atts, {"doc": b"PK\x03\x04 not really a docx"})

        text = _text(reader)
        assert "bylaws-draft.docx" in text
        assert "Listed only" in text
        assert len(reader.pages) == _minutes_only_pages(atts)

    def test_without_contents_the_pdf_is_the_minutes_alone(self):
        attached = _pdf(3)
        atts = [_attachment("rep", "application/pdf", len(attached))]

        reader = _render(atts, {})

        assert len(reader.pages) == _minutes_only_pages(atts)


class TestBadFilesDoNotSpoilTheExport:
    def test_a_password_protected_pdf_is_listed_not_appended(self):
        writer = PdfWriter()
        writer.append(PdfReader(BytesIO(_pdf(1))))
        writer.encrypt(user_password="secret", owner_password="owner")
        buf = BytesIO()
        writer.write(buf)
        locked = buf.getvalue()
        atts = [_attachment("lock", "application/pdf", len(locked))]

        reader = _render(atts, {"lock": locked})

        assert len(reader.pages) == _minutes_only_pages(atts)
        assert "password" in _text(reader).lower()

    def test_a_corrupt_pdf_is_listed_not_appended(self):
        atts = [_attachment("bad", "application/pdf", 20)]

        reader = _render(atts, {"bad": b"%PDF-1.4 this is not a pdf"})

        assert len(reader.pages) == _minutes_only_pages(atts)
        assert "could not be read" in _text(reader)

    def test_a_corrupt_image_is_listed_not_drawn(self):
        atts = [_attachment("bad", "image/png", 20)]

        reader = _render(atts, {"bad": b"\x89PNG\r\n\x1a\n broken"})

        assert _image_count(reader) == 0
        assert "could not be read" in _text(reader)


class TestBudgets:
    def test_files_past_the_byte_budget_are_not_read(self):
        big = budget.MAX_INCLUDED_BYTES - 10
        atts = [
            _attachment("first", "application/pdf", big),
            _attachment("second", "application/pdf", 100),
            _attachment("word", "application/msword", 5),
        ]

        # The second would take the total past the budget; a listed-only type
        # is never read, so it costs nothing.
        assert budget.select_for_pdf(atts) == ["first"]

    def test_a_file_left_out_for_size_says_so(self):
        atts = [_attachment("huge", "application/pdf", budget.MAX_INCLUDED_BYTES + 1)]

        reader = _render(atts, {})

        assert "size limit" in _text(reader)

    def test_appended_pages_stop_at_the_page_budget(self, monkeypatch):
        monkeypatch.setattr(budget, "MAX_APPENDED_PAGES", 3)
        first, second = _pdf(2), _pdf(2, label="Second file")
        atts = [
            _attachment("one", "application/pdf", len(first)),
            _attachment("two", "application/pdf", len(second)),
        ]

        reader = _render(atts, {"one": first, "two": second})

        assert len(reader.pages) == _minutes_only_pages(atts) + 2
        assert "page limit" in _text(reader)

    def test_an_image_over_the_pixel_budget_is_not_drawn(self, monkeypatch):
        monkeypatch.setattr(budget, "MAX_IMAGE_PIXELS", 100)
        image = _png(20, 20)
        atts = [_attachment("img", "image/png", len(image))]

        reader = _render(atts, {"img": image})

        assert _image_count(reader) == 0
        assert "too large" in _text(reader)

    def test_a_large_image_is_scaled_down_before_it_is_drawn(self):
        image = _png(4000, 3000)

        prepared = budget.prepare([_attachment("img", "image/png", 1)], {"img": image})

        drawn = Image.open(BytesIO(prepared["img"].image or b""))
        assert max(drawn.size) <= budget.IMAGE_MAX_EDGE


def test_bare_table_cells_print_as_written_not_as_escape_codes():
    """Attendance, action-item and attachment columns that are bare table
    cells print their text literally, so escaping it there put "&amp;" on
    the adopted record."""
    attachment = _attachment("a1", "application/pdf", 10)
    attachment["category"] = "r&d_report"
    data = {
        "title": "Monthly meeting",
        "attendees": [{"name": "Pat", "status": "chief's_guest"}],
        "action_items": [
            {
                "description": "Order hose",
                "priority": "high & urgent",
                "status": "on_hold_'vendor'",
            }
        ],
        "attachments": [attachment],
    }
    out = render_minutes_pdf(data, META).read()
    text = " ".join(_text(PdfReader(BytesIO(out))).split())
    for literal in ("chief's_guest", "high & urgent", "on hold 'vendor'", "r&d report"):
        assert literal in text
    for code in ("&amp;", "&#x27;"):
        assert code not in text
