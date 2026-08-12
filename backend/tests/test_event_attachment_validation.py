"""Regression tests for fail-closed event attachment content validation."""

import builtins
import sys
from types import SimpleNamespace

import pytest

from app.utils.mime_validation import detect_mime_type


def test_detect_attachment_mime_uses_file_content(monkeypatch):
    fake_magic = SimpleNamespace(from_buffer=lambda content, mime: "application/pdf")
    monkeypatch.setitem(sys.modules, "magic", fake_magic)

    assert detect_mime_type(b"%PDF-1.7") == "application/pdf"


def test_detect_attachment_mime_fails_closed_without_magic(monkeypatch):
    original_import = builtins.__import__

    def import_without_magic(name, *args, **kwargs):
        if name == "magic":
            raise ImportError("libmagic unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.delitem(sys.modules, "magic", raising=False)
    monkeypatch.setattr(builtins, "__import__", import_without_magic)

    with pytest.raises(RuntimeError, match="validation is unavailable"):
        detect_mime_type(b"untrusted content")
