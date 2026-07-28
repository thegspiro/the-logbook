"""
Cloudflare email attachment builder — unit tests (no network, no DB).

The Cloudflare Email Sending API supports base64 attachments with a 5 MiB
total-message cap; EmailService previously dropped attachments entirely on
that backend (see KNOWN_LIMITATIONS history).
"""

import base64

from app.services.email_service import EmailService


class TestBuildCloudflareAttachments:
    def test_encodes_file_with_mime_type(self, tmp_path):
        pdf = tmp_path / "package.pdf"
        pdf.write_bytes(b"%PDF-1.4 fake content")

        attachments = EmailService._build_cloudflare_attachments([str(pdf)])

        assert len(attachments) == 1
        att = attachments[0]
        assert att["filename"] == "package.pdf"
        assert att["type"] == "application/pdf"
        assert att["disposition"] == "attachment"
        assert base64.b64decode(att["content"]) == b"%PDF-1.4 fake content"

    def test_unknown_extension_falls_back_to_octet_stream(self, tmp_path):
        blob = tmp_path / "data.zzz_unknown"
        blob.write_bytes(b"abc")

        attachments = EmailService._build_cloudflare_attachments([str(blob)])
        assert attachments[0]["type"] == "application/octet-stream"

    def test_missing_file_skipped(self, tmp_path):
        attachments = EmailService._build_cloudflare_attachments(
            [str(tmp_path / "does-not-exist.pdf")]
        )
        assert attachments == []

    def test_none_and_empty_inputs(self):
        assert EmailService._build_cloudflare_attachments(None) == []
        assert EmailService._build_cloudflare_attachments([]) == []

    def test_size_budget_skips_oversize_attachment(self, tmp_path):
        small = tmp_path / "small.pdf"
        small.write_bytes(b"x" * 100)
        big = tmp_path / "big.pdf"
        big.write_bytes(b"y" * 10_000)

        attachments = EmailService._build_cloudflare_attachments(
            [str(small), str(big)], budget_bytes=1_000
        )

        names = [a["filename"] for a in attachments]
        assert names == [
            "small.pdf"
        ], "The over-budget attachment must be skipped, not fail the send"
