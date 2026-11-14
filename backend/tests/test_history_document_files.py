"""History document files, without a database: what is accepted, the PDF
copy members open (rebuilt without metadata, scripts, actions or
attachments), embedded JPEGs losing their EXIF, the text read for search, the
first-page preview, and image scans.

Real pypdf and PDFium on PDFs built here, carrying what a phone scanner or a
hostile file would: what is under test is the bytes that come out."""

import io

import pytest
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    StreamObject,
    TextStringObject,
)
from reportlab.pdfgen import canvas

from app.services import history_document_files as files

pytestmark = pytest.mark.unit


def _letter(*pages: str, author: str = "Chief Smith") -> bytes:
    out = io.BytesIO()
    page = canvas.Canvas(out)
    page.setAuthor(author)
    page.setTitle("Private title")
    for text in pages:
        page.drawString(72, 750, text)
        page.showPage()
    page.save()
    return out.getvalue()


def _js(writer: PdfWriter, script: str):
    return writer._add_object(
        DictionaryObject(
            {
                NameObject("/S"): NameObject("/JavaScript"),
                NameObject("/JS"): TextStringObject(script),
            }
        )
    )


def _hostile_pdf() -> bytes:
    """A letter with document and page scripts, an attached file, a file
    attachment annotation, a link annotation and author metadata."""
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_letter("Dear Chief,"))))
    writer._root_object[NameObject("/OpenAction")] = _js(writer, "app.alert('open')")
    page = writer.pages[0]
    page[NameObject("/AA")] = DictionaryObject(
        {NameObject("/O"): _js(writer, "app.alert('page')")}
    )
    writer.add_attachment("secret.txt", b"ATTACHEDSECRET")
    embedded = DecodedStreamObject()
    embedded.set_data(b"ANNOTATIONSECRET")
    embedded[NameObject("/Type")] = NameObject("/EmbeddedFile")
    spec = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Filespec"),
            NameObject("/F"): TextStringObject("a.txt"),
            NameObject("/EF"): DictionaryObject(
                {NameObject("/F"): writer._add_object(embedded)}
            ),
        }
    )
    rect = ArrayObject(
        [NumberObject(0), NumberObject(0), NumberObject(10), NumberObject(10)]
    )
    attachment = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/FileAttachment"),
            NameObject("/Rect"): rect,
            NameObject("/FS"): writer._add_object(spec),
        }
    )
    link = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Link"),
            NameObject("/Rect"): rect,
            NameObject("/A"): DictionaryObject(
                {
                    NameObject("/S"): NameObject("/URI"),
                    NameObject("/URI"): TextStringObject("https://example.org/"),
                }
            ),
        }
    )
    scripted_link = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Annot"),
            NameObject("/Subtype"): NameObject("/Link"),
            NameObject("/Rect"): rect,
            NameObject("/A"): _js(writer, "app.alert('click')"),
        }
    )
    page[NameObject("/Annots")] = ArrayObject(
        [
            writer._add_object(attachment),
            writer._add_object(link),
            writer._add_object(scripted_link),
        ]
    )
    writer.add_metadata({"/Author": "Chief Smith", "/Producer": "PhoneScanner 2.1"})
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def _jpeg_with_gps() -> bytes:
    image = Image.new("RGB", (64, 32), "red")
    exif = image.getexif()
    exif[0x010F] = "ScannerCo"
    exif[0x8825] = {1: "N", 2: (40.0, 1.0, 2.0)}
    out = io.BytesIO()
    image.save(out, "JPEG", exif=exif.tobytes(), comment=b"FILEDBYJANE")
    return out.getvalue()


