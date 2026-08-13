"""
Error-code catalog integrity tests.

These are pure unit tests (no database): they pin the support contract —
every curated code is documented, formatted consistently, can never collide
with the automatic LB-API-<status> family, and resolves correctly from
exceptions.
"""

import re
from pathlib import Path

from fastapi import HTTPException

from app.core.error_codes import (
    ERROR_CODE_CATALOG,
    FALLBACK_STATUS_INFO,
    CodedHTTPException,
    ErrorCode,
    catalog_entries,
    fallback_error_code,
    resolve_error_code,
)

DOCS_PATH = Path(__file__).resolve().parents[2] / "docs" / "ERROR_CODES.md"

CODE_FORMAT = re.compile(r"^LB-[A-Z]+-\d{3}$")


class TestCatalogIntegrity:
    def test_every_code_has_a_catalog_entry(self):
        missing = [c.value for c in ErrorCode if c not in ERROR_CODE_CATALOG]
        assert not missing, f"Codes without catalog entries: {missing}"

    def test_catalog_has_no_orphan_entries(self):
        orphans = [c.value for c in ERROR_CODE_CATALOG if c not in list(ErrorCode)]
        assert not orphans

    def test_code_format_is_consistent(self):
        for code in ErrorCode:
            assert CODE_FORMAT.match(code.value), code.value

    def test_codes_are_unique(self):
        values = [c.value for c in ErrorCode]
        assert len(values) == len(set(values))

    def test_curated_numbers_cannot_collide_with_fallback_family(self):
        # Fallback codes embed the HTTP status (400-599); curated codes must
        # keep their sequence numbers below 100 so LB-XXX-NNN never reads as
        # a status, and no curated code may use the reserved API category.
        for code in ErrorCode:
            _, category, number = code.value.split("-")
            assert category != "API", code.value
            assert int(number) < 100, code.value

    def test_every_entry_is_fully_documented(self):
        for code, info in ERROR_CODE_CATALOG.items():
            assert info.title, code.value
            assert info.description, code.value
            assert info.resolution, code.value


class TestResolution:
    def test_coded_exception_resolves_to_its_code(self):
        exc = CodedHTTPException(
            status_code=401,
            detail="x",
            error_code=ErrorCode.AUTH_SESSION_INVALID,
        )
        assert resolve_error_code(exc) == "LB-AUTH-002"

    def test_plain_http_exception_falls_back_to_status(self):
        assert resolve_error_code(HTTPException(status_code=404)) == "LB-API-404"

    def test_non_http_exception_falls_back_to_500(self):
        assert resolve_error_code(RuntimeError("boom")) == "LB-API-500"

    def test_fallback_code_embeds_status(self):
        assert fallback_error_code(429) == "LB-API-429"

    def test_coded_exception_preserves_headers(self):
        exc = CodedHTTPException(
            status_code=401,
            detail="x",
            error_code=ErrorCode.AUTH_NOT_SIGNED_IN,
            headers={"WWW-Authenticate": "Bearer"},
        )
        assert exc.headers == {"WWW-Authenticate": "Bearer"}
        assert exc.status_code == 401
        assert exc.detail == "x"


class TestReferenceEndpointData:
    def test_entries_cover_curated_and_fallback_families(self):
        entries = catalog_entries()
        codes = {e["code"] for e in entries}
        for code in ErrorCode:
            assert code.value in codes
        for http_status in FALLBACK_STATUS_INFO:
            assert fallback_error_code(http_status) in codes

    def test_entries_are_json_shaped(self):
        for entry in catalog_entries():
            assert set(entry) == {
                "code",
                "category",
                "title",
                "description",
                "resolution",
            }
            assert isinstance(entry["resolution"], list)


class TestDocumentationSync:
    """docs/ERROR_CODES.md is the offline half of the support contract."""

    def test_doc_exists(self):
        assert DOCS_PATH.is_file()

    def test_doc_lists_every_curated_code(self):
        doc = DOCS_PATH.read_text(encoding="utf-8")
        missing = [c.value for c in ErrorCode if c.value not in doc]
        assert not missing, f"docs/ERROR_CODES.md is missing: {missing}"

    def test_doc_lists_common_fallback_codes(self):
        doc = DOCS_PATH.read_text(encoding="utf-8")
        missing = [
            fallback_error_code(s)
            for s in FALLBACK_STATUS_INFO
            if fallback_error_code(s) not in doc
        ]
        assert not missing, f"docs/ERROR_CODES.md is missing: {missing}"
