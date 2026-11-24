"""Tests for docs-site/csp.py. Run: python -m pytest docs-site/tests"""

import base64
import hashlib
import importlib.util
import pathlib

import pytest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "csp.py"
_spec = importlib.util.spec_from_file_location("csp", SCRIPT)
csp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(csp)


def sha(body):
    return (
        "'sha256-"
        + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode()
        + "'"
    )


def test_an_inline_script_is_hashed_exactly():
    assert csp.inline_script_hashes("<script>var a=1;</script>") == {sha("var a=1;")}


def test_external_and_json_scripts_are_not_hashed():
    html = (
        '<script src="assets/x.js"></script>'
        '<script id="__config" type="application/json">{"a":1}</script>'
    )
    assert csp.inline_script_hashes(html) == set()


def test_a_multiline_script_keeps_its_whitespace():
    body = "\n  __md_scope = 1\n"
    assert csp.inline_script_hashes(f"<script>{body}</script>") == {sha(body)}


def test_hashes_are_collected_once_across_the_site(tmp_path):
    (tmp_path / "a").mkdir()
    (tmp_path / "index.html").write_text("<script>x()</script>")
    (tmp_path / "a" / "index.html").write_text(
        "<script>x()</script><script>y()</script>"
    )
    assert csp.site_hashes(tmp_path) == sorted({sha("x()"), sha("y()")})


def test_render_fills_the_placeholder():
    out = csp.render(
        "script-src 'self' __INLINE_SCRIPT_HASHES__;", ["'sha256-a'", "'sha256-b'"]
    )
    assert out == "script-src 'self' 'sha256-a' 'sha256-b';"


def test_a_template_without_the_placeholder_is_refused():
    with pytest.raises(ValueError):
        csp.render("script-src 'self';", ["'sha256-a'"])


def test_the_committed_template_has_the_placeholder():
    template = SCRIPT.parent / "nginx" / "security-headers.conf"
    assert csp.PLACEHOLDER in template.read_text()