def _pdf_with_jpeg(jpeg: bytes) -> bytes:
    """A page drawing *jpeg* as a DCT image stream, kept byte for byte as a
    scanning app stores it."""
    writer = PdfWriter()
    page = writer.add_blank_page(200, 200)
    image = StreamObject()
    image._data = jpeg
    image.update(
        {
            NameObject("/Type"): NameObject("/XObject"),
            NameObject("/Subtype"): NameObject("/Image"),
            NameObject("/Width"): NumberObject(64),
            NameObject("/Height"): NumberObject(32),
            NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
            NameObject("/BitsPerComponent"): NumberObject(8),
            NameObject("/Filter"): NameObject("/DCTDecode"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/XObject"): DictionaryObject(
                {NameObject("/Im0"): writer._add_object(image)}
            )
        }
    )
    contents = DecodedStreamObject()
    contents.set_data(b"q 64 0 0 32 10 10 cm /Im0 Do Q")
    page[NameObject("/Contents")] = writer._add_object(contents)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


class TestWhatIsAccepted:
    @pytest.mark.parametrize(
        ("name", "accepted"),
        [
            ("letter.pdf", True),
            ("scan.JPG", True),
            ("scan.jpeg", True),
            ("scan.png", True),
            ("scan.webp", True),
            # Converted to PDF first (owner decision 3).
            ("letter.docx", False),
            ("letter.doc", False),
            # Refused across the platform.
            ("scan.tif", False),
            ("noextension", False),
        ],
    )
    def test_by_name(self, name, accepted):
        assert files.accepts(name) is accepted

    def test_the_limit_is_the_owners(self):
        assert files.DOCUMENT_RULES.max_bytes == 50 * 1024 * 1024
        assert "application/pdf" in files.DOCUMENT_RULES.allowed_types
        assert not any(
            "word" in mime or "office" in mime
            for mime in files.DOCUMENT_RULES.allowed_types
        )


class TestTheMembersCopyOfAPdf:
    def test_scripts_attachments_and_metadata_are_gone(self):
        original = _hostile_pdf()
        reader = PdfReader(io.BytesIO(original))
        assert "/OpenAction" in reader.trailer["/Root"]
        assert list(reader.attachments) == ["secret.txt"]

        copies = files.make_pdf_copies(original)

        cleaned = copies.cleaned
        assert b"JavaScript" not in cleaned
        assert b"ANNOTATIONSECRET" not in cleaned
        assert b"FileAttachment" not in cleaned
        assert b"Chief Smith" not in cleaned
        assert b"PhoneScanner" not in cleaned
        assert b"Private title" not in cleaned
        out = PdfReader(io.BytesIO(cleaned))
        assert list(out.attachments) == []
        assert out.metadata is None
        root = out.trailer["/Root"]
        assert "/OpenAction" not in root
        assert "/Names" not in root
        assert "/AA" not in out.pages[0]

    def test_a_plain_link_survives_and_a_scripted_one_loses_its_script(self):
        copies = files.make_pdf_copies(_hostile_pdf())
        annots = [
            ref.get_object()
            for ref in PdfReader(io.BytesIO(copies.cleaned)).pages[0]["/Annots"]
        ]
        assert [a["/Subtype"] for a in annots] == ["/Link", "/Link"]
        assert annots[0]["/A"]["/URI"] == "https://example.org/"
        assert "/A" not in annots[1]

    def test_the_pages_and_text_are_kept(self):
        copies = files.make_pdf_copies(_letter("Dear Chief,", "Yours, Engine 3"))
        assert copies.page_count == 2
        assert "Dear Chief," in copies.text
        assert "Yours, Engine 3" in copies.text
        assert copies.text_truncated is False
        assert len(PdfReader(io.BytesIO(copies.cleaned)).pages) == 2

    def test_an_embedded_jpeg_loses_its_exif_but_not_its_picture(self):
        jpeg = _jpeg_with_gps()
        original = _pdf_with_jpeg(jpeg)
        assert b"ScannerCo" in original

        copies = files.make_pdf_copies(original)

        assert b"ScannerCo" not in copies.cleaned
        assert b"FILEDBYJANE" not in copies.cleaned
        image = PdfReader(io.BytesIO(copies.cleaned)).pages[0].images[0]
        picture = Image.open(io.BytesIO(image.data))
        assert picture.size == (64, 32)
        assert dict(picture.getexif()) == {}

    def test_the_first_page_is_drawn_as_a_bounded_preview(self):
        copies = files.make_pdf_copies(_letter("Dear Chief,"))
        assert copies.preview is not None
        preview = Image.open(io.BytesIO(copies.preview))
        assert preview.format == "WEBP"
        assert max(preview.size) == 400
        assert dict(preview.getexif()) == {}

    def test_text_past_the_limit_is_cut_and_says_so(self, monkeypatch):
        monkeypatch.setattr(files, "MAX_TEXT_CHARS", 15)
        copies = files.make_pdf_copies(_letter("Dear Chief, the parade", "Page two"))
        assert len(copies.text) <= 15
        assert copies.text_truncated is True

    def test_pages_past_the_limit_are_not_read(self, monkeypatch):
        monkeypatch.setattr(files, "MAX_TEXT_PAGES", 1)
        copies = files.make_pdf_copies(_letter("First page", "Second page"))
        assert "First page" in copies.text
        assert "Second page" not in copies.text
        assert copies.text_truncated is True
        # Every page is still in the copy members open.
        assert copies.page_count == 2

    def test_a_password_protected_pdf_is_refused(self):
        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_letter("x"))))
        writer.encrypt("secret")
        out = io.BytesIO()
        writer.write(out)
        with pytest.raises(files.UnreadableDocument, match="password-protected"):
            files.make_pdf_copies(out.getvalue())

    def test_a_pdf_restricted_only_by_its_owner_is_accepted(self):
        """It opens without a password, so it is not password-protected."""
        writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_letter("Dear Chief,"))))
        writer.encrypt("", owner_password="owner")
        out = io.BytesIO()
        writer.write(out)
        copies = files.make_pdf_copies(out.getvalue())
        assert "Dear Chief," in copies.text
        assert PdfReader(io.BytesIO(copies.cleaned)).is_encrypted is False

    def test_bytes_that_are_not_a_pdf_are_refused(self):
        with pytest.raises(files.UnreadableDocument, match="could not be read"):
            files.make_pdf_copies(b"%PDF-1.4 not really a pdf")


class TestStripJpeg:
    def test_metadata_segments_go_and_the_picture_stays(self):
        jpeg = _jpeg_with_gps()
        cleaned = files.strip_jpeg(jpeg)
        assert b"ScannerCo" not in cleaned
        assert b"FILEDBYJANE" not in cleaned
        picture = Image.open(io.BytesIO(cleaned))
        assert picture.size == (64, 32)
        assert dict(picture.getexif()) == {}

    def test_what_is_not_a_jpeg_is_left_alone(self):
        assert files.strip_jpeg(b"not a jpeg") == b"not a jpeg"


class TestScans:
    def _scan(self, size=(300, 100)) -> bytes:
        image = Image.new("RGB", size, "white")
        exif = image.getexif()
        exif[0x8825] = {1: "N", 2: (40.0, 1.0, 2.0)}
        out = io.BytesIO()
        image.save(out, "JPEG", exif=exif.tobytes())
        return out.getvalue()

    def test_a_scan_gets_the_photo_treatment(self):
        copies = files.make_scan_copies(self._scan())
        for data in (copies.display, copies.thumbnail):
            image = Image.open(io.BytesIO(data))
            assert image.format == "WEBP"
            assert dict(image.getexif()) == {}

    def test_a_scan_may_be_larger_than_a_photo(self, monkeypatch):
        from app.services import history_media_files as media_files

        monkeypatch.setattr(media_files, "MAX_PIXELS", 100)
        monkeypatch.setattr(files, "SCAN_MAX_PIXELS", 50_000)
        assert files.make_scan_copies(self._scan()).width == 300

    def test_a_scan_past_its_own_limit_is_refused(self, monkeypatch):
        monkeypatch.setattr(files, "SCAN_MAX_PIXELS", 100)
        with pytest.raises(files.UnreadableMedia, match="million"):
            files.make_scan_copies(self._scan())
